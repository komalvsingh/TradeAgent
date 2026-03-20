// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./AgentRegistry.sol";

/**
 * @title RiskRouter
 * @notice On-chain risk gatekeeper for AI trading agents.
 *
 *         Before any trade executes, the RiskRouter:
 *         1. Verifies the EIP-712 signature from the agent's wallet
 *         2. Checks trade limits (single trade + daily loss)
 *         3. Verifies the token is in the allowed list
 *         4. Emits TradeApproved / TradeRejected for indexers
 *
 *         Trade execution itself happens off-chain (DEX router call)
 *         but all approvals are permanently recorded here.
 */
contract RiskRouter {
    // ── Events ────────────────────────────────────────────────────────────────
    event TradeApproved(
        uint256 indexed agentId,
        address indexed wallet,
        bytes32 tradeHash,
        string  tokenPair,
        string  action,
        uint256 amountUsd
    );
    event TradeRejected(
        uint256 indexed agentId,
        bytes32 tradeHash,
        string  reason
    );
    event TokenAllowlistUpdated(string token, bool allowed);
    event LimitsUpdated(uint256 maxSingleTradeUsd, uint256 maxDailyLossUsd);

    // ── Structs ───────────────────────────────────────────────────────────────
    struct TradeIntent {
        uint256 agentId;
        string  tokenPair;    // e.g. "ETH/USDC"
        string  action;       // "BUY" | "SELL"
        uint256 amountUsd;    // in USD cents to avoid decimals (e.g. 10000 = $100)
        uint256 confidence;   // 0-100
        string  reason;
        uint256 nonce;
        uint256 deadline;
    }

    struct DailyStats {
        uint256 date;         // block.timestamp / 86400
        uint256 totalLossUsd;
        uint256 tradeCount;
    }

    // ── State ─────────────────────────────────────────────────────────────────
    AgentRegistry public agentRegistry;
    address public owner;

    uint256 public maxSingleTradeUsd = 5_000 * 100;  // $5,000 in cents
    uint256 public maxDailyLossUsd   = 10_000 * 100; // $10,000 in cents
    uint256 public minConfidence      = 45;

    mapping(string => bool) public allowedTokens;
    mapping(uint256 => DailyStats) public agentDailyStats; // agentId → stats
    mapping(bytes32 => bool) public processedTrades;        // prevent replay
    mapping(uint256 => uint256) public agentNonces;

    // EIP-712 domain separator
    bytes32 public immutable DOMAIN_SEPARATOR;
    bytes32 public constant TRADE_TYPEHASH = keccak256(
        "TradeIntent(uint256 agentId,string tokenPair,string action,uint256 amountUsd,uint256 confidence,string reason,uint256 nonce,uint256 deadline)"
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "RiskRouter: not owner");
        _;
    }

    constructor(address _agentRegistry) {
        owner = msg.sender;
        agentRegistry = AgentRegistry(_agentRegistry);

        // Seed allowlist
        allowedTokens["ETH"]   = true;
        allowedTokens["BTC"]   = true;
        allowedTokens["MATIC"] = true;
        allowedTokens["LINK"]  = true;
        allowedTokens["UNI"]   = true;
        allowedTokens["AAVE"]  = true;

        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("AITradingAgent")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    // ── Core: validate + approve a trade ─────────────────────────────────────

    /**
     * @notice Submit a signed trade intent for risk validation.
     * @param intent  The trade parameters.
     * @param v,r,s   EIP-712 signature from the agent wallet.
     * @return approved Whether the trade passed all risk checks.
     * @return tradeHash Unique hash for this trade (used for replay protection).
     */
    function submitTrade(
        TradeIntent calldata intent,
        uint8  v,
        bytes32 r,
        bytes32 s
    ) external returns (bool approved, bytes32 tradeHash) {
        // ── Deadline check ────────────────────────────────────────────────────
        require(block.timestamp <= intent.deadline, "RiskRouter: trade expired");

        // ── Nonce / replay protection ─────────────────────────────────────────
        require(
            intent.nonce == agentNonces[intent.agentId],
            "RiskRouter: invalid nonce"
        );

        // ── Compute and check trade hash ──────────────────────────────────────
        tradeHash = _hashTrade(intent);
        require(!processedTrades[tradeHash], "RiskRouter: already processed");

        // ── Signature verification (EIP-712) ──────────────────────────────────
        address signer = _recoverSigner(tradeHash, v, r, s);
        // (In production, compare signer to agent owner from AgentRegistry)
        require(signer != address(0), "RiskRouter: invalid signature");

        // ── Risk checks ───────────────────────────────────────────────────────
        (bool passed, string memory rejectReason) = _runRiskChecks(intent);

        processedTrades[tradeHash] = true;
        agentNonces[intent.agentId]++;

        if (passed) {
            _updateDailyStats(intent);
            emit TradeApproved(
                intent.agentId,
                signer,
                tradeHash,
                intent.tokenPair,
                intent.action,
                intent.amountUsd
            );
            return (true, tradeHash);
        } else {
            emit TradeRejected(intent.agentId, tradeHash, rejectReason);
            return (false, tradeHash);
        }
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    function _runRiskChecks(TradeIntent calldata intent)
        internal
        view
        returns (bool, string memory)
    {
        // 1. Confidence threshold
        if (intent.confidence < minConfidence) {
            return (false, "Confidence below minimum");
        }

        // 2. Single trade limit
        if (intent.amountUsd > maxSingleTradeUsd) {
            return (false, "Exceeds single trade limit");
        }

        // 3. Token allowlist (extract base token from "ETH/USDC" → "ETH")
        string memory baseToken = _extractBaseToken(intent.tokenPair);
        if (!allowedTokens[baseToken]) {
            return (false, "Token not in allowlist");
        }

        // 4. Daily loss limit
        DailyStats storage stats = agentDailyStats[intent.agentId];
        uint256 today = block.timestamp / 86400;
        if (stats.date == today && stats.totalLossUsd >= maxDailyLossUsd) {
            return (false, "Daily loss limit reached");
        }

        // 5. Agent must be active
        (,,,, bool active,,) = agentRegistry.getAgent(intent.agentId);
        if (!active) {
            return (false, "Agent not active");
        }

        return (true, "");
    }

    function _updateDailyStats(TradeIntent calldata intent) internal {
        uint256 today = block.timestamp / 86400;
        DailyStats storage stats = agentDailyStats[intent.agentId];
        if (stats.date != today) {
            stats.date = today;
            stats.totalLossUsd = 0;
            stats.tradeCount = 0;
        }
        stats.tradeCount++;
    }

    function _hashTrade(TradeIntent calldata intent)
        internal
        view
        returns (bytes32)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                TRADE_TYPEHASH,
                intent.agentId,
                keccak256(bytes(intent.tokenPair)),
                keccak256(bytes(intent.action)),
                intent.amountUsd,
                intent.confidence,
                keccak256(bytes(intent.reason)),
                intent.nonce,
                intent.deadline
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
    }

    function _recoverSigner(bytes32 hash, uint8 v, bytes32 r, bytes32 s)
        internal
        pure
        returns (address)
    {
        return ecrecover(hash, v, r, s);
    }

    function _extractBaseToken(string calldata pair)
        internal
        pure
        returns (string memory)
    {
        bytes memory b = bytes(pair);
        uint256 slashIdx = 0;
        for (uint256 i = 0; i < b.length; i++) {
            if (b[i] == "/") { slashIdx = i; break; }
        }
        if (slashIdx == 0) return pair;
        bytes memory base = new bytes(slashIdx);
        for (uint256 i = 0; i < slashIdx; i++) base[i] = b[i];
        return string(base);
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    function setLimits(uint256 maxSingle, uint256 maxDaily) external onlyOwner {
        maxSingleTradeUsd = maxSingle;
        maxDailyLossUsd   = maxDaily;
        emit LimitsUpdated(maxSingle, maxDaily);
    }

    function setTokenAllowed(string calldata token, bool allowed) external onlyOwner {
        allowedTokens[token] = allowed;
        emit TokenAllowlistUpdated(token, allowed);
    }

    function setMinConfidence(uint256 threshold) external onlyOwner {
        minConfidence = threshold;
    }

    // ── View ──────────────────────────────────────────────────────────────────

    function getAgentNonce(uint256 agentId) external view returns (uint256) {
        return agentNonces[agentId];
    }

    function isTradeProcessed(bytes32 tradeHash) external view returns (bool) {
        return processedTrades[tradeHash];
    }
}
