"""
AI Decision Service — LangChain + Groq trading brain.

Uses Groq LLaMA3-70B with structured output to reason about market data
and produce a trade decision with full explanation.
"""
from __future__ import annotations
import os
from typing import Any, Dict
from langchain_groq import ChatGroq
from langchain.prompts import ChatPromptTemplate
from langchain.output_parsers import PydanticOutputParser
from loguru import logger
from dotenv import load_dotenv

load_dotenv()

from core.config import get_settings
from models.schemas import (
    AIDecision,
    AIDecisionRequest,
    MarketData,
    TradeAction,
    RiskLevel,
    Strategy,
)
from services.market_data import fetch_current_market_data

settings = get_settings()

# Read Groq key directly from env as backup
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")

# ─── Prompt ──────────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are an expert DeFi trading agent with deep knowledge of
technical analysis, risk management, and on-chain markets.

You will be given real-time market data for a crypto token and you must:
1. Analyse the data using the requested strategy
2. Decide BUY / SELL / HOLD
3. Give a clear, concise reason (1-2 sentences max)
4. Rate your confidence (0-100)
5. Assess risk level (LOW / MEDIUM / HIGH)

Rules:
- RSI < 30 → oversold → lean BUY
- RSI > 70 → overbought → lean SELL
- Price above MA7 > MA25 → bullish → lean BUY
- Sentiment < -0.3 → bearish → lean SELL
- Sentiment > 0.3 → bullish → lean BUY
- Never risk more than the agent's max trade limit
- HOLD when signals are conflicting or confidence < 50

{format_instructions}
"""

USER_PROMPT = """Market Data:
Token: {token} ({symbol})
Price: ${price_usd}
24h Change: {price_change_24h}%
RSI (14): {rsi}
MA7: ${ma_7}
MA25: ${ma_25}
MA99: ${ma_99}
Sentiment Score: {sentiment_score}  (range: -1 bearish → +1 bullish)
Volume 24h: ${volume_24h}

Strategy requested: {strategy}
Max trade amount: ${max_trade_usd}

Produce a trade decision."""


class AIDecisionService:
    def __init__(self):
        # Use settings first, fallback to direct env read
        api_key = settings.groq_api_key or GROQ_API_KEY or ""
        self.groq_available = bool(api_key)

        if self.groq_available:
            self.llm = ChatGroq(
                model="llama-3.3-70b-versatile",
                temperature=0.2,
                api_key=api_key,
            )
            logger.info("✅ Groq LLM initialized with llama-3.3-70b-versatile")
        else:
            self.llm = None
            logger.warning("⚠️  No GROQ_API_KEY found — using rule-based fallback")

        self.parser = PydanticOutputParser(pydantic_object=AIDecision)

    async def get_decision(
        self,
        request: AIDecisionRequest,
        max_trade_usd: float = 500.0,
    ) -> AIDecision:
        """Fetch market data then ask Groq LLaMA3 for a trade decision."""
        market = await fetch_current_market_data(request.token)
        return await self._reason(market, request.strategy, max_trade_usd)

    async def _reason(
        self,
        market: MarketData,
        strategy: Strategy,
        max_trade_usd: float,
    ) -> AIDecision:
        # Try Groq LLM first, fall back to rule-based engine
        if self.groq_available and self.llm is not None:
            try:
                return await self._llm_decision(market, strategy, max_trade_usd)
            except Exception as e:
                logger.warning(f"Groq LLM decision failed, using rule-based fallback: {e}")

        return self._rule_based_decision(market, strategy, max_trade_usd)

    async def _llm_decision(
        self,
        market: MarketData,
        strategy: Strategy,
        max_trade_usd: float,
    ) -> AIDecision:
        prompt = ChatPromptTemplate.from_messages([
            ("system", SYSTEM_PROMPT),
            ("human", USER_PROMPT),
        ])

        chain = prompt | self.llm | self.parser

        result: AIDecision = await chain.ainvoke({
            "format_instructions": self.parser.get_format_instructions(),
            "token": market.token,
            "symbol": market.symbol,
            "price_usd": market.price_usd,
            "price_change_24h": market.price_change_24h,
            "rsi": market.rsi,
            "ma_7": market.ma_7,
            "ma_25": market.ma_25,
            "ma_99": market.ma_99,
            "sentiment_score": market.sentiment_score,
            "volume_24h": market.volume_24h,
            "strategy": strategy.value,
            "max_trade_usd": max_trade_usd,
        })
        return result

    def _rule_based_decision(
        self,
        market: MarketData,
        strategy: Strategy,
        max_trade_usd: float,
    ) -> AIDecision:
        """
        Deterministic fallback when no Groq key is provided.
        Implements RSI + MA crossover + sentiment logic.
        """
        rsi = market.rsi or 50.0
        sentiment = market.sentiment_score or 0.0
        ma7 = market.ma_7 or market.price_usd
        ma25 = market.ma_25 or market.price_usd
        price = market.price_usd

        signals: Dict[str, Any] = {}
        score = 0  # positive = BUY, negative = SELL

        # RSI signal
        if strategy in (Strategy.RSI, Strategy.COMBINED):
            if rsi < 30:
                score += 2
                signals["rsi"] = f"Oversold ({rsi:.1f})"
            elif rsi > 70:
                score -= 2
                signals["rsi"] = f"Overbought ({rsi:.1f})"
            else:
                signals["rsi"] = f"Neutral ({rsi:.1f})"

        # MA crossover signal
        if strategy in (Strategy.MA_CROSSOVER, Strategy.COMBINED):
            if ma7 > ma25 and price > ma25:
                score += 1
                signals["ma"] = "Bullish MA crossover (MA7 > MA25)"
            elif ma7 < ma25 and price < ma25:
                score -= 1
                signals["ma"] = "Bearish MA crossover (MA7 < MA25)"
            else:
                signals["ma"] = "MA crossover neutral"

        # Sentiment signal
        if strategy in (Strategy.SENTIMENT, Strategy.COMBINED):
            if sentiment > 0.3:
                score += 1
                signals["sentiment"] = f"Positive sentiment ({sentiment:.2f})"
            elif sentiment < -0.3:
                score -= 1
                signals["sentiment"] = f"Negative sentiment ({sentiment:.2f})"
            else:
                signals["sentiment"] = f"Neutral sentiment ({sentiment:.2f})"

        # Determine action + confidence
        abs_score = abs(score)
        if score >= 2:
            action = TradeAction.BUY
            confidence = min(50 + abs_score * 12, 95)
            reason = (
                f"Multiple bullish signals: {'; '.join(signals.values())}. "
                f"RSI at {rsi:.1f} and sentiment at {sentiment:.2f} suggest upward momentum."
            )
        elif score <= -2:
            action = TradeAction.SELL
            confidence = min(50 + abs_score * 12, 95)
            reason = (
                f"Multiple bearish signals: {'; '.join(signals.values())}. "
                f"RSI at {rsi:.1f} and sentiment at {sentiment:.2f} suggest downward pressure."
            )
        else:
            action = TradeAction.HOLD
            confidence = 40 + abs_score * 5
            reason = (
                f"Mixed signals detected: {'; '.join(signals.values())}. "
                "Holding position until clearer direction emerges."
            )

        # Risk level
        if rsi < 20 or rsi > 80 or abs(market.price_change_24h) > 8:
            risk = RiskLevel.HIGH
        elif rsi < 35 or rsi > 65 or abs(market.price_change_24h) > 4:
            risk = RiskLevel.MEDIUM
        else:
            risk = RiskLevel.LOW

        # Trade amount (scale by confidence)
        amount = round(max_trade_usd * (confidence / 100) * 0.8, 2)

        return AIDecision(
            action=action,
            token=market.token,
            token_pair=f"{market.symbol}/USDC",
            amount_usd=amount,
            reason=reason,
            confidence=round(confidence, 1),
            risk_level=risk,
            indicators={
                "rsi": rsi,
                "ma_7": ma7,
                "ma_25": ma25,
                "ma_99": market.ma_99,
                "sentiment": sentiment,
                "price_change_24h": market.price_change_24h,
                "signals": signals,
            },
            strategy_used=strategy,
        )


# ─── Voice Command Parser ─────────────────────────────────────────────────────

async def parse_voice_command(text: str) -> Dict[str, Any]:
    """
    Parse natural language voice commands.
    Examples:
      "Buy ETH now"              → {intent: "trade", action: "BUY", token: "ethereum"}
      "What's my PnL?"           → {intent: "query", query_type: "pnl"}
      "Switch to aggressive mode"→ {intent: "settings", mode: "aggressive"}
    """
    text_lower = text.lower()

    # Identify token
    token_keywords = {
        "ethereum": "ethereum", "eth": "ethereum",
        "bitcoin": "bitcoin", "btc": "bitcoin",
        "matic": "polygon-ecosystem-token", "polygon": "polygon-ecosystem-token", "pol": "polygon-ecosystem-token",
        "link": "chainlink", "chainlink": "chainlink",
        "uni": "uniswap", "uniswap": "uniswap",
    }
    detected_token = "ethereum"  # default
    for kw, tok_id in token_keywords.items():
        if kw in text_lower:
            detected_token = tok_id
            break

    # Identify intent
    if any(w in text_lower for w in ["buy", "purchase", "long"]):
        return {"intent": "trade", "action": "BUY", "token": detected_token}
    elif any(w in text_lower for w in ["sell", "exit", "short"]):
        return {"intent": "trade", "action": "SELL", "token": detected_token}
    elif any(w in text_lower for w in ["pnl", "profit", "loss", "performance"]):
        return {"intent": "query", "query_type": "pnl"}
    elif any(w in text_lower for w in ["risk", "exposure", "heatmap"]):
        return {"intent": "query", "query_type": "risk"}
    elif any(w in text_lower for w in ["aggressive", "risky"]):
        return {"intent": "settings", "mode": "aggressive"}
    elif any(w in text_lower for w in ["conservative", "safe"]):
        return {"intent": "settings", "mode": "conservative"}
    elif any(w in text_lower for w in ["status", "what", "how", "show"]):
        return {"intent": "query", "query_type": "status"}
    else:
        return {"intent": "unknown", "raw": text}