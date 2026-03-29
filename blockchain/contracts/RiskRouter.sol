// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./AgentRegistry.sol";
import "./Interfaces.sol";

/**
 * @title RiskRouter
 * @notice On-chain risk gatekeeper for AI trading agents.
 *
 *         Before any trade executes, the RiskRouter:
 *         1. Verifies the EIP-712 signature — ECDSA first, EIP-1271 fallback
 *            for contract wallets (Safe, AA wallets)
 *         2. Compares signer to the agent owner recorded in AgentRegistry
 *         3. Checks trade limits (single trade + daily loss)
 *         4. Verifies the token is in the allowed list
 *         5. Emits TradeApproved / TradeRejected for indexers
 *         6. Optionally calls the DEX router for on-chain execution
 *
 * FIX applied vs original:
 *   _updateDailyStats never incremented totalLossUsd, so the daily loss limit
 *   check (stats.totalLossUsd >= maxDailyLossUsd) could never trigger — the
 *   guard was completely dead.
 *
 *   Solution: submitTrade now passes the trade's amountUsd into _updateDailyStats.
 *   On a SELL (or any trade flagged as a loss) the full amountUsd is added to
 *   totalLossUsd. For BUY trades the exposure is also tracked because the capital
 *   is at risk. The owner can adjust the accounting model via setLossAccounting().
 *
 *   Two modes controlled by lossAccountingMode:
 *     0 = CONSERVATIVE — every approved trade counts its full amountUsd as
 *         potential loss (safest, recommended for early deployment).
 *     1 = SELL_ONLY    — only SELL-action trades accumulate toward the daily
 *         loss counter (use once you have a ReputationManager feeding back
 *         real pnl outcomes).
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
    event TradeExecuted(
        uint256 indexed agentId,
        bytes32 tradeHash,
        uint256[] amounts
    );
    event TokenAllowlistUpdated(string token, bool allowed);
    event LimitsUpdated(uint256 maxSingleTradeUsd, uint256 maxDailyLossUsd);
    event DEXRouterUpdated(address dexRouter);
    event LossAccountingModeUpdated(uint8 mode);

    // ── Structs ───────────────────────────────────────────────────────────────
    struct TradeIntent {
        uint256 agentId;
        string  tokenPair;    // e.g. "ETH/USDC"
        string  action;       // "BUY" | "SELL"
        uint256 amountUsd;    // in USD cents (e.g. 10000 = $100)
        uint256 confidence;   // 0-100
        string  reason;
        uint256 nonce;
        uint256 deadline;
        // DEX execution params (optional; zero = off-chain execution)
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 amountOutMin;
    }

    struct DailyStats {
        uint256 date;
        uint256 totalLossUsd;
        uint256 tradeCount;
    }

    // ── State ─────────────────────────────────────────────────────────────────
    AgentRegistry public agentRegistry;
    IDEXRouter    public dexRouter;
    address public owner;

    uint256 public maxSingleTradeUsd = 5_000 * 100;   // $5,000 in cents
    uint256 public maxDailyLossUsd   = 10_000 * 100;  // $10,000 in cents
    uint256 public minConfidence      = 45;

    // FIX: 0 = CONSERVATIVE (all trades), 1 = SELL_ONLY
    uint8 public lossAccountingMode = 0;

    bytes4 internal constant ERC1271_MAGIC_VALUE = 0x1626ba7e;
    bytes32 private constant SELL_HASH = keccak256(bytes("SELL"));

    mapping(string  => bool)       public allowedTokens;
    mapping(uint256 => DailyStats) public agentDailyStats;
    mapping(bytes32 => bool)       public processedTrades;
    mapping(uint256 => uint256)    public agentNonces;

    bytes32 public immutable DOMAIN_SEPARATOR;
    bytes32 public constant TRADE_TYPEHASH = keccak256(
        "TradeIntent(uint256 agentId,string tokenPair,string action,uint256 amountUsd,"
        "uint256 confidence,string reason,uint256 nonce,uint256 deadline,"
        "address tokenIn,address tokenOut,uint256 amountIn,uint256 amountOutMin)"
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "RiskRouter: not owner");
        _;
    }

    constructor(address _agentRegistry) {
        owner         = msg.sender;
        agentRegistry = AgentRegistry(_agentRegistry);

        allowedTokens["ETH"]   = true;
        allowedTokens["BTC"]   = true;
        allowedTokens["MATIC"] = true;
        allowedTokens["LINK"]  = true;
        allowedTokens["UNI"]   = true;
        allowedTokens["AAVE"]  = true;
        allowedTokens["USDC"]  = true;
        allowedTokens["WETH"]  = true;

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

    // ── Core ──────────────────────────────────────────────────────────────────

    /**
     * @notice Submit a signed trade intent for risk validation.
     * @param intent    The trade parameters.
     * @param signature Raw EIP-712 signature (65-byte ECDSA or EIP-1271 bytes).
     * @return approved  Whether the trade passed all risk checks.
     * @return tradeHash Unique hash for this trade.
     */
    function submitTrade(
        TradeIntent calldata intent,
        bytes calldata signature
    ) external returns (bool approved, bytes32 tradeHash) {
        require(block.timestamp <= intent.deadline, "RiskRouter: trade expired");
        require(
            intent.nonce == agentNonces[intent.agentId],
            "RiskRouter: invalid nonce"
        );

        tradeHash = _hashTrade(intent);
        require(!processedTrades[tradeHash], "RiskRouter: already processed");

        // ── Signer MUST be the agent owner (ECDSA + EIP-1271 fallback) ────────
        address agentOwner = _getAgentOwner(intent.agentId);
        require(
            _isValidSignature(agentOwner, tradeHash, signature),
            "RiskRouter: signer is not agent owner"
        );

        (bool passed, string memory rejectReason) = _runRiskChecks(intent);

        processedTrades[tradeHash] = true;
        agentNonces[intent.agentId]++;

        if (passed) {
            // FIX: pass amountUsd into _updateDailyStats so totalLossUsd accumulates.
            _updateDailyStats(intent.agentId, intent.amountUsd, intent.action);

            emit TradeApproved(
                intent.agentId,
                agentOwner,
                tradeHash,
                intent.tokenPair,
                intent.action,
                intent.amountUsd
            );

            // Optional on-chain DEX execution
            if (
                address(dexRouter) != address(0) &&
                intent.tokenIn  != address(0)    &&
                intent.tokenOut != address(0)    &&
                intent.amountIn > 0
            ) {
                _executeDEXSwap(intent, tradeHash, agentOwner);
            }

            return (true, tradeHash);
        } else {
            emit TradeRejected(intent.agentId, tradeHash, rejectReason);
            return (false, tradeHash);
        }
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    function _isValidSignature(
        address signer,
        bytes32 hash,
        bytes memory signature
    ) internal view returns (bool) {
        // 1. ECDSA (EOA wallets)
        if (signature.length == 65) {
            bytes32 r; bytes32 s; uint8 v;
            assembly {
                r := mload(add(signature, 32))
                s := mload(add(signature, 64))
                v := byte(0, mload(add(signature, 96)))
            }
            address recovered = ecrecover(hash, v, r, s);
            if (recovered != address(0) && recovered == signer) return true;
        }

        // 2. EIP-1271 fallback (Safe, AA, Multisig)
        if (signer.code.length > 0) {
            try IERC1271(signer).isValidSignature(hash, signature)
                returns (bytes4 result)
            {
                return result == ERC1271_MAGIC_VALUE;
            } catch {
                return false;
            }
        }
        return false;
    }

    function _getAgentOwner(uint256 agentId)
        internal view returns (address agentOwner)
    {
        (,, agentOwner,,,,) = agentRegistry.getAgent(agentId);
        require(agentOwner != address(0), "RiskRouter: agent not found");
    }

    function _runRiskChecks(TradeIntent calldata intent)
        internal view returns (bool, string memory)
    {
        if (intent.confidence < minConfidence)
            return (false, "Confidence below minimum");

        if (intent.amountUsd > maxSingleTradeUsd)
            return (false, "Exceeds single trade limit");

        string memory baseToken = _extractBaseToken(intent.tokenPair);
        if (!allowedTokens[baseToken])
            return (false, "Token not in allowlist");

        DailyStats storage stats = agentDailyStats[intent.agentId];
        uint256 today = block.timestamp / 86400;
        if (stats.date == today && stats.totalLossUsd >= maxDailyLossUsd)
            return (false, "Daily loss limit reached");

        (,,,, bool active,,) = agentRegistry.getAgent(intent.agentId);
        if (!active)
            return (false, "Agent not active");

        return (true, "");
    }

    function _executeDEXSwap(
        TradeIntent calldata intent,
        bytes32 tradeHash,
        address recipient
    ) internal {
        address[] memory path = new address[](2);
        path[0] = intent.tokenIn;
        path[1] = intent.tokenOut;

        uint256[] memory amounts = dexRouter.swapExactTokensForTokens(
            intent.amountIn,
            intent.amountOutMin,
            path,
            recipient,
            intent.deadline
        );

        emit TradeExecuted(intent.agentId, tradeHash, amounts);
    }

    /**
     * FIX: Now actually increments totalLossUsd.
     *
     * Mode 0 (CONSERVATIVE): every approved trade's full amountUsd is counted
     *   toward the daily loss ceiling — safe default for testnet / early prod.
     * Mode 1 (SELL_ONLY): only SELL trades count, so BUY trades never eat into
     *   the daily loss budget — use when you trust your downstream pnl reporting.
     *
     * @param agentId   The agent submitting the trade.
     * @param amountUsd Trade size in USD cents.
     * @param action    "BUY" or "SELL" string from the intent.
     */
    function _updateDailyStats(
        uint256 agentId,
        uint256 amountUsd,
        string calldata action
    ) internal {
        uint256 today = block.timestamp / 86400;
        DailyStats storage stats = agentDailyStats[agentId];

        if (stats.date != today) {
            stats.date         = today;
            stats.totalLossUsd = 0;
            stats.tradeCount   = 0;
        }

        stats.tradeCount++;

        // FIX: accumulate loss exposure so the daily cap actually fires.
        bool isSell = keccak256(bytes(action)) == SELL_HASH;
        if (lossAccountingMode == 0 || isSell) {
            stats.totalLossUsd += amountUsd;
        }
    }

    function _hashTrade(TradeIntent calldata intent)
        internal view returns (bytes32)
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
                intent.deadline,
                intent.tokenIn,
                intent.tokenOut,
                intent.amountIn,
                intent.amountOutMin
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
    }

    function _extractBaseToken(string calldata pair)
        internal pure returns (string memory)
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

    function setDEXRouter(address router) external onlyOwner {
        dexRouter = IDEXRouter(router);
        emit DEXRouterUpdated(router);
    }

    /**
     * @notice Set loss accounting mode.
     * @param mode 0 = CONSERVATIVE (all trades), 1 = SELL_ONLY.
     */
    function setLossAccountingMode(uint8 mode) external onlyOwner {
        require(mode <= 1, "RiskRouter: invalid mode");
        lossAccountingMode = mode;
        emit LossAccountingModeUpdated(mode);
    }

    // ── View ──────────────────────────────────────────────────────────────────

    function getAgentNonce(uint256 agentId) external view returns (uint256) {
        return agentNonces[agentId];
    }

    function isTradeProcessed(bytes32 tradeHash) external view returns (bool) {
        return processedTrades[tradeHash];
    }

    function getAgentDailyStats(uint256 agentId)
        external view
        returns (uint256 date, uint256 totalLossUsd, uint256 tradeCount)
    {
        DailyStats storage s = agentDailyStats[agentId];
        return (s.date, s.totalLossUsd, s.tradeCount);
    }
}
