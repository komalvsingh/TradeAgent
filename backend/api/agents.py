from fastapi import APIRouter, HTTPException
from loguru import logger
import uuid

from core.database import get_db
from models.schemas import Agent, AgentRegistration
from services.blockchain import blockchain_service

router = APIRouter(prefix="/agents", tags=["Agents"])


@router.post("/register", response_model=Agent)
async def register_agent(payload: AgentRegistration):
    """Register a new AI trading agent (off-chain + on-chain)."""
    db = get_db()

    existing = await db["agents"].find_one({"wallet_address": payload.wallet_address})
    if existing:
        existing["id"] = str(existing.pop("_id", existing.get("id", "")))
        return Agent(**existing)

    agent = Agent(
        id=str(uuid.uuid4()),
        wallet_address=payload.wallet_address,
        name=payload.name,
        strategy=payload.strategy,
        risk_tolerance=payload.risk_tolerance,
        max_trade_usd=payload.max_trade_usd,
    )

    # Register on-chain
    on_chain_id = await blockchain_service.register_agent_on_chain(agent)
    agent.on_chain_id = on_chain_id

    # Persist
    data = agent.model_dump()
    data["_id"] = data.pop("id")
    await db["agents"].insert_one(data)

    logger.info(f"Agent registered: {agent.name} ({agent.wallet_address})")
    return agent


@router.get("/{wallet_address}", response_model=Agent)
async def get_agent(wallet_address: str):
    """Fetch agent profile by wallet address."""
    db = get_db()
    doc = await db["agents"].find_one({"wallet_address": wallet_address})
    if not doc:
        raise HTTPException(status_code=404, detail="Agent not found")
    doc["id"] = str(doc.pop("_id", doc.get("id", "")))
    return Agent(**doc)


@router.get("/", response_model=list[Agent])
async def list_agents():
    """List all registered agents."""
    db = get_db()
    docs = await db["agents"].find().to_list(100)
    result = []
    for doc in docs:
        doc["id"] = str(doc.pop("_id", doc.get("id", "")))
        result.append(Agent(**doc))
    return result