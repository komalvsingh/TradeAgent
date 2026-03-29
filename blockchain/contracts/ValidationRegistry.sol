// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAgentRegistry {
    function ownerOf(uint256 tokenId) external view returns (address);
}

/**
 * @title ValidationRegistry
 *
 * FIXES applied vs original:
 *
 *   FIX 1 — Timestamp in artifact hash (critical, broke all storeValidation calls):
 *     The original built the artifact hash with block.timestamp on-chain, then
 *     asked the caller to sign that hash off-chain — but the caller cannot know
 *     block.timestamp before the tx mines, so ecrecover always recovered the wrong
 *     address and the tx reverted with "invalid validator signature".
 *
 *     Solution: the caller passes an explicit `timestamp` parameter. The hash is
 *     built from that caller-supplied timestamp both here and in computeArtifactHash,
 *     so off-chain signing and on-chain verification use identical inputs.
 *     storeValidation now accepts 7 args (added `timestamp`).
 *
 *   FIX 2 — onlyTradeOwnerOrAdmin reverted on non-existent tradeId:
 *     When recordOutcome was called with an unknown tradeId the modifier read
 *     _validations[tradeId].agentId == 0, passed that to _isAgentOwner(0), which
 *     either reverted or returned an unrelated address. The "trade not found" check
 *     inside the function body never ran because the modifier already blocked it.
 *
 *     Solution: existence is now checked first inside the modifier using a
 *     dedicated internal helper _tradeExists(). The "trade not found" require
 *     inside the function body is kept as a double-guard.
 *
 *   FIX 3 — Signature scheme stays personal_sign (prefix-aware):
 *     _verifySignatureWithPrefix (prepends "\x19Ethereum Signed Message:\n32")
 *     is kept unchanged — it correctly matches MetaMask signMessage / personal_sign,
 *     which is the only signing path still universally supported.
 */
contract ValidationRegistry {

    bytes32 public immutable DOMAIN_SEPARATOR;

    bytes32 public constant VALIDATION_TYPEHASH = keccak256(
        "ValidationArtifact(uint256 agentId,string tradeId,uint256 confidence,"
        "string riskCheck,uint256 timestamp,address validator)"
    );

    bytes32 public constant OUTCOME_TYPEHASH = keccak256(
        "OutcomeArtifact(string tradeId,bool profitable,int256 pnlBps,uint256 timestamp)"
    );

    event ValidationStored(
        uint256 indexed agentId,
        string  indexed tradeId,
        uint256 confidence,
        string  riskCheck,
        uint256 timestamp,
        address indexed validator
    );
    event OutcomeRecorded(string indexed tradeId, bool profitable, int256 pnlBps);
    event ValidatorAdded(address indexed validator);
    event ValidatorRemoved(address indexed validator);

    struct Validation {
        uint256 agentId;
        string  tradeId;
        string  reason;
        uint256 confidence;
        string  riskCheck;
        uint256 timestamp;
        bool    outcomeRecorded;
        bool    profitable;
        int256  pnlBps;
        address validator;
        bytes   validatorSig;
        bytes32 artifactHash;
    }

    mapping(string  => Validation) private _validations;
    mapping(uint256 => string[])   private _agentTrades;
    mapping(address => bool)       public  authorizedValidators;

    uint256 public totalValidations;
    address public owner;
    address public authorizedCaller;
    IAgentRegistry public agentRegistry;

    modifier onlyOwner() {
        require(msg.sender == owner, "ValidationRegistry: not owner");
        _;
    }

    modifier onlyAgentOwnerOrAdmin(uint256 agentId) {
        require(
            _isAgentOwner(agentId)         ||
            msg.sender == owner            ||
            msg.sender == authorizedCaller ||
            authorizedValidators[msg.sender],
            "ValidationRegistry: not authorized"
        );
        _;
    }

    /**
     * FIX 2: Check trade existence FIRST so the "not found" error surfaces
     * before the agentId lookup. Previously a missing tradeId gave agentId=0,
     * which made the authorization check meaningless or reverted unpredictably.
     */
    modifier onlyTradeOwnerOrAdmin(string calldata tradeId) {
        require(_tradeExists(tradeId), "ValidationRegistry: trade not found");
        uint256 agentId = _validations[tradeId].agentId;
        require(
            _isAgentOwner(agentId)         ||
            msg.sender == owner            ||
            msg.sender == authorizedCaller ||
            authorizedValidators[msg.sender],
            "ValidationRegistry: not authorized"
        );
        _;
    }

    constructor(address _agentRegistry) {
        owner            = msg.sender;
        authorizedCaller = msg.sender;
        authorizedValidators[msg.sender] = true;
        agentRegistry    = IAgentRegistry(_agentRegistry);

        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("AITradingValidation")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    /**
     * FIX 1: Added explicit `timestamp` parameter (7 args total).
     *
     * The caller must:
     *   1. Read the latest block timestamp from the chain (or use Date.now()/1000).
     *   2. Call computeArtifactHash(agentId, tradeId, confidence, riskCheck, timestamp, validator)
     *      to get the exact bytes32 the contract will verify.
     *   3. Sign that hash with personal_sign / signMessage (prefix-aware).
     *   4. Submit here passing the same `timestamp` value used in step 2.
     *
     * The contract rebuilds the artifact hash from the supplied timestamp and
     * verifies the signature against it — both sides use the same timestamp so
     * ecrecover now recovers the correct address.
     */
    function storeValidation(
        uint256 agentId,
        string calldata tradeId,
        string calldata reason,
        uint256 confidence,
        string calldata riskCheck,
        uint256 timestamp,        // FIX 1: caller-supplied timestamp
        bytes calldata validatorSig
    ) external onlyAgentOwnerOrAdmin(agentId) {
        require(bytes(tradeId).length > 0,
            "ValidationRegistry: tradeId required");
        require(!_tradeExists(tradeId),
            "ValidationRegistry: tradeId already stored");
        require(confidence <= 100,
            "ValidationRegistry: invalid confidence");
        // Sanity: timestamp must be within ±10 minutes of current block time
        // to prevent stale or future-dated artifacts.
        require(
            timestamp >= block.timestamp - 600 && timestamp <= block.timestamp + 60,
            "ValidationRegistry: timestamp out of range"
        );

        bytes32 artifactHash = _buildArtifactHash(
            agentId, tradeId, confidence, riskCheck, timestamp, msg.sender
        );

        require(
            _verifySignatureWithPrefix(msg.sender, artifactHash, validatorSig),
            "ValidationRegistry: invalid validator signature"
        );

        _validations[tradeId] = Validation({
            agentId:         agentId,
            tradeId:         tradeId,
            reason:          _truncate(reason, 256),
            confidence:      confidence,
            riskCheck:       riskCheck,
            timestamp:       timestamp,
            outcomeRecorded: false,
            profitable:      false,
            pnlBps:          0,
            validator:       msg.sender,
            validatorSig:    validatorSig,
            artifactHash:    artifactHash
        });

        _agentTrades[agentId].push(tradeId);
        totalValidations++;

        emit ValidationStored(agentId, tradeId, confidence, riskCheck, timestamp, msg.sender);
    }

    function recordOutcome(
        string calldata tradeId,
        bool profitable,
        int256 pnlBps
    ) external onlyTradeOwnerOrAdmin(tradeId) {
        Validation storage v = _validations[tradeId];
        // Double-guard: modifier already checked existence, but kept for clarity.
        require(bytes(v.tradeId).length > 0, "ValidationRegistry: trade not found");
        require(!v.outcomeRecorded,           "ValidationRegistry: already recorded");
        v.outcomeRecorded = true;
        v.profitable      = profitable;
        v.pnlBps          = pnlBps;
        emit OutcomeRecorded(tradeId, profitable, pnlBps);
    }

    function getValidation(string calldata tradeId)
        external view
        returns (
            uint256 agentId, string memory reason, uint256 confidence,
            string memory riskCheck, uint256 timestamp,
            bool outcomeRecorded, bool profitable, int256 pnlBps
        )
    {
        Validation storage v = _validations[tradeId];
        return (v.agentId, v.reason, v.confidence, v.riskCheck,
                v.timestamp, v.outcomeRecorded, v.profitable, v.pnlBps);
    }

    function getValidationArtifact(string calldata tradeId)
        external view
        returns (address validator, bytes memory validatorSig, bytes32 artifactHash)
    {
        Validation storage v = _validations[tradeId];
        require(_tradeExists(tradeId), "ValidationRegistry: trade not found");
        return (v.validator, v.validatorSig, v.artifactHash);
    }

    function verifyValidationArtifact(string calldata tradeId)
        external view returns (bool)
    {
        Validation storage v = _validations[tradeId];
        require(_tradeExists(tradeId), "ValidationRegistry: trade not found");
        bytes32 expected = _buildArtifactHash(
            v.agentId, tradeId, v.confidence, v.riskCheck, v.timestamp, v.validator
        );
        return (
            expected == v.artifactHash &&
            _verifySignatureWithPrefix(v.validator, v.artifactHash, v.validatorSig)
        );
    }

    function computeArtifactHash(
        uint256 agentId, string calldata tradeId, uint256 confidence,
        string calldata riskCheck, uint256 timestamp, address validator
    ) external view returns (bytes32) {
        return _buildArtifactHash(agentId, tradeId, confidence, riskCheck, timestamp, validator);
    }

    function getAgentTradeIds(uint256 agentId) external view returns (string[] memory) {
        return _agentTrades[agentId];
    }

    function getAgentTradeCount(uint256 agentId) external view returns (uint256) {
        return _agentTrades[agentId].length;
    }

    function setAuthorizedCaller(address caller) external onlyOwner {
        authorizedCaller = caller;
    }

    function addValidator(address validator) external onlyOwner {
        authorizedValidators[validator] = true;
        emit ValidatorAdded(validator);
    }

    function removeValidator(address validator) external onlyOwner {
        authorizedValidators[validator] = false;
        emit ValidatorRemoved(validator);
    }

    function setAgentRegistry(address _agentRegistry) external onlyOwner {
        agentRegistry = IAgentRegistry(_agentRegistry);
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    function _tradeExists(string calldata tradeId) internal view returns (bool) {
        return bytes(_validations[tradeId].tradeId).length > 0;
    }

    function _isAgentOwner(uint256 agentId) internal view returns (bool) {
        try agentRegistry.ownerOf(agentId) returns (address agentOwner) {
            return agentOwner == msg.sender;
        } catch {
            return false;
        }
    }

    function _buildArtifactHash(
        uint256 agentId, string memory tradeId, uint256 confidence,
        string memory riskCheck, uint256 timestamp, address validator
    ) internal view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(
            VALIDATION_TYPEHASH,
            agentId,
            keccak256(bytes(tradeId)),
            confidence,
            keccak256(bytes(riskCheck)),
            timestamp,
            validator
        ));
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
    }

    /**
     * @notice Verify a signature produced by MetaMask personal_sign / signMessage.
     *
     * personal_sign prepends "\x19Ethereum Signed Message:\n32" to the hash
     * before signing. We apply the same prefix here so ecrecover recovers the
     * correct signer address. Equivalent to OZ ECDSA.toEthSignedMessageHash.
     */
    function _verifySignatureWithPrefix(
        address signer,
        bytes32 hash,
        bytes memory signature
    ) internal pure returns (bool) {
        if (signature.length != 65) return false;

        bytes32 prefixedHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", hash)
        );

        bytes32 r; bytes32 s; uint8 v;
        assembly {
            r := mload(add(signature, 32))
            s := mload(add(signature, 64))
            v := byte(0, mload(add(signature, 96)))
        }

        if (v < 27) v += 27;

        address recovered = ecrecover(prefixedHash, v, r, s);
        return (recovered != address(0) && recovered == signer);
    }

    function _truncate(string calldata str, uint256 maxLen)
        internal pure returns (string memory)
    {
        bytes calldata b = bytes(str);
        if (b.length <= maxLen) return str;
        bytes memory out = new bytes(maxLen);
        for (uint256 i = 0; i < maxLen; i++) out[i] = b[i];
        return string(out);
    }
}
