// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title AgentRegistry
 * @notice ERC-8004-inspired on-chain identity registry for AI trading agents.
 *         Each agent gets a unique ID, stores its metadata, and carries a
 *         trust score that evolves with trade outcomes.
 */
contract AgentRegistry {
    // ── Events ───────────────────────────────────────────────────────────────
    event AgentRegistered(
        uint256 indexed agentId,
        address indexed owner,
        string name,
        string strategy
    );
    event AgentDeactivated(uint256 indexed agentId);
    event TrustScoreUpdated(uint256 indexed agentId, uint256 newScore);

    // ── Data structures ───────────────────────────────────────────────────────
    struct Agent {
        uint256 id;
        address owner;
        string  name;
        string  strategy;   // "RSI", "MA_CROSSOVER", "SENTIMENT", "COMBINED"
        string  endpoint;   // off-chain API endpoint
        uint256 trustScore; // 0–100 (stored as integer, e.g. 75 = 75%)
        uint256 totalTrades;
        uint256 profitableTrades;
        int256  totalPnlBps; // basis points (1 bps = 0.01%)
        bool    active;
        uint256 registeredAt;
    }

    // ── State ─────────────────────────────────────────────────────────────────
    uint256 private _nextId = 1;
    mapping(uint256 => Agent) private _agents;
    mapping(address => uint256[]) private _ownerAgents;

    // Only the ReputationManager contract can update scores
    address public reputationManager;
    address public owner;

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
        owner = msg.sender;
        reputationManager = msg.sender; // updated after ReputationManager deploy
    }

    // ── External functions ────────────────────────────────────────────────────

    /**
     * @notice Register a new AI trading agent.
     * @return agentId The unique on-chain identifier.
     */
    function registerAgent(
        string calldata name,
        string calldata strategy,
        string calldata endpoint
    ) external returns (uint256 agentId) {
        require(bytes(name).length > 0, "AgentRegistry: name required");
        require(bytes(strategy).length > 0, "AgentRegistry: strategy required");

        agentId = _nextId++;

        _agents[agentId] = Agent({
            id:               agentId,
            owner:            msg.sender,
            name:             name,
            strategy:         strategy,
            endpoint:         endpoint,
            trustScore:       50,   // start at neutral
            totalTrades:      0,
            profitableTrades: 0,
            totalPnlBps:      0,
            active:           true,
            registeredAt:     block.timestamp
        });

        _ownerAgents[msg.sender].push(agentId);

        emit AgentRegistered(agentId, msg.sender, name, strategy);
    }

    /**
     * @notice Deactivate an agent (owner only).
     */
    function deactivateAgent(uint256 agentId) external {
        Agent storage agent = _agents[agentId];
        require(agent.owner == msg.sender, "AgentRegistry: not agent owner");
        require(agent.active, "AgentRegistry: already inactive");
        agent.active = false;
        emit AgentDeactivated(agentId);
    }

    /**
     * @notice Update trust score and trade stats after a trade outcome.
     *         Called by ReputationManager.
     */
    function updateReputation(
        uint256 agentId,
        bool profitable,
        int256 pnlBps
    ) external onlyReputationManager {
        Agent storage agent = _agents[agentId];
        require(agent.active, "AgentRegistry: agent not active");

        agent.totalTrades++;
        agent.totalPnlBps += pnlBps;

        if (profitable) {
            agent.profitableTrades++;
            // Increase trust score (max 100)
            agent.trustScore = agent.trustScore >= 98
                ? 100
                : agent.trustScore + 2;
        } else {
            // Decrease trust score (min 0)
            agent.trustScore = agent.trustScore <= 2
                ? 0
                : agent.trustScore - 2;  // smaller penalty than reward
        }

        emit TrustScoreUpdated(agentId, agent.trustScore);
    }

    // ── View functions ────────────────────────────────────────────────────────

    function getAgent(uint256 agentId)
        external
        view
        returns (
            string memory name,
            string memory strategy,
            address agentOwner,
            uint256 trustScore,
            bool active,
            uint256 totalTrades,
            uint256 profitableTrades
        )
    {
        Agent storage a = _agents[agentId];
        return (
            a.name,
            a.strategy,
            a.owner,
            a.trustScore,
            a.active,
            a.totalTrades,
            a.profitableTrades
        );
    }

    function getTrustScore(uint256 agentId) external view returns (uint256) {
        return _agents[agentId].trustScore;
    }

    function getAgentsByOwner(address agentOwner)
        external
        view
        returns (uint256[] memory)
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
}
