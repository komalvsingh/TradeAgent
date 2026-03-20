from fastapi import APIRouter, HTTPException
from loguru import logger

from models.schemas import (
    VoiceCommand, VoiceResponse, MarketData, AIDecisionRequest, Strategy
)
from services.ai_agent import AIDecisionService, parse_voice_command
from services.market_data import fetch_current_market_data, SUPPORTED_TOKENS
from core.database import get_db
from models.schemas import Agent

router     = APIRouter(tags=["Market & Voice"])
ai_service = AIDecisionService()


# ─── Market Data ──────────────────────────────────────────────────────────────

@router.get("/market", tags=["Market"])
async def list_supported_tokens():
    """List all supported tokens."""
    return {"tokens": SUPPORTED_TOKENS}


@router.get("/market/{token_id}", response_model=MarketData, tags=["Market"])
async def get_market_data(token_id: str):
    """
    Get real-time market data + technical indicators for a token.
    Returns 503 (not 500) on CoinGecko rate limit so CORS headers are sent.
    """
    if token_id not in SUPPORTED_TOKENS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported token '{token_id}'. Supported: {SUPPORTED_TOKENS}",
        )
    try:
        return await fetch_current_market_data(token_id)
    except RuntimeError as e:
        logger.warning(f"Market data unavailable for {token_id}: {e}")
        raise HTTPException(
            status_code=503,
            detail=f"Market data temporarily unavailable for {token_id}. "
                   f"CoinGecko may be rate-limiting. Try again in 60s.",
        )
    except Exception as e:
        logger.error(f"Unexpected error fetching {token_id}: {e}")
        raise HTTPException(
            status_code=503,
            detail=f"Market data error for {token_id}: {str(e)}",
        )


# ─── Voice AI Trader ──────────────────────────────────────────────────────────

@router.post("/voice", response_model=VoiceResponse, tags=["Voice"])
async def process_voice_command(command: VoiceCommand):
    """
    Voice AI Trader — natural language commands.
    Examples: "Buy ETH now", "What's my PnL?", "Switch to conservative mode"
    """
    try:
        parsed = await parse_voice_command(command.text)
    except Exception as e:
        logger.error(f"Voice command parse error: {e}")
        return VoiceResponse(
            intent="error",
            explanation="Sorry, I couldn't process that command. Please try again.",
        )

    intent = parsed.get("intent")

    # ── Trade intent ──────────────────────────────────────────────────────────
    if intent == "trade":
        action = parsed.get("action")
        token  = parsed.get("token", "ethereum")

        db = get_db()
        agent_doc = await db["agents"].find_one({"wallet_address": command.wallet_address})
        if not agent_doc:
            return VoiceResponse(
                intent="error",
                explanation="You need to register your agent first before trading.",
            )

        agent_doc["id"] = str(agent_doc.pop("_id", agent_doc.get("id", "")))
        agent = Agent(**agent_doc)

        try:
            decision = await ai_service.get_decision(
                AIDecisionRequest(
                    token=token,
                    strategy=agent.strategy,
                    wallet_address=command.wallet_address,
                ),
                max_trade_usd=agent.max_trade_usd,
            )
        except RuntimeError as e:
            logger.warning(f"AI decision failed in voice command: {e}")
            return VoiceResponse(
                intent="error",
                explanation=f"Market data temporarily unavailable for {token.upper()}. "
                            f"Please try again in a moment.",
            )
        except Exception as e:
            logger.error(f"AI decision unexpected error: {e}")
            return VoiceResponse(
                intent="error",
                explanation="AI decision service error. Please try again.",
            )

        voice_overrides_ai = decision.action.value != action
        explanation = f"I heard you want to {action} {token.upper()}. "

        if voice_overrides_ai:
            explanation += (
                f"However, my analysis suggests {decision.action.value} "
                f"with {decision.confidence}% confidence. "
                f"Reason: {decision.reason} "
                f"I'll note your preference, but please consider the risk."
            )
        else:
            explanation += (
                f"Great — my analysis agrees! {decision.reason} "
                f"Confidence: {decision.confidence}%."
            )

        return VoiceResponse(
            intent="trade",
            action=decision.action,
            token=token,
            explanation=explanation,
            decision=decision,
        )

    # ── Query intent ──────────────────────────────────────────────────────────
    elif intent == "query":
        query_type = parsed.get("query_type")

        if query_type == "pnl":
            try:
                db        = get_db()
                agent_doc = await db["agents"].find_one({"wallet_address": command.wallet_address})
                pnl       = float(agent_doc.get("total_pnl", 0)) if agent_doc else 0.0
                trades    = int(agent_doc.get("total_trades", 0)) if agent_doc else 0
                trust     = float(agent_doc.get("trust_score", 50)) if agent_doc else 50.0
                return VoiceResponse(
                    intent="query",
                    explanation=(
                        f"Your total PnL is ${pnl:.4f} across {trades} trades. "
                        f"Trust score: {trust:.0f}/100. "
                        + ("You are profitable! Keep it up." if pnl > 0
                           else "You are in the red. Consider adjusting your strategy.")
                    ),
                )
            except Exception as e:
                logger.error(f"PnL query error: {e}")
                return VoiceResponse(intent="query", explanation="Could not fetch PnL data.")

        elif query_type == "risk":
            return VoiceResponse(
                intent="query",
                explanation="Navigate to the Risk Heatmap on your Dashboard to see your full exposure breakdown by token.",
            )

        else:
            return VoiceResponse(
                intent="query",
                explanation="I can help you trade, check your PnL, view risk, or change strategy. What would you like to do?",
            )

    # ── Settings intent ───────────────────────────────────────────────────────
    elif intent == "settings":
        mode = parsed.get("mode")
        try:
            db       = get_db()
            risk_map = {"aggressive": "HIGH", "conservative": "LOW"}
            new_risk = risk_map.get(mode, "MEDIUM")
            await db["agents"].update_one(
                {"wallet_address": command.wallet_address},
                {"$set": {"risk_tolerance": new_risk}},
            )
            return VoiceResponse(
                intent="settings",
                explanation=(
                    f"Done! Switched to {mode} mode. "
                    f"Risk tolerance is now {new_risk}. "
                    f"Future trades will reflect this change."
                ),
            )
        except Exception as e:
            logger.error(f"Settings update error: {e}")
            return VoiceResponse(
                intent="error",
                explanation="Could not update settings. Please try again.",
            )

    # ── Unknown intent ────────────────────────────────────────────────────────
    else:
        return VoiceResponse(
            intent="unknown",
            explanation=(
                "I didn't quite understand that. Try: "
                "'Buy ETH', 'Sell BTC', 'What's my PnL?', "
                "'Switch to conservative mode', or 'Show my risk heatmap'."
            ),
        )