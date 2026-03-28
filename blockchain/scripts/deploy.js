// scripts/deploy.js — run with: npx hardhat run scripts/deploy.js --network sepolia

const hre = require("hardhat");

async function main() {

  const [deployer] = await hre.ethers.getSigners();

  console.log("Deploying with:", deployer.address);

  const balance = await hre.ethers.provider.getBalance(deployer.address);

  console.log("Balance:", hre.ethers.formatEther(balance), "ETH\n");


  // ── 1. AgentRegistry ─────────────────────────────────────────

  console.log("[1/4] Deploying AgentRegistry...");

  const AgentRegistry = await hre.ethers.getContractFactory("AgentRegistry");

  const agentRegistry = await AgentRegistry.deploy();

  await agentRegistry.waitForDeployment();

  const agentRegistryAddress = await agentRegistry.getAddress();

  console.log("✅ AgentRegistry:     ", agentRegistryAddress);


  // ── 2. ValidationRegistry ───────────────────────────────────

  console.log("[2/4] Deploying ValidationRegistry...");

  const ValidationRegistry = await hre.ethers.getContractFactory("ValidationRegistry");

  const validationRegistry = await ValidationRegistry.deploy();

  await validationRegistry.waitForDeployment();

  const validationRegistryAddress = await validationRegistry.getAddress();

  console.log("✅ ValidationRegistry:", validationRegistryAddress);


  // ── 3. ReputationManager ────────────────────────────────────

  console.log("[3/4] Deploying ReputationManager...");

  const ReputationManager = await hre.ethers.getContractFactory("ReputationManager");

  const reputationManager = await ReputationManager.deploy(
    agentRegistryAddress,
    validationRegistryAddress
  );

  await reputationManager.waitForDeployment();

  const reputationManagerAddress = await reputationManager.getAddress();

  console.log("✅ ReputationManager: ", reputationManagerAddress);


  // ── 4. RiskRouter ───────────────────────────────────────────

  console.log("[4/4] Deploying RiskRouter...");

  const RiskRouter = await hre.ethers.getContractFactory("RiskRouter");

  const riskRouter = await RiskRouter.deploy(agentRegistryAddress);

  await riskRouter.waitForDeployment();

  const riskRouterAddress = await riskRouter.getAddress();

  console.log("✅ RiskRouter:        ", riskRouterAddress);


  // ── Wiring Contracts ────────────────────────────────────────

  console.log("\n🔧 Wiring contracts...");

  let tx;


  tx = await agentRegistry.setReputationManager(reputationManagerAddress);

  await tx.wait();

  console.log("✅ AgentRegistry.setReputationManager →", reputationManagerAddress);


  tx = await validationRegistry.setAuthorizedCaller(reputationManagerAddress);

  await tx.wait();

  console.log("✅ ValidationRegistry.setAuthorizedCaller →", reputationManagerAddress);


  tx = await validationRegistry.addValidator(riskRouterAddress);

  await tx.wait();

  console.log("✅ ValidationRegistry.addValidator →", riskRouterAddress);


  tx = await reputationManager.setAuthorizedCaller(riskRouterAddress, true);

  await tx.wait();

  console.log("✅ ReputationManager.setAuthorizedCaller(RiskRouter) →", riskRouterAddress);


  // ── Summary ─────────────────────────────────────────────────

  console.log("\n==============================================");

  console.log("  DEPLOYMENT COMPLETE — SEPOLIA TESTNET");

  console.log("==============================================");

  console.log("AgentRegistry:      ", agentRegistryAddress);

  console.log("ValidationRegistry: ", validationRegistryAddress);

  console.log("ReputationManager:  ", reputationManagerAddress);

  console.log("RiskRouter:         ", riskRouterAddress);

  console.log("==============================================");


  // ── Optional: Etherscan Verification ────────────────────────

  if (process.env.ETHERSCAN_API_KEY) {

    console.log("\n🔍 Waiting before verification...");

    await new Promise(r => setTimeout(r, 30000));


    await hre.run("verify:verify", {
      address: agentRegistryAddress,
      constructorArguments: []
    });

    await hre.run("verify:verify", {
      address: validationRegistryAddress,
      constructorArguments: []
    });

    await hre.run("verify:verify", {
      address: reputationManagerAddress,
      constructorArguments: [
        agentRegistryAddress,
        validationRegistryAddress
      ]
    });

    await hre.run("verify:verify", {
      address: riskRouterAddress,
      constructorArguments: [
        agentRegistryAddress
      ]
    });

    console.log("✅ All contracts verified");
  }

}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});