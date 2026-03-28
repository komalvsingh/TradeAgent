// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./Interfaces.sol";

/**
 * @title AgentRegistry
 * @notice ERC-721-based on-chain identity registry for AI trading agents.
 *         Each agent is minted as an NFT token, stores its metadata, and carries
 *         a trust score that evolves with trade outcomes.
 *         Implements EIP-1271 for contract-wallet signature validation.
 *         Inspired by ERC-8004 agent identity standard.
 */
contract AgentRegistry is IERC721Metadata {

    bytes4 internal constant ERC1271_MAGIC_VALUE = 0x1626ba7e;

    // ── Events ────────────────────────────────────────────────────────────────
    event AgentRegistered(
        uint256 indexed agentId,
        address indexed owner,
        string name,
        string strategy
    );
    event AgentDeactivated(uint256 indexed agentId);
    event TrustScoreUpdated(uint256 indexed agentId, uint256 newScore);

    // ── Structs ───────────────────────────────────────────────────────────────
    struct Agent {
        uint256 id;
        address owner;
        string  name;
        string  strategy;
        string  endpoint;
        string  tokenURI;
        uint256 trustScore;
        uint256 totalTrades;
        uint256 profitableTrades;
        int256  totalPnlBps;
        bool    active;
        uint256 registeredAt;
    }

    // ── ERC-721 State ─────────────────────────────────────────────────────────
    string private _nftName;
    string private _nftSymbol;
    mapping(uint256 => address) private _owners;
    mapping(address => uint256) private _balances;
    mapping(uint256 => address) private _tokenApprovals;
    mapping(address => mapping(address => bool)) private _operatorApprovals;

    // ── Registry State ────────────────────────────────────────────────────────
    uint256 private _nextId = 1;
    mapping(uint256 => Agent)   private _agents;
    mapping(address => uint256[]) private _ownerAgents;

    address public reputationManager;
    address public owner;
    address public erc8004Registry;

    modifier onlyOwner() {
        require(msg.sender == owner, "AgentRegistry: not owner");
        _;
    }

    modifier onlyReputationManager() {
        require(
            msg.sender == reputationManager || msg.sender == owner,
            "AgentRegistry: not reputation manager"
        );
        _;
    }

    constructor() {
        owner             = msg.sender;
        reputationManager = msg.sender;
        _nftName          = "AITradingAgent";
        _nftSymbol        = "AITA";
    }

    // ── ERC-165 ───────────────────────────────────────────────────────────────

    function supportsInterface(bytes4 interfaceId)
        public pure override returns (bool)
    {
        return
            interfaceId == type(IERC721).interfaceId         ||
            interfaceId == type(IERC721Metadata).interfaceId ||
            interfaceId == type(IERC165).interfaceId;
    }

    // ── ERC-721 Metadata ──────────────────────────────────────────────────────

    function name()   external view override returns (string memory) { return _nftName; }
    function symbol() external view override returns (string memory) { return _nftSymbol; }

    function tokenURI(uint256 tokenId) external view override returns (string memory) {
        require(_owners[tokenId] != address(0), "AgentRegistry: nonexistent token");
        return _agents[tokenId].tokenURI;
    }

    // ── ERC-721 Core ──────────────────────────────────────────────────────────

    function balanceOf(address _owner) external view override returns (uint256) {
        require(_owner != address(0), "AgentRegistry: zero address");
        return _balances[_owner];
    }

    function ownerOf(uint256 tokenId) external view override returns (address) {
        address tokenOwner = _owners[tokenId];
        require(tokenOwner != address(0), "AgentRegistry: nonexistent token");
        return tokenOwner;
    }

    function approve(address to, uint256 tokenId) external override {
        address tokenOwner = _owners[tokenId];
        require(to != tokenOwner, "AgentRegistry: approve to current owner");
        require(
            msg.sender == tokenOwner || _operatorApprovals[tokenOwner][msg.sender],
            "AgentRegistry: not authorized"
        );
        _tokenApprovals[tokenId] = to;
        emit Approval(tokenOwner, to, tokenId);
    }

    function getApproved(uint256 tokenId) external view override returns (address) {
        require(_owners[tokenId] != address(0), "AgentRegistry: nonexistent token");
        return _tokenApprovals[tokenId];
    }

    function setApprovalForAll(address operator, bool approved) external override {
        require(operator != msg.sender, "AgentRegistry: approve to caller");
        _operatorApprovals[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function isApprovedForAll(address _owner, address operator)
        external view override returns (bool)
    {
        return _operatorApprovals[_owner][operator];
    }

    function transferFrom(address from, address to, uint256 tokenId) external override {
        require(_isApprovedOrOwner(msg.sender, tokenId), "AgentRegistry: not authorized");
        _transfer(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external override {
        require(_isApprovedOrOwner(msg.sender, tokenId), "AgentRegistry: not authorized");
        _transfer(from, to, tokenId);
        require(
            _checkOnERC721Received(from, to, tokenId, ""),
            "AgentRegistry: not ERC721Receiver"
        );
    }

    function safeTransferFrom(
        address from,
        address to,
        uint256 tokenId,
        bytes calldata data
    ) public override {
        require(_isApprovedOrOwner(msg.sender, tokenId), "AgentRegistry: not authorized");
        _transfer(from, to, tokenId);
        bytes memory dataCopy = data;
        require(
            _checkOnERC721Received(from, to, tokenId, dataCopy),
            "AgentRegistry: not ERC721Receiver"
        );
    }

    // ── EIP-1271 ──────────────────────────────────────────────────────────────

    function isValidSignature(bytes32 hash, bytes memory signature)
        external view returns (bytes4)
    {
        if (signature.length == 65) {
            bytes32 r; bytes32 s; uint8 v;
            assembly {
                r := mload(add(signature, 32))
                s := mload(add(signature, 64))
                v := byte(0, mload(add(signature, 96)))
            }
            address recovered = ecrecover(hash, v, r, s);
            if (recovered != address(0) && recovered == owner)
                return ERC1271_MAGIC_VALUE;
        }
        return 0xffffffff;
    }

    function isValidAgentSignature(
        uint256 agentId,
        bytes32 hash,
        bytes memory signature
    ) external view returns (bool) {
        address agentOwner = _agents[agentId].owner;
        require(agentOwner != address(0), "AgentRegistry: agent not found");

        if (signature.length == 65) {
            bytes32 r; bytes32 s; uint8 v;
            assembly {
                r := mload(add(signature, 32))
                s := mload(add(signature, 64))
                v := byte(0, mload(add(signature, 96)))
            }
            if (ecrecover(hash, v, r, s) == agentOwner) return true;
        }

        if (agentOwner.code.length > 0) {
            try IERC1271(agentOwner).isValidSignature(hash, signature)
                returns (bytes4 result)
            {
                return result == ERC1271_MAGIC_VALUE;
            } catch {
                return false;
            }
        }
        return false;
    }

    // ── External functions ────────────────────────────────────────────────────

    function registerAgent(
        string calldata name_,
        string calldata strategy,
        string calldata endpoint,
        string calldata tokenURI_
    ) external returns (uint256 agentId) {
        require(bytes(name_).length    > 0, "AgentRegistry: name required");
        require(bytes(strategy).length > 0, "AgentRegistry: strategy required");

        agentId = _nextId++;

        _agents[agentId] = Agent({
            id:               agentId,
            owner:            msg.sender,
            name:             name_,
            strategy:         strategy,
            endpoint:         endpoint,
            tokenURI:         tokenURI_,
            trustScore:       50,
            totalTrades:      0,
            profitableTrades: 0,
            totalPnlBps:      0,
            active:           true,
            registeredAt:     block.timestamp
        });

        _ownerAgents[msg.sender].push(agentId);
        _safeMint(msg.sender, agentId);

        emit AgentRegistered(agentId, msg.sender, name_, strategy);
    }

    function deactivateAgent(uint256 agentId) external {
        Agent storage agent = _agents[agentId];
        require(agent.owner == msg.sender, "AgentRegistry: not agent owner");
        require(agent.active,              "AgentRegistry: already inactive");
        agent.active = false;
        emit AgentDeactivated(agentId);
    }

    function updateReputation(
        uint256 agentId,
        bool    profitable,
        int256  pnlBps
    ) external onlyReputationManager {
        Agent storage agent = _agents[agentId];
        require(agent.active, "AgentRegistry: agent not active");

        agent.totalTrades++;
        agent.totalPnlBps += pnlBps;

        if (profitable) {
            agent.profitableTrades++;
            agent.trustScore = agent.trustScore >= 98 ? 100 : agent.trustScore + 2;
        } else {
            agent.trustScore = agent.trustScore <= 2  ? 0   : agent.trustScore - 2;
        }

        emit TrustScoreUpdated(agentId, agent.trustScore);
    }

    // ── View functions ────────────────────────────────────────────────────────

    function getAgent(uint256 agentId)
        external view
        returns (
            string memory agentName,
            string memory strategy,
            address agentOwner,
            uint256 trustScore,
            bool    active,
            uint256 totalTrades,
            uint256 profitableTrades
        )
    {
        Agent storage a = _agents[agentId];
        return (a.name, a.strategy, a.owner, a.trustScore, a.active, a.totalTrades, a.profitableTrades);
    }

    function getTrustScore(uint256 agentId) external view returns (uint256) {
        return _agents[agentId].trustScore;
    }

    function getAgentsByOwner(address agentOwner)
        external view returns (uint256[] memory)
    {
        return _ownerAgents[agentOwner];
    }

    function totalAgents() external view returns (uint256) {
        return _nextId - 1;
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    function setReputationManager(address manager) external onlyOwner {
        reputationManager = manager;
    }

    function setERC8004Registry(address registry) external onlyOwner {
        erc8004Registry = registry;
    }

    // ── Internal ERC-721 helpers ──────────────────────────────────────────────

    function _safeMint(address to, uint256 tokenId) internal {
        require(to != address(0),               "AgentRegistry: mint to zero");
        require(_owners[tokenId] == address(0), "AgentRegistry: already minted");
        _balances[to]   += 1;
        _owners[tokenId] = to;
        emit Transfer(address(0), to, tokenId);
        require(
            _checkOnERC721Received(address(0), to, tokenId, ""),
            "AgentRegistry: not ERC721Receiver"
        );
    }

    function _transfer(address from, address to, uint256 tokenId) internal {
        require(_owners[tokenId] == from, "AgentRegistry: wrong owner");
        require(to != address(0),         "AgentRegistry: transfer to zero");
        delete _tokenApprovals[tokenId];
        _balances[from]        -= 1;
        _balances[to]          += 1;
        _owners[tokenId]        = to;
        _agents[tokenId].owner  = to;
        _ownerAgents[to].push(tokenId);
        emit Transfer(from, to, tokenId);
    }

    function _isApprovedOrOwner(address spender, uint256 tokenId)
        internal view returns (bool)
    {
        address tokenOwner = _owners[tokenId];
        return (
            spender == tokenOwner                    ||
            _tokenApprovals[tokenId] == spender      ||
            _operatorApprovals[tokenOwner][spender]
        );
    }

    function _checkOnERC721Received(
        address from, address to, uint256 tokenId, bytes memory data
    ) internal returns (bool) {
        if (to.code.length == 0) return true;
        try IERC721Receiver(to).onERC721Received(msg.sender, from, tokenId, data)
            returns (bytes4 retval)
        {
            return retval == IERC721Receiver.onERC721Received.selector;
        } catch {
            return false;
        }
    }
}
