"""
Risk Management Service

Validates trade intents against configurable risk rules before
they are sent to the on-chain Risk Router contract.
"""
from loguru import logger
from models.schemas import AIDecision, Agent, RiskLevel, TradeAction


class RiskCheckResult:
    def __init__(self, passed: bool, reason: str, adjusted_amount: float):
        self.passed = passed
        self.reason = reason
        self.adjusted_amount = adjusted_amount


class RiskManager:
    # Global hard limits (can be made configurable per agent)
    MAX_SINGLE_TRADE_USD = 5_000.0
    MAX_DAILY_LOSS_USD = 10_000.0
    MIN_CONFIDENCE_THRESHOLD = 45.0
    HIGH_RISK_CONFIDENCE_THRESHOLD = 70.0   # higher bar for HIGH risk trades

    ALLOWED_TOKENS = {
        "ethereum", "bitcoin", "polygon-ecosystem-token",
        "chainlink", "uniswap", "aave",
    }

    def check_trade(self, decision: AIDecision, agent: Agent) -> RiskCheckResult:
        """
        Run all risk checks in sequence. Returns first failure.
        If all pass, returns passed=True with possibly adjusted amount.
        """
        checks = [
            self._check_token_allowed,
            self._check_confidence,
            self._check_amount_limit,
            self._check_agent_limit,
            self._check_high_risk_threshold,
        ]

        amount = decision.amount_usd

        for check_fn in checks:
            result = check_fn(decision, agent, amount)
            if not result.passed:
                logger.warning(
                    f"Risk check failed [{check_fn.__name__}]: {result.reason}"
                )
                return result
            amount = result.adjusted_amount  # allow adjustments to propagate

        logger.info(f"All risk checks passed. Final amount: ${amount}")
        return RiskCheckResult(
            passed=True,
            reason="All risk checks passed",
            adjusted_amount=amount,
        )

    # ── Individual checks ────────────────────────────────────────────────────

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
            # Clamp instead of reject
            clamped = self.MAX_SINGLE_TRADE_USD
            return RiskCheckResult(
                passed=True,
                reason=f"Amount clamped from ${amount} to global max ${clamped}",
                adjusted_amount=clamped,
            )
        return RiskCheckResult(True, "Amount within global limit", amount)

    def _check_agent_limit(
        self, decision: AIDecision, agent: Agent, amount: float
    ) -> RiskCheckResult:
        if amount > agent.max_trade_usd:
            clamped = agent.max_trade_usd
            return RiskCheckResult(
                passed=True,
                reason=f"Amount clamped to agent max ${clamped}",
                adjusted_amount=clamped,
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


# Singleton
risk_manager = RiskManager()
