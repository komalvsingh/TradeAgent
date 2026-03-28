"""
AI Decision Service — LangChain + Groq trading brain.

New features added
------------------
1. Explainability Engine: why[], why_not_alternatives, alternative_actions
2. Proof Layer: decision_hash (SHA3-256 of decision data)
3. Strategy Comparison: run_strategy_comparison() runs all 4 strategies
4. What-If Simulator: simulate_strategies() returns simulated PnL per strategy
"""
from __future__ import annotations

import hashlib
import json
import os
from typing import Any, Dict, List

from langchain_groq import ChatGroq
from langchain.prompts import ChatPromptTemplate
from langchain.output_parsers import PydanticOutputParser
from loguru import logger
from dotenv import load_dotenv

load_dotenv()

from core.config import get_settings
from models.schemas import (
    AIDecision, AIDecisionRequest, MarketData,
    TradeAction, RiskLevel, Strategy, StrategyComparisonResult,
)
from services.market_data import fetch_current_market_data, normalise_token

settings     = get_settings()
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")

# ─── Prompts ──────────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are an expert DeFi trading agent with deep knowledge of
technical analysis, risk management, and on-chain markets.

Given real-time market data, produce a structured trade decision with FULL EXPLAINABILITY.

You MUST return a JSON object matching the output schema exactly, including:
- action: BUY | SELL | HOLD
- reason: 1-2 sentence summary
- confidence: 0-100
- risk_level: LOW | MEDIUM | HIGH
- why: array of 3-4 specific bullet reasons (each under 15 words)
- why_not_alternatives: one sentence explaining why the other actions are suboptimal

Rules:
- RSI < 30 → oversold → lean BUY
- RSI > 70 → overbought → lean SELL  
- MA7 > MA25 + price > MA25 → bullish
- Sentiment < -0.3 → bearish | > 0.3 → bullish
- HOLD when signals conflict or confidence < 50

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
Sentiment: {sentiment_score:.4f}
Volume 24h: ${volume_24h:,.0f}
Strategy: {strategy}
Max trade: ${max_trade_usd:.2f}

Produce a full explainable trade decision."""


def _make_decision_hash(decision: AIDecision) -> str:
    """Generate SHA3-256 proof hash from decision data."""
    payload = {
        "action":     decision.action.value,
        "token":      decision.token,
        "confidence": decision.confidence,
        "reason":     decision.reason,
        "timestamp":  decision.timestamp.isoformat(),
    }
    raw  = json.dumps(payload, sort_keys=True).encode()
    return "0x" + hashlib.sha3_256(raw).hexdigest()


def _build_alternative_actions(
    action: TradeAction,
    market: MarketData,
    why_not: str,
) -> List[dict]:
    """Build the 2 non-chosen alternatives with brief reasons."""
    all_actions = [TradeAction.BUY, TradeAction.SELL, TradeAction.HOLD]
    alts = []
    for a in all_actions:
        if a == action:
            continue
        if a == TradeAction.BUY:
            reason = f"RSI {market.rsi:.1f} not in oversold territory yet." if market.rsi else "Insufficient bullish signals."
        elif a == TradeAction.SELL:
            reason = f"No confirmed downtrend — price holding above MA25." if market.ma_25 and market.price_usd > market.ma_25 else "Downside signals not confirmed."
        else:
            reason = "Sufficient signal strength exists to act rather than hold."
        alts.append({"action": a.value, "confidence": 0, "reason": reason})
    return alts


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
            logger.warning("⚠️  No GROQ_API_KEY — rule-based fallback active")

        self.parser = PydanticOutputParser(pydantic_object=AIDecision)

    # ── Public entry point ────────────────────────────────────────────────────

    async def get_decision(
        self,
        request: AIDecisionRequest,
        max_trade_usd: float = 500.0,
    ) -> AIDecision:
        token_id = normalise_token(request.token)
        logger.info(f"Fetching market data: '{request.token}' → '{token_id}'")
        market = await fetch_current_market_data(token_id)
        logger.info(
            f"Market snapshot RSI={market.rsi} MA7={market.ma_7} "
            f"MA25={market.ma_25} sentiment={market.sentiment_score}"
        )
        return await self._reason(market, request.strategy, max_trade_usd)

    # ── Strategy Comparison (Feature 4) ───────────────────────────────────────

    async def run_strategy_comparison(
        self,
        token: str,
        wallet_address: str,
        max_trade_usd: float = 500.0,
    ) -> List[StrategyComparisonResult]:
        """Run all 4 strategies on the same market snapshot and return comparison."""
        token_id = normalise_token(token)
        market   = await fetch_current_market_data(token_id)
        results  = []

        for strategy in Strategy:
            try:
                decision = await self._reason(market, strategy, max_trade_usd)
                # Simulate PnL based on 24h change
                chg = market.price_change_24h / 100
                if decision.action == TradeAction.BUY:
                    sim_pnl = round(decision.amount_usd * chg, 4)
                elif decision.action == TradeAction.SELL:
                    sim_pnl = round(decision.amount_usd * -chg, 4)
                else:
                    sim_pnl = 0.0

                results.append(StrategyComparisonResult(
                    strategy   = strategy.value,
                    action     = decision.action.value,
                    confidence = decision.confidence,
                    amount_usd = decision.amount_usd,
                    reason     = decision.reason,
                    sim_pnl    = sim_pnl,
                ))
            except Exception as e:
                logger.warning(f"Strategy {strategy.value} comparison failed: {e}")

        # Sort by simulated PnL descending
        results.sort(key=lambda x: x.sim_pnl or 0, reverse=True)
        return results

    # ── What-If Simulator (Feature 5) ─────────────────────────────────────────

    async def simulate_what_if(
        self,
        token: str,
        max_trade_usd: float = 500.0,
    ) -> dict:
        """Simulate all strategies and show what would have happened."""
        token_id = normalise_token(token)
        market   = await fetch_current_market_data(token_id)
        results  = await self.run_strategy_comparison(token, "", max_trade_usd)

        best     = results[0] if results else None
        worst    = results[-1] if results else None

        return {
            "token":            token_id,
            "current_price":    market.price_usd,
            "price_change_24h": market.price_change_24h,
            "rsi":              market.rsi,
            "strategies":       [r.model_dump() for r in results],
            "best_strategy":    best.strategy if best else None,
            "worst_strategy":   worst.strategy if worst else None,
            "summary": (
                f"If you had traded {token_id.upper()} today, the best strategy would have been "
                f"{best.strategy} ({best.action}) with simulated PnL of ${best.sim_pnl:+.4f}."
            ) if best else "No simulation data available.",
        }

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
        if None in (market.rsi, market.ma_7, market.ma_25):
            raise ValueError("Incomplete indicators — skipping LLM path")

        prompt = ChatPromptTemplate.from_messages([
            ("system", SYSTEM_PROMPT),
            ("human",  USER_PROMPT),
        ])
        chain = prompt | self.llm | self.parser

        try:
            result: AIDecision = await chain.ainvoke({
                "format_instructions": self.parser.get_format_instructions(),
                "token":              market.token,
                "symbol":             market.symbol,
                "price_usd":          market.price_usd,
                "price_change_24h":   market.price_change_24h,
                "rsi":                market.rsi,
                "ma_7":               market.ma_7,
                "ma_25":              market.ma_25,
                "ma_99":              market.ma_99 or market.ma_25,
                "sentiment_score":    market.sentiment_score,
                "volume_24h":         market.volume_24h,
                "strategy":           strategy.value,
                "max_trade_usd":      max_trade_usd,
            })
        except Exception as exc:
            raise RuntimeError(f"LLM chain error: {exc}") from exc

        # Enrich indicators
        result.indicators = result.indicators or {}
        result.indicators.update({
            "rsi": market.rsi, "ma_7": market.ma_7, "ma_25": market.ma_25,
            "ma_99": market.ma_99, "sentiment": market.sentiment_score,
            "price_change_24h": market.price_change_24h,
        })

        # Add explainability if LLM didn't provide it
        if not result.why:
            result.why = self._build_why_bullets(market, result.action, strategy)
        if not result.why_not_alternatives:
            result.why_not_alternatives = f"Chosen action {result.action.value} has strongest signal confirmation."
        if not result.alternative_actions:
            result.alternative_actions = _build_alternative_actions(result.action, market, result.why_not_alternatives)

        # Proof hash
        result.decision_hash = _make_decision_hash(result)
        return result

    def _rule_based_decision(
        self,
        market: MarketData,
        strategy: Strategy,
        max_trade_usd: float,
    ) -> AIDecision:
        rsi       = market.rsi             if market.rsi            is not None else 50.0
        sentiment = market.sentiment_score if market.sentiment_score is not None else 0.0
        ma7       = market.ma_7            if market.ma_7            is not None else market.price_usd
        ma25      = market.ma_25           if market.ma_25           is not None else market.price_usd
        ma99      = market.ma_99           if market.ma_99           is not None else market.price_usd
        price     = market.price_usd
        chg       = market.price_change_24h

        logger.debug(f"Rule engine: RSI={rsi:.1f} MA7={ma7:.4f} MA25={ma25:.4f} s={sentiment:.4f}")

        signals: Dict[str, str] = {}
        score = 0

        if strategy in (Strategy.RSI, Strategy.COMBINED):
            if rsi < 30:   score += 2; signals["rsi"] = f"Oversold RSI {rsi:.1f}"
            elif rsi > 70: score -= 2; signals["rsi"] = f"Overbought RSI {rsi:.1f}"
            elif rsi < 45: score += 1; signals["rsi"] = f"Mildly oversold RSI {rsi:.1f}"
            elif rsi > 55: score -= 1; signals["rsi"] = f"Mildly overbought RSI {rsi:.1f}"
            else:                      signals["rsi"] = f"Neutral RSI {rsi:.1f}"

        if strategy in (Strategy.MA_CROSSOVER, Strategy.COMBINED):
            if ma7 > ma25 and price > ma25:
                score += 1; signals["ma"] = f"Bullish crossover MA7={ma7:.2f} > MA25={ma25:.2f}"
            elif ma7 < ma25 and price < ma25:
                score -= 1; signals["ma"] = f"Bearish crossover MA7={ma7:.2f} < MA25={ma25:.2f}"
            else:
                signals["ma"] = f"MA neutral (MA7={ma7:.2f}, MA25={ma25:.2f})"

        if strategy in (Strategy.SENTIMENT, Strategy.COMBINED):
            if sentiment > 0.3:   score += 1; signals["sentiment"] = f"Positive sentiment {sentiment:+.2f}"
            elif sentiment < -0.3: score -= 1; signals["sentiment"] = f"Negative sentiment {sentiment:+.2f}"
            else:                              signals["sentiment"] = f"Neutral sentiment {sentiment:+.2f}"

        if abs(chg) >= 3.0:
            if chg > 0: score += 1; signals["momentum"] = f"Strong 24h gain {chg:+.2f}%"
            else:       score -= 1; signals["momentum"] = f"Strong 24h drop {chg:+.2f}%"

        abs_score = abs(score)

        if score >= 2:
            action     = TradeAction.BUY
            confidence = min(55 + abs_score * 10, 95)
            reason     = f"Bullish signals: {' | '.join(signals.values())}. Price {price:,.4f} with {chg:+.2f}% momentum."
        elif score <= -2:
            action     = TradeAction.SELL
            confidence = min(55 + abs_score * 10, 95)
            reason     = f"Bearish signals: {' | '.join(signals.values())}. Price {price:,.4f} with {chg:+.2f}% change."
        else:
            action     = TradeAction.HOLD
            confidence = 45 + abs_score * 5
            reason     = f"Mixed/weak signals: {' | '.join(signals.values())}. Holding for clearer direction."

        if rsi < 20 or rsi > 80 or abs(chg) > 8: risk = RiskLevel.HIGH
        elif rsi < 35 or rsi > 65 or abs(chg) > 4: risk = RiskLevel.MEDIUM
        else: risk = RiskLevel.LOW

        amount = round(max_trade_usd * (confidence / 100.0) * 0.8, 2)

        # ── Build explainability ──────────────────────────────────────────────
        why_bullets = self._build_why_bullets(market, action, strategy)
        why_not     = self._build_why_not(action, signals, market)
        alt_actions = _build_alternative_actions(action, market, why_not)

        decision = AIDecision(
            action                = action,
            token                 = market.token,
            token_pair            = f"{market.symbol}/USDC",
            amount_usd            = amount,
            reason                = reason,
            confidence            = round(float(confidence), 1),
            risk_level            = risk,
            indicators            = {
                "rsi": rsi, "ma_7": ma7, "ma_25": ma25, "ma_99": ma99,
                "sentiment": sentiment, "price_change_24h": chg, "signals": signals,
            },
            strategy_used         = strategy,
            why                   = why_bullets,
            why_not_alternatives  = why_not,
            alternative_actions   = alt_actions,
        )

        # ── Proof hash (Feature 2) ────────────────────────────────────────────
        decision.decision_hash = _make_decision_hash(decision)

        logger.info(
            f"Rule decision → {action.value} {market.symbol} | "
            f"score={score} confidence={confidence}% | hash={decision.decision_hash[:12]}..."
        )
        return decision

    def _build_why_bullets(
        self,
        market: MarketData,
        action: TradeAction,
        strategy: Strategy,
    ) -> List[str]:
        """Generate 3-4 specific bullet point reasons from market data."""
        bullets = []
        rsi = market.rsi or 50.0
        s   = market.sentiment_score or 0.0
        ma7 = market.ma_7 or market.price_usd
        ma25= market.ma_25 or market.price_usd
        chg = market.price_change_24h

        # RSI bullet
        if rsi < 30:
            bullets.append(f"RSI at {rsi:.1f} — deeply oversold, historically a reversal zone")
        elif rsi > 70:
            bullets.append(f"RSI at {rsi:.1f} — overbought, momentum likely to fade")
        else:
            bullets.append(f"RSI at {rsi:.1f} — in neutral range, no extreme pressure")

        # MA bullet
        if ma7 > ma25:
            bullets.append(f"7-day MA (${ma7:.2f}) above 25-day MA (${ma25:.2f}) — bullish crossover")
        else:
            bullets.append(f"7-day MA (${ma7:.2f}) below 25-day MA (${ma25:.2f}) — bearish crossover")

        # Sentiment bullet
        if s > 0.3:
            bullets.append(f"Market sentiment positive at {s:.2f} — buyers in control")
        elif s < -0.3:
            bullets.append(f"Market sentiment negative at {s:.2f} — selling pressure present")
        else:
            bullets.append(f"Sentiment neutral at {s:.2f} — no strong directional bias")

        # Momentum bullet
        if abs(chg) > 2:
            bullets.append(f"24h price movement {chg:+.2f}% — {'strong bullish' if chg > 0 else 'strong bearish'} momentum")

        return bullets[:4]

    def _build_why_not(
        self,
        action: TradeAction,
        signals: Dict[str, str],
        market: MarketData,
    ) -> str:
        ma7  = market.ma_7 or market.price_usd
        ma25 = market.ma_25 or market.price_usd
        rsi  = market.rsi or 50.0

        if action == TradeAction.BUY:
            return f"Selling is not supported because no confirmed downtrend exists — MA7 (${ma7:.2f}) and price momentum do not indicate reversal."
        elif action == TradeAction.SELL:
            return f"Buying is not supported because RSI at {rsi:.1f} and current momentum suggest further downside before a reversal."
        else:
            return f"Acting (BUY or SELL) requires stronger signal confirmation — current indicators show {len(signals)} conflicting signals."


# ─── Voice Command Parser ─────────────────────────────────────────────────────

async def parse_voice_command(text: str) -> Dict[str, Any]:
    text_lower = text.lower()
    token_keywords: Dict[str, str] = {
        "ethereum": "ethereum", "eth":      "ethereum",
        "bitcoin":  "bitcoin",  "btc":      "bitcoin",
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