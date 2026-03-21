"""
Dashboard API — with Sharpe Ratio, Max Drawdown, Circuit Breaker, and Vault Accounting.
"""
from __future__ import annotations

import math
from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException
from loguru import logger

from core.database import get_db
from models.schemas import DashboardStats, RiskHeatmapEntry, TradeIntent, Agent
from services.market_data import fetch_multi_token_market_data

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])

VAULT_INITIAL = 10_000.0   # starting virtual USDC


# ─── Main dashboard ───────────────────────────────────────────────────────────

@router.get("/{wallet_address}", response_model=DashboardStats)
async def get_dashboard(wallet_address: str):
    """Comprehensive dashboard stats for a wallet."""
    db = get_db()

    # Agent
    agent_doc = await db["agents"].find_one({"wallet_address": wallet_address})
    if not agent_doc:
        raise HTTPException(status_code=404, detail="Agent not found")
    agent_doc["id"] = str(agent_doc.pop("_id", agent_doc.get("id", "")))
    agent = Agent(**agent_doc)

    # All executed trades for analytics
    all_cursor = (
        db["trades"]
        .find({"wallet_address": wallet_address, "status": "EXECUTED"})
        .sort("created_at", 1)
    )
    all_trades = await all_cursor.to_list(1000)

    # Recent 10 trades (any status) for table
    recent_cursor = (
        db["trades"]
        .find({"wallet_address": wallet_address})
        .sort("created_at", -1)
        .limit(10)
    )
    raw_recent = await recent_cursor.to_list(10)
    recent_trades = []
    for doc in raw_recent:
        doc["id"] = str(doc.pop("_id", doc.get("id", "")))
        try:
            recent_trades.append(TradeIntent(**doc))
        except Exception:
            pass

    # Win rate
    win_rate = (
        (agent.profitable_trades / agent.total_trades * 100)
        if agent.total_trades > 0
        else 0.0
    )

    # Risk-adjusted metrics
    sharpe, max_dd, max_dd_pct, current_dd = _compute_risk_metrics(
        all_trades, vault_initial=VAULT_INITIAL
    )

    # Vault balance (initial + cumulative PnL from all executed trades)
    total_pnl_executed = sum(t.get("pnl", 0) or 0 for t in all_trades)
    vault_balance       = VAULT_INITIAL + total_pnl_executed

    # Daily loss (trades today with negative PnL)
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    daily_loss_usd = sum(
        abs(t.get("pnl", 0) or 0)
        for t in all_trades
        if (t.get("pnl") or 0) < 0
        and _trade_ts(t) >= today_start
    )
    daily_loss_pct = (daily_loss_usd / vault_balance * 100) if vault_balance > 0 else 0.0

    # Circuit breaker
    cb_active = (max_dd_pct or 0) > 15.0 or daily_loss_pct > 5.0

    # Equity curve
    equity_curve = _build_equity_curve(all_trades, vault_initial=VAULT_INITIAL)

    # Risk heatmap
    heatmap = await build_risk_heatmap(wallet_address)

    return DashboardStats(
        total_trades       = agent.total_trades,
        profitable_trades  = agent.profitable_trades,
        total_pnl          = round(agent.total_pnl, 4),
        trust_score        = round(agent.trust_score, 1),
        win_rate           = round(win_rate, 1),
        recent_trades      = recent_trades,
        risk_heatmap       = heatmap,
        sharpe_ratio       = sharpe,
        max_drawdown       = max_dd,
        max_drawdown_pct   = max_dd_pct,
        current_drawdown   = current_dd,
        circuit_breaker_active = cb_active,
        vault_balance      = round(vault_balance, 2),
        vault_initial      = VAULT_INITIAL,
        daily_loss_usd     = round(daily_loss_usd, 4),
        daily_loss_pct     = round(daily_loss_pct, 2),
        equity_curve       = equity_curve,
    )


# ─── Risk heatmap ─────────────────────────────────────────────────────────────

@router.get("/heatmap/{wallet_address}", response_model=list[RiskHeatmapEntry])
async def get_risk_heatmap(wallet_address: str):
    return await build_risk_heatmap(wallet_address)


async def build_risk_heatmap(wallet_address: str) -> list[RiskHeatmapEntry]:
    db = get_db()
    cursor = db["trades"].find({"wallet_address": wallet_address, "status": "EXECUTED"})
    trades = await cursor.to_list(200)

    exposure_map: dict[str, float] = {}
    for trade in trades:
        base_token = trade["token_pair"].split("/")[0].lower()
        exposure_map[base_token] = exposure_map.get(base_token, 0) + trade.get("amount_usd", 0)

    if not exposure_map:
        exposure_map = {"eth": 500, "btc": 300, "pol": 200}

    token_id_map = {
        "eth":  "ethereum",
        "btc":  "bitcoin",
        "pol":  "polygon-ecosystem-token",
        "matic":"polygon-ecosystem-token",
        "link": "chainlink",
        "uni":  "uniswap",
        "aave": "aave",
    }
    token_ids  = list({token_id_map.get(k, k) for k in exposure_map})
    market_data = await fetch_multi_token_market_data(token_ids[:4])

    heatmap = []
    for symbol, exposure in exposure_map.items():
        token_id = token_id_map.get(symbol, symbol)
        mkt      = market_data.get(token_id)
        if mkt:
            volatility = abs(mkt.price_change_24h)
            sentiment  = mkt.sentiment_score or 0.0
            risk_score = min(100, volatility * 5 + max(0, -sentiment * 30) + 10)
        else:
            volatility, sentiment, risk_score = 5.0, 0.0, 30.0

        heatmap.append(RiskHeatmapEntry(
            token        = symbol.upper(),
            risk_score   = round(risk_score, 1),
            exposure_usd = round(exposure, 2),
            volatility   = round(volatility, 2),
            sentiment    = round(sentiment, 4),
        ))

    return sorted(heatmap, key=lambda x: x.risk_score, reverse=True)


# ─── PnL chart ────────────────────────────────────────────────────────────────

@router.get("/pnl-chart/{wallet_address}")
async def get_pnl_chart(wallet_address: str):
    db     = get_db()
    cursor = (
        db["trades"]
        .find({"wallet_address": wallet_address, "status": "EXECUTED"})
        .sort("created_at", 1)
    )
    trades = await cursor.to_list(500)
    equity_curve = _build_equity_curve(trades, VAULT_INITIAL)
    return {"wallet_address": wallet_address, "data": equity_curve}


# ── Risk metrics endpoint (used by risk_manager before each trade) ─────────────

@router.get("/risk-state/{wallet_address}")
async def get_risk_state(wallet_address: str):
    """
    Lightweight endpoint called by trade_execution to get current
    drawdown / daily loss state before allowing a trade.
    """
    db     = get_db()
    cursor = (
        db["trades"]
        .find({"wallet_address": wallet_address, "status": "EXECUTED"})
        .sort("created_at", 1)
    )
    trades = await cursor.to_list(1000)

    _, _, max_dd_pct, current_dd_pct = _compute_risk_metrics(trades, VAULT_INITIAL)

    today_start    = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    vault_balance  = VAULT_INITIAL + sum(t.get("pnl", 0) or 0 for t in trades)
    daily_loss_usd = sum(
        abs(t.get("pnl", 0) or 0)
        for t in trades
        if (t.get("pnl") or 0) < 0 and _trade_ts(t) >= today_start
    )
    daily_loss_pct = (daily_loss_usd / vault_balance * 100) if vault_balance > 0 else 0.0

    return {
        "vault_balance":     round(vault_balance, 2),
        "max_drawdown_pct":  round(max_dd_pct or 0, 2),
        "current_drawdown_pct": round(current_dd_pct or 0, 2),
        "daily_loss_pct":    round(daily_loss_pct, 2),
        "circuit_breaker":   (max_dd_pct or 0) > 15.0 or daily_loss_pct > 5.0,
    }


# ─── Analytics helpers ────────────────────────────────────────────────────────

def _trade_ts(trade: dict) -> datetime:
    ts = trade.get("created_at") or trade.get("executed_at")
    if isinstance(ts, datetime):
        return ts
    if isinstance(ts, str):
        try:
            return datetime.fromisoformat(ts)
        except Exception:
            pass
    return datetime.utcnow()


def _compute_risk_metrics(
    trades: list[dict],
    vault_initial: float,
) -> tuple[float | None, float | None, float | None, float | None]:
    """
    Returns (sharpe_ratio, max_drawdown_usd, max_drawdown_pct, current_drawdown_pct)

    Sharpe = mean(returns) / std(returns) × √252   (annualised, risk-free=0)
    Max Drawdown = worst peak→trough equity drop
    """
    if not trades:
        return None, None, None, None

    pnls = [t.get("pnl", 0) or 0 for t in trades]

    # ── Sharpe Ratio ─────────────────────────────────────────────────────────
    n     = len(pnls)
    mean  = sum(pnls) / n
    if n > 1:
        variance = sum((p - mean) ** 2 for p in pnls) / (n - 1)
        std      = math.sqrt(variance)
    else:
        std = 0.0

    sharpe: float | None = None
    if std > 0:
        # Annualise: assume ~252 trades/year (daily trading)
        sharpe = round(mean / std * math.sqrt(252), 3)

    # ── Max Drawdown ─────────────────────────────────────────────────────────
    equity  = vault_initial
    peak    = vault_initial
    max_dd_abs = 0.0
    max_dd_pct = 0.0

    for pnl in pnls:
        equity += pnl
        if equity > peak:
            peak = equity
        drawdown     = peak - equity
        drawdown_pct = (drawdown / peak * 100) if peak > 0 else 0.0
        if drawdown_abs := drawdown:
            if drawdown_abs > max_dd_abs:
                max_dd_abs = drawdown_abs
                max_dd_pct = drawdown_pct

    current_dd     = peak - equity
    current_dd_pct = (current_dd / peak * 100) if peak > 0 else 0.0

    return (
        sharpe,
        round(max_dd_abs, 4) if max_dd_abs > 0 else None,
        round(max_dd_pct, 2) if max_dd_pct > 0 else None,
        round(current_dd_pct, 2),
    )


def _build_equity_curve(
    trades: list[dict],
    vault_initial: float,
) -> list[dict]:
    """
    Returns [{timestamp, equity, pnl, action, token_pair}, ...] for charting.
    """
    equity     = vault_initial
    peak       = vault_initial
    curve      = [{"timestamp": "Start", "equity": vault_initial, "pnl": 0,
                   "drawdown": 0.0, "action": "", "token_pair": ""}]

    for trade in trades:
        pnl    = trade.get("pnl", 0) or 0
        equity += pnl
        peak    = max(peak, equity)
        dd_pct  = ((peak - equity) / peak * 100) if peak > 0 else 0.0

        ts = _trade_ts(trade)
        curve.append({
            "timestamp":  ts.strftime("%m/%d %H:%M") if ts else "—",
            "equity":     round(equity, 2),
            "pnl":        round(pnl, 4),
            "drawdown":   round(dd_pct, 2),
            "action":     trade.get("action", ""),
            "token_pair": trade.get("token_pair", ""),
        })

    return curve