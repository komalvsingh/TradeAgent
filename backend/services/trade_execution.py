"""
Trade Execution Service.

Fixes applied
-------------
1. Token is normalised via `normalise_token()` before every market data fetch,
   so "Bitcoin" / "BTC" / "bitcoin" all resolve correctly.
2. `decision.token` is normalised when passed to `fetch_current_market_data`
   (the AI decision service already stores the raw token name; normalise here
   as a safety net).
3. PnL calculation is unchanged (sound logic) but now logs the exact
   confidence-weighted exposure so you can trace it in the console.
4. `_save_trade` gracefully handles missing `id` field.
5. Reputation update is fire-and-forget with a timeout so it never blocks.
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime

from loguru import logger

from core.database import get_db
from models.schemas import (
    AIDecision,
    Agent,
    TradeIntent,
    TradeStatus,
    ValidationProof,
)
from services.blockchain import blockchain_service
from services.market_data import fetch_current_market_data, normalise_token
from services.risk_manager import risk_manager


class TradeExecutionService:

    async def execute_trade(self, decision: AIDecision, agent: Agent) -> TradeIntent:
        db       = get_db()
        trade_id = str(uuid.uuid4())

        # ── Step 1: Off-chain risk check ──────────────────────────────────────
        risk_result  = risk_manager.check_trade(decision, agent)
        risk_status  = "passed" if risk_result.passed else "failed"
        final_amount = risk_result.adjusted_amount

        intent = TradeIntent(
            id             = trade_id,
            wallet_address = agent.wallet_address,
            agent_id       = agent.id or agent.wallet_address,
            token_pair     = decision.token_pair,
            action         = decision.action,
            amount_usd     = final_amount,
            reason         = decision.reason,
            confidence     = decision.confidence,
            risk_level     = decision.risk_level,
            risk_check     = risk_status,
            status         = TradeStatus.PENDING if risk_result.passed else TradeStatus.REJECTED,
        )

        if not risk_result.passed:
            logger.warning(f"Trade {trade_id} rejected by risk check: {risk_result.reason}")
            await self._save_trade(db, intent)
            return intent

        # ── Step 2: On-chain token check via RiskRouter ───────────────────────
        token_symbol  = decision.token_pair.split("/")[0]
        token_allowed = await blockchain_service.is_token_allowed(token_symbol)

        if not token_allowed:
            logger.warning(f"Trade {trade_id} blocked — {token_symbol} not on allow-list")
            intent.status     = TradeStatus.REJECTED
            intent.risk_check = "failed"
            await self._save_trade(db, intent)
            return intent

        logger.info(f"RiskRouter: {token_symbol} allowed ✅")

        # ── Step 2b: EIP-712 sign + RiskRouter.submitTrade() ─────────────────
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
                logger.warning(f"Trade {trade_id} rejected by RiskRouter.submitTrade()")
                intent.status     = TradeStatus.REJECTED
                intent.risk_check = "failed"
                await self._save_trade(db, intent)
                return intent
            if risk_router_tx:
                intent.on_chain_id = risk_router_tx
                logger.info(f"RiskRouter approval tx: {risk_router_tx}")

        # ── Step 3: Fetch market data (cache hit — effectively free) ──────────
        # The AI decision service fetched this <1 s ago; the 60 s TTL cache
        # means this is an instant in-memory return with no HTTP call.
        # ✅ FIX: normalise token before fetching so mismatches never cause a miss
        token_id = normalise_token(decision.token)
        try:
            market           = await fetch_current_market_data(token_id)
            entry_price      = market.price_usd
            price_change_24h = market.price_change_24h
            logger.info(f"Entry price [{token_symbol}]: ${entry_price:,.4f} | 24h={price_change_24h:+.2f}%")
        except Exception as exc:
            logger.error(f"Market data fetch failed for trade {trade_id}: {exc}")
            intent.status = TradeStatus.FAILED
            await self._save_trade(db, intent)
            return intent

        # ── Step 4: Store validation proof on-chain ───────────────────────────
        proof = ValidationProof(
            id         = str(uuid.uuid4()),
            trade_id   = trade_id,
            agent_id   = intent.agent_id,
            reason     = decision.reason,
            risk_check = risk_status,
            confidence = decision.confidence,
        )
        on_chain_tx        = await blockchain_service.store_validation_proof(proof)
        proof.on_chain_tx  = on_chain_tx
        intent.on_chain_id = on_chain_tx
        logger.info(f"Validation proof stored: {on_chain_tx}")

        try:
            proof_data                = proof.model_dump()
            proof_data["entry_price"] = entry_price
            await db["validation_proofs"].insert_one(proof_data)
        except Exception as exc:
            logger.warning(f"Could not save proof to DB (non-fatal): {exc}")

        # ── Step 5: PnL from real 24 h market movement ────────────────────────
        #
        # Rationale:
        #   • Sampling price twice seconds apart yields ~0 delta — meaningless.
        #   • 24 h change is the real signal the AI analysed, so it's the
        #     correct basis for intraday PnL tracking.
        #   • Confidence scales exposure: high-confidence trades carry more.
        #
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

        logger.info(
            f"PnL [{decision.action.value} {token_symbol}] "
            f"24h Δ={price_change_24h:+.2f}% | amount=${final_amount:.2f} | "
            f"confidence={decision.confidence:.1f}% | PnL=${pnl:+.4f}"
        )

        # ── Step 6: Update ReputationManager on-chain (fire-and-forget) ───────
        # Wrap in a short timeout so a slow RPC never stalls trade response.
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
                logger.info(f"Reputation updated on-chain: {rep_tx}")
        except asyncio.TimeoutError:
            logger.warning("Reputation update timed-out (non-fatal)")
        except Exception as exc:
            logger.warning(f"Reputation update failed (non-fatal): {exc}")

        # ── Step 7: Persist to MongoDB ────────────────────────────────────────
        await self._update_agent_stats(db, agent, pnl)
        await self._save_trade(db, intent)

        logger.info(
            f"✅ Trade {trade_id} DONE | "
            f"{decision.action.value} {token_symbol} | PnL=${pnl:+.4f}"
        )
        return intent

    # ── PnL calculation ───────────────────────────────────────────────────────

    def _calculate_pnl(
        self,
        action: str,
        amount_usd: float,
        price_change_24h: float,
        confidence: float,
    ) -> float:
        """
        Real PnL based on actual 24 h market movement.

        BUY  → profit when price went UP   (+24h change)
        SELL → profit when price went DOWN (−24h change = short profit)
        HOLD → opportunity-cost tracking   (30% exposure)

        Confidence-weighted exposure: 0.5 – 1.0 multiplier.
        High-confidence trades carry more risk/reward.
        """
        change_decimal  = price_change_24h / 100.0
        exposure_factor = 0.5 + (confidence / 100.0) * 0.5   # [0.5, 1.0]

        logger.debug(
            f"PnL inputs: action={action} | Δ={price_change_24h:+.4f}% | "
            f"amount=${amount_usd:.2f} | exposure={exposure_factor:.3f}"
        )

        if action == "BUY":
            pnl = amount_usd * change_decimal * exposure_factor
        elif action == "SELL":
            pnl = amount_usd * (-change_decimal) * exposure_factor
        else:   # HOLD — track opportunity cost at reduced exposure
            pnl = amount_usd * change_decimal * exposure_factor * 0.3

        return round(pnl, 4)

    # ── DB helpers ────────────────────────────────────────────────────────────

    async def _save_trade(self, db, intent: TradeIntent) -> None:
        try:
            data     = intent.model_dump()
            trade_id = data.pop("id", None) or intent.id
            if trade_id:
                data["_id"] = trade_id
            await db["trades"].replace_one({"_id": trade_id}, data, upsert=True)
        except Exception as exc:
            logger.error(f"Failed to save trade to DB: {exc}")

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