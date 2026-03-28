"""
Trade Execution Service — extended with:
  - Trade Quality Score (Feature 8)
  - Failure Intelligence (Feature 9)
  - Proof Layer: decision_hash stored in DB (Feature 2)
  - Explainability: why[] + why_not_alternatives carried into TradeIntent
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime

from loguru import logger

from core.database import get_db
from models.schemas import (
    AIDecision, Agent, TradeIntent, TradeStatus,
    ValidationProof, TradeQualityScore,
)
from services.blockchain import blockchain_service
from services.market_data import fetch_current_market_data, normalise_token
from services.risk_manager import risk_manager, RiskManager
from api.dashboard import _compute_risk_metrics, VAULT_INITIAL


def _compute_quality_score(
    decision: AIDecision,
    pnl: float,
    risk_passed: bool,
) -> TradeQualityScore:
    """
    Trade Quality Score (Feature 8):
    - risk_score:   HIGH risk = 3, MEDIUM = 6, LOW = 9
    - timing_score: based on confidence / 10
    - pnl_score:    5 + normalized pnl impact, clamped 0–10
    - trade_score:  weighted average
    - label:        Excellent / Good / Average / Poor
    """
    risk_map   = {"LOW": 9.0, "MEDIUM": 6.0, "HIGH": 3.0}
    risk_score = risk_map.get(decision.risk_level.value, 5.0)
    if not risk_passed:
        risk_score = max(0.0, risk_score - 2.0)

    timing_score = round(min(decision.confidence / 10.0, 10.0), 1)

    # PnL score: 0 pnl = 5, capped at 0–10
    pnl_impact   = (pnl / max(decision.amount_usd, 1)) * 100   # % return
    pnl_score    = round(min(max(5.0 + pnl_impact * 2, 0.0), 10.0), 1)

    trade_score  = round((risk_score * 0.35 + timing_score * 0.35 + pnl_score * 0.30), 1)

    if trade_score >= 8:   label = "Excellent"
    elif trade_score >= 6: label = "Good"
    elif trade_score >= 4: label = "Average"
    else:                  label = "Poor"

    return TradeQualityScore(
        trade_score  = trade_score,
        risk_score   = risk_score,
        timing_score = timing_score,
        pnl_score    = pnl_score,
        label        = label,
    )


def _compute_failure_reason(
    decision: AIDecision,
    pnl: float,
    price_change_24h: float,
) -> str | None:
    """
    Failure Intelligence (Feature 9):
    Only called when pnl < 0. Explains WHY the trade failed.
    """
    if pnl >= 0:
        return None

    rsi  = decision.indicators.get("rsi", 50) if decision.indicators else 50
    chg  = price_change_24h
    action = decision.action.value

    if action == "BUY" and chg < -3:
        return f"Bought into a strong downtrend — price dropped {chg:.2f}% despite oversold RSI signal."
    if action == "SELL" and chg > 3:
        return f"Shorted into upward momentum — price rose {chg:+.2f}% against the sell signal."
    if rsi > 65 and action == "BUY":
        return f"Entered BUY when RSI was {rsi:.1f} — overbought territory increased reversal risk."
    if rsi < 35 and action == "SELL":
        return f"Entered SELL when RSI was {rsi:.1f} — oversold conditions increase bounce risk."
    if abs(chg) > 5:
        return f"High volatility ({chg:+.2f}% 24h swing) exceeded strategy's normal operating range."
    if decision.confidence < 55:
        return f"Low confidence ({decision.confidence:.0f}%) trade executed — insufficient signal strength."

    return f"Market moved against position ({chg:+.2f}% 24h) — mixed signals not captured by {decision.strategy_used.value} strategy."


class TradeExecutionService:

    async def execute_trade(self, decision: AIDecision, agent: Agent) -> TradeIntent:
        db       = get_db()
        trade_id = str(uuid.uuid4())

        # ── Pre-check: live drawdown / daily loss ─────────────────────────────
        current_drawdown_pct, daily_loss_pct, vault_balance = \
            await self._get_risk_state(db, agent.wallet_address)

        # ── Step 1: Off-chain risk check ──────────────────────────────────────
        risk_result  = risk_manager.check_trade(
            decision, agent,
            current_drawdown_pct = current_drawdown_pct,
            daily_loss_pct       = daily_loss_pct,
        )
        risk_status  = "passed" if risk_result.passed else "failed"
        final_amount = risk_result.adjusted_amount

        # ATR-based position sizing
        atr           = decision.indicators.get("atr") if decision.indicators else None
        price         = decision.indicators.get("price") if decision.indicators else None
        pos_size_pct  = None
        stop_loss_usd = None
        if atr and price and vault_balance > 0:
            pos_size_usd  = RiskManager.atr_position_size(vault_balance, 1.5, atr, price)
            pos_size_pct  = round(pos_size_usd / vault_balance * 100, 2)
            stop_loss_usd = round(price - atr * 1.5, 4)
            final_amount  = min(final_amount, pos_size_usd)

        intent = TradeIntent(
            id                   = trade_id,
            wallet_address       = agent.wallet_address,
            agent_id             = agent.id or agent.wallet_address,
            token_pair           = decision.token_pair,
            action               = decision.action,
            amount_usd           = final_amount,
            reason               = decision.reason,
            confidence           = decision.confidence,
            risk_level           = decision.risk_level,
            risk_check           = risk_status,
            status               = TradeStatus.PENDING if risk_result.passed else TradeStatus.REJECTED,
            atr                  = atr,
            position_size_pct    = pos_size_pct,
            stop_loss_usd        = stop_loss_usd,
            # ── Carry explainability into trade record ─────────────────────
            why                  = decision.why,
            why_not_alternatives = decision.why_not_alternatives,
            alternative_actions  = decision.alternative_actions,
            decision_hash        = decision.decision_hash,
        )

        if not risk_result.passed:
            logger.warning(f"Trade {trade_id} rejected: {risk_result.reason}")
            # Failure intelligence for rejected trades
            intent.failure_reason = f"Risk check failed: {risk_result.reason}"
            await self._save_trade(db, intent)
            return intent

        # ── Step 2: On-chain token check ──────────────────────────────────────
        token_symbol  = decision.token_pair.split("/")[0]
        token_allowed = await blockchain_service.is_token_allowed(token_symbol)
        if not token_allowed:
            logger.warning(f"Trade {trade_id} blocked — {token_symbol} not allowed")
            intent.status        = TradeStatus.REJECTED
            intent.risk_check    = "failed"
            intent.failure_reason = f"Token {token_symbol} not on the RiskRouter allowlist."
            await self._save_trade(db, intent)
            return intent

        logger.info(f"RiskRouter: {token_symbol} allowed ✅")

        # ── Step 2b: EIP-712 RiskRouter.submitTrade() ─────────────────────────
        if decision.action.value != "HOLD":
            approved, risk_router_tx = await blockchain_service.submit_trade_to_risk_router(
                agent_id   = intent.agent_id,
                token_pair = decision.token_pair,
                action     = decision.action.value,
                amount_usd = final_amount,
                confidence = decision.confidence,
                reason     = decision.reason,
            )
            if not approved:
                intent.status        = TradeStatus.REJECTED
                intent.risk_check    = "failed"
                intent.failure_reason = "Rejected by on-chain RiskRouter.submitTrade()."
                await self._save_trade(db, intent)
                return intent
            if risk_router_tx:
                intent.on_chain_id = risk_router_tx

        # ── Step 3: Fetch market data (cache hit) ─────────────────────────────
        token_id = normalise_token(decision.token)
        try:
            market           = await fetch_current_market_data(token_id)
            entry_price      = market.price_usd
            price_change_24h = market.price_change_24h
            logger.info(f"Entry [{token_symbol}]: ${entry_price:,.4f} | 24h={price_change_24h:+.2f}%")
        except Exception as exc:
            logger.error(f"Market data fetch failed for {trade_id}: {exc}")
            intent.status        = TradeStatus.FAILED
            intent.failure_reason = f"Market data unavailable: {str(exc)}"
            await self._save_trade(db, intent)
            return intent

        # ── Step 4: Store validation proof on-chain ───────────────────────────
        proof = ValidationProof(
            id            = str(uuid.uuid4()),
            trade_id      = trade_id,
            agent_id      = intent.agent_id,
            reason        = decision.reason,
            risk_check    = risk_status,
            confidence    = decision.confidence,
            decision_hash = decision.decision_hash,   # proof layer
        )
        on_chain_tx        = await blockchain_service.store_validation_proof(proof)
        proof.on_chain_tx  = on_chain_tx
        intent.on_chain_id = on_chain_tx
        logger.info(f"Validation proof: {on_chain_tx} | hash={decision.decision_hash}")

        try:
            proof_data                = proof.model_dump()
            proof_data["entry_price"] = entry_price
            await db["validation_proofs"].insert_one(proof_data)
        except Exception as exc:
            logger.warning(f"Could not save proof (non-fatal): {exc}")

        # ── Step 5: PnL from real 24h market movement ─────────────────────────
        pnl = self._calculate_pnl(
            action           = decision.action.value,
            amount_usd       = final_amount,
            price_change_24h = price_change_24h,
            confidence       = decision.confidence,
        )

        intent.pnl         = pnl
        intent.tx_hash     = f"simulated-dex-{trade_id[:8]}"
        intent.status      = TradeStatus.EXECUTED
        intent.executed_at = datetime.utcnow()
        proof.pnl          = pnl
        proof.outcome      = "profit" if pnl > 0 else "loss" if pnl < 0 else "neutral"

        # ── Feature 8: Trade Quality Score ────────────────────────────────────
        quality = _compute_quality_score(decision, pnl, risk_result.passed)
        intent.quality_score = quality
        logger.info(
            f"Quality score: {quality.trade_score}/10 ({quality.label}) | "
            f"risk={quality.risk_score} timing={quality.timing_score} pnl={quality.pnl_score}"
        )

        # ── Feature 9: Failure Intelligence ───────────────────────────────────
        if pnl < 0:
            intent.failure_reason = _compute_failure_reason(decision, pnl, price_change_24h)
            if intent.failure_reason:
                logger.info(f"Failure intelligence: {intent.failure_reason}")

        logger.info(
            f"PnL [{decision.action.value} {token_symbol}] "
            f"24h Δ={price_change_24h:+.2f}% | amount=${final_amount:.2f} | PnL=${pnl:+.4f}"
        )

        # ── Step 6: Update ReputationManager on-chain ─────────────────────────
        try:
            rep_tx = await asyncio.wait_for(
                blockchain_service.update_reputation(
                    agent_id   = intent.agent_id,
                    trade_id   = trade_id,
                    profitable = (pnl > 0),
                    pnl_usd    = pnl,
                ),
                timeout=5.0,
            )
            if rep_tx:
                logger.info(f"Reputation updated: {rep_tx}")
        except (asyncio.TimeoutError, Exception) as exc:
            logger.warning(f"Reputation update skipped (non-fatal): {exc}")

        # ── Step 7: Persist ───────────────────────────────────────────────────
        await self._update_agent_stats(db, agent, pnl)
        await self._save_trade(db, intent)

        logger.info(f"✅ Trade {trade_id} | {decision.action.value} {token_symbol} | PnL=${pnl:+.4f}")
        return intent

    # ── PnL ───────────────────────────────────────────────────────────────────

    def _calculate_pnl(
        self,
        action: str,
        amount_usd: float,
        price_change_24h: float,
        confidence: float,
    ) -> float:
        change_decimal  = price_change_24h / 100.0
        exposure_factor = 0.5 + (confidence / 100.0) * 0.5
        if action == "BUY":
            pnl = amount_usd * change_decimal * exposure_factor
        elif action == "SELL":
            pnl = amount_usd * (-change_decimal) * exposure_factor
        else:
            pnl = amount_usd * change_decimal * exposure_factor * 0.3
        return round(pnl, 4)

    # ── DB helpers ────────────────────────────────────────────────────────────

    async def _get_risk_state(
        self, db, wallet_address: str
    ) -> tuple[float, float, float]:
        try:
            cursor = (
                db["trades"]
                .find({"wallet_address": wallet_address, "status": "EXECUTED"})
                .sort("created_at", 1)
            )
            trades = await cursor.to_list(1000)
            _, _, _, current_dd_pct = _compute_risk_metrics(trades, VAULT_INITIAL)
            current_dd_pct = current_dd_pct or 0.0
            vault_balance  = VAULT_INITIAL + sum(t.get("pnl", 0) or 0 for t in trades)

            today_start    = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
            daily_loss_usd = sum(
                abs(t.get("pnl", 0) or 0)
                for t in trades
                if (t.get("pnl") or 0) < 0
                and (t.get("created_at") or datetime.utcnow()) >= today_start
            )
            daily_loss_pct = (daily_loss_usd / vault_balance * 100) if vault_balance > 0 else 0.0

            await db["agents"].update_one(
                {"wallet_address": wallet_address},
                {"$set": {"vault_balance": round(vault_balance, 2)}},
            )
            return current_dd_pct, daily_loss_pct, vault_balance
        except Exception as exc:
            logger.warning(f"_get_risk_state failed (non-fatal): {exc}")
            return 0.0, 0.0, VAULT_INITIAL

    async def _save_trade(self, db, intent: TradeIntent) -> None:
        try:
            data     = intent.model_dump()
            trade_id = data.pop("id", None) or intent.id
            if trade_id:
                data["_id"] = trade_id
            await db["trades"].replace_one({"_id": trade_id}, data, upsert=True)
        except Exception as exc:
            logger.error(f"Failed to save trade: {exc}")

    async def _update_agent_stats(self, db, agent: Agent, pnl: float) -> None:
        try:
            inc = {"total_trades": 1, "total_pnl": pnl}
            if pnl > 0:
                inc["profitable_trades"] = 1
            new_trust = max(0.0, min(100.0, agent.trust_score + (2.0 if pnl > 0 else -1.5)))
            await db["agents"].update_one(
                {"wallet_address": agent.wallet_address},
                {"$inc": inc, "$set": {"trust_score": new_trust}},
            )
        except Exception as exc:
            logger.warning(f"Could not update agent stats (non-fatal): {exc}")


trade_execution_service = TradeExecutionService()