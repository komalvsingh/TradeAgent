const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const feeData = await ethers.provider.getFeeData();
  const gasPrice = (feeData.gasPrice * 150n) / 100n; // +50% buffer
  const txOverrides = { gasPrice };
  console.log("Gas price:", ethers.formatUnits(gasPrice, "gwei"), "gwei");

  // 1. AgentRegistry
  const AgentRegistry = await ethers.getContractFactory("AgentRegistry");
  const agentRegistry = await AgentRegistry.deploy(txOverrides);
  await agentRegistry.waitForDeployment();
  console.log("AgentRegistry:      ", await agentRegistry.getAddress());

  // 2. ValidationRegistry
  const ValidationRegistry = await ethers.getContractFactory("ValidationRegistry");
  const validationRegistry = await ValidationRegistry.deploy(
    await agentRegistry.getAddress(), txOverrides
  );
  await validationRegistry.waitForDeployment();
  console.log("ValidationRegistry: ", await validationRegistry.getAddress());

  // 3. ReputationManager
  const ReputationManager = await ethers.getContractFactory("ReputationManager");
  const reputationManager = await ReputationManager.deploy(
    await agentRegistry.getAddress(),
    await validationRegistry.getAddress(),
    txOverrides
  );
  await reputationManager.waitForDeployment();
  console.log("ReputationManager:  ", await reputationManager.getAddress());

  // 4. RiskRouter
  const RiskRouter = await ethers.getContractFactory("RiskRouter");
  const riskRouter = await RiskRouter.deploy(
    await agentRegistry.getAddress(), txOverrides
  );
  await riskRouter.waitForDeployment();
  console.log("RiskRouter:         ", await riskRouter.getAddress());

  // ── Wire up permissions ──────────────────────────────────────────────────
  let tx;

  tx = await agentRegistry.setReputationManager(
    await reputationManager.getAddress(), txOverrides
  );
  await tx.wait();
  console.log("✓ ReputationManager wired into AgentRegistry");

  tx = await reputationManager.setAuthorizedCaller(
    await riskRouter.getAddress(), true, txOverrides
  );
  await tx.wait();
  console.log("✓ RiskRouter authorized in ReputationManager");

  tx = await validationRegistry.setAuthorizedCaller(
    await riskRouter.getAddress(), txOverrides
  );
  await tx.wait();
  console.log("✓ RiskRouter authorized in ValidationRegistry");

  console.log("\n── Update your .env ──────────────────────────────────────");
  console.log(`VITE_AGENT_REGISTRY_ADDRESS=${await agentRegistry.getAddress()}`);
  console.log(`VITE_VALIDATION_REGISTRY_ADDRESS=${await validationRegistry.getAddress()}`);
  console.log(`VITE_REPUTATION_MANAGER_ADDRESS=${await reputationManager.getAddress()}`);
  console.log(`VITE_RISK_ROUTER_ADDRESS=${await riskRouter.getAddress()}`);
}

main().catch((e) => { console.error(e); process.exit(1); });