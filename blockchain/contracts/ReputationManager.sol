// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./AgentRegistry.sol";
import "./ValidationRegistry.sol";

/**
 * @title ReputationManager
 * @notice Orchestrates trust score updates by combining:
 *           - Trade PnL outcome
 *           - Confidence accuracy (did high-confidence trades actually profit?)
 *           - Validator consensus score (extensible for multi-validator setups)
 *
 *         This is the final step in the trust layer pipeline.
 */
contract ReputationManager {
    event ReputationUpdated(
        uint256 indexed agentId,
        uint256 newTrustScore,
        int256  scoreDelta,
        string  reason
    );

    struct ScoreUpdate {
        uint256 agentId;
        string  tradeId;
        bool    profitable;
        int256  pnlBps;
        uint256 confidence;
        uint256 timestamp;
    }

    AgentRegistry     public agentRegistry;
    ValidationRegistry public validationRegistry;
    address public owner;

    // Score delta bounds
    int256 public constant MAX_POSITIVE_DELTA = 5;
    int256 public constant MAX_NEGATIVE_DELTA = -3;

    mapping(uint256 => ScoreUpdate[]) public agentHistory;

    modifier onlyOwner() {
        require(msg.sender == owner, "ReputationManager: not owner");
        _;
    }

    constructor(address _registry, address _validationRegistry) {
        owner             = msg.sender;
        agentRegistry     = AgentRegistry(_registry);
        validationRegistry = ValidationRegistry(_validationRegistry);
    }

    /**
     * @notice Update an agent's reputation after a trade settles.
     * @param agentId    On-chain agent ID.
     * @param tradeId    Off-chain trade UUID (must exist in ValidationRegistry).
     * @param profitable Whether the trade was profitable.
     * @param pnlBps     PnL in basis points.
     */
    function updateReputation(
        uint256 agentId,
        string calldata tradeId,
        bool profitable,
        int256 pnlBps
    ) external onlyOwner {
        // Fetch confidence from on-chain proof
        (,, uint256 confidence,,,,, ) =
            validationRegistry.getValidation(tradeId);

        // Compute delta: high confidence + profitable = bigger reward
        int256 delta = _computeDelta(profitable, pnlBps, confidence);

        // Record outcome on ValidationRegistry
        validationRegistry.recordOutcome(tradeId, profitable, pnlBps);

        // Update trust score on AgentRegistry
        agentRegistry.updateReputation(agentId, profitable, pnlBps);

        // Store history
        agentHistory[agentId].push(ScoreUpdate({
            agentId:    agentId,
            tradeId:    tradeId,
            profitable: profitable,
            pnlBps:     pnlBps,
            confidence: confidence,
            timestamp:  block.timestamp
        }));

        uint256 newScore = agentRegistry.getTrustScore(agentId);
        string memory reason = profitable
            ? "Profitable trade - trust increased"
            : "Unprofitable trade - trust decreased";

        emit ReputationUpdated(agentId, newScore, delta, reason);
    }

    /**
     * @notice Compute score delta based on outcome + confidence accuracy.
     *
     * Logic:
     *   - Profitable + high confidence (>= 75): +5 (agent was right AND confident)
     *   - Profitable + medium confidence:       +3
     *   - Profitable + low confidence:          +1 (lucky)
     *   - Unprofitable + high confidence:       -3 (overconfident and wrong)
     *   - Unprofitable + low confidence:        -1 (uncertain and wrong, expected)
     */
    function _computeDelta(
        bool profitable,
        int256 pnlBps,
        uint256 confidence
    ) internal pure returns (int256 delta) {
        if (profitable) {
            if (confidence >= 75) delta = 5;
            else if (confidence >= 55) delta = 3;
            else delta = 1;
            // Bonus for exceptional returns
            if (pnlBps > 200) delta += 1; // >2% return
        } else {
            if (confidence >= 75) delta = -3; // overconfident wrong
            else if (confidence >= 55) delta = -2;
            else delta = -1;
        }

        // Clamp
        if (delta > MAX_POSITIVE_DELTA) delta = MAX_POSITIVE_DELTA;
        if (delta < MAX_NEGATIVE_DELTA) delta = MAX_NEGATIVE_DELTA;
    }

    // ── View ──────────────────────────────────────────────────────────────────

    function getAgentHistory(uint256 agentId)
        external
        view
        returns (ScoreUpdate[] memory)
    {
        return agentHistory[agentId];
    }

    function getTrustScore(uint256 agentId) external view returns (uint256) {
        return agentRegistry.getTrustScore(agentId);
    }
}
