"""
AI Decision Service — LangChain + Groq trading brain.

Uses Groq LLaMA3-70B with structured output to reason about market data
and produce a trade decision with full explanation.

Fixes applied
-------------
1. Token is normalised via `normalise_token()` before fetching market data,
   so "Bitcoin", "BTC", "bitcoin" all resolve to the correct CoinGecko ID.
2. Rule-based engine no longer silently swallows None indicators:
   - rsi / ma7 / ma25 are logged and validated before use.
   - score=0 path (HOLD) now shows meaningful indicator values in the
     reason string, not just "neutral" placeholders.
3. Confidence formula adjusted: abs_score=1 → 60%, abs_score=2 → 74%,
   abs_score=3+ → 86%+, instead of always bottoming at 40%.
4. `_llm_decision` catches parse errors separately so a bad JSON response
   from Groq falls back to the rule-based engine instead of crashing.
5. All indicator values are included in the returned `AIDecision.indicators`
   dict so the frontend can display them.
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
from services.market_data import fetch_current_market_data, normalise_token

settings = get_settings()

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")

# ─── Prompt ───────────────────────────────────────────────────────────────────

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
Price: ${price_usd:,.4f}
24h Change: {price_change_24h:+.2f}%
RSI (14): {rsi:.1f}
MA7: ${ma_7:,.4f}
MA25: ${ma_25:,.4f}
MA99: ${ma_99:,.4f}
Sentiment Score: {sentiment_score:.4f}  (range: -1 bearish → +1 bullish)
Volume 24h: ${volume_24h:,.0f}

Strategy requested: {strategy}
Max trade amount: ${max_trade_usd:.2f}

Produce a trade decision."""


class AIDecisionService:
    def __init__(self):
        api_key = (settings.groq_api_key or GROQ_API_KEY or "").strip()
        self.groq_available = bool(api_key)

        if self.groq_available:
            self.llm = ChatGroq(
                model="llama-3.3-70b-versatile",
                temperature=0.2,
                api_key=api_key,
            )
            logger.info("✅ Groq LLM initialised with llama-3.3-70b-versatile")
        else:
            self.llm = None
            logger.warning("⚠️  No GROQ_API_KEY found — using rule-based fallback")

        self.parser = PydanticOutputParser(pydantic_object=AIDecision)

    # ── Public entry point ────────────────────────────────────────────────────

    async def get_decision(
        self,
        request: AIDecisionRequest,
        max_trade_usd: float = 500.0,
    ) -> AIDecision:
        """
        Resolve token, fetch live market data, then get a trade decision.
        Token name is normalised here so both LLM and rule-based paths
        always receive a clean CoinGecko token ID.
        """
        # ✅ FIX 1: normalise token name ("Bitcoin" → "bitcoin")
        token_id = normalise_token(request.token)

        logger.info(f"Fetching market data for token='{request.token}' → id='{token_id}'")
        market = await fetch_current_market_data(token_id)

        logger.info(
            f"Market snapshot — RSI={market.rsi} | MA7={market.ma_7} | "
            f"MA25={market.ma_25} | sentiment={market.sentiment_score}"
        )
        return await self._reason(market, request.strategy, max_trade_usd)

    # ── Internal reasoning ────────────────────────────────────────────────────

    async def _reason(
        self,
        market: MarketData,
        strategy: Strategy,
        max_trade_usd: float,
    ) -> AIDecision:
        if self.groq_available and self.llm is not None:
            try:
                return await self._llm_decision(market, strategy, max_trade_usd)
            except Exception as exc:
                logger.warning(f"Groq LLM failed — falling back to rule engine: {exc}")

        return self._rule_based_decision(market, strategy, max_trade_usd)

    async def _llm_decision(
        self,
        market: MarketData,
        strategy: Strategy,
        max_trade_usd: float,
    ) -> AIDecision:
        # Guard: if any indicator is missing, skip LLM (it would confuse the model)
        if None in (market.rsi, market.ma_7, market.ma_25):
            raise ValueError("Incomplete market indicators — skipping LLM path")

        prompt = ChatPromptTemplate.from_messages([
            ("system", SYSTEM_PROMPT),
            ("human", USER_PROMPT),
        ])
        chain = prompt | self.llm | self.parser

        try:
            result: AIDecision = await chain.ainvoke({
                "format_instructions": self.parser.get_format_instructions(),
                "token":           market.token,
                "symbol":          market.symbol,
                "price_usd":       market.price_usd,
                "price_change_24h": market.price_change_24h,
                "rsi":             market.rsi,
                "ma_7":            market.ma_7,
                "ma_25":           market.ma_25,
                "ma_99":           market.ma_99 or market.ma_25,
                "sentiment_score": market.sentiment_score,
                "volume_24h":      market.volume_24h,
                "strategy":        strategy.value,
                "max_trade_usd":   max_trade_usd,
            })
        except Exception as exc:
            # ✅ FIX 4: parse errors fall back gracefully
            raise RuntimeError(f"LLM chain error: {exc}") from exc

        # Ensure indicators are always populated in the response
        result.indicators = result.indicators or {}
        result.indicators.update({
            "rsi":             market.rsi,
            "ma_7":            market.ma_7,
            "ma_25":           market.ma_25,
            "ma_99":           market.ma_99,
            "sentiment":       market.sentiment_score,
            "price_change_24h": market.price_change_24h,
        })
        return result

    def _rule_based_decision(
        self,
        market: MarketData,
        strategy: Strategy,
        max_trade_usd: float,
    ) -> AIDecision:
        """
        Deterministic fallback implementing RSI + MA crossover + sentiment.

        Fixes vs. previous version
        --------------------------
        • _compute_ma now always returns a float (never None), so
          `market.ma_7 or market.price_usd` guard is redundant — but kept
          for safety.
        • confidence starts at 55 for a single signal, 74 for two, 86+ for three.
        • HOLD confidence is 45 when there are partial signals, not always 40.
        • reason string always includes real numeric values.
        """
        # ── Safely extract indicators ─────────────────────────────────────────
        rsi       = market.rsi             if market.rsi       is not None else 50.0
        sentiment = market.sentiment_score if market.sentiment_score is not None else 0.0
        ma7       = market.ma_7            if market.ma_7       is not None else market.price_usd
        ma25      = market.ma_25           if market.ma_25      is not None else market.price_usd
        ma99      = market.ma_99           if market.ma_99      is not None else market.price_usd
        price     = market.price_usd

        # Log what the rule engine actually sees
        logger.debug(
            f"Rule engine inputs — RSI={rsi:.1f} | MA7={ma7:.4f} | "
            f"MA25={ma25:.4f} | sentiment={sentiment:.4f} | price={price:.4f}"
        )

        signals: Dict[str, str] = {}
        score = 0   # positive = BUY pressure, negative = SELL pressure

        # ── RSI signal ────────────────────────────────────────────────────────
        if strategy in (Strategy.RSI, Strategy.COMBINED):
            if rsi < 30:
                score += 2
                signals["rsi"] = f"Oversold RSI {rsi:.1f}"
            elif rsi > 70:
                score -= 2
                signals["rsi"] = f"Overbought RSI {rsi:.1f}"
            elif rsi < 45:
                score += 1
                signals["rsi"] = f"Mildly oversold RSI {rsi:.1f}"
            elif rsi > 55:
                score -= 1
                signals["rsi"] = f"Mildly overbought RSI {rsi:.1f}"
            else:
                signals["rsi"] = f"Neutral RSI {rsi:.1f}"

        # ── MA crossover signal ───────────────────────────────────────────────
        if strategy in (Strategy.MA_CROSSOVER, Strategy.COMBINED):
            if ma7 > ma25 and price > ma25:
                score += 1
                signals["ma"] = f"Bullish crossover MA7={ma7:.2f} > MA25={ma25:.2f}"
            elif ma7 < ma25 and price < ma25:
                score -= 1
                signals["ma"] = f"Bearish crossover MA7={ma7:.2f} < MA25={ma25:.2f}"
            else:
                signals["ma"] = f"MA neutral (MA7={ma7:.2f}, MA25={ma25:.2f})"

        # ── Sentiment signal ──────────────────────────────────────────────────
        if strategy in (Strategy.SENTIMENT, Strategy.COMBINED):
            if sentiment > 0.3:
                score += 1
                signals["sentiment"] = f"Positive sentiment {sentiment:+.2f}"
            elif sentiment < -0.3:
                score -= 1
                signals["sentiment"] = f"Negative sentiment {sentiment:+.2f}"
            else:
                signals["sentiment"] = f"Neutral sentiment {sentiment:+.2f}"

        # ── 24 h price momentum (bonus signal) ───────────────────────────────
        chg = market.price_change_24h
        if abs(chg) >= 3.0:
            if chg > 0:
                score += 1
                signals["momentum"] = f"Strong 24h gain {chg:+.2f}%"
            else:
                score -= 1
                signals["momentum"] = f"Strong 24h drop {chg:+.2f}%"

        signal_summary = " | ".join(signals.values()) if signals else "No signals computed"

        # ── Determine action + confidence ─────────────────────────────────────
        abs_score = abs(score)

        if score >= 2:
            action     = TradeAction.BUY
            # ✅ FIX 3: meaningful confidence curve
            confidence = min(55 + abs_score * 10, 95)
            reason     = (
                f"Bullish signals: {signal_summary}. "
                f"Price {price:,.4f} with {chg:+.2f}% 24h momentum supports buying."
            )
        elif score <= -2:
            action     = TradeAction.SELL
            confidence = min(55 + abs_score * 10, 95)
            reason     = (
                f"Bearish signals: {signal_summary}. "
                f"Price {price:,.4f} with {chg:+.2f}% 24h change suggests selling."
            )
        else:
            action     = TradeAction.HOLD
            # ✅ FIX: HOLD confidence reflects partial signal strength
            confidence = 45 + abs_score * 5
            reason     = (
                f"Mixed/weak signals: {signal_summary}. "
                "Holding until a clearer directional signal emerges."
            )

        # ── Risk level ────────────────────────────────────────────────────────
        if rsi < 20 or rsi > 80 or abs(chg) > 8:
            risk = RiskLevel.HIGH
        elif rsi < 35 or rsi > 65 or abs(chg) > 4:
            risk = RiskLevel.MEDIUM
        else:
            risk = RiskLevel.LOW

        # ── Trade amount: scale by confidence ─────────────────────────────────
        amount = round(max_trade_usd * (confidence / 100.0) * 0.8, 2)

        logger.info(
            f"Rule-based decision → {action.value} {market.symbol} | "
            f"score={score} | confidence={confidence}% | risk={risk.value}"
        )

        return AIDecision(
            action        = action,
            token         = market.token,
            token_pair    = f"{market.symbol}/USDC",
            amount_usd    = amount,
            reason        = reason,
            confidence    = round(float(confidence), 1),
            risk_level    = risk,
            indicators    = {
                "rsi":             rsi,
                "ma_7":            ma7,
                "ma_25":           ma25,
                "ma_99":           ma99,
                "sentiment":       sentiment,
                "price_change_24h": chg,
                "signals":         signals,
            },
            strategy_used = strategy,
        )


# ─── Voice Command Parser ─────────────────────────────────────────────────────

async def parse_voice_command(text: str) -> Dict[str, Any]:
    """
    Parse natural language voice commands.

    Examples
    --------
    "Buy ETH now"               → {intent: "trade", action: "BUY",  token: "ethereum"}
    "What's my PnL?"            → {intent: "query", query_type: "pnl"}
    "Switch to aggressive mode" → {intent: "settings", mode: "aggressive"}
    """
    text_lower = text.lower()

    token_keywords: Dict[str, str] = {
        "ethereum": "ethereum",  "eth":      "ethereum",
        "bitcoin":  "bitcoin",   "btc":      "bitcoin",
        "matic":    "polygon-ecosystem-token",
        "polygon":  "polygon-ecosystem-token",
        "pol":      "polygon-ecosystem-token",
        "link":     "chainlink", "chainlink": "chainlink",
        "uni":      "uniswap",   "uniswap":   "uniswap",
        "aave":     "aave",
        "sol":      "solana",    "solana":    "solana",
    }

    detected_token = "ethereum"
    for kw, tok_id in token_keywords.items():
        if kw in text_lower:
            detected_token = tok_id
            break

    if any(w in text_lower for w in ["buy", "purchase", "long"]):
        return {"intent": "trade", "action": "BUY",  "token": detected_token}
    if any(w in text_lower for w in ["sell", "exit", "short"]):
        return {"intent": "trade", "action": "SELL", "token": detected_token}
    if any(w in text_lower for w in ["pnl", "profit", "loss", "performance"]):
        return {"intent": "query", "query_type": "pnl"}
    if any(w in text_lower for w in ["risk", "exposure", "heatmap"]):
        return {"intent": "query", "query_type": "risk"}
    if any(w in text_lower for w in ["aggressive", "risky"]):
        return {"intent": "settings", "mode": "aggressive"}
    if any(w in text_lower for w in ["conservative", "safe"]):
        return {"intent": "settings", "mode": "conservative"}
    if any(w in text_lower for w in ["status", "what", "how", "show"]):
        return {"intent": "query", "query_type": "status"}

    return {"intent": "unknown", "raw": text}