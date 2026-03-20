from fastapi import APIRouter, HTTPException
from loguru import logger

from core.database import get_db
from models.schemas import (
    AIDecision, AIDecisionRequest, Agent, TradeIntent
)
from services.ai_agent import AIDecisionService
from services.trade_execution import trade_execution_service

router = APIRouter(prefix="/trade", tags=["Trading"])

ai_service = AIDecisionService()


async def _get_agent(wallet_address: str) -> Agent:
    db = get_db()
    doc = await db["agents"].find_one({"wallet_address": wallet_address})
    if not doc:
        raise HTTPException(status_code=404, detail="Agent not found. Register first.")
    doc["id"] = str(doc.pop("_id", doc.get("id", "")))
    return Agent(**doc)


@router.post("/decision", response_model=AIDecision)
async def get_ai_decision(request: AIDecisionRequest):
    """
    Get AI trading decision without executing the trade.
    Useful for previewing the decision before the user confirms.
    """
    agent = await _get_agent(request.wallet_address)
    decision = await ai_service.get_decision(request, agent.max_trade_usd)
    logger.info(
        f"Decision for {request.wallet_address}: "
        f"{decision.action} {decision.token} @{decision.confidence}% confidence"
    )
    return decision


@router.post("/execute", response_model=TradeIntent)
async def execute_trade(request: AIDecisionRequest):
    """
    Full pipeline: AI decision → risk check → on-chain proof → execute.
    Returns a TradeIntent with status and tx hash.
    """
    agent = await _get_agent(request.wallet_address)
    decision = await ai_service.get_decision(request, agent.max_trade_usd)
    intent = await trade_execution_service.execute_trade(decision, agent)
    return intent


@router.get("/history/{wallet_address}", response_model=list[TradeIntent])
async def get_trade_history(wallet_address: str, limit: int = 20):
    """Return recent trade history for a wallet."""
    db = get_db()
    cursor = (
        db["trades"]
        .find({"wallet_address": wallet_address})
        .sort("created_at", -1)
        .limit(limit)
    )
    docs = await cursor.to_list(limit)
    result = []
    for doc in docs:
        doc["id"] = str(doc.pop("_id", doc.get("id", "")))
        result.append(TradeIntent(**doc))
    return result


@router.get("/replay/{trade_id}")
async def replay_trade(trade_id: str):
    db = get_db()

    # ✅ FIX: search by _id string, convert ObjectId fields to string
    trade_doc = await db["trades"].find_one({"_id": trade_id})
    if not trade_doc:
        raise HTTPException(status_code=404, detail="Trade not found")

    proof_doc = await db["validation_proofs"].find_one({"trade_id": trade_id})

    # ✅ FIX: strip MongoDB _id from both docs before returning
    trade_doc.pop("_id", None)
    if proof_doc:
        proof_doc.pop("_id", None)

    steps = [
        {
            "step": 1,
            "title": "Market Data Fetched",
            "description": f"Fetched real-time data for {trade_doc.get('token_pair', 'N/A').split('/')[0]}",
        },
        {
            "step": 2,
            "title": "AI Decision Made",
            "description": f"AI decided to {trade_doc.get('action')} with {trade_doc.get('confidence')}% confidence",
            "detail": trade_doc.get("reason"),
        },
        {
            "step": 3,
            "title": "Risk Check",
            "description": f"Risk check: {str(trade_doc.get('risk_check', '')).upper()}",
            "detail": f"Risk level: {trade_doc.get('risk_level')}",
        },
        {
            "step": 4,
            "title": "Validation Proof Stored",
            "description": "Validation proof stored on Sepolia testnet",
            "detail": proof_doc.get("on_chain_tx") if proof_doc else "N/A",
        },
        {
            "step": 5,
            "title": "Trade Executed",
            "description": f"Swap executed on DEX: {trade_doc.get('token_pair')}",
            "detail": f"TX: {trade_doc.get('tx_hash', 'N/A')}",
        },
        {
            "step": 6,
            "title": "PnL & Reputation Updated",
            "description": f"PnL: ${trade_doc.get('pnl', 0):.2f} | Reputation updated on-chain",
        },
    ]

    return {
        "trade_id": trade_id,
        "summary": trade_doc,
        "proof": proof_doc,
        "steps": steps,
    }