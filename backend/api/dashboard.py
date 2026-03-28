"""
Dashboard API — extended with:
  - Failure Intelligence endpoint (Feature 9)
  - Trade Quality Score summary (Feature 8)
  - Auto-Generated Report data (Feature 10)
  - Risk Visualizer stats (Feature 6)
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

VAULT_INITIAL = 10_000.0


# ─── Main dashboard ───────────────────────────────────────────────────────────

@router.get("/{wallet_address}", response_model=DashboardStats)
async def get_dashboard(wallet_address: str):
    db = get_db()

    agent_doc = await db["agents"].find_one({"wallet_address": wallet_address})
    if not agent_doc:
        raise HTTPException(status_code=404, detail="Agent not found")
    agent_doc["id"] = str(agent_doc.pop("_id", agent_doc.get("id", "")))
    agent = Agent(**agent_doc)

    all_cursor = (
        db["trades"]
        .find({"wallet_address": wallet_address, "status": "EXECUTED"})
        .sort("created_at", 1)
    )
    all_trades = await all_cursor.to_list(1000)

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

    win_rate = (
        (agent.profitable_trades / agent.total_trades * 100)
        if agent.total_trades > 0 else 0.0
    )

    sharpe, max_dd, max_dd_pct, current_dd = _compute_risk_metrics(all_trades, VAULT_INITIAL)

    total_pnl_executed = sum(t.get("pnl", 0) or 0 for t in all_trades)
    vault_balance       = VAULT_INITIAL + total_pnl_executed

    today_start    = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    daily_loss_usd = sum(
        abs(t.get("pnl", 0) or 0)
        for t in all_trades
        if (t.get("pnl") or 0) < 0
        and _trade_ts(t) >= today_start
    )
    daily_loss_pct = (daily_loss_usd / vault_balance * 100) if vault_balance > 0 else 0.0

    cb_active    = (max_dd_pct or 0) > 15.0 or daily_loss_pct > 5.0
    equity_curve = _build_equity_curve(all_trades, VAULT_INITIAL)
    heatmap      = await build_risk_heatmap(wallet_address)

    # ── Failure Intelligence summary (Feature 9) ──────────────────────────────
    failed_analysis = _build_failure_analysis(all_trades)

    return DashboardStats(
        total_trades           = agent.total_trades,
        profitable_trades      = agent.profitable_trades,
        total_pnl              = round(agent.total_pnl, 4),
        trust_score            = round(agent.trust_score, 1),
        win_rate               = round(win_rate, 1),
        recent_trades          = recent_trades,
        risk_heatmap           = heatmap,
        sharpe_ratio           = sharpe,
        max_drawdown           = max_dd,
        max_drawdown_pct       = max_dd_pct,
        current_drawdown       = current_dd,
        circuit_breaker_active = cb_active,
        vault_balance          = round(vault_balance, 2),
        vault_initial          = VAULT_INITIAL,
        daily_loss_usd         = round(daily_loss_usd, 4),
        daily_loss_pct         = round(daily_loss_pct, 2),
        equity_curve           = equity_curve,
        failed_trade_analysis  = failed_analysis,
    )


# ─── Risk Heatmap ─────────────────────────────────────────────────────────────

@router.get("/heatmap/{wallet_address}", response_model=list[RiskHeatmapEntry])
async def get_risk_heatmap(wallet_address: str):
    return await build_risk_heatmap(wallet_address)


async def build_risk_heatmap(wallet_address: str) -> list[RiskHeatmapEntry]:
    db     = get_db()
    cursor = db["trades"].find({"wallet_address": wallet_address, "status": "EXECUTED"})
    trades = await cursor.to_list(200)

    exposure_map: dict[str, float] = {}
    for trade in trades:
        base = trade["token_pair"].split("/")[0].lower()
        exposure_map[base] = exposure_map.get(base, 0) + trade.get("amount_usd", 0)

    if not exposure_map:
        exposure_map = {"eth": 500, "btc": 300, "pol": 200}

    token_id_map = {
        "eth": "ethereum", "btc": "bitcoin",
        "pol": "polygon-ecosystem-token", "matic": "polygon-ecosystem-token",
        "link": "chainlink", "uni": "uniswap", "aave": "aave",
    }
    token_ids   = list({token_id_map.get(k, k) for k in exposure_map})
    market_data = await fetch_multi_token_market_data(token_ids[:4])

    heatmap = []
    for symbol, exposure in exposure_map.items():
        token_id   = token_id_map.get(symbol, symbol)
        mkt        = market_data.get(token_id)
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
    trades       = await cursor.to_list(500)
    equity_curve = _build_equity_curve(trades, VAULT_INITIAL)
    return {"wallet_address": wallet_address, "data": equity_curve}


# ─── Risk state ───────────────────────────────────────────────────────────────

@router.get("/risk-state/{wallet_address}")
async def get_risk_state(wallet_address: str):
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
        "vault_balance":          round(vault_balance, 2),
        "max_drawdown_pct":       round(max_dd_pct or 0, 2),
        "current_drawdown_pct":   round(current_dd_pct or 0, 2),
        "daily_loss_pct":         round(daily_loss_pct, 2),
        "circuit_breaker":        (max_dd_pct or 0) > 15.0 or daily_loss_pct > 5.0,
    }


# ─── Failure Intelligence (Feature 9) ────────────────────────────────────────

@router.get("/failure-analysis/{wallet_address}")
async def get_failure_analysis(wallet_address: str):
    """
    Analyse all losing trades and explain WHY they failed.
    """
    db     = get_db()
    cursor = (
        db["trades"]
        .find({"wallet_address": wallet_address, "status": "EXECUTED", "pnl": {"$lt": 0}})
        .sort("pnl", 1)
        .limit(20)
    )
    bad_trades = await cursor.to_list(20)

    analysis = _build_failure_analysis(bad_trades)

    # Pattern summary
    reasons   = [t.get("failure_reason", "") for t in bad_trades if t.get("failure_reason")]
    patterns  = {}
    for r in reasons:
        for kw in ["volatility", "overbought", "oversold", "confidence", "downtrend", "momentum"]:
            if kw in r.lower():
                patterns[kw] = patterns.get(kw, 0) + 1

    top_pattern = max(patterns, key=patterns.get) if patterns else "mixed signals"

    return {
        "wallet_address":   wallet_address,
        "total_failures":   len(bad_trades),
        "total_loss":       round(sum(t.get("pnl", 0) or 0 for t in bad_trades), 4),
        "top_failure_pattern": top_pattern,
        "recommendations":  _build_recommendations(top_pattern),
        "failed_trades":    analysis,
    }


# ─── Trade Quality Summary (Feature 8) ───────────────────────────────────────

@router.get("/quality-summary/{wallet_address}")
async def get_quality_summary(wallet_address: str):
    """Aggregate quality scores across all trades."""
    db     = get_db()
    cursor = (
        db["trades"]
        .find({"wallet_address": wallet_address, "status": "EXECUTED"})
        .sort("created_at", -1)
        .limit(50)
    )
    trades = await cursor.to_list(50)

    scores = [
        t["quality_score"]["trade_score"]
        for t in trades
        if t.get("quality_score") and t["quality_score"].get("trade_score")
    ]

    if not scores:
        return {"message": "No quality scores yet. Execute some trades first."}

    avg    = round(sum(scores) / len(scores), 1)
    best   = round(max(scores), 1)
    worst  = round(min(scores), 1)

    label_map = {range(8, 11): "Excellent", range(6, 8): "Good",
                 range(4, 6): "Average", range(0, 4): "Poor"}
    avg_label = "Average"
    for r, lbl in label_map.items():
        if int(avg) in r:
            avg_label = lbl

    return {
        "avg_quality_score": avg,
        "best_quality_score": best,
        "worst_quality_score": worst,
        "label": avg_label,
        "total_scored_trades": len(scores),
    }


# ─── Auto-Generated Report (Feature 10) ──────────────────────────────────────

@router.get("/report/{wallet_address}")
async def generate_report(wallet_address: str):
    """
    Generate a full trading report with all metrics.
    Frontend can use this to render a printable PDF.
    """
    db = get_db()

    agent_doc = await db["agents"].find_one({"wallet_address": wallet_address})
    if not agent_doc:
        raise HTTPException(status_code=404, detail="Agent not found")

    cursor = (
        db["trades"]
        .find({"wallet_address": wallet_address, "status": "EXECUTED"})
        .sort("created_at", 1)
    )
    trades = await cursor.to_list(1000)

    sharpe, max_dd, max_dd_pct, current_dd = _compute_risk_metrics(trades, VAULT_INITIAL)
    vault_balance = VAULT_INITIAL + sum(t.get("pnl", 0) or 0 for t in trades)
    win_rate = (
        agent_doc.get("profitable_trades", 0) / agent_doc.get("total_trades", 1) * 100
        if agent_doc.get("total_trades", 0) > 0 else 0
    )

    # Strategy breakdown
    strategy_stats: dict = {}
    for t in trades:
        s   = t.get("strategy_used", "UNKNOWN")
        pnl = t.get("pnl", 0) or 0
        if s not in strategy_stats:
            strategy_stats[s] = {"count": 0, "pnl": 0.0, "wins": 0}
        strategy_stats[s]["count"] += 1
        strategy_stats[s]["pnl"]   += pnl
        if pnl > 0:
            strategy_stats[s]["wins"] += 1

    # Token breakdown
    token_stats: dict = {}
    for t in trades:
        tok = t.get("token_pair", "UNKNOWN")
        pnl = t.get("pnl", 0) or 0
        if tok not in token_stats:
            token_stats[tok] = {"count": 0, "pnl": 0.0}
        token_stats[tok]["count"] += 1
        token_stats[tok]["pnl"]   += pnl

    # Quality score average
    qs = [t["quality_score"]["trade_score"] for t in trades
          if t.get("quality_score") and t["quality_score"].get("trade_score")]
    avg_quality = round(sum(qs) / len(qs), 1) if qs else None

    return {
        "generated_at":     datetime.utcnow().isoformat(),
        "wallet_address":   wallet_address,
        "agent_name":       agent_doc.get("name"),
        "strategy":         agent_doc.get("strategy"),
        "risk_tolerance":   agent_doc.get("risk_tolerance"),
        "summary": {
            "total_trades":       agent_doc.get("total_trades", 0),
            "profitable_trades":  agent_doc.get("profitable_trades", 0),
            "total_pnl":          round(agent_doc.get("total_pnl", 0), 4),
            "win_rate":           round(win_rate, 1),
            "trust_score":        round(agent_doc.get("trust_score", 50), 1),
            "vault_balance":      round(vault_balance, 2),
            "vault_return_pct":   round((vault_balance - VAULT_INITIAL) / VAULT_INITIAL * 100, 2),
        },
        "risk_metrics": {
            "sharpe_ratio":    sharpe,
            "max_drawdown":    max_dd,
            "max_drawdown_pct": max_dd_pct,
            "current_drawdown": current_dd,
        },
        "strategy_breakdown":    strategy_stats,
        "token_breakdown":       token_stats,
        "avg_quality_score":     avg_quality,
        "equity_curve":          _build_equity_curve(trades, VAULT_INITIAL),
        "failure_analysis":      _build_failure_analysis(
            [t for t in trades if (t.get("pnl") or 0) < 0]
        ),
    }


# ─── Analytics helpers ────────────────────────────────────────────────────────

def _trade_ts(trade: dict) -> datetime:
    ts = trade.get("created_at") or trade.get("executed_at")
    if isinstance(ts, datetime): return ts
    if isinstance(ts, str):
        try: return datetime.fromisoformat(ts)
        except Exception: pass
    return datetime.utcnow()


def _compute_risk_metrics(
    trades: list[dict],
    vault_initial: float,
) -> tuple[float | None, float | None, float | None, float | None]:
    if not trades:
        return None, None, None, None

    pnls   = [t.get("pnl", 0) or 0 for t in trades]
    n      = len(pnls)
    mean   = sum(pnls) / n
    std    = math.sqrt(sum((p - mean) ** 2 for p in pnls) / (n - 1)) if n > 1 else 0.0
    sharpe = round(mean / std * math.sqrt(252), 3) if std > 0 else None

    equity = vault_initial; peak = vault_initial
    max_dd_abs = 0.0; max_dd_pct = 0.0

    for pnl in pnls:
        equity += pnl
        if equity > peak: peak = equity
        dd = peak - equity
        dd_pct = (dd / peak * 100) if peak > 0 else 0.0
        if dd > max_dd_abs:
            max_dd_abs = dd; max_dd_pct = dd_pct

    current_dd     = peak - equity
    current_dd_pct = (current_dd / peak * 100) if peak > 0 else 0.0

    return (
        sharpe,
        round(max_dd_abs, 4) if max_dd_abs > 0 else None,
        round(max_dd_pct, 2) if max_dd_pct > 0 else None,
        round(current_dd_pct, 2),
    )


def _build_equity_curve(trades: list[dict], vault_initial: float) -> list[dict]:
    equity = vault_initial; peak = vault_initial
    curve  = [{"timestamp": "Start", "equity": vault_initial, "pnl": 0,
               "drawdown": 0.0, "action": "", "token_pair": ""}]
    for trade in trades:
        pnl    = trade.get("pnl", 0) or 0
        equity += pnl
        peak    = max(peak, equity)
        dd_pct  = ((peak - equity) / peak * 100) if peak > 0 else 0.0
        ts      = _trade_ts(trade)
        curve.append({
            "timestamp":  ts.strftime("%m/%d %H:%M") if ts else "—",
            "equity":     round(equity, 2),
            "pnl":        round(pnl, 4),
            "drawdown":   round(dd_pct, 2),
            "action":     trade.get("action", ""),
            "token_pair": trade.get("token_pair", ""),
        })
    return curve


def _build_failure_analysis(bad_trades: list[dict]) -> list[dict]:
    """Build failure analysis list for dashboard and report."""
    analysis = []
    for t in bad_trades:
        rsi    = (t.get("indicators") or {}).get("rsi", 50)
        reason = t.get("failure_reason")

        if not reason:
            chg = (t.get("indicators") or {}).get("price_change_24h", 0)
            action = t.get("action", "")
            if action == "BUY" and chg < -3:
                reason = f"Bought into downtrend — price dropped {chg:.2f}%"
            elif action == "SELL" and chg > 3:
                reason = f"Shorted into uptrend — price rose {chg:+.2f}%"
            elif rsi > 65 and action == "BUY":
                reason = f"Entered BUY at overbought RSI {rsi:.1f}"
            elif rsi < 35 and action == "SELL":
                reason = f"Entered SELL at oversold RSI {rsi:.1f}"
            else:
                reason = "Mixed signals — insufficient directional confirmation"

        analysis.append({
            "trade_id":      str(t.get("_id", "")),
            "pair":          t.get("token_pair"),
            "action":        t.get("action"),
            "pnl":           round(t.get("pnl", 0) or 0, 4),
            "confidence":    t.get("confidence"),
            "failure_reason": reason,
        })
    return analysis


def _build_recommendations(pattern: str) -> list[str]:
    """Return actionable recommendations based on failure pattern."""
    recs = {
        "volatility": [
            "Consider adding ATR-based position sizing to account for high volatility periods.",
            "Reduce max_trade_usd during periods of >5% 24h price swings.",
        ],
        "overbought": [
            "Wait for RSI to pull back below 65 before entering BUY positions.",
            "Add RSI divergence check before executing high-RSI trades.",
        ],
        "oversold": [
            "Confirm downtrend with MA crossover before entering SELL positions.",
            "Combine RSI oversold with negative sentiment before shorting.",
        ],
        "confidence": [
            "Set a minimum confidence threshold of 60% for trade execution.",
            "Switch to COMBINED strategy for stronger signal confirmation.",
        ],
        "momentum": [
            "Add 24h momentum filter — avoid BUY on strong negative momentum.",
            "Use SENTIMENT strategy during high-momentum market conditions.",
        ],
        "mixed signals": [
            "Use COMBINED strategy for better signal consensus.",
            "Increase signal confirmation threshold before executing trades.",
        ],
    }
    return recs.get(pattern, [
        "Review your strategy settings in the Dashboard.",
        "Consider adjusting risk tolerance to MEDIUM for balanced signal filtering.",
    ])