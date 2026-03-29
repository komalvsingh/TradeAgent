import AgentRegistry      from "./AgentRegistry.json";
import ValidationRegistry from "./ValidationRegistry.json";
import RiskRouter         from "./RiskRouter.json";
import ReputationManager  from "./ReputationManager.json";

// Hardhat/Foundry artifacts wrap the ABI in { abi: [...], bytecode: "...", ... }
// ethers.Contract() needs the raw array — extract .abi, fall back to the
// whole export in case the file is already a bare array.
export const AGENT_REGISTRY_ABI      = AgentRegistry.abi      ?? AgentRegistry;
export const VALIDATION_REGISTRY_ABI = ValidationRegistry.abi ?? ValidationRegistry;
export const RISK_ROUTER_ABI         = RiskRouter.abi         ?? RiskRouter;
export const REPUTATION_MANAGER_ABI  = ReputationManager.abi  ?? ReputationManager;