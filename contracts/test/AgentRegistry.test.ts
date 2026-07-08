import { expect } from "chai";
import { ethers } from "hardhat";

describe("AgentRegistry (Phase C3)", function () {
    it("registers an agent and attests settlement performance", async function () {
        const [owner, agentOwner] = await ethers.getSigners();
        const Registry = await ethers.getContractFactory("AgentRegistry");
        const registry = await Registry.deploy();
        await registry.waitForDeployment();

        await registry.registerAgent(agentOwner.address, "https://leadrtb.com/strategy/1");
        const agentId = await registry.ownerToAgent(agentOwner.address);
        expect(agentId).to.equal(1);

        await registry.attestSettlement(agentOwner.address, true);
        const agent = await registry.getAgent(1);
        expect(agent.wins).to.equal(1);
        expect(agent.settlements).to.equal(1);
        expect(agent.reputation).to.equal(10000);

        await registry.attestSettlement(agentOwner.address, false);
        const agent2 = await registry.getAgent(1);
        expect(agent2.wins).to.equal(1);
        expect(agent2.settlements).to.equal(2);
        expect(agent2.reputation).to.equal(5000);
    });
});
