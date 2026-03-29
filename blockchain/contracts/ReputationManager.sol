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
 * FIX (multi-user): onlyAuthorized now also accepts the agent NFT owner from
 * AgentRegistry, so any registered user can trigger reputation updates for
 * their own agents. Previously only the contract owner and whitelisted callers
 * could do this, blocking all other users.
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
     * FIX: Added _isAgentOwner(agentId) to the authorization check.
     * This allows any user who owns an agent NFT to update their own agent's
     * reputation, without needing to be whitelisted by the contract owner.
     *
     * Full authorization order:
     *   1. msg.sender == ownerOf(agentId) in AgentRegistry  ← NEW
     *   2. msg.sender == contract owner
     *   3. msg.sender is in authorizedCallers (RiskRouter, backend wallet)
     */
    modifier onlyAuthorized(uint256 agentId) {
        require(
            _isAgentOwner(agentId)          ||
            msg.sender == owner             ||
            authorizedCallers[msg.sender],
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
     *
     * FIX: modifier changed from onlyAuthorized (no args) to
     * onlyAuthorized(agentId) so the agent owner check can use the agentId.
     */
    function updateReputation(
        uint256 agentId,
        string calldata tradeId,
        bool profitable,
        int256 pnlBps
    ) external onlyAuthorized(agentId) {
        // getValidation returns: agentId, reason, confidence, riskCheck,
        //                        timestamp, outcomeRecorded, profitable, pnlBps
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
     *
     * FIX: Same modifier fix — onlyAuthorized(agentId).
     */
    function updateReputationDirect(
        uint256 agentId,
        bool    profitable,
        int256  pnlBps,
        uint256 confidence
    ) external onlyAuthorized(agentId) {
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
            if (pnlBps > 200) delta += 1;
        } else {
            if      (confidence >= 75) delta = -3;
            else if (confidence >= 55) delta = -2;
            else                       delta = -1;
        }
        if (delta > MAX_POSITIVE_DELTA) delta = MAX_POSITIVE_DELTA;
        if (delta < MAX_NEGATIVE_DELTA) delta = MAX_NEGATIVE_DELTA;
    }

    // ── Drawdown + Sharpe proxy tracking ──────────────────────────────────────

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
     * @notice Grant or revoke authorization for a backend/service wallet.
     * Wire in RiskRouter after deployment:
     *   reputationManager.setAuthorizedCaller(riskRouterAddress, true)
     */
    function setAuthorizedCaller(address caller, bool authorized) external onlyOwner {
        authorizedCallers[caller] = authorized;
        emit AuthorizedCallerSet(caller, authorized);
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    /**
     * @dev Returns true if msg.sender owns the agentId NFT in AgentRegistry.
     *      Uses try/catch so a non-existent agentId returns false rather than
     *      reverting — allowing the modifier to fall through to other branches.
     */
    function _isAgentOwner(uint256 agentId) internal view returns (bool) {
        try agentRegistry.ownerOf(agentId) returns (address agentOwner) {
            return agentOwner == msg.sender;
        } catch {
            return false;
        }
    }
}
