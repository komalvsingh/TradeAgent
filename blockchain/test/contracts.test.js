const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AI Trading Agent — Contract Suite", function () {
  let deployer, trader, stranger;
  let agentRegistry, validationRegistry, riskRouter, reputationManager;

  beforeEach(async function () {
    [deployer, trader, stranger] = await ethers.getSigners();

    // Deploy all contracts
    const AgentRegistry = await ethers.getContractFactory("AgentRegistry");
    agentRegistry = await AgentRegistry.deploy();

    const ValidationRegistry = await ethers.getContractFactory("ValidationRegistry");
    validationRegistry = await ValidationRegistry.deploy();

    const RiskRouter = await ethers.getContractFactory("RiskRouter");
    riskRouter = await RiskRouter.deploy(await agentRegistry.getAddress());

    const ReputationManager = await ethers.getContractFactory("ReputationManager");
    reputationManager = await ReputationManager.deploy(
      await agentRegistry.getAddress(),
      await validationRegistry.getAddress()
    );

    // Wire permissions
    await agentRegistry.setReputationManager(await reputationManager.getAddress());
    await validationRegistry.setAuthorizedCaller(await reputationManager.getAddress());
  });

  // ── AgentRegistry ─────────────────────────────────────────────────────────
  describe("AgentRegistry", function () {
    it("should register an agent and assign ID 1", async function () {
      const tx = await agentRegistry
        .connect(trader)
        .registerAgent("AlphaBot", "COMBINED", "/api/agents/trader");
      await tx.wait();

      const [name, strategy, owner, trustScore, active] =
        await agentRegistry.getAgent(1);

      expect(name).to.equal("AlphaBot");
      expect(strategy).to.equal("COMBINED");
      expect(owner).to.equal(trader.address);
      expect(trustScore).to.equal(50n);  // starts neutral
      expect(active).to.be.true;
    });

    it("should reject empty agent name", async function () {
      await expect(
        agentRegistry.registerAgent("", "RSI", "/endpoint")
      ).to.be.revertedWith("AgentRegistry: name required");
    });

    it("should deactivate agent (owner only)", async function () {
      await agentRegistry.connect(trader).registerAgent("Bot", "RSI", "/ep");
      await agentRegistry.connect(trader).deactivateAgent(1);
      const [,,, , active] = await agentRegistry.getAgent(1);
      expect(active).to.be.false;
    });

    it("should not allow strangers to deactivate", async function () {
      await agentRegistry.connect(trader).registerAgent("Bot", "RSI", "/ep");
      await expect(
        agentRegistry.connect(stranger).deactivateAgent(1)
      ).to.be.revertedWith("AgentRegistry: not agent owner");
    });

    it("trust score increases on profitable trade", async function () {
      await agentRegistry.connect(trader).registerAgent("Bot", "RSI", "/ep");
      // deployer acts as reputationManager (set in beforeEach wiring)
      await agentRegistry.updateReputation(1, true, 150n);
      const score = await agentRegistry.getTrustScore(1);
      expect(score).to.be.gt(50n);
    });

    it("trust score decreases on unprofitable trade", async function () {
      await agentRegistry.connect(trader).registerAgent("Bot", "RSI", "/ep");
      await agentRegistry.updateReputation(1, false, -100n);
      const score = await agentRegistry.getTrustScore(1);
      expect(score).to.be.lt(50n);
    });
  });

  // ── ValidationRegistry ────────────────────────────────────────────────────
  describe("ValidationRegistry", function () {
    const TRADE_ID = "trade-uuid-001";

    it("stores a validation proof", async function () {
      await validationRegistry.storeValidation(
        1, TRADE_ID, "RSI oversold, buying ETH", 82, "passed"
      );

      const [agentId, reason, confidence, riskCheck] =
        await validationRegistry.getValidation(TRADE_ID);

      expect(agentId).to.equal(1n);
      expect(confidence).to.equal(82n);
      expect(riskCheck).to.equal("passed");
      expect(reason).to.include("RSI");
    });

    it("prevents duplicate tradeId storage", async function () {
      await validationRegistry.storeValidation(
        1, TRADE_ID, "reason", 70, "passed"
      );
      await expect(
        validationRegistry.storeValidation(1, TRADE_ID, "reason2", 60, "passed")
      ).to.be.revertedWith("ValidationRegistry: tradeId already stored");
    });

    it("records outcome correctly", async function () {
      await validationRegistry.storeValidation(1, TRADE_ID, "r", 70, "passed");
      // set self as authorized for test
      await validationRegistry.setAuthorizedCaller(deployer.address);
      await validationRegistry.recordOutcome(TRADE_ID, true, 200n);

      const [,,,, , outcomeRecorded, profitable, pnlBps] =
        await validationRegistry.getValidation(TRADE_ID);

      expect(outcomeRecorded).to.be.true;
      expect(profitable).to.be.true;
      expect(pnlBps).to.equal(200n);
    });
  });

  // ── RiskRouter ────────────────────────────────────────────────────────────
  describe("RiskRouter", function () {
    let agentId;

    beforeEach(async function () {
      await agentRegistry.connect(trader).registerAgent("TBot", "RSI", "/ep");
      agentId = 1;
    });

    it("reports allowed tokens correctly", async function () {
      expect(await riskRouter.allowedTokens("ETH")).to.be.true;
      expect(await riskRouter.allowedTokens("XYZ")).to.be.false;
    });

    it("owner can update allowed tokens", async function () {
      await riskRouter.setTokenAllowed("DOGE", true);
      expect(await riskRouter.allowedTokens("DOGE")).to.be.true;
    });

    it("owner can update trade limits", async function () {
      await riskRouter.setLimits(1_000_00n, 5_000_00n); // $1k / $5k in cents
      expect(await riskRouter.maxSingleTradeUsd()).to.equal(1_000_00n);
    });

    it("nonce starts at 0 for new agents", async function () {
      expect(await riskRouter.getAgentNonce(agentId)).to.equal(0n);
    });
  });

  // ── ReputationManager ─────────────────────────────────────────────────────
  describe("ReputationManager", function () {
    const TRADE_ID = "trade-rep-001";

    beforeEach(async function () {
      await agentRegistry.connect(trader).registerAgent("RepBot", "RSI", "/ep");
      // Store validation proof (deployer is authorized after deploy wiring)
      // Re-authorize deployer for this test
      await validationRegistry.setAuthorizedCaller(deployer.address);
      await validationRegistry.storeValidation(
        1, TRADE_ID, "Strong RSI signal", 80, "passed"
      );
      // Re-wire to reputationManager for outcome recording
      await validationRegistry.setAuthorizedCaller(
        await reputationManager.getAddress()
      );
    });

    it("updates reputation on profitable trade", async function () {
      const scoreBefore = await agentRegistry.getTrustScore(1);
      await reputationManager.updateReputation(1, TRADE_ID, true, 150n);
      const scoreAfter = await agentRegistry.getTrustScore(1);
      expect(scoreAfter).to.be.gt(scoreBefore);
    });

    it("emits ReputationUpdated event", async function () {
      await expect(
        reputationManager.updateReputation(1, TRADE_ID, true, 150n)
      ).to.emit(reputationManager, "ReputationUpdated");
    });

    it("records trade history", async function () {
      await reputationManager.updateReputation(1, TRADE_ID, false, -50n);
      const history = await reputationManager.getAgentHistory(1);
      expect(history.length).to.equal(1);
      expect(history[0].profitable).to.be.false;
    });
  });
});