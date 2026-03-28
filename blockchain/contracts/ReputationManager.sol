// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./AgentRegistry.sol";
import "./ValidationRegistry.sol";

/**
 * @title ReputationManager
 * @notice Orchestrates trust score updates combining:
 *           - Trade PnL outcome
 *           - Confidence accuracy
 *           - Drawdown tracking (max drawdown for leaderboard)
 *           - Sharpe-proxy signals (win-rate + running PnL variance)
 *
 *         Caller access is open via onlyAuthorized so that RiskRouter and
 *         backend wallets can trigger updates automatically post-trade,
 *         removing the old onlyOwner bottleneck.
 */
contract ReputationManager {

    // ── Events ────────────────────────────────────────────────────────────────
    event ReputationUpdated(
        uint256 indexed agentId,
        uint256 newTrustScore,
        int256  scoreDelta,
        string  reason
    );
    event AuthorizedCallerSet(address indexed caller, bool authorized);
    event DrawdownUpdated(uint256 indexed agentId, uint256 maxDrawdownBps);

    // ── Structs ───────────────────────────────────────────────────────────────
    struct ScoreUpdate {
        uint256 agentId;
        string  tradeId;
        bool    profitable;
        int256  pnlBps;
        uint256 confidence;
        uint256 timestamp;
    }

    /**
     * @notice Per-agent performance metrics for leaderboard + Sharpe proxy.
     *
     *   Sharpe proxy  = avgPnlBps / stdDevProxy
     *   stdDevProxy   = sqrt(sumSquaredPnlBps/n - avg²)  (computed off-chain)
     *   maxDrawdownBps = peak-to-trough loss in absolute basis points
     */
    struct AgentStats {
        int256  peakPnlBps;
        int256  currentPnlBps;
        uint256 maxDrawdownBps;
        int256  sumPnlBps;
        uint256 sumSquaredPnlBps;
        uint256 tradeCount;
        uint256 winCount;
        uint256 lossCount;
        uint256 lastUpdated;
    }

    // ── State ─────────────────────────────────────────────────────────────────
    AgentRegistry      public agentRegistry;
    ValidationRegistry public validationRegistry;
    address public owner;

    mapping(address => bool)          public authorizedCallers;
    mapping(uint256 => ScoreUpdate[]) public agentHistory;
    mapping(uint256 => AgentStats)    public agentStats;

    int256 public constant MAX_POSITIVE_DELTA = 5;
    int256 public constant MAX_NEGATIVE_DELTA = -3;

    modifier onlyOwner() {
        require(msg.sender == owner, "ReputationManager: not owner");
        _;
    }

    /**
     * @notice Replaces the old onlyOwner on updateReputation.
     *         Allows owner, RiskRouter, or any whitelisted backend wallet to
     *         trigger updates automatically without manual intervention.
     */
    modifier onlyAuthorized() {
        require(
            msg.sender == owner || authorizedCallers[msg.sender],
            "ReputationManager: not authorized"
        );
        _;
    }

    constructor(address _registry, address _validationRegistry) {
        owner              = msg.sender;
        agentRegistry      = AgentRegistry(_registry);
        validationRegistry = ValidationRegistry(_validationRegistry);
        authorizedCallers[msg.sender] = true;
    }

    // ── Core ──────────────────────────────────────────────────────────────────

    /**
     * @notice Update an agent's reputation after a trade settles.
     *         Can be called by owner, RiskRouter, or any authorized caller.
     *
     * @param agentId    On-chain agent ID (ERC-721 token ID).
     * @param tradeId    Off-chain trade UUID (must exist in ValidationRegistry).
     * @param profitable Whether the trade was profitable.
     * @param pnlBps     PnL in basis points.
     */
    function updateReputation(
        uint256 agentId,
        string calldata tradeId,
        bool profitable,
        int256 pnlBps
    ) external onlyAuthorized {
        (,, uint256 confidence,,,,, ) =
            validationRegistry.getValidation(tradeId);

        int256 delta = _computeDelta(profitable, pnlBps, confidence);

        validationRegistry.recordOutcome(tradeId, profitable, pnlBps);
        agentRegistry.updateReputation(agentId, profitable, pnlBps);
        _updateAgentStats(agentId, profitable, pnlBps);

        agentHistory[agentId].push(ScoreUpdate({
            agentId:    agentId,
            tradeId:    tradeId,
            profitable: profitable,
            pnlBps:     pnlBps,
            confidence: confidence,
            timestamp:  block.timestamp
        }));

        uint256 newScore = agentRegistry.getTrustScore(agentId);
        emit ReputationUpdated(
            agentId, newScore, delta,
            profitable
                ? "Profitable trade - trust increased"
                : "Unprofitable trade - trust decreased"
        );
    }

    /**
     * @notice Direct update without a ValidationRegistry lookup.
     *         Used by RiskRouter in automated post-trade flows.
     */
    function updateReputationDirect(
        uint256 agentId,
        bool    profitable,
        int256  pnlBps,
        uint256 confidence
    ) external onlyAuthorized {
        int256 delta = _computeDelta(profitable, pnlBps, confidence);

        agentRegistry.updateReputation(agentId, profitable, pnlBps);
        _updateAgentStats(agentId, profitable, pnlBps);

        agentHistory[agentId].push(ScoreUpdate({
            agentId:    agentId,
            tradeId:    "",
            profitable: profitable,
            pnlBps:     pnlBps,
            confidence: confidence,
            timestamp:  block.timestamp
        }));

        uint256 newScore = agentRegistry.getTrustScore(agentId);
        emit ReputationUpdated(
            agentId, newScore, delta,
            profitable
                ? "Profitable trade - trust increased"
                : "Unprofitable trade - trust decreased"
        );
    }

    // ── Score delta logic ─────────────────────────────────────────────────────

    function _computeDelta(
        bool profitable,
        int256 pnlBps,
        uint256 confidence
    ) internal pure returns (int256 delta) {
        if (profitable) {
            if      (confidence >= 75) delta = 5;
            else if (confidence >= 55) delta = 3;
            else                       delta = 1;
            if (pnlBps > 200) delta += 1; // >2% bonus
        } else {
            if      (confidence >= 75) delta = -3;
            else if (confidence >= 55) delta = -2;
            else                       delta = -1;
        }
        if (delta > MAX_POSITIVE_DELTA) delta = MAX_POSITIVE_DELTA;
        if (delta < MAX_NEGATIVE_DELTA) delta = MAX_NEGATIVE_DELTA;
    }

    // ── Drawdown + Sharpe proxy tracking ──────────────────────────────────────

    /**
     * @notice Update per-agent drawdown and running Sharpe-proxy stats.
     *
     * Drawdown:
     *   currentPnl   += pnlBps
     *   peakPnl       = max(peakPnl, currentPnl)
     *   drawdown      = peakPnl - currentPnl
     *   maxDrawdown   = max(maxDrawdown, drawdown)
     *
     * Sharpe proxy inputs (use off-chain to compute final ratio):
     *   avg   = sumPnlBps / tradeCount
     *   stdDev = sqrt(sumSquaredPnlBps/n - avg²)
     *   Sharpe ≈ avg / stdDev
     */
    function _updateAgentStats(
        uint256 agentId,
        bool    profitable,
        int256  pnlBps
    ) internal {
        AgentStats storage s = agentStats[agentId];

        s.currentPnlBps += pnlBps;
        s.sumPnlBps     += pnlBps;
        s.tradeCount    += 1;
        s.lastUpdated    = block.timestamp;

        if (profitable) s.winCount  += 1;
        else            s.lossCount += 1;

        int256 absPnl = pnlBps < 0 ? -pnlBps : pnlBps;
        s.sumSquaredPnlBps += uint256(absPnl * absPnl);

        if (s.currentPnlBps > s.peakPnlBps) {
            s.peakPnlBps = s.currentPnlBps;
        }

        int256 drawdown = s.peakPnlBps - s.currentPnlBps;
        if (drawdown > 0) {
            uint256 drawdownAbs = uint256(drawdown);
            if (drawdownAbs > s.maxDrawdownBps) {
                s.maxDrawdownBps = drawdownAbs;
                emit DrawdownUpdated(agentId, drawdownAbs);
            }
        }
    }

    // ── View ──────────────────────────────────────────────────────────────────

    function getAgentHistory(uint256 agentId)
        external view returns (ScoreUpdate[] memory)
    {
        return agentHistory[agentId];
    }

    function getTrustScore(uint256 agentId) external view returns (uint256) {
        return agentRegistry.getTrustScore(agentId);
    }

    /**
     * @notice Get all performance stats for leaderboard display.
     * @return peakPnlBps       Highest cumulative PnL ever reached.
     * @return currentPnlBps    Current cumulative PnL.
     * @return maxDrawdownBps   Maximum peak-to-trough drawdown (abs bps).
     * @return avgPnlBps        Average per-trade PnL in basis points.
     * @return winRate          Win rate × 10000 (e.g. 6750 = 67.50%).
     * @return tradeCount       Total number of settled trades.
     * @return sumSquaredPnlBps Sum of squared per-trade PnLs (for off-chain stdDev).
     */
    function getAgentPerformance(uint256 agentId)
        external view
        returns (
            int256  peakPnlBps,
            int256  currentPnlBps,
            uint256 maxDrawdownBps,
            int256  avgPnlBps,
            uint256 winRate,
            uint256 tradeCount,
            uint256 sumSquaredPnlBps
        )
    {
        AgentStats storage s = agentStats[agentId];
        tradeCount       = s.tradeCount;
        peakPnlBps       = s.peakPnlBps;
        currentPnlBps    = s.currentPnlBps;
        maxDrawdownBps   = s.maxDrawdownBps;
        sumSquaredPnlBps = s.sumSquaredPnlBps;
        avgPnlBps        = tradeCount > 0 ? s.sumPnlBps / int256(tradeCount) : int256(0);
        winRate          = tradeCount > 0 ? (s.winCount * 10000) / tradeCount : 0;
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    /**
     * @notice Grant or revoke authorization.
     *         After deployment wire in RiskRouter:
     *           reputationManager.setAuthorizedCaller(riskRouterAddress, true)
     */
    function setAuthorizedCaller(address caller, bool authorized) external onlyOwner {
        authorizedCallers[caller] = authorized;
        emit AuthorizedCallerSet(caller, authorized);
    }
}
