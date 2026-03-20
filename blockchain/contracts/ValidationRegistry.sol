// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ValidationRegistry
 * @notice Immutable on-chain log of AI trading decisions.
 *
 *         Every trade that passes risk checks stores:
 *         - Agent ID
 *         - Trade ID (off-chain UUID)
 *         - AI reasoning summary
 *         - Confidence score
 *         - Risk check result
 *         - Timestamp
 *
 *         This creates a tamper-proof audit trail for the trust layer.
 */
contract ValidationRegistry {
    // ── Events ────────────────────────────────────────────────────────────────
    event ValidationStored(
        uint256 indexed agentId,
        string  indexed tradeId,
        uint256 confidence,
        string  riskCheck,
        uint256 timestamp
    );
    event OutcomeRecorded(
        string  indexed tradeId,
        bool    profitable,
        int256  pnlBps
    );

    // ── Structs ───────────────────────────────────────────────────────────────
    struct Validation {
        uint256 agentId;
        string  tradeId;
        string  reason;        // AI explanation (truncated to 256 chars)
        uint256 confidence;    // 0-100
        string  riskCheck;     // "passed" | "failed"
        uint256 timestamp;
        bool    outcomeRecorded;
        bool    profitable;
        int256  pnlBps;
    }

    // ── State ─────────────────────────────────────────────────────────────────
    mapping(string => Validation) private _validations;  // tradeId → Validation
    mapping(uint256 => string[])  private _agentTrades;  // agentId → tradeIds[]

    uint256 public totalValidations;
    address public owner;
    address public authorizedCaller; // backend service wallet

    modifier onlyAuthorized() {
        require(
            msg.sender == owner || msg.sender == authorizedCaller,
            "ValidationRegistry: not authorized"
        );
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "ValidationRegistry: not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
        authorizedCaller = msg.sender;
    }

    // ── Write functions ───────────────────────────────────────────────────────

    /**
     * @notice Store AI decision proof before trade execution.
     * @param agentId    On-chain agent identifier.
     * @param tradeId    Off-chain UUID for cross-referencing.
     * @param reason     AI reasoning string (capped at 256 bytes on-chain).
     * @param confidence AI confidence score (0-100).
     * @param riskCheck  Result of risk validation ("passed" / "failed").
     */
    function storeValidation(
        uint256 agentId,
        string calldata tradeId,
        string calldata reason,
        uint256 confidence,
        string calldata riskCheck
    ) external onlyAuthorized {
        require(bytes(tradeId).length > 0, "ValidationRegistry: tradeId required");
        require(
            bytes(_validations[tradeId].tradeId).length == 0,
            "ValidationRegistry: tradeId already stored"
        );
        require(confidence <= 100, "ValidationRegistry: invalid confidence");

        // Truncate reason to 256 chars for gas efficiency
        string memory truncatedReason = _truncate(reason, 256);

        _validations[tradeId] = Validation({
            agentId:         agentId,
            tradeId:         tradeId,
            reason:          truncatedReason,
            confidence:      confidence,
            riskCheck:       riskCheck,
            timestamp:       block.timestamp,
            outcomeRecorded: false,
            profitable:      false,
            pnlBps:          0
        });

        _agentTrades[agentId].push(tradeId);
        totalValidations++;

        emit ValidationStored(agentId, tradeId, confidence, riskCheck, block.timestamp);
    }

    /**
     * @notice Record the trade outcome after settlement.
     * @param tradeId    Off-chain UUID.
     * @param profitable Whether the trade made a profit.
     * @param pnlBps     PnL in basis points (can be negative).
     */
    function recordOutcome(
        string calldata tradeId,
        bool profitable,
        int256 pnlBps
    ) external onlyAuthorized {
        Validation storage v = _validations[tradeId];
        require(bytes(v.tradeId).length > 0, "ValidationRegistry: trade not found");
        require(!v.outcomeRecorded, "ValidationRegistry: outcome already recorded");

        v.outcomeRecorded = true;
        v.profitable      = profitable;
        v.pnlBps          = pnlBps;

        emit OutcomeRecorded(tradeId, profitable, pnlBps);
    }

    // ── View functions ────────────────────────────────────────────────────────

    function getValidation(string calldata tradeId)
        external
        view
        returns (
            uint256 agentId,
            string memory reason,
            uint256 confidence,
            string memory riskCheck,
            uint256 timestamp,
            bool outcomeRecorded,
            bool profitable,
            int256 pnlBps
        )
    {
        Validation storage v = _validations[tradeId];
        return (
            v.agentId,
            v.reason,
            v.confidence,
            v.riskCheck,
            v.timestamp,
            v.outcomeRecorded,
            v.profitable,
            v.pnlBps
        );
    }

    function getAgentTradeIds(uint256 agentId)
        external
        view
        returns (string[] memory)
    {
        return _agentTrades[agentId];
    }

    function getAgentTradeCount(uint256 agentId) external view returns (uint256) {
        return _agentTrades[agentId].length;
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    function setAuthorizedCaller(address caller) external onlyOwner {
        authorizedCaller = caller;
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    function _truncate(string calldata s, uint256 maxLen)
        internal
        pure
        returns (string memory)
    {
        bytes calldata b = bytes(s);
        if (b.length <= maxLen) return s;
        bytes memory out = new bytes(maxLen);
        for (uint256 i = 0; i < maxLen; i++) out[i] = b[i];
        return string(out);
    }
}
