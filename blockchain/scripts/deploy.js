/**
 * Deploy Script — AI Trading Agent Contracts
 *
 * Deploys in the correct dependency order:
 *   1. AgentRegistry
 *   2. ValidationRegistry
 *   3. RiskRouter  (needs AgentRegistry)
 *   4. ReputationManager (needs AgentRegistry + ValidationRegistry)
 *
 * Then wires up permissions between contracts.
 *
 * Usage:
 *   npx hardhat run scripts/deploy.js --network sepolia
 *   npx hardhat run scripts/deploy.js --network localhost
 */
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(" AI Trading Agent — Contract Deployment");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`Deployer : ${deployer.address}`);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance  : ${ethers.formatEther(balance)} ETH`);
  console.log(`Network  : ${(await ethers.provider.getNetwork()).name}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // ── 1. AgentRegistry ──────────────────────────────────────────────────────
  console.log("1/4  Deploying AgentRegistry...");
  const AgentRegistry = await ethers.getContractFactory("AgentRegistry");
  const agentRegistry = await AgentRegistry.deploy();
  await agentRegistry.waitForDeployment();
  const agentRegistryAddr = await agentRegistry.getAddress();
  console.log(`     ✅ AgentRegistry: ${agentRegistryAddr}`);

  // ── 2. ValidationRegistry ─────────────────────────────────────────────────
  console.log("2/4  Deploying ValidationRegistry...");
  const ValidationRegistry = await ethers.getContractFactory("ValidationRegistry");
  const validationRegistry = await ValidationRegistry.deploy();
  await validationRegistry.waitForDeployment();
  const validationRegistryAddr = await validationRegistry.getAddress();
  console.log(`     ✅ ValidationRegistry: ${validationRegistryAddr}`);

  // ── 3. RiskRouter ─────────────────────────────────────────────────────────
  console.log("3/4  Deploying RiskRouter...");
  const RiskRouter = await ethers.getContractFactory("RiskRouter");
  const riskRouter = await RiskRouter.deploy(agentRegistryAddr);
  await riskRouter.waitForDeployment();
  const riskRouterAddr = await riskRouter.getAddress();
  console.log(`     ✅ RiskRouter: ${riskRouterAddr}`);

  // ── 4. ReputationManager ──────────────────────────────────────────────────
  console.log("4/4  Deploying ReputationManager...");
  const ReputationManager = await ethers.getContractFactory("ReputationManager");
  const reputationManager = await ReputationManager.deploy(
    agentRegistryAddr,
    validationRegistryAddr
  );
  await reputationManager.waitForDeployment();
  const reputationManagerAddr = await reputationManager.getAddress();
  console.log(`     ✅ ReputationManager: ${reputationManagerAddr}`);

  // ── Wire up permissions ───────────────────────────────────────────────────
console.log("\nWiring permissions (waiting 15s for network to settle)...");
await new Promise(r => setTimeout(r, 15000));

const feeData = await ethers.provider.getFeeData();
const gasPrice = feeData.gasPrice * 130n / 100n; // 30% above base

// AgentRegistry trusts ReputationManager to update scores
const tx1 = await agentRegistry.setReputationManager(reputationManagerAddr, { gasPrice });
await tx1.wait();
console.log("  ✅ AgentRegistry → ReputationManager");

await new Promise(r => setTimeout(r, 8000)); // wait between txs

// ValidationRegistry trusts ReputationManager to record outcomes
const tx2 = await validationRegistry.setAuthorizedCaller(reputationManagerAddr, { gasPrice });
await tx2.wait();
console.log("  ✅ ValidationRegistry → ReputationManager");
  // ── Save addresses ────────────────────────────────────────────────────────
  const deploymentInfo = {
    network:              (await ethers.provider.getNetwork()).name,
    chainId:              Number((await ethers.provider.getNetwork()).chainId),
    deployer:             deployer.address,
    deployedAt:           new Date().toISOString(),
    contracts: {
      AgentRegistry:      agentRegistryAddr,
      ValidationRegistry: validationRegistryAddr,
      RiskRouter:         riskRouterAddr,
      ReputationManager:  reputationManagerAddr,
    },
  };

  const outPath = path.join(__dirname, "../deployments.json");
  fs.writeFileSync(outPath, JSON.stringify(deploymentInfo, null, 2));
  console.log(`\n📄 Addresses saved to: ${outPath}`);

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(" Deployment Complete!");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`AgentRegistry      : ${agentRegistryAddr}`);
  console.log(`ValidationRegistry : ${validationRegistryAddr}`);
  console.log(`RiskRouter         : ${riskRouterAddr}`);
  console.log(`ReputationManager  : ${reputationManagerAddr}`);
  console.log("\n📋 Copy these into your backend .env:");
  console.log(`AGENT_REGISTRY_ADDRESS=${agentRegistryAddr}`);
  console.log(`RISK_ROUTER_ADDRESS=${riskRouterAddr}`);
  console.log(`VALIDATION_REGISTRY_ADDRESS=${validationRegistryAddr}`);

  // ── Etherscan verification (Sepolia only) ─────────────────────────────────
  const network = await ethers.provider.getNetwork();
  if (network.chainId === 11155111n && process.env.ETHERSCAN_API_KEY) {
    console.log("\nVerifying on Etherscan (waiting 30s for indexing)...");
    await new Promise(r => setTimeout(r, 30000));
    const { run } = require("hardhat");
    try {
      await run("verify:verify", { address: agentRegistryAddr, constructorArguments: [] });
      await run("verify:verify", { address: validationRegistryAddr, constructorArguments: [] });
      await run("verify:verify", { address: riskRouterAddr, constructorArguments: [agentRegistryAddr] });
      await run("verify:verify", { address: reputationManagerAddr, constructorArguments: [agentRegistryAddr, validationRegistryAddr] });
      console.log("✅ All contracts verified on Etherscan");
    } catch (e) {
      console.warn("Etherscan verification failed (non-fatal):", e.message);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});