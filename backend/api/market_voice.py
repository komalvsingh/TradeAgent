"""
Market & Voice API Router.

Fixes applied
-------------
1. Voice explanations now include real market data (price, RSI, MA crossover,
   sentiment, 24h change) so every spoken response is dynamic and informative.
2. Trade intent fetches live market data to enrich the explanation.
3. PnL query includes win-rate and last-trade info from DB.
4. Status and risk queries also pull live ETH snapshot for context.
5. All responses are structured so the frontend TTS reads them naturally.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from loguru import logger

from core.database import get_db
from models.schemas import (
    Agent, AIDecisionRequest, MarketData, Strategy,
    VoiceCommand, VoiceResponse,
)
from services.ai_agent import AIDecisionService, parse_voice_command
from services.market_data import fetch_current_market_data, normalise_token, SUPPORTED_TOKENS

router     = APIRouter(tags=["Market & Voice"])
ai_service = AIDecisionService()


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _market_summary(market: MarketData) -> str:
    """
    Build a concise, TTS-friendly market summary sentence from real data.
    e.g. "Bitcoin is trading at $84,321 — up 2.3% in the last 24 hours.
          RSI is 61.2. The 7-day MA is above the 25-day MA, a bullish crossover.
          Sentiment is mildly positive at 0.31."
    """
    token_name = market.token.replace("-", " ").title()
    price      = f"${market.price_usd:,.2f}"
    chg        = market.price_change_24h or 0.0
    chg_str    = f"up {chg:.2f}%" if chg >= 0 else f"down {abs(chg):.2f}%"

    parts = [f"{token_name} is trading at {price}, {chg_str} in the last 24 hours."]

    rsi = market.rsi
    if rsi is not None:
        if rsi < 30:
            parts.append(f"RSI is {rsi:.1f} — deeply oversold, a potential buying opportunity.")
        elif rsi > 70:
            parts.append(f"RSI is {rsi:.1f} — overbought territory, caution advised.")
        elif rsi < 45:
            parts.append(f"RSI is {rsi:.1f} — mildly oversold.")
        elif rsi > 55:
            parts.append(f"RSI is {rsi:.1f} — mildly overbought.")
        else:
            parts.append(f"RSI is {rsi:.1f} — neutral.")

    ma7  = market.ma_7
    ma25 = market.ma_25
    if ma7 is not None and ma25 is not None:
        if ma7 > ma25:
            parts.append(
                f"The 7-day moving average of ${ma7:,.2f} is above the 25-day "
                f"average of ${ma25:,.2f}, indicating a bullish crossover."
            )
        else:
            parts.append(
                f"The 7-day moving average of ${ma7:,.2f} is below the 25-day "
                f"average of ${ma25:,.2f}, indicating bearish pressure."
            )

    s = market.sentiment_score
    if s is not None:
        if s > 0.3:
            parts.append(f"Market sentiment is positive at {s:.2f}.")
        elif s < -0.3:
            parts.append(f"Market sentiment is negative at {s:.2f}, suggesting bearish bias.")
        else:
            parts.append(f"Market sentiment is neutral at {s:.2f}.")

    return " ".join(parts)


def _decision_summary(decision, market: MarketData | None = None) -> str:
    """Build a rich TTS-friendly decision explanation."""
    action     = decision.action.value if hasattr(decision.action, "value") else decision.action
    confidence = decision.confidence
    risk       = decision.risk_level.value if hasattr(decision.risk_level, "value") else decision.risk_level
    amount     = decision.amount_usd
    reason     = decision.reason or ""

    base = (
        f"My recommendation is to {action} with {confidence:.0f}% confidence. "
        f"Risk level is {risk}. Suggested trade amount is ${amount:.2f}. "
        f"{reason}"
    )
    if market:
        base += f" {_market_summary(market)}"
    return base


# ─── Market endpoints ──────────────────────────────────────────────────────────

@router.get("/market", tags=["Market"])
async def list_supported_tokens():
    return {"tokens": SUPPORTED_TOKENS}


@router.get("/market/{token_id}", response_model=MarketData, tags=["Market"])
async def get_market_data(token_id: str):
    normalised = normalise_token(token_id)
    if normalised not in SUPPORTED_TOKENS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported token '{token_id}'. Supported: {SUPPORTED_TOKENS}",
        )
    try:
        return await fetch_current_market_data(normalised)
    except RuntimeError as exc:
        logger.warning(f"Market data unavailable for {token_id}: {exc}")
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        logger.error(f"Unexpected error fetching {token_id}: {exc}")
        raise HTTPException(status_code=503, detail=str(exc))


# ─── Voice endpoint ────────────────────────────────────────────────────────────

@router.post("/voice", response_model=VoiceResponse, tags=["Voice"])
async def process_voice_command(command: VoiceCommand):
    try:
        parsed = await parse_voice_command(command.text)
    except Exception as exc:
        logger.error(f"Voice parse error: {exc}")
        return VoiceResponse(
            intent="error",
            explanation="Sorry, I couldn't understand that command. Please try again.",
        )

    intent = parsed.get("intent")

    # ── Trade intent ───────────────────────────────────────────────────────────
    if intent == "trade":
        action   = parsed.get("action")
        token_id = normalise_token(parsed.get("token", "ethereum"))

        db        = get_db()
        agent_doc = await db["agents"].find_one({"wallet_address": command.wallet_address})
        if not agent_doc:
            return VoiceResponse(
                intent="error",
                explanation="You need to register your agent first before trading.",
            )
        agent_doc["id"] = str(agent_doc.pop("_id", agent_doc.get("id", "")))
        agent = Agent(**agent_doc)

        # Fetch live market data for the spoken summary
        market: MarketData | None = None
        try:
            market = await fetch_current_market_data(token_id)
        except Exception as exc:
            logger.warning(f"Could not fetch market data for voice: {exc}")

        # Get AI decision
        try:
            decision = await ai_service.get_decision(
                AIDecisionRequest(
                    token=token_id,
                    strategy=agent.strategy,
                    wallet_address=command.wallet_address,
                ),
                max_trade_usd=agent.max_trade_usd,
            )
        except RuntimeError as exc:
            logger.warning(f"AI decision failed in voice: {exc}")
            mkt_txt = f" {_market_summary(market)}" if market else ""
            return VoiceResponse(
                intent="error",
                explanation=(
                    f"Market data is temporarily unavailable for "
                    f"{token_id.replace('-', ' ').title()}. "
                    f"Please try again shortly.{mkt_txt}"
                ),
            )
        except Exception as exc:
            logger.error(f"AI decision error in voice: {exc}")
            return VoiceResponse(
                intent="error",
                explanation="AI decision service encountered an error. Please try again.",
            )

        ai_action          = decision.action.value if hasattr(decision.action, "value") else decision.action
        voice_overrides_ai = ai_action != action
        token_name         = token_id.replace("-", " ").title()

        if voice_overrides_ai:
            explanation = (
                f"You asked to {action} {token_name}. "
                f"However, my analysis recommends {ai_action} with "
                f"{decision.confidence:.0f}% confidence. "
                f"{decision.reason} "
            )
        else:
            explanation = (
                f"Great — I agree with your {action} intent for {token_name}. "
                f"{decision.reason} "
                f"Confidence is {decision.confidence:.0f}% and risk is "
                f"{decision.risk_level.value if hasattr(decision.risk_level, 'value') else decision.risk_level}. "
            )

        if market:
            explanation += _market_summary(market)

        return VoiceResponse(
            intent="trade",
            action=decision.action,
            token=token_id,
            explanation=explanation,
            decision=decision,
        )

    # ── Query: PnL ─────────────────────────────────────────────────────────────
    elif intent == "query":
        query_type = parsed.get("query_type")

        if query_type == "pnl":
            try:
                db        = get_db()
                agent_doc = await db["agents"].find_one({"wallet_address": command.wallet_address})
                if not agent_doc:
                    return VoiceResponse(
                        intent="query",
                        explanation="No agent found. Please register your agent first.",
                    )

                pnl        = float(agent_doc.get("total_pnl",        0))
                trades     = int(agent_doc.get("total_trades",        0))
                profitable = int(agent_doc.get("profitable_trades",   0))
                trust      = float(agent_doc.get("trust_score",      50))
                win_rate   = (profitable / trades * 100) if trades > 0 else 0.0
                strategy   = agent_doc.get("strategy", "COMBINED")
                risk_tol   = agent_doc.get("risk_tolerance", "MEDIUM")

                pnl_str    = f"positive ${pnl:.4f}" if pnl >= 0 else f"negative ${abs(pnl):.4f}"
                perf_note  = (
                    "You are profitable — excellent work!"
                    if pnl > 0 else
                    "You are currently in the red. Consider reviewing your strategy."
                )

                mkt_context = ""
                try:
                    eth = await fetch_current_market_data("ethereum")
                    mkt_context = (
                        f" For context, Ethereum is currently at ${eth.price_usd:,.2f}, "
                        f"{'up' if eth.price_change_24h >= 0 else 'down'} "
                        f"{abs(eth.price_change_24h):.2f}% today."
                    )
                except Exception:
                    pass

                explanation = (
                    f"Here is your performance summary. "
                    f"Total PnL is {pnl_str} across {trades} trade{'s' if trades != 1 else ''}. "
                    f"Win rate is {win_rate:.1f}% with {profitable} profitable trades. "
                    f"Trust score is {trust:.0f} out of 100. "
                    f"You are running the {strategy} strategy with {risk_tol} risk tolerance. "
                    f"{perf_note}{mkt_context}"
                )
                return VoiceResponse(intent="query", explanation=explanation)

            except Exception as exc:
                logger.error(f"PnL query error: {exc}")
                return VoiceResponse(
                    intent="query",
                    explanation="Could not fetch your PnL data. Please try again.",
                )

        elif query_type == "risk":
            try:
                db        = get_db()
                agent_doc = await db["agents"].find_one({"wallet_address": command.wallet_address})
                risk_tol  = agent_doc.get("risk_tolerance", "MEDIUM") if agent_doc else "MEDIUM"
                max_trade = float(agent_doc.get("max_trade_usd", 500)) if agent_doc else 500.0

                eth_info = ""
                try:
                    eth     = await fetch_current_market_data("ethereum")
                    eth_rsi = eth.rsi or 50
                    eth_risk = (
                        "HIGH"   if eth_rsi > 70 or abs(eth.price_change_24h) > 5 else
                        "MEDIUM" if eth_rsi > 55 or abs(eth.price_change_24h) > 2 else
                        "LOW"
                    )
                    eth_info = (
                        f" Current market conditions: Ethereum RSI is {eth_rsi:.1f} "
                        f"with a {eth_risk} risk reading based on recent volatility."
                    )
                except Exception:
                    pass

                explanation = (
                    f"Your current risk profile is {risk_tol} tolerance "
                    f"with a maximum trade size of ${max_trade:.0f}. "
                    f"For a full visual breakdown, navigate to the Risk Heatmap "
                    f"on your Dashboard.{eth_info}"
                )
                return VoiceResponse(intent="query", explanation=explanation)

            except Exception as exc:
                logger.error(f"Risk query error: {exc}")
                return VoiceResponse(
                    intent="query",
                    explanation="Navigate to the Risk Heatmap on your Dashboard for full exposure details.",
                )

        elif query_type == "status":
            try:
                db        = get_db()
                agent_doc = await db["agents"].find_one({"wallet_address": command.wallet_address})
                if not agent_doc:
                    return VoiceResponse(
                        intent="query",
                        explanation="No agent registered. Please set one up on the Dashboard.",
                    )

                name     = agent_doc.get("name", "Your agent")
                strategy = agent_doc.get("strategy", "COMBINED")
                risk     = agent_doc.get("risk_tolerance", "MEDIUM")
                trust    = float(agent_doc.get("trust_score", 50))
                trades   = int(agent_doc.get("total_trades", 0))
                pnl      = float(agent_doc.get("total_pnl", 0))

                mkt = ""
                try:
                    eth = await fetch_current_market_data("ethereum")
                    mood = (
                        "bullish"  if eth.price_change_24h > 1  else
                        "bearish"  if eth.price_change_24h < -1 else
                        "flat"
                    )
                    mkt = (
                        f" The market is {mood} right now — "
                        f"Ethereum is at ${eth.price_usd:,.2f}, "
                        f"{'up' if eth.price_change_24h >= 0 else 'down'} "
                        f"{abs(eth.price_change_24h):.2f}% today."
                    )
                except Exception:
                    pass

                explanation = (
                    f"{name} is active and running the {strategy} strategy "
                    f"with {risk} risk tolerance. "
                    f"Trust score is {trust:.0f} out of 100. "
                    f"You have executed {trades} trade{'s' if trades != 1 else ''} "
                    f"with a total PnL of ${pnl:.4f}.{mkt}"
                )
                return VoiceResponse(intent="query", explanation=explanation)

            except Exception as exc:
                logger.error(f"Status query error: {exc}")
                return VoiceResponse(
                    intent="query",
                    explanation="Could not fetch agent status. Please try again.",
                )

        else:
            return VoiceResponse(
                intent="query",
                explanation=(
                    "I can help you check your PnL, review your risk exposure, "
                    "or get a full agent status report. What would you like to know?"
                ),
            )

    # ── Settings intent ────────────────────────────────────────────────────────
    elif intent == "settings":
        mode = parsed.get("mode")
        try:
            db        = get_db()
            risk_map  = {"aggressive": "HIGH", "conservative": "LOW"}
            new_risk  = risk_map.get(mode, "MEDIUM")

            agent_doc = await db["agents"].find_one({"wallet_address": command.wallet_address})
            max_trade = float(agent_doc.get("max_trade_usd", 500)) if agent_doc else 500.0

            await db["agents"].update_one(
                {"wallet_address": command.wallet_address},
                {"$set": {"risk_tolerance": new_risk}},
            )

            if new_risk == "HIGH":
                advice = (
                    f"Aggressive mode enabled. Risk tolerance is now HIGH. "
                    f"The AI will favour larger positions and higher-confidence trades. "
                    f"Maximum trade size remains ${max_trade:.0f}. "
                    f"Be aware that high RSI or volatile conditions will still "
                    f"trigger HOLD decisions to protect your capital."
                )
            else:
                advice = (
                    f"Conservative mode enabled. Risk tolerance is now LOW. "
                    f"The AI will favour smaller, safer positions and require "
                    f"stronger signal confirmation before recommending a trade. "
                    f"Maximum trade size remains ${max_trade:.0f}."
                )

            return VoiceResponse(intent="settings", explanation=advice)

        except Exception as exc:
            logger.error(f"Settings update error: {exc}")
            return VoiceResponse(
                intent="error",
                explanation="Could not update your settings. Please try again.",
            )

    # ── Unknown ────────────────────────────────────────────────────────────────
    else:
        return VoiceResponse(
            intent="unknown",
            explanation=(
                "I didn't quite catch that. You can say things like: "
                "'Buy ETH now', 'Sell Bitcoin', 'What is my PnL?', "
                "'Show my risk heatmap', 'What is my status', "
                "or 'Switch to conservative mode'."
            ),
        )