from pydantic import BaseModel, Field
from typing import Optional, List, Literal, Dict, Any
from datetime import datetime
from enum import Enum


# ─── Enums ────────────────────────────────────────────────────────────────────

class TradeAction(str, Enum):
    BUY  = "BUY"
    SELL = "SELL"
    HOLD = "HOLD"


class RiskLevel(str, Enum):
    LOW    = "LOW"
    MEDIUM = "MEDIUM"
    HIGH   = "HIGH"


class Strategy(str, Enum):
    RSI          = "RSI"
    MA_CROSSOVER = "MA_CROSSOVER"
    SENTIMENT    = "SENTIMENT"
    COMBINED     = "COMBINED"


class TradeStatus(str, Enum):
    PENDING  = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    EXECUTED = "EXECUTED"
    FAILED   = "FAILED"


# ─── Market Data ──────────────────────────────────────────────────────────────

class MarketData(BaseModel):
    token:            str
    symbol:           str
    price_usd:        float
    price_change_24h: float
    volume_24h:       float
    market_cap:       float
    rsi:              Optional[float] = None
    ma_7:             Optional[float] = None
    ma_25:            Optional[float] = None
    ma_99:            Optional[float] = None
    sentiment_score:  Optional[float] = None   # -1 to 1
    timestamp:        datetime = Field(default_factory=datetime.utcnow)


# ─── AI Decision ──────────────────────────────────────────────────────────────

class AIDecisionRequest(BaseModel):
    token:          str = "ethereum"
    strategy:       Strategy = Strategy.COMBINED
    wallet_address: str
    agent_id:       Optional[str] = None


class AIDecision(BaseModel):
    action:        TradeAction
    token:         str
    token_pair:    str
    amount_usd:    float
    reason:        str
    confidence:    float          # 0–100
    risk_level:    RiskLevel
    indicators:    dict           # raw indicator values
    strategy_used: Strategy
    timestamp:     datetime = Field(default_factory=datetime.utcnow)

    # ── Explainability Engine (Feature 1) ──────────────────────────────────
    why:                   List[str]       = Field(default_factory=list)
    why_not_alternatives:  Optional[str]   = None
    alternative_actions:   List[dict]      = Field(default_factory=list)

    # ── Proof Layer (Feature 2) ────────────────────────────────────────────
    decision_hash:         Optional[str]   = None


# ─── Trade Quality Score (Feature 8) ──────────────────────────────────────────

class TradeQualityScore(BaseModel):
    trade_score:   float
    risk_score:    float
    timing_score:  float
    pnl_score:     float
    label:         str


# ─── Trade Intent ─────────────────────────────────────────────────────────────

class TradeIntent(BaseModel):
    id:             Optional[str] = None
    wallet_address: str
    agent_id:       str
    token_pair:     str
    action:         TradeAction
    amount_usd:     float
    reason:         str
    confidence:     float
    risk_level:     RiskLevel
    risk_check:     Literal["passed", "failed", "pending"] = "pending"
    status:         TradeStatus = TradeStatus.PENDING
    tx_hash:        Optional[str] = None
    on_chain_id:    Optional[str] = None
    pnl:            Optional[float] = None
    created_at:     datetime = Field(default_factory=datetime.utcnow)
    executed_at:    Optional[datetime] = None

    atr:               Optional[float] = None
    position_size_pct: Optional[float] = None
    stop_loss_usd:     Optional[float] = None

    why:                  List[str]              = Field(default_factory=list)
    why_not_alternatives: Optional[str]          = None
    alternative_actions:  List[dict]             = Field(default_factory=list)

    decision_hash:        Optional[str]          = None
    quality_score:        Optional[TradeQualityScore] = None
    failure_reason:       Optional[str]          = None


# ─── Agent ────────────────────────────────────────────────────────────────────

class AgentRegistration(BaseModel):
    wallet_address: str
    name:           str
    strategy:       Strategy
    risk_tolerance: RiskLevel = RiskLevel.MEDIUM
    max_trade_usd:  float = 1000.0
    on_chain_id:    int | None = None


class Agent(BaseModel):
    id:                Optional[str] = None
    wallet_address:    str
    name:              str
    strategy:          Strategy
    risk_tolerance:    RiskLevel
    max_trade_usd:     float
    # FIX: was Optional[str] — must match AgentRegistration which sends int.
    # The contract emits agentId as uint256 → JS Number → JSON integer.
    on_chain_id:       int | None = None
    trust_score:       float = 50.0
    total_trades:      int   = 0
    profitable_trades: int   = 0
    total_pnl:         float = 0.0
    vault_balance:     float = 10_000.0
    created_at:        datetime = Field(default_factory=datetime.utcnow)


# ─── Validation Proof ─────────────────────────────────────────────────────────

class ValidationProof(BaseModel):
    id:               Optional[str] = None
    trade_id:         str
    agent_id:         str
    reason:           str
    risk_check:       str
    confidence:       float
    outcome:          Optional[str]   = None
    pnl:              Optional[float] = None
    validator_score:  Optional[float] = None
    on_chain_tx:      Optional[str]   = None
    decision_hash:    Optional[str]   = None
    timestamp:        datetime = Field(default_factory=datetime.utcnow)


# ─── Voice Command ────────────────────────────────────────────────────────────

class VoiceCommand(BaseModel):
    text:           str
    wallet_address: str
    agent_id:       Optional[str] = None


class VoiceResponse(BaseModel):
    intent:      str
    action:      Optional[TradeAction] = None
    token:       Optional[str]         = None
    explanation: str
    decision:    Optional[AIDecision]  = None


# ─── Risk Heatmap ─────────────────────────────────────────────────────────────

class RiskHeatmapEntry(BaseModel):
    token:        str
    risk_score:   float
    exposure_usd: float
    volatility:   float
    sentiment:    float


# ─── Strategy Comparison (Feature 4) ─────────────────────────────────────────

class StrategyComparisonResult(BaseModel):
    strategy:   str
    action:     str
    confidence: float
    amount_usd: float
    reason:     str
    sim_pnl:    Optional[float] = None


# ─── Copilot Chat (Feature 7) ────────────────────────────────────────────────

class CopilotMessage(BaseModel):
    wallet_address: str
    message:        str
    history:        List[dict] = Field(default_factory=list)


class CopilotResponse(BaseModel):
    reply:   str
    sources: List[str] = Field(default_factory=list)


# ─── Dashboard ────────────────────────────────────────────────────────────────

class DashboardStats(BaseModel):
    total_trades:      int
    profitable_trades: int
    total_pnl:         float
    trust_score:       float
    win_rate:          float
    recent_trades:     List[TradeIntent]
    risk_heatmap:      List[RiskHeatmapEntry]

    sharpe_ratio:           Optional[float] = None
    max_drawdown:           Optional[float] = None
    max_drawdown_pct:       Optional[float] = None
    current_drawdown:       Optional[float] = None
    circuit_breaker_active: bool            = False

    vault_balance:  float = 10_000.0
    vault_initial:  float = 10_000.0
    daily_loss_usd: float = 0.0
    daily_loss_pct: float = 0.0
    equity_curve:   List[dict] = Field(default_factory=list)

    failed_trade_analysis: List[dict] = Field(default_factory=list)