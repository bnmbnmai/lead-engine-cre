// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title AgentRegistry
 * @notice Phase C3 — on-chain agent registration + performance attestations.
 *         Settlement path (PersonalEscrowVault / settlement saga) writes
 *         win-rate attestations here so marketplace leaderboards are
 *         verifiable without trusting the backend alone.
 */
contract AgentRegistry is Ownable {
    struct Agent {
        address owner;
        string uri;          // metadata URI (strategy marketplace link)
        uint32 wins;
        uint32 settlements;
        uint32 reputation;   // wins/settlements × 10000
        bool active;
    }

    uint256 private _nextId;
    mapping(uint256 => Agent) public agents;
    mapping(address => uint256) public ownerToAgent;

    event AgentRegistered(uint256 indexed agentId, address indexed owner, string uri);
    event PerformanceAttested(uint256 indexed agentId, bool won, uint32 wins, uint32 settlements, uint32 reputation);

    constructor() Ownable(msg.sender) {
        _nextId = 1;
    }

    function registerAgent(address owner, string calldata uri) external returns (uint256 agentId) {
        require(owner != address(0), "zero owner");
        require(ownerToAgent[owner] == 0, "already registered");

        agentId = _nextId++;
        agents[agentId] = Agent({
            owner: owner,
            uri: uri,
            wins: 0,
            settlements: 0,
            reputation: 0,
            active: true
        });
        ownerToAgent[owner] = agentId;

        emit AgentRegistered(agentId, owner, uri);
    }

    /**
     * @notice Called by the authorized settlement relayer after auction close.
     */
    function attestSettlement(address owner, bool won) external onlyOwner {
        uint256 agentId = ownerToAgent[owner];
        require(agentId != 0, "not registered");

        Agent storage a = agents[agentId];
        if (won) a.wins += 1;
        a.settlements += 1;
        a.reputation = a.settlements > 0
            ? uint32((uint256(a.wins) * 10000) / uint256(a.settlements))
            : 0;

        emit PerformanceAttested(agentId, won, a.wins, a.settlements, a.reputation);
    }

    function getAgent(uint256 agentId) external view returns (Agent memory) {
        return agents[agentId];
    }
}
