from pydantic import BaseModel, Field
from typing import Optional, List, Literal
from datetime import datetime
from enum import Enum


# ─── Enums ───────────────────────────────────────────────────────────────────

class TradeAction(str, Enum):
    BUY = "BUY"
    SELL = "SELL"
    HOLD = "HOLD"


class RiskLevel(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"


class Strategy(str, Enum):
    RSI = "RSI"
    MA_CROSSOVER = "MA_CROSSOVER"
    SENTIMENT = "SENTIMENT"
    COMBINED = "COMBINED"


class TradeStatus(str, Enum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    EXECUTED = "EXECUTED"
    FAILED = "FAILED"


# ─── Market Data ─────────────────────────────────────────────────────────────

class MarketData(BaseModel):
    token: str
    symbol: str
    price_usd: float
    price_change_24h: float
    volume_24h: float
    market_cap: float
    rsi: Optional[float] = None
    ma_7: Optional[float] = None
    ma_25: Optional[float] = None
    ma_99: Optional[float] = None
    sentiment_score: Optional[float] = None   # -1 to 1
    timestamp: datetime = Field(default_factory=datetime.utcnow)


# ─── AI Decision ─────────────────────────────────────────────────────────────

class AIDecisionRequest(BaseModel):
    token: str = "ethereum"
    strategy: Strategy = Strategy.COMBINED
    wallet_address: str
    agent_id: Optional[str] = None


class AIDecision(BaseModel):
    action: TradeAction
    token: str
    token_pair: str
    amount_usd: float
    reason: str
    confidence: float          # 0 - 100
    risk_level: RiskLevel
    indicators: dict           # raw indicator values
    strategy_used: Strategy
    timestamp: datetime = Field(default_factory=datetime.utcnow)


# ─── Trade Intent ─────────────────────────────────────────────────────────────

class TradeIntent(BaseModel):
    id: Optional[str] = None
    wallet_address: str
    agent_id: str
    token_pair: str
    action: TradeAction
    amount_usd: float
    reason: str
    confidence: float
    risk_level: RiskLevel
    risk_check: Literal["passed", "failed", "pending"] = "pending"
    status: TradeStatus = TradeStatus.PENDING
    tx_hash: Optional[str] = None
    on_chain_id: Optional[str] = None
    pnl: Optional[float] = None
    # ── Enhanced validation artifact fields ────────────────────────────────
    atr: Optional[float] = None              # ATR at time of trade
    position_size_pct: Optional[float] = None  # % of vault used
    stop_loss_usd: Optional[float] = None    # computed stop loss price
    created_at: datetime = Field(default_factory=datetime.utcnow)
    executed_at: Optional[datetime] = None


# ─── Agent ───────────────────────────────────────────────────────────────────

class AgentRegistration(BaseModel):
    wallet_address: str
    name: str
    strategy: Strategy
    risk_tolerance: RiskLevel = RiskLevel.MEDIUM
    max_trade_usd: float = 1000.0


class Agent(BaseModel):
    id: Optional[str] = None
    wallet_address: str
    name: str
    strategy: Strategy
    risk_tolerance: RiskLevel
    max_trade_usd: float
    on_chain_id: Optional[str] = None
    trust_score: float = 50.0
    total_trades: int = 0
    profitable_trades: int = 0
    total_pnl: float = 0.0
    vault_balance: float = 10_000.0   # virtual USDC sandbox vault balance
    created_at: datetime = Field(default_factory=datetime.utcnow)


# ─── Validation / Proof ───────────────────────────────────────────────────────

class ValidationProof(BaseModel):
    id: Optional[str] = None
    trade_id: str
    agent_id: str
    reason: str
    risk_check: str
    confidence: float
    outcome: Optional[str] = None
    pnl: Optional[float] = None
    validator_score: Optional[float] = None
    on_chain_tx: Optional[str] = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)


# ─── Voice Command ────────────────────────────────────────────────────────────

class VoiceCommand(BaseModel):
    text: str
    wallet_address: str
    agent_id: Optional[str] = None


class VoiceResponse(BaseModel):
    intent: str
    action: Optional[TradeAction] = None
    token: Optional[str] = None
    explanation: str
    decision: Optional[AIDecision] = None


# ─── Risk Heatmap ─────────────────────────────────────────────────────────────

class RiskHeatmapEntry(BaseModel):
    token: str
    risk_score: float
    exposure_usd: float
    volatility: float
    sentiment: float


# ─── Dashboard ────────────────────────────────────────────────────────────────

class DashboardStats(BaseModel):
    total_trades: int
    profitable_trades: int
    total_pnl: float
    trust_score: float
    win_rate: float
    recent_trades: List[TradeIntent]
    risk_heatmap: List[RiskHeatmapEntry]
    # ── Risk-adjusted metrics (hackathon judging criteria) ─────────────────
    sharpe_ratio: Optional[float] = None      # annualised Sharpe (risk-free=0)
    max_drawdown: Optional[float] = None      # worst peak→trough drawdown in $
    max_drawdown_pct: Optional[float] = None  # as % of peak equity
    current_drawdown: Optional[float] = None  # current drawdown from peak
    circuit_breaker_active: bool = False       # True when trading is halted
    # ── Vault accounting ───────────────────────────────────────────────────
    vault_balance: float = 10_000.0           # virtual USDC in sandbox vault
    vault_initial: float = 10_000.0           # starting capital
    daily_loss_usd: float = 0.0               # loss today
    daily_loss_pct: float = 0.0               # daily loss as % of vault
    equity_curve: List[dict] = Field(default_factory=list)  # [{ts, equity}]