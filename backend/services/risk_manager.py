"""
Risk Management Service

Now includes:
  - Drawdown circuit breaker (checks DB for current drawdown before allowing trade)
  - ATR-based position sizing
  - Volatility-scaled risk cap
"""
from __future__ import annotations

import math
from typing import Optional
from loguru import logger
from models.schemas import AIDecision, Agent, RiskLevel, TradeAction

# ── Thresholds ────────────────────────────────────────────────────────────────
DRAWDOWN_REDUCE_PCT   = 8.0   # reduce position size 50% when drawdown > 8%
DRAWDOWN_HALT_PCT     = 15.0  # stop all trading when drawdown > 15%
DAILY_LOSS_CAP_PCT    = 5.0   # no new trades when daily loss > 5% of vault


class RiskCheckResult:
    def __init__(self, passed: bool, reason: str, adjusted_amount: float,
                 circuit_breaker: bool = False):
        self.passed          = passed
        self.reason          = reason
        self.adjusted_amount = adjusted_amount
        self.circuit_breaker = circuit_breaker   # True = trading halted


class RiskManager:
    # Global hard limits
    MAX_SINGLE_TRADE_USD        = 5_000.0
    MAX_DAILY_LOSS_USD          = 10_000.0
    MIN_CONFIDENCE_THRESHOLD    = 45.0
    HIGH_RISK_CONFIDENCE_THRESHOLD = 70.0

    ALLOWED_TOKENS = {
        "ethereum", "bitcoin", "polygon-ecosystem-token",
        "chainlink", "uniswap", "aave",
    }

    # ── Public entry point ────────────────────────────────────────────────────

    def check_trade(
        self,
        decision: AIDecision,
        agent: Agent,
        current_drawdown_pct: float = 0.0,
        daily_loss_pct: float       = 0.0,
    ) -> RiskCheckResult:
        """
        Run all risk checks in sequence. Returns first failure.
        circuit_breaker=True means the agent should stop trading entirely.
        """
        checks = [
            lambda d, a, amt: self._check_circuit_breaker(d, a, amt,
                                  current_drawdown_pct, daily_loss_pct),
            self._check_token_allowed,
            self._check_confidence,
            self._check_amount_limit,
            self._check_agent_limit,
            self._check_high_risk_threshold,
            lambda d, a, amt: self._check_volatility_scale(d, a, amt,
                                  current_drawdown_pct),
        ]

        amount = decision.amount_usd
        for check_fn in checks:
            result = check_fn(decision, agent, amount)
            if not result.passed:
                logger.warning(f"Risk check failed [{check_fn.__name__ if hasattr(check_fn, '__name__') else 'lambda'}]: {result.reason}")
                return result
            amount = result.adjusted_amount

        logger.info(f"All risk checks passed. Final amount: ${amount:.2f}")
        return RiskCheckResult(passed=True, reason="All risk checks passed", adjusted_amount=amount)

    # ── Circuit breaker ───────────────────────────────────────────────────────

    def _check_circuit_breaker(
        self,
        decision: AIDecision,
        agent: Agent,
        amount: float,
        current_drawdown_pct: float,
        daily_loss_pct: float,
    ) -> RiskCheckResult:
        """
        Hard stop when drawdown is catastrophic, or daily loss cap reached.

        Thresholds:
          > 15% drawdown  → halt all trading (circuit breaker ON)
          > 5%  daily loss → halt for the day
          > 8%  drawdown  → halve position size
        """
        if decision.action == TradeAction.HOLD:
            return RiskCheckResult(True, "HOLD skips circuit breaker", amount)

        # Hard halt - drawdown > 15%
        if current_drawdown_pct > DRAWDOWN_HALT_PCT:
            logger.warning(
                f"⛔ CIRCUIT BREAKER: drawdown {current_drawdown_pct:.1f}% "
                f"> {DRAWDOWN_HALT_PCT}% threshold — all trading halted"
            )
            return RiskCheckResult(
                passed=False,
                reason=(
                    f"Circuit breaker active: portfolio drawdown {current_drawdown_pct:.1f}% "
                    f"exceeds {DRAWDOWN_HALT_PCT}% threshold. Trading halted to protect capital."
                ),
                adjusted_amount=0.0,
                circuit_breaker=True,
            )

        # Daily loss cap
        if daily_loss_pct > DAILY_LOSS_CAP_PCT:
            return RiskCheckResult(
                passed=False,
                reason=(
                    f"Daily loss cap reached: {daily_loss_pct:.1f}% "
                    f"> {DAILY_LOSS_CAP_PCT}% — no new trades today."
                ),
                adjusted_amount=0.0,
                circuit_breaker=False,
            )

        return RiskCheckResult(True, "Circuit breaker: OK", amount)

    # ── Individual checks ─────────────────────────────────────────────────────

    def _check_token_allowed(
        self, decision: AIDecision, agent: Agent, amount: float
    ) -> RiskCheckResult:
        if decision.token not in self.ALLOWED_TOKENS:
            return RiskCheckResult(
                passed=False,
                reason=f"Token '{decision.token}' is not in the allowed list",
                adjusted_amount=amount,
            )
        return RiskCheckResult(True, "Token allowed", amount)

    def _check_confidence(
        self, decision: AIDecision, agent: Agent, amount: float
    ) -> RiskCheckResult:
        if decision.action == TradeAction.HOLD:
            return RiskCheckResult(True, "HOLD requires no confidence check", amount)
        if decision.confidence < self.MIN_CONFIDENCE_THRESHOLD:
            return RiskCheckResult(
                passed=False,
                reason=f"Confidence {decision.confidence}% below minimum {self.MIN_CONFIDENCE_THRESHOLD}%",
                adjusted_amount=amount,
            )
        return RiskCheckResult(True, "Confidence acceptable", amount)

    def _check_amount_limit(
        self, decision: AIDecision, agent: Agent, amount: float
    ) -> RiskCheckResult:
        if amount > self.MAX_SINGLE_TRADE_USD:
            return RiskCheckResult(
                passed=True,
                reason=f"Amount clamped from ${amount:.0f} to global max ${self.MAX_SINGLE_TRADE_USD:.0f}",
                adjusted_amount=self.MAX_SINGLE_TRADE_USD,
            )
        return RiskCheckResult(True, "Amount within global limit", amount)

    def _check_agent_limit(
        self, decision: AIDecision, agent: Agent, amount: float
    ) -> RiskCheckResult:
        if amount > agent.max_trade_usd:
            return RiskCheckResult(
                passed=True,
                reason=f"Amount clamped to agent max ${agent.max_trade_usd:.0f}",
                adjusted_amount=agent.max_trade_usd,
            )
        return RiskCheckResult(True, "Amount within agent limit", amount)

    def _check_high_risk_threshold(
        self, decision: AIDecision, agent: Agent, amount: float
    ) -> RiskCheckResult:
        if decision.risk_level == RiskLevel.HIGH:
            if decision.confidence < self.HIGH_RISK_CONFIDENCE_THRESHOLD:
                return RiskCheckResult(
                    passed=False,
                    reason=(
                        f"HIGH risk trade requires ≥{self.HIGH_RISK_CONFIDENCE_THRESHOLD}% "
                        f"confidence, got {decision.confidence}%"
                    ),
                    adjusted_amount=amount,
                )
            if agent.risk_tolerance == RiskLevel.LOW:
                return RiskCheckResult(
                    passed=False,
                    reason="Agent risk tolerance is LOW, blocking HIGH risk trade",
                    adjusted_amount=amount,
                )
        return RiskCheckResult(True, "Risk level acceptable", amount)

    def _check_volatility_scale(
        self,
        decision: AIDecision,
        agent: Agent,
        amount: float,
        current_drawdown_pct: float,
    ) -> RiskCheckResult:
        """
        Dynamically reduce position size when:
          - Drawdown > 8% → reduce to 50%
          - HIGH risk level → reduce to 70%
        Both can stack.
        """
        scale = 1.0
        reasons = []

        if current_drawdown_pct > DRAWDOWN_REDUCE_PCT:
            scale *= 0.5
            reasons.append(f"drawdown {current_drawdown_pct:.1f}% > {DRAWDOWN_REDUCE_PCT}% → size×0.5")

        if decision.risk_level == RiskLevel.HIGH:
            scale *= 0.7
            reasons.append("HIGH risk → size×0.7")

        if scale < 1.0:
            new_amount = round(amount * scale, 2)
            reason = f"Position scaled to ${new_amount:.2f} ({'; '.join(reasons)})"
            logger.info(f"Volatility scaling: {reason}")
            return RiskCheckResult(True, reason, new_amount)

        return RiskCheckResult(True, "No scaling needed", amount)

    # ── ATR-based position size helper ────────────────────────────────────────

    @staticmethod
    def atr_position_size(
        vault_balance: float,
        risk_pct: float,
        atr: float,
        price: float,
        risk_per_atr: float = 1.5,
    ) -> float:
        """
        Kelly-inspired ATR position sizing.

        stop_loss_distance = ATR × risk_per_atr
        risk_dollars       = vault × risk_pct/100
        units              = risk_dollars / stop_loss_distance
        position_value     = units × price

        Returns position size in USD, capped at vault_balance × 20%.
        """
        if atr <= 0 or price <= 0:
            return min(vault_balance * 0.02, 500.0)   # safe default 2%

        stop_distance = atr * risk_per_atr
        risk_dollars  = vault_balance * (risk_pct / 100.0)
        units         = risk_dollars / stop_distance
        position_usd  = units * price

        # Hard cap: never risk more than 20% of vault in one trade
        cap = vault_balance * 0.20
        return round(min(position_usd, cap), 2)


# Singleton
risk_manager = RiskManager()
