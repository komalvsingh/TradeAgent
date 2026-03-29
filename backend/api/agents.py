from fastapi import APIRouter, HTTPException
from loguru import logger
import uuid

from core.database import get_db
from models.schemas import Agent, AgentRegistration
from services.blockchain import blockchain_service

router = APIRouter(prefix="/agents", tags=["Agents"])


def _serialize(doc: dict) -> dict:
    """
    Normalize a MongoDB document for Pydantic consumption.

    FIX: Previously `doc.pop("_id")` silently lost the real ID if the
    document was already stored with a string "id" field alongside "_id".
    Now we always prefer the UUID string "id" when present, and fall back
    to stringifying "_id" (ObjectId) only when no explicit "id" exists.

    FIX: on_chain_id is cast to int when truthy to match the Pydantic schema
    `on_chain_id: int | None`. MongoDB stores it as-inserted; if it was ever
    inserted as a float (e.g. 1.0) this ensures validation doesn't fail.
    """
    # Preserve explicit UUID "id" field; stringify ObjectId "_id" as fallback
    if "id" not in doc or not doc["id"]:
        doc["id"] = str(doc.pop("_id", ""))
    else:
        doc.pop("_id", None)  # discard ObjectId — UUID "id" is canonical

    # Coerce on_chain_id to int
    if doc.get("on_chain_id") is not None:
        try:
            doc["on_chain_id"] = int(doc["on_chain_id"])
        except (TypeError, ValueError):
            doc["on_chain_id"] = None

    return doc


@router.post("/register", response_model=Agent)
async def register_agent(payload: AgentRegistration):
    """
    Register a new agent (or return existing one for this wallet).

    FIX: The original code used `existing.pop("_id")` which mutated the dict
    and relied on _id being present. `_serialize()` now handles both cases.

    The backend never calls the blockchain — on_chain_id is supplied by the
    frontend after a successful AgentRegistry TX (MetaMask flow).
    """
    db = get_db()

    # Return existing agent if already registered for this wallet
    existing = await db["agents"].find_one({"wallet_address": payload.wallet_address})
    if existing:
        return Agent(**_serialize(existing))

    agent_id = str(uuid.uuid4())

    agent = Agent(
        id=agent_id,
        wallet_address=payload.wallet_address,
        name=payload.name,
        strategy=payload.strategy,
        risk_tolerance=payload.risk_tolerance,
        max_trade_usd=payload.max_trade_usd,
        # FIX: cast to int explicitly — Pydantic accepts int | None, but
        # the AgentRegistration schema declared it as `int | None` too.
        # A JS Number serialized over JSON is always safe as int here, but
        # we guard it anyway.
        on_chain_id=int(payload.on_chain_id) if payload.on_chain_id is not None else None,
    )

    data = agent.model_dump()
    # Store the UUID as _id so MongoDB is happy, keeping "id" in the doc too
    # so _serialize() can find it on the next read without re-stringifying ObjectId.
    data["_id"] = agent_id

    await db["agents"].insert_one(data)

    logger.info(
        f"Agent registered: {agent.name} ({agent.wallet_address}) "
        f"on_chain_id={agent.on_chain_id}"
    )
    return agent


@router.get("/{wallet_address}", response_model=Agent)
async def get_agent(wallet_address: str):
    """Fetch agent profile by wallet address."""
    db = get_db()
    doc = await db["agents"].find_one({"wallet_address": wallet_address})
    if not doc:
        raise HTTPException(status_code=404, detail="Agent not found")
    return Agent(**_serialize(doc))


@router.get("/", response_model=list[Agent])
async def list_agents():
    """List all registered agents."""
    db = get_db()
    docs = await db["agents"].find().to_list(100)
    return [Agent(**_serialize(doc)) for doc in docs]


@router.patch("/{wallet_address}/link-chain", response_model=Agent)
async def link_chain_id(wallet_address: str, on_chain_id: int):
    """
    NEW: Link an on_chain_id to an existing backend-only agent record.

    Use this when the MetaMask TX succeeded but the backend call failed
    during the original registration flow (so the agent exists in the DB
    but has on_chain_id=null). The frontend can retry this endpoint without
    re-triggering the contract TX.
    """
    db = get_db()
    doc = await db["agents"].find_one({"wallet_address": wallet_address})
    if not doc:
        raise HTTPException(status_code=404, detail="Agent not found")

    await db["agents"].update_one(
        {"wallet_address": wallet_address},
        {"$set": {"on_chain_id": on_chain_id}},
    )

    doc["on_chain_id"] = on_chain_id
    return Agent(**_serialize(doc))