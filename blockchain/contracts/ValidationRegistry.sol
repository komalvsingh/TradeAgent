// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ValidationRegistry
 * @notice Immutable on-chain log of AI trading decisions with EIP-712 signed artifacts.
 *
 *         Every trade that passes risk checks stores:
 *         - Agent ID (linked to ERC-721 token in AgentRegistry)
 *         - Trade ID (off-chain UUID)
 *         - AI reasoning summary
 *         - Confidence score
 *         - Risk check result
 *         - EIP-712 signed artifact (validator's signature over the struct)
 *         - Timestamp
 *
 *         EIP-712 artifacts allow validators and third parties to independently
 *         verify that a specific validation was signed by an authorised validator,
 *         without trusting the on-chain caller.
 */
contract ValidationRegistry {

    // ── EIP-712 ───────────────────────────────────────────────────────────────
    bytes32 public immutable DOMAIN_SEPARATOR;

    bytes32 public constant VALIDATION_TYPEHASH = keccak256(
        "ValidationArtifact(uint256 agentId,string tradeId,uint256 confidence,"
        "string riskCheck,uint256 timestamp,address validator)"
    );

    bytes32 public constant OUTCOME_TYPEHASH = keccak256(
        "OutcomeArtifact(string tradeId,bool profitable,int256 pnlBps,uint256 timestamp)"
    );

    // ── Events ────────────────────────────────────────────────────────────────
    event ValidationStored(
        uint256 indexed agentId,
        string  indexed tradeId,
        uint256 confidence,
        string  riskCheck,
        uint256 timestamp,
        address indexed validator
    );
    event OutcomeRecorded(
        string  indexed tradeId,
        bool    profitable,
        int256  pnlBps
    );
    event ValidatorAdded(address indexed validator);
    event ValidatorRemoved(address indexed validator);

    // ── Structs ───────────────────────────────────────────────────────────────
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
        // EIP-712 artifact
        address validator;
        bytes   validatorSig;
        bytes32 artifactHash;
    }

    // ── State ─────────────────────────────────────────────────────────────────
    mapping(string  => Validation) private _validations;
    mapping(uint256 => string[])   private _agentTrades;
    mapping(address => bool)       public  authorizedValidators;

    uint256 public totalValidations;
    address public owner;
    address public authorizedCaller;

    modifier onlyAuthorized() {
        require(
            msg.sender == owner            ||
            msg.sender == authorizedCaller ||
            authorizedValidators[msg.sender],
            "ValidationRegistry: not authorized"
        );
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "ValidationRegistry: not owner");
        _;
    }

    constructor() {
        owner            = msg.sender;
        authorizedCaller = msg.sender;
        authorizedValidators[msg.sender] = true;

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

    // ── Write functions ───────────────────────────────────────────────────────

    /**
     * @notice Store AI decision proof with an EIP-712 signed artifact.
     *
     * @param agentId      On-chain agent ID (links to ERC-721 token).
     * @param tradeId      Off-chain UUID.
     * @param reason       AI reasoning (capped at 256 bytes).
     * @param confidence   AI confidence 0-100.
     * @param riskCheck    "passed" | "failed".
     * @param validatorSig EIP-712 signature over ValidationArtifact, signed by
     *                     msg.sender. The caller signs:
     *                       keccak256("\x19\x01" || DOMAIN_SEPARATOR ||
     *                         keccak256(VALIDATION_TYPEHASH || agentId ||
     *                           keccak256(tradeId) || confidence ||
     *                           keccak256(riskCheck) || block.timestamp || msg.sender))
     */
    function storeValidation(
        uint256 agentId,
        string calldata tradeId,
        string calldata reason,
        uint256 confidence,
        string calldata riskCheck,
        bytes calldata validatorSig
    ) external onlyAuthorized {
        require(bytes(tradeId).length > 0, "ValidationRegistry: tradeId required");
        require(
            bytes(_validations[tradeId].tradeId).length == 0,
            "ValidationRegistry: tradeId already stored"
        );
        require(confidence <= 100, "ValidationRegistry: invalid confidence");

        bytes32 artifactHash = _buildArtifactHash(
            agentId, tradeId, confidence, riskCheck, block.timestamp, msg.sender
        );
        require(
            _verifySignature(msg.sender, artifactHash, validatorSig),
            "ValidationRegistry: invalid validator signature"
        );

        _validations[tradeId] = Validation({
            agentId:         agentId,
            tradeId:         tradeId,
            reason:          _truncate(reason, 256),
            confidence:      confidence,
            riskCheck:       riskCheck,
            timestamp:       block.timestamp,
            outcomeRecorded: false,
            profitable:      false,
            pnlBps:          0,
            validator:       msg.sender,
            validatorSig:    validatorSig,
            artifactHash:    artifactHash
        });

        _agentTrades[agentId].push(tradeId);
        totalValidations++;

        emit ValidationStored(agentId, tradeId, confidence, riskCheck, block.timestamp, msg.sender);
    }

    /**
     * @notice Record the trade outcome after settlement.
     */
    function recordOutcome(
        string calldata tradeId,
        bool profitable,
        int256 pnlBps
    ) external onlyAuthorized {
        Validation storage v = _validations[tradeId];
        require(bytes(v.tradeId).length > 0, "ValidationRegistry: trade not found");
        require(!v.outcomeRecorded,           "ValidationRegistry: already recorded");

        v.outcomeRecorded = true;
        v.profitable      = profitable;
        v.pnlBps          = pnlBps;

        emit OutcomeRecorded(tradeId, profitable, pnlBps);
    }

    // ── View functions ────────────────────────────────────────────────────────

    function getValidation(string calldata tradeId)
        external view
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
            v.agentId, v.reason, v.confidence, v.riskCheck,
            v.timestamp, v.outcomeRecorded, v.profitable, v.pnlBps
        );
    }

    /**
     * @notice Returns the raw EIP-712 artifact for external verification.
     */
    function getValidationArtifact(string calldata tradeId)
        external view
        returns (
            address validator,
            bytes memory validatorSig,
            bytes32 artifactHash
        )
    {
        Validation storage v = _validations[tradeId];
        require(bytes(v.tradeId).length > 0, "ValidationRegistry: trade not found");
        return (v.validator, v.validatorSig, v.artifactHash);
    }

    /**
     * @notice Re-verify a stored artifact entirely on-chain.
     */
    function verifyValidationArtifact(string calldata tradeId)
        external view returns (bool valid)
    {
        Validation storage v = _validations[tradeId];
        require(bytes(v.tradeId).length > 0, "ValidationRegistry: trade not found");

        bytes32 expected = _buildArtifactHash(
            v.agentId, tradeId, v.confidence, v.riskCheck, v.timestamp, v.validator
        );
        return (
            expected == v.artifactHash &&
            _verifySignature(v.validator, v.artifactHash, v.validatorSig)
        );
    }

    /**
     * @notice Helper view: compute the EIP-712 hash off-chain before signing.
     */
    function computeArtifactHash(
        uint256 agentId,
        string calldata tradeId,
        uint256 confidence,
        string calldata riskCheck,
        uint256 timestamp,
        address validator
    ) external view returns (bytes32) {
        return _buildArtifactHash(agentId, tradeId, confidence, riskCheck, timestamp, validator);
    }

    function getAgentTradeIds(uint256 agentId)
        external view returns (string[] memory)
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

    function addValidator(address validator) external onlyOwner {
        authorizedValidators[validator] = true;
        emit ValidatorAdded(validator);
    }

    function removeValidator(address validator) external onlyOwner {
        authorizedValidators[validator] = false;
        emit ValidatorRemoved(validator);
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    function _buildArtifactHash(
        uint256 agentId,
        string memory tradeId,
        uint256 confidence,
        string memory riskCheck,
        uint256 timestamp,
        address validator
    ) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                VALIDATION_TYPEHASH,
                agentId,
                keccak256(bytes(tradeId)),
                confidence,
                keccak256(bytes(riskCheck)),
                timestamp,
                validator
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
    }

    function _verifySignature(
        address signer,
        bytes32 hash,
        bytes memory signature
    ) internal pure returns (bool) {
        if (signature.length != 65) return false;
        bytes32 r; bytes32 s; uint8 v;
        assembly {
            r := mload(add(signature, 32))
            s := mload(add(signature, 64))
            v := byte(0, mload(add(signature, 96)))
        }
        address recovered = ecrecover(hash, v, r, s);
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
