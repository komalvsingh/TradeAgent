import React, { createContext, useContext, useMemo } from "react";
import { ethers } from "ethers";
import { useWallet } from "./WalletContext";
import {
  AGENT_REGISTRY_ABI,
  VALIDATION_REGISTRY_ABI,
  RISK_ROUTER_ABI,
  REPUTATION_MANAGER_ABI,
} from "../abis/index";

// ── Deployed contract addresses (Sepolia) ────────────────────────────────────
const ADDRESSES = {
  AgentRegistry:      import.meta.env.REACT_APP_AGENT_REGISTRY_ADDRESS      || "",
  ValidationRegistry: import.meta.env.REACT_APP_VALIDATION_REGISTRY_ADDRESS  || "",
  RiskRouter:         import.meta.env.REACT_APP_RISK_ROUTER_ADDRESS           || "",
  ReputationManager:  import.meta.env.REACT_APP_REPUTATION_MANAGER_ADDRESS    || "",
};

const ContractContext = createContext(null);

export function ContractProvider({ children }) {
  const { signer, provider } = useWallet();

  // Build contract instances whenever signer changes
  const contracts = useMemo(() => {
    const runner = signer || provider;
    if (!runner) return {};

    const make = (address, abi) => {
      if (!address) return null;
      try {
        return new ethers.Contract(address, abi, runner);
      } catch (e) {
        console.warn(`Contract init failed for ${address}:`, e.message);
        return null;
      }
    };

    return {
      agentRegistry:      make(ADDRESSES.AgentRegistry,      AGENT_REGISTRY_ABI),
      validationRegistry: make(ADDRESSES.ValidationRegistry, VALIDATION_REGISTRY_ABI),
      riskRouter:         make(ADDRESSES.RiskRouter,          RISK_ROUTER_ABI),
      reputationManager:  make(ADDRESSES.ReputationManager,   REPUTATION_MANAGER_ABI),
    };
  }, [signer, provider]);

  // ── Helper: register agent on-chain ──────────────────────────────────────
  const registerAgentOnChain = async (name, strategy, endpoint) => {
    if (!contracts.agentRegistry) throw new Error("AgentRegistry not connected");
    const tx = await contracts.agentRegistry.registerAgent(name, strategy, endpoint);
    return tx.wait();
  };

  // ── Helper: get agent trust score ────────────────────────────────────────
  const getTrustScore = async (agentId) => {
    if (!contracts.agentRegistry) return null;
    const score = await contracts.agentRegistry.getTrustScore(agentId);
    return Number(score);
  };

  // ── Helper: get agent info ────────────────────────────────────────────────
  const getAgentInfo = async (agentId) => {
    if (!contracts.agentRegistry) return null;
    const result = await contracts.agentRegistry.getAgent(agentId);
    return {
      name:             result[0],
      strategy:         result[1],
      owner:            result[2],
      trustScore:       Number(result[3]),
      active:           result[4],
      totalTrades:      Number(result[5]),
      profitableTrades: Number(result[6]),
    };
  };

  // ── Helper: get agent nonce from RiskRouter ───────────────────────────────
  const getAgentNonce = async (agentId) => {
    if (!contracts.riskRouter) return null;
    const nonce = await contracts.riskRouter.getAgentNonce(agentId);
    return Number(nonce);
  };

  // ── Helper: get validation from registry ─────────────────────────────────
  const getValidation = async (tradeId) => {
    if (!contracts.validationRegistry) return null;
    const result = await contracts.validationRegistry.getValidation(tradeId);
    return {
      agentId:         Number(result[0]),
      reason:          result[1],
      confidence:      Number(result[2]),
      riskCheck:       result[3],
      timestamp:       Number(result[4]),
      outcomeRecorded: result[5],
      profitable:      result[6],
      pnlBps:          Number(result[7]),
    };
  };

  return (
    <ContractContext.Provider value={{
      contracts,
      addresses: ADDRESSES,
      registerAgentOnChain,
      getTrustScore,
      getAgentInfo,
      getAgentNonce,
      getValidation,
    }}>
      {children}
    </ContractContext.Provider>
  );
}

export const useContracts = () => useContext(ContractContext);