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
  AgentRegistry:      import.meta.env.VITE_AGENT_REGISTRY_ADDRESS      || "",
  ValidationRegistry: import.meta.env.VITE_VALIDATION_REGISTRY_ADDRESS  || "",
  RiskRouter:         import.meta.env.VITE_RISK_ROUTER_ADDRESS           || "",
  ReputationManager:  import.meta.env.VITE_REPUTATION_MANAGER_ADDRESS    || "",
};

// ── Ethers version guard ─────────────────────────────────────────────────────
const ZERO_ADDR =
  ethers.ZeroAddress ??
  ethers.constants?.AddressZero;

const toNumber = (val) => {
  if (val === undefined || val === null) return 0;
  if (typeof val === "bigint") return Number(val);
  if (typeof val?.toNumber === "function") return val.toNumber();
  return Number(val);
};

const ContractContext = createContext(null);

export function ContractProvider({ children }) {
  const { signer, provider } = useWallet();

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

  // ══════════════════════════════════════════════════════════════════════════
  // AgentRegistry helpers
  // ══════════════════════════════════════════════════════════════════════════

  const registerAgentOnChain = async (name, strategy, endpoint, tokenURI = "") => {
    if (!contracts.agentRegistry) {
      throw new Error(
        "AgentRegistry contract not connected. " +
        "Check your VITE_AGENT_REGISTRY_ADDRESS env var and that you are on Sepolia."
      );
    }
    if (!signer) throw new Error("Wallet not connected");

    const tx      = await contracts.agentRegistry.registerAgent(name, strategy, endpoint, tokenURI);
    const receipt = await tx.wait();

    let agentId = null;
    try {
      const iface = contracts.agentRegistry.interface;

      if (receipt.events?.length) {
        const ev = receipt.events.find((e) => e.event === "AgentRegistered");
        if (ev?.args?.agentId !== undefined) {
          agentId = toNumber(ev.args.agentId);
        }
      }

      if (agentId === null && receipt.logs?.length) {
        for (const log of receipt.logs) {
          try {
            const parsed = iface.parseLog({ topics: log.topics, data: log.data });
            if (parsed?.name === "AgentRegistered") {
              agentId = toNumber(parsed.args.agentId);
              break;
            }
          } catch { /* skip */ }
        }
      }
    } catch (parseErr) {
      console.warn("Could not parse AgentRegistered event:", parseErr.message);
    }

    return { receipt, agentId };
  };

  // FIX (AgentRegistry): contract owner can now also deactivate any agent
  // (emergencyDeactivate). This helper calls the standard deactivateAgent —
  // the contract will accept both agent-owner and contract-owner callers.
  const deactivateAgent = async (agentId) => {
    if (!contracts.agentRegistry) throw new Error("AgentRegistry not connected");
    const tx = await contracts.agentRegistry.deactivateAgent(agentId);
    return tx.wait();
  };

  // Explicit emergency path — only works if the caller is the contract owner.
  const emergencyDeactivateAgent = async (agentId) => {
    if (!contracts.agentRegistry) throw new Error("AgentRegistry not connected");
    const tx = await contracts.agentRegistry.emergencyDeactivate(agentId);
    return tx.wait();
  };

  const getAgentInfo = async (agentId) => {
    if (!contracts.agentRegistry) return null;
    const result = await contracts.agentRegistry.getAgent(agentId);
    return {
      name:             result[0],
      strategy:         result[1],
      owner:            result[2],
      trustScore:       toNumber(result[3]),
      active:           result[4],
      totalTrades:      toNumber(result[5]),
      profitableTrades: toNumber(result[6]),
    };
  };

  const getTrustScore = async (agentId) => {
    if (!contracts.agentRegistry) return null;
    const score = await contracts.agentRegistry.getTrustScore(agentId);
    return toNumber(score);
  };

  const getAgentsByOwner = async (ownerAddress) => {
    if (!contracts.agentRegistry) return [];
    const ids = await contracts.agentRegistry.getAgentsByOwner(ownerAddress);
    return ids.map(toNumber);
  };

  const getTotalAgents = async () => {
    if (!contracts.agentRegistry) return 0;
    const total = await contracts.agentRegistry.totalAgents();
    return toNumber(total);
  };

  const getTokenURI = async (agentId) => {
    if (!contracts.agentRegistry) return null;
    return contracts.agentRegistry.tokenURI(agentId);
  };

  const isValidAgentSignature = async (agentId, hash, sig) => {
    if (!contracts.agentRegistry) return false;
    return contracts.agentRegistry.isValidAgentSignature(agentId, hash, sig);
  };

  // ══════════════════════════════════════════════════════════════════════════
  // RiskRouter helpers
  // ══════════════════════════════════════════════════════════════════════════

  const getAgentNonce = async (agentId) => {
    if (!contracts.riskRouter) return null;
    const nonce = await contracts.riskRouter.getAgentNonce(agentId);
    return toNumber(nonce);
  };

  const isTradeProcessed = async (tradeHash) => {
    if (!contracts.riskRouter) return false;
    return contracts.riskRouter.isTradeProcessed(tradeHash);
  };

  // FIX (RiskRouter): Added getAgentDailyStats — now exposed since the contract
  // has the view function and totalLossUsd is actually populated.
  const getAgentDailyStats = async (agentId) => {
    if (!contracts.riskRouter) return null;
    const result = await contracts.riskRouter.getAgentDailyStats(agentId);
    return {
      date:          toNumber(result[0]),
      totalLossUsd:  toNumber(result[1]),
      tradeCount:    toNumber(result[2]),
    };
  };

  const submitTradeIntent = async (intent) => {
    if (!contracts.riskRouter) throw new Error("RiskRouter not connected");
    if (!signer) throw new Error("Wallet not connected");

    const network  = await signer.provider.getNetwork();
    const chainId  = toNumber(network.chainId);
    const nonce    = await getAgentNonce(intent.agentId);
    const deadline = Math.floor(Date.now() / 1000) + 300;

    const tradeIntent = {
      agentId:      intent.agentId,
      tokenPair:    intent.tokenPair,
      action:       intent.action,
      amountUsd:    intent.amountUsd,
      confidence:   intent.confidence,
      reason:       intent.reason,
      nonce,
      deadline,
      tokenIn:      intent.tokenIn      || ZERO_ADDR,
      tokenOut:     intent.tokenOut     || ZERO_ADDR,
      amountIn:     intent.amountIn     || 0,
      amountOutMin: intent.amountOutMin || 0,
    };

    const domain = {
      name:              "AITradingAgent",
      version:           "1",
      chainId,
      verifyingContract: ADDRESSES.RiskRouter,
    };

    const types = {
      TradeIntent: [
        { name: "agentId",      type: "uint256" },
        { name: "tokenPair",    type: "string"  },
        { name: "action",       type: "string"  },
        { name: "amountUsd",    type: "uint256" },
        { name: "confidence",   type: "uint256" },
        { name: "reason",       type: "string"  },
        { name: "nonce",        type: "uint256" },
        { name: "deadline",     type: "uint256" },
        { name: "tokenIn",      type: "address" },
        { name: "tokenOut",     type: "address" },
        { name: "amountIn",     type: "uint256" },
        { name: "amountOutMin", type: "uint256" },
      ],
    };

    const signature = await (
      typeof signer.signTypedData === "function"
        ? signer.signTypedData(domain, types, tradeIntent)   // ethers v6
        : signer._signTypedData(domain, types, tradeIntent)  // ethers v5
    );

    const tx      = await contracts.riskRouter.submitTrade(tradeIntent, signature);
    const receipt = await tx.wait();

    const iface       = contracts.riskRouter.interface;
    let approvedEvent = null;
    let rejectedEvent = null;

    for (const log of receipt.logs || []) {
      try {
        const parsed = iface.parseLog({ topics: log.topics, data: log.data });
        if (parsed?.name === "TradeApproved") approvedEvent = parsed;
        if (parsed?.name === "TradeRejected") rejectedEvent = parsed;
      } catch { /* skip foreign logs */ }
    }

    return {
      receipt,
      approved:  !!approvedEvent,
      rejected:  !!rejectedEvent,
      tradeHash: approvedEvent?.args?.tradeHash || rejectedEvent?.args?.tradeHash || null,
      reason:    rejectedEvent?.args?.reason || null,
    };
  };

  // ══════════════════════════════════════════════════════════════════════════
  // ValidationRegistry helpers
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * FIX (ValidationRegistry — timestamp bug):
   *
   * The fixed contract accepts a caller-supplied `timestamp` (7th arg before
   * validatorSig) and verifies the sig against a hash built from that timestamp.
   * This means signing and verification now use the same inputs and ecrecover
   * always recovers the correct address.
   *
   * Signing uses personal_sign / signMessage (prefix-aware) because the contract's
   * _verifySignatureWithPrefix prepends "\x19Ethereum Signed Message:\n32".
   *
   * Flow:
   *   1. Get current timestamp from latest block (same reference the contract
   *      allows within ±10 min tolerance).
   *   2. Call computeArtifactHash() view to get the exact bytes32 to sign.
   *   3. Sign with signer.signMessage(bytes) — this uses personal_sign which
   *      adds the prefix the contract expects. No eth_sign needed.
   *   4. Submit storeValidation(..., timestamp, sig) — 7 args.
   */
  const storeValidation = async (agentId, tradeId, reason, confidence, riskCheck) => {
    if (!contracts.validationRegistry) throw new Error("ValidationRegistry not connected");
    if (!signer) throw new Error("Wallet not connected");

    const validator = await signer.getAddress();

    // Step 1: Get timestamp from the chain (within the contract's ±10 min window).
    const latestBlock = await signer.provider.getBlock("latest");
    const timestamp   = latestBlock.timestamp;

    // Step 2: Compute the exact artifact hash the contract will verify against.
    // We use the provider (read-only) — no MetaMask popup here.
    const artifactHash = await contracts.validationRegistry.computeArtifactHash(
      agentId,
      tradeId,
      confidence,
      riskCheck,
      timestamp,
      validator
    );

    // Step 3: Sign with personal_sign (signMessage).
    // The contract uses _verifySignatureWithPrefix which prepends
    // "\x19Ethereum Signed Message:\n32", matching personal_sign exactly.
    // ethers v6: getBytes(); ethers v5: arrayify()
    const hashBytes = ethers.getBytes
      ? ethers.getBytes(artifactHash)          // ethers v6
      : ethers.utils.arrayify(artifactHash);   // ethers v5

    const validatorSig = await signer.signMessage(hashBytes);

    // Step 4: Submit — 7 args (fixed contract adds `timestamp` before validatorSig).
    const tx = await contracts.validationRegistry.storeValidation(
      agentId, tradeId, reason, confidence, riskCheck, timestamp, validatorSig
    );
    return tx.wait();
  };

  const getValidation = async (tradeId) => {
    if (!contracts.validationRegistry) return null;
    const result = await contracts.validationRegistry.getValidation(tradeId);
    return {
      agentId:         toNumber(result[0]),
      reason:          result[1],
      confidence:      toNumber(result[2]),
      riskCheck:       result[3],
      timestamp:       toNumber(result[4]),
      outcomeRecorded: result[5],
      profitable:      result[6],
      pnlBps:          toNumber(result[7]),
    };
  };

  const getValidationArtifact = async (tradeId) => {
    if (!contracts.validationRegistry) return null;
    const result = await contracts.validationRegistry.getValidationArtifact(tradeId);
    return {
      validator:    result[0],
      validatorSig: result[1],
      artifactHash: result[2],
    };
  };

  const verifyValidationArtifact = async (tradeId) => {
    if (!contracts.validationRegistry) return false;
    return contracts.validationRegistry.verifyValidationArtifact(tradeId);
  };

  const getAgentTradeIds = async (agentId) => {
    if (!contracts.validationRegistry) return [];
    return contracts.validationRegistry.getAgentTradeIds(agentId);
  };

  const getAgentTradeCount = async (agentId) => {
    if (!contracts.validationRegistry) return 0;
    const count = await contracts.validationRegistry.getAgentTradeCount(agentId);
    return toNumber(count);
  };

  // ══════════════════════════════════════════════════════════════════════════
  // ReputationManager helpers
  // ══════════════════════════════════════════════════════════════════════════

  const updateReputation = async (agentId, tradeId, profitable, pnlBps) => {
    if (!contracts.reputationManager) throw new Error("ReputationManager not connected");
    const tx = await contracts.reputationManager.updateReputation(agentId, tradeId, profitable, pnlBps);
    return tx.wait();
  };

  const updateReputationDirect = async (agentId, profitable, pnlBps, confidence) => {
    if (!contracts.reputationManager) throw new Error("ReputationManager not connected");
    const tx = await contracts.reputationManager.updateReputationDirect(agentId, profitable, pnlBps, confidence);
    return tx.wait();
  };

  const getTrustScoreViaManager = async (agentId) => {
    if (!contracts.reputationManager) return null;
    const score = await contracts.reputationManager.getTrustScore(agentId);
    return toNumber(score);
  };

  const getAgentHistory = async (agentId) => {
    if (!contracts.reputationManager) return [];
    const history = await contracts.reputationManager.getAgentHistory(agentId);
    return history.map((h) => ({
      agentId:    toNumber(h.agentId),
      tradeId:    h.tradeId,
      profitable: h.profitable,
      pnlBps:     toNumber(h.pnlBps),
      confidence: toNumber(h.confidence),
      timestamp:  toNumber(h.timestamp),
    }));
  };

  const getAgentPerformance = async (agentId) => {
    if (!contracts.reputationManager) return null;
    const result = await contracts.reputationManager.getAgentPerformance(agentId);

    const peakPnlBps       = toNumber(result[0]);
    const currentPnlBps    = toNumber(result[1]);
    const maxDrawdownBps   = toNumber(result[2]);
    const avgPnlBps        = toNumber(result[3]);
    const winRate          = toNumber(result[4]);
    const tradeCount       = toNumber(result[5]);
    const sumSquaredPnlBps = toNumber(result[6]);

    let sharpeProxy = null;
    if (tradeCount > 1 && sumSquaredPnlBps > 0) {
      const variance = sumSquaredPnlBps / tradeCount - Math.pow(avgPnlBps, 2);
      const stdDev   = variance > 0 ? Math.sqrt(variance) : 0;
      sharpeProxy    = stdDev > 0 ? avgPnlBps / stdDev : null;
    }

    return {
      peakPnlBps,
      currentPnlBps,
      maxDrawdownBps,
      avgPnlBps,
      winRatePct:    winRate / 100,
      tradeCount,
      sumSquaredPnlBps,
      sharpeProxy,
    };
  };

  // ══════════════════════════════════════════════════════════════════════════
  // Context value
  // ══════════════════════════════════════════════════════════════════════════

  return (
    <ContractContext.Provider value={{
      contracts,
      addresses: ADDRESSES,

      // AgentRegistry
      registerAgentOnChain,
      deactivateAgent,
      emergencyDeactivateAgent,   // NEW — contract owner only
      getAgentInfo,
      getTrustScore,
      getAgentsByOwner,
      getTotalAgents,
      getTokenURI,
      isValidAgentSignature,

      // RiskRouter
      getAgentNonce,
      isTradeProcessed,
      getAgentDailyStats,         // NEW — daily loss now tracked correctly
      submitTradeIntent,

      // ValidationRegistry
      storeValidation,
      getValidation,
      getValidationArtifact,
      verifyValidationArtifact,
      getAgentTradeIds,
      getAgentTradeCount,

      // ReputationManager
      updateReputation,
      updateReputationDirect,
      getTrustScoreViaManager,
      getAgentHistory,
      getAgentPerformance,
    }}>
      {children}
    </ContractContext.Provider>
  );
}

export const useContracts = () => useContext(ContractContext);