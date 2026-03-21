from fastapi import APIRouter, HTTPException
from core.database import get_db
from models.schemas import DashboardStats, RiskHeatmapEntry, TradeIntent, Agent
from services.market_data import fetch_multi_token_market_data

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


@router.get("/{wallet_address}", response_model=DashboardStats)
async def get_dashboard(wallet_address: str):
    """Comprehensive dashboard stats for a wallet."""
    db = get_db()

    # Agent stats
    agent_doc = await db["agents"].find_one({"wallet_address": wallet_address})
    if not agent_doc:
        raise HTTPException(status_code=404, detail="Agent not found")
    agent_doc["id"] = str(agent_doc.pop("_id", agent_doc.get("id", "")))
    agent = Agent(**agent_doc)

    # Recent trades
    cursor = (
        db["trades"]
        .find({"wallet_address": wallet_address})
        .sort("created_at", -1)
        .limit(10)
    )
    raw_trades = await cursor.to_list(10)
    recent_trades = []
    for doc in raw_trades:
        doc["id"] = str(doc.pop("_id", doc.get("id", "")))
        recent_trades.append(TradeIntent(**doc))

    # Risk heatmap
    heatmap = await build_risk_heatmap(wallet_address)

    win_rate = (
        (agent.profitable_trades / agent.total_trades * 100)
        if agent.total_trades > 0
        else 0.0
    )

    return DashboardStats(
        total_trades=agent.total_trades,
        profitable_trades=agent.profitable_trades,
        total_pnl=round(agent.total_pnl, 2),
        trust_score=round(agent.trust_score, 1),
        win_rate=round(win_rate, 1),
        recent_trades=recent_trades,
        risk_heatmap=heatmap,
    )


@router.get("/heatmap/{wallet_address}", response_model=list[RiskHeatmapEntry])
async def get_risk_heatmap(wallet_address: str):
    """Risk heatmap showing exposure and risk per token."""
    return await build_risk_heatmap(wallet_address)


async def build_risk_heatmap(wallet_address: str) -> list[RiskHeatmapEntry]:
    """Compute risk heatmap from recent trades + live market data."""
    db = get_db()

    # Get executed trades per token
    cursor = db["trades"].find({
        "wallet_address": wallet_address,
        "status": "EXECUTED",
    })
    trades = await cursor.to_list(200)

    # Aggregate exposure per token
    exposure_map: dict[str, float] = {}
    for trade in trades:
        base_token = trade["token_pair"].split("/")[0].lower()
        exposure_map[base_token] = exposure_map.get(base_token, 0) + trade.get("amount_usd", 0)

    if not exposure_map:
        # Demo data if no trades yet
        exposure_map = {"eth": 500, "btc": 300, "matic": 200}

    # Fetch live market data for risk scoring
    token_id_map = {
        "eth": "ethereum", "btc": "bitcoin",
        "matic": "polygon-ecosystem-token", "link": "chainlink",
    }
    token_ids = [token_id_map.get(k, k) for k in exposure_map.keys()]
    market_data = await fetch_multi_token_market_data(token_ids[:4])

    heatmap = []
    for symbol, exposure in exposure_map.items():
        token_id = token_id_map.get(symbol, symbol)
        mkt = market_data.get(token_id)

        if mkt:
            volatility = abs(mkt.price_change_24h)
            sentiment = mkt.sentiment_score or 0.0
            # Risk score: weighted combination of volatility + negative sentiment
            risk_score = min(100, volatility * 5 + max(0, -sentiment * 30) + 10)
        else:
            volatility = 5.0
            sentiment = 0.0
            risk_score = 30.0

        heatmap.append(RiskHeatmapEntry(
            token=symbol.upper(),
            risk_score=round(risk_score, 1),
            exposure_usd=round(exposure, 2),
            volatility=round(volatility, 2),
            sentiment=round(sentiment, 4),
        ))

    return sorted(heatmap, key=lambda x: x.risk_score, reverse=True)


@router.get("/pnl-chart/{wallet_address}")
async def get_pnl_chart(wallet_address: str):
    """Return time-series PnL data for charting."""
    db = get_db()
    cursor = (
        db["trades"]
        .find({"wallet_address": wallet_address, "status": "EXECUTED"})
        .sort("created_at", 1)
    )
    trades = await cursor.to_list(500)

    cumulative = 0.0
    chart_data = []
    for trade in trades:
        pnl = trade.get("pnl", 0) or 0
        cumulative += pnl
        chart_data.append({
            "timestamp": trade["created_at"].isoformat() if hasattr(trade["created_at"], "isoformat") else str(trade["created_at"]),
            "pnl": round(pnl, 2),
            "cumulative_pnl": round(cumulative, 2),
            "action": trade["action"],
            "token_pair": trade["token_pair"],
        })

    return {"wallet_address": wallet_address, "data": chart_data}