"""
Trading API — extended with:
  - Strategy Comparison Engine (Feature 4)
  - What-If Simulator (Feature 5)
  - AI Copilot Chat (Feature 7)
  - Trade Quality Score stored on execute
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from loguru import logger

from core.database import get_db
from models.schemas import (
    AIDecision, AIDecisionRequest, Agent, TradeIntent,
    CopilotMessage, CopilotResponse, StrategyComparisonResult,
)
from services.ai_agent import AIDecisionService
from services.trade_execution import trade_execution_service

router     = APIRouter(prefix="/trade", tags=["Trading"])
ai_service = AIDecisionService()


async def _get_agent(wallet_address: str) -> Agent:
    db  = get_db()
    doc = await db["agents"].find_one({"wallet_address": wallet_address})
    if not doc:
        raise HTTPException(status_code=404, detail="Agent not found. Register first.")
    doc["id"] = str(doc.pop("_id", doc.get("id", "")))
    return Agent(**doc)


# ── Core trading endpoints ────────────────────────────────────────────────────

@router.post("/decision", response_model=AIDecision)
async def get_ai_decision(request: AIDecisionRequest):
    """Get AI trading decision with full explainability (no execution)."""
    agent    = await _get_agent(request.wallet_address)
    decision = await ai_service.get_decision(request, agent.max_trade_usd)
    logger.info(
        f"Decision for {request.wallet_address}: "
        f"{decision.action} {decision.token} @{decision.confidence}% | "
        f"hash={decision.decision_hash}"
    )
    return decision


@router.post("/execute", response_model=TradeIntent)
async def execute_trade(request: AIDecisionRequest):
    """Full pipeline: AI decision → risk check → on-chain proof → execute."""
    agent    = await _get_agent(request.wallet_address)
    decision = await ai_service.get_decision(request, agent.max_trade_usd)
    intent   = await trade_execution_service.execute_trade(decision, agent)
    return intent


@router.get("/history/{wallet_address}", response_model=list[TradeIntent])
async def get_trade_history(wallet_address: str, limit: int = 20):
    db     = get_db()
    cursor = (
        db["trades"]
        .find({"wallet_address": wallet_address})
        .sort("created_at", -1)
        .limit(limit)
    )
    docs   = await cursor.to_list(limit)
    result = []
    for doc in docs:
        doc["id"] = str(doc.pop("_id", doc.get("id", "")))
        try:
            result.append(TradeIntent(**doc))
        except Exception:
            pass
    return result


@router.get("/replay/{trade_id}")
async def replay_trade(trade_id: str):
    """Step-by-step playback of a past trade (Feature 3)."""
    db        = get_db()
    trade_doc = await db["trades"].find_one({"_id": trade_id})
    if not trade_doc:
        raise HTTPException(status_code=404, detail="Trade not found")

    proof_doc = await db["validation_proofs"].find_one({"trade_id": trade_id})
    trade_doc.pop("_id", None)
    if proof_doc:
        proof_doc.pop("_id", None)

    steps = [
        {
            "step":        1,
            "title":       "Market Data Fetched",
            "description": f"Live CoinGecko data fetched for {trade_doc.get('token_pair','N/A').split('/')[0]}",
            "detail":      f"Entry price captured from real-time feed.",
        },
        {
            "step":        2,
            "title":       "AI Explainability Engine",
            "description": f"LLaMA3-70B decided {trade_doc.get('action')} with {trade_doc.get('confidence')}% confidence",
            "detail":      trade_doc.get("reason"),
            "why":         trade_doc.get("why", []),
            "decision_hash": trade_doc.get("decision_hash"),
        },
        {
            "step":        3,
            "title":       "Risk Check Passed",
            "description": f"Risk check: {str(trade_doc.get('risk_check','')).upper()} | Level: {trade_doc.get('risk_level')}",
            "detail":      f"Stop loss: ${trade_doc.get('stop_loss_usd','N/A')} | Position: {trade_doc.get('position_size_pct','N/A')}% of vault",
        },
        {
            "step":        4,
            "title":       "Cryptographic Proof Stored",
            "description": "Validation proof stored on Sepolia testnet — immutable and auditable",
            "detail":      proof_doc.get("on_chain_tx") if proof_doc else "N/A",
            "proof_hash":  proof_doc.get("decision_hash") if proof_doc else None,
        },
        {
            "step":        5,
            "title":       "Trade Executed",
            "description": f"DEX swap: {trade_doc.get('token_pair')}",
            "detail":      f"TX: {trade_doc.get('tx_hash','N/A')}",
        },
        {
            "step":        6,
            "title":       "PnL & Reputation Updated",
            "description": f"PnL: ${trade_doc.get('pnl',0):.4f} | Quality Score: {trade_doc.get('quality_score',{}).get('trade_score','N/A') if trade_doc.get('quality_score') else 'N/A'}/10",
            "detail":      "ReputationManager updated on-chain",
            "failure_reason": trade_doc.get("failure_reason"),
        },
    ]

    return {
        "trade_id": trade_id,
        "summary":  trade_doc,
        "proof":    proof_doc,
        "steps":    steps,
    }


# ── Strategy Comparison Engine (Feature 4) ────────────────────────────────────

@router.post("/compare-strategies", response_model=list[StrategyComparisonResult])
async def compare_strategies(request: AIDecisionRequest):
    """
    Run all 4 strategies on the same live market data and return comparison.
    Shows which strategy would have been best.
    """
    agent   = await _get_agent(request.wallet_address)
    results = await ai_service.run_strategy_comparison(
        token          = request.token,
        wallet_address = request.wallet_address,
        max_trade_usd  = agent.max_trade_usd,
    )
    return results


# ── What-If Simulator (Feature 5) ─────────────────────────────────────────────

@router.post("/simulate")
async def simulate_what_if(request: AIDecisionRequest):
    """
    Simulate what would have happened with each strategy today
    using live 24h price movement as ground truth.
    """
    agent  = await _get_agent(request.wallet_address)
    result = await ai_service.simulate_what_if(
        token          = request.token,
        max_trade_usd  = agent.max_trade_usd,
    )
    return result


# ── AI Copilot Chat (Feature 7) ───────────────────────────────────────────────

@router.post("/copilot", response_model=CopilotResponse)
async def copilot_chat(payload: CopilotMessage):
    """
    AI Copilot: answer questions about past trades using Groq.
    Examples: "Why did you buy ETH?", "Why are my trades losing money?"
    """
    db = get_db()

    # Fetch last 10 trades for context
    cursor = (
        db["trades"]
        .find({"wallet_address": payload.wallet_address, "status": "EXECUTED"})
        .sort("created_at", -1)
        .limit(10)
    )
    trades = await cursor.to_list(10)

    # Fetch agent profile
    agent_doc = await db["agents"].find_one({"wallet_address": payload.wallet_address})
    agent_ctx = ""
    if agent_doc:
        agent_ctx = (
            f"Agent: {agent_doc.get('name')} | "
            f"Strategy: {agent_doc.get('strategy')} | "
            f"Risk: {agent_doc.get('risk_tolerance')} | "
            f"Trust Score: {agent_doc.get('trust_score',50):.0f}/100 | "
            f"Total PnL: ${agent_doc.get('total_pnl',0):.4f}"
        )

    trade_ctx = "\n".join([
        f"- [{t.get('created_at','')}: {t.get('action')} {t.get('token_pair')} | "
        f"Confidence: {t.get('confidence')}% | PnL: ${t.get('pnl',0):.4f} | "
        f"Reason: {t.get('reason','')} | "
        f"Why: {'; '.join(t.get('why',[])[:2])}]"
        for t in trades
    ]) or "No trades executed yet."

    # Build conversation history for multi-turn chat
    history_ctx = ""
    if payload.history:
        history_ctx = "\n".join([
            f"{m['role'].upper()}: {m['content']}"
            for m in payload.history[-6:]   # last 3 exchanges
        ])

    system_prompt = f"""You are an AI trading agent assistant with deep knowledge of DeFi and technical analysis.
You have access to the user's full trade history and agent profile.
Answer questions about their trades, strategy performance, and market analysis.
Be specific — reference actual numbers, RSI values, and trade outcomes from the context.
Keep answers to 2-4 sentences unless a detailed breakdown is requested.

AGENT PROFILE:
{agent_ctx}

RECENT TRADE HISTORY:
{trade_ctx}"""

    user_message = payload.message
    if history_ctx:
        user_message = f"Previous conversation:\n{history_ctx}\n\nNew question: {payload.message}"

    # Use Groq if available, otherwise give a rule-based answer
    if ai_service.groq_available and ai_service.llm:
        try:
            from langchain.schema import SystemMessage, HumanMessage
            messages  = [SystemMessage(content=system_prompt), HumanMessage(content=user_message)]
            response  = await ai_service.llm.ainvoke(messages)
            reply     = response.content
        except Exception as e:
            logger.warning(f"Copilot Groq call failed: {e}")
            reply = _rule_based_copilot_answer(payload.message, trades, agent_doc)
    else:
        reply = _rule_based_copilot_answer(payload.message, trades, agent_doc)

    # Extract referenced trade IDs
    sources = [str(t.get("_id", "")) for t in trades[:3]]

    return CopilotResponse(reply=reply, sources=sources)


def _rule_based_copilot_answer(message: str, trades: list, agent_doc: dict) -> str:
    """Fallback copilot answer when Groq is unavailable."""
    msg   = message.lower()
    pnl   = agent_doc.get("total_pnl", 0) if agent_doc else 0
    name  = agent_doc.get("name", "your agent") if agent_doc else "your agent"
    total = agent_doc.get("total_trades", 0) if agent_doc else 0

    if "why" in msg and ("buy" in msg or "sell" in msg or "trade" in msg):
        last = trades[0] if trades else None
        if last:
            return (
                f"The last trade was a {last.get('action')} of {last.get('token_pair')} "
                f"with {last.get('confidence')}% confidence. "
                f"Reason: {last.get('reason','')} "
                f"Key signals: {'; '.join(last.get('why',[])[:2])}"
            )
        return "No trades found to explain."

    if "pnl" in msg or "profit" in msg or "loss" in msg:
        return (
            f"{name} has executed {total} trades with a total PnL of ${pnl:.4f}. "
            f"{'Performance is positive — the strategy is working.' if pnl > 0 else 'Performance is negative — consider reviewing the strategy or risk tolerance.'}"
        )

    if "worst" in msg or "bad" in msg or "fail" in msg:
        worst = min(trades, key=lambda t: t.get("pnl", 0) or 0, default=None)
        if worst:
            return (
                f"The worst trade was a {worst.get('action')} of {worst.get('token_pair')} "
                f"with PnL ${worst.get('pnl',0):.4f}. "
                f"Reason: {worst.get('reason','')}"
            )
        return "No losing trades found."

    return (
        f"I can answer questions about your trades, strategy performance, and market signals. "
        f"Try asking: 'Why did you buy ETH?', 'What was my worst trade?', or 'How is my strategy performing?'"
    )