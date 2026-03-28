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

  // ════════════════════════════════════════════════════════════════════════════
  // AgentRegistry helpers
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Register a new AI trading agent.
   * Contract now requires a tokenURI (4th arg) for ERC-721 metadata.
   */
  const registerAgentOnChain = async (name, strategy, endpoint, tokenURI = "") => {
    if (!contracts.agentRegistry) throw new Error("AgentRegistry not connected");
    const tx = await contracts.agentRegistry.registerAgent(name, strategy, endpoint, tokenURI);
    const receipt = await tx.wait();
    // Parse agentId from AgentRegistered event
    const iface = contracts.agentRegistry.interface;
    const event = receipt.logs
      .map(log => { try { return iface.parseLog(log); } catch { return null; } })
      .find(e => e?.name === "AgentRegistered");
    return {
      receipt,
      agentId: event ? Number(event.args.agentId) : null,
    };
  };

  /** Deactivate an agent (must be called by agent owner). */
  const deactivateAgent = async (agentId) => {
    if (!contracts.agentRegistry) throw new Error("AgentRegistry not connected");
    const tx = await contracts.agentRegistry.deactivateAgent(agentId);
    return tx.wait();
  };

  /** Get full agent info. */
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

  /** Get agent trust score (0–100). */
  const getTrustScore = async (agentId) => {
    if (!contracts.agentRegistry) return null;
    const score = await contracts.agentRegistry.getTrustScore(agentId);
    return Number(score);
  };

  /** Get all agent IDs owned by an address. */
  const getAgentsByOwner = async (ownerAddress) => {
    if (!contracts.agentRegistry) return [];
    const ids = await contracts.agentRegistry.getAgentsByOwner(ownerAddress);
    return ids.map(Number);
  };

  /** Total number of agents registered. */
  const getTotalAgents = async () => {
    if (!contracts.agentRegistry) return 0;
    const total = await contracts.agentRegistry.totalAgents();
    return Number(total);
  };

  /** ERC-721: get tokenURI for a given agentId. */
  const getTokenURI = async (agentId) => {
    if (!contracts.agentRegistry) return null;
    return contracts.agentRegistry.tokenURI(agentId);
  };

  /**
   * EIP-1271: validate a signature against a specific agent's owner.
   * Handles both EOA (ECDSA) and contract wallets (Safe, AA) automatically.
   * @param {number|string} agentId
   * @param {string} hash   - bytes32 hex string (EIP-712 digest)
   * @param {string} sig    - hex signature bytes
   */
  const isValidAgentSignature = async (agentId, hash, sig) => {
    if (!contracts.agentRegistry) return false;
    return contracts.agentRegistry.isValidAgentSignature(agentId, hash, sig);
  };

  // ════════════════════════════════════════════════════════════════════════════
  // RiskRouter helpers
  // ════════════════════════════════════════════════════════════════════════════

  /** Get current nonce for an agent (used when building TradeIntent). */
  const getAgentNonce = async (agentId) => {
    if (!contracts.riskRouter) return null;
    const nonce = await contracts.riskRouter.getAgentNonce(agentId);
    return Number(nonce);
  };

  /** Check if a trade hash has already been processed (replay protection). */
  const isTradeProcessed = async (tradeHash) => {
    if (!contracts.riskRouter) return false;
    return contracts.riskRouter.isTradeProcessed(tradeHash);
  };

  /**
   * Build and sign a TradeIntent, then submit it to the RiskRouter.
   *
   * New contract signature:
   *   submitTrade(TradeIntent calldata intent, bytes calldata signature)
   *
   * TradeIntent now includes DEX execution fields:
   *   tokenIn, tokenOut, amountIn, amountOutMin (pass zero/address(0) for off-chain execution)
   *
   * @param {object} intent - TradeIntent fields
   * @param {string} intent.agentId
   * @param {string} intent.tokenPair      - e.g. "ETH/USDC"
   * @param {string} intent.action         - "BUY" | "SELL"
   * @param {string|number} intent.amountUsd  - in USD cents
   * @param {number} intent.confidence     - 0-100
   * @param {string} intent.reason
   * @param {string} [intent.tokenIn]      - ERC-20 address or address(0)
   * @param {string} [intent.tokenOut]     - ERC-20 address or address(0)
   * @param {string|number} [intent.amountIn]     - token amount (0 = off-chain)
   * @param {string|number} [intent.amountOutMin] - slippage min (0 = off-chain)
   */
  const submitTradeIntent = async (intent) => {
    if (!contracts.riskRouter) throw new Error("RiskRouter not connected");
    if (!signer) throw new Error("Wallet not connected");

    const chainId = (await signer.provider.getNetwork()).chainId;
    const nonce   = await getAgentNonce(intent.agentId);
    const deadline = Math.floor(Date.now() / 1000) + 300; // 5 min

    const ZERO_ADDR = ethers.constants.AddressZero;

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

    // EIP-712 domain — must match RiskRouter constructor
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

    // Sign via EIP-712 (_signTypedData handles both EOA and injected wallets)
    const signature = await signer._signTypedData(domain, types, tradeIntent);

    const tx = await contracts.riskRouter.submitTrade(tradeIntent, signature);
    const receipt = await tx.wait();

    // Parse result from events
    const iface = contracts.riskRouter.interface;
    const approvedEvent = receipt.logs
      .map(log => { try { return iface.parseLog(log); } catch { return null; } })
      .find(e => e?.name === "TradeApproved");
    const rejectedEvent = receipt.logs
      .map(log => { try { return iface.parseLog(log); } catch { return null; } })
      .find(e => e?.name === "TradeRejected");

    return {
      receipt,
      approved:  !!approvedEvent,
      rejected:  !!rejectedEvent,
      tradeHash: approvedEvent?.args?.tradeHash || rejectedEvent?.args?.tradeHash || null,
      reason:    rejectedEvent?.args?.reason || null,
    };
  };

  // ════════════════════════════════════════════════════════════════════════════
  // ValidationRegistry helpers
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Store a validation with an EIP-712 signed artifact.
   *
   * New contract requirement: caller must sign the ValidationArtifact struct
   * and pass the signature. This is verified on-chain.
   *
   * @param {number}  agentId
   * @param {string}  tradeId      - off-chain UUID
   * @param {string}  reason
   * @param {number}  confidence   - 0-100
   * @param {string}  riskCheck    - "passed" | "failed"
   */
  const storeValidation = async (agentId, tradeId, reason, confidence, riskCheck) => {
    if (!contracts.validationRegistry) throw new Error("ValidationRegistry not connected");
    if (!signer) throw new Error("Wallet not connected");

    const chainId   = (await signer.provider.getNetwork()).chainId;
    const timestamp = Math.floor(Date.now() / 1000);
    const validator = await signer.getAddress();

    // EIP-712 domain — must match ValidationRegistry constructor
    const domain = {
      name:              "AITradingValidation",
      version:           "1",
      chainId,
      verifyingContract: ADDRESSES.ValidationRegistry,
    };

    const types = {
      ValidationArtifact: [
        { name: "agentId",    type: "uint256" },
        { name: "tradeId",    type: "string"  },
        { name: "confidence", type: "uint256" },
        { name: "riskCheck",  type: "string"  },
        { name: "timestamp",  type: "uint256" },
        { name: "validator",  type: "address" },
      ],
    };

    const value = { agentId, tradeId, confidence, riskCheck, timestamp, validator };
    const validatorSig = await signer._signTypedData(domain, types, value);

    const tx = await contracts.validationRegistry.storeValidation(
      agentId, tradeId, reason, confidence, riskCheck, validatorSig
    );
    return tx.wait();
  };

  /** Get stored validation data. */
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

  /**
   * Get the raw EIP-712 artifact stored for a validation.
   * Returns validator address, raw signature bytes, and artifact hash.
   */
  const getValidationArtifact = async (tradeId) => {
    if (!contracts.validationRegistry) return null;
    const result = await contracts.validationRegistry.getValidationArtifact(tradeId);
    return {
      validator:    result[0],
      validatorSig: result[1],
      artifactHash: result[2],
    };
  };

  /**
   * Re-verify a stored artifact entirely on-chain.
   * Returns true if the validator signature is still valid.
   */
  const verifyValidationArtifact = async (tradeId) => {
    if (!contracts.validationRegistry) return false;
    return contracts.validationRegistry.verifyValidationArtifact(tradeId);
  };

  /** Get all trade IDs for an agent. */
  const getAgentTradeIds = async (agentId) => {
    if (!contracts.validationRegistry) return [];
    return contracts.validationRegistry.getAgentTradeIds(agentId);
  };

  /** Get total trade count for an agent. */
  const getAgentTradeCount = async (agentId) => {
    if (!contracts.validationRegistry) return 0;
    const count = await contracts.validationRegistry.getAgentTradeCount(agentId);
    return Number(count);
  };

  // ════════════════════════════════════════════════════════════════════════════
  // ReputationManager helpers
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Update reputation via ValidationRegistry (requires prior storeValidation call).
   * Now callable by RiskRouter or any authorized caller, not just owner.
   */
  const updateReputation = async (agentId, tradeId, profitable, pnlBps) => {
    if (!contracts.reputationManager) throw new Error("ReputationManager not connected");
    const tx = await contracts.reputationManager.updateReputation(
      agentId, tradeId, profitable, pnlBps
    );
    return tx.wait();
  };

  /**
   * Direct reputation update — no ValidationRegistry entry required.
   * Used for automated flows triggered by RiskRouter.
   */
  const updateReputationDirect = async (agentId, profitable, pnlBps, confidence) => {
    if (!contracts.reputationManager) throw new Error("ReputationManager not connected");
    const tx = await contracts.reputationManager.updateReputationDirect(
      agentId, profitable, pnlBps, confidence
    );
    return tx.wait();
  };

  /** Get current trust score via ReputationManager. */
  const getTrustScoreViaManager = async (agentId) => {
    if (!contracts.reputationManager) return null;
    const score = await contracts.reputationManager.getTrustScore(agentId);
    return Number(score);
  };

  /** Get full trade history for an agent. */
  const getAgentHistory = async (agentId) => {
    if (!contracts.reputationManager) return [];
    const history = await contracts.reputationManager.getAgentHistory(agentId);
    return history.map(h => ({
      agentId:    Number(h.agentId),
      tradeId:    h.tradeId,
      profitable: h.profitable,
      pnlBps:     Number(h.pnlBps),
      confidence: Number(h.confidence),
      timestamp:  Number(h.timestamp),
    }));
  };

  /**
   * Get all performance stats for leaderboard display.
   * Includes drawdown, win rate, and Sharpe proxy inputs.
   *
   * @returns {object}
   *   peakPnlBps       - highest cumulative PnL ever reached
   *   currentPnlBps    - current cumulative PnL
   *   maxDrawdownBps   - maximum peak-to-trough drawdown (abs bps)
   *   avgPnlBps        - average per-trade PnL
   *   winRate          - win rate × 10000 (e.g. 6750 = 67.50%)
   *   tradeCount       - total settled trades
   *   sumSquaredPnlBps - for off-chain Sharpe ratio stdDev calculation
   *   sharpeProxy      - avgPnlBps / stdDev estimate (computed here client-side)
   */
  const getAgentPerformance = async (agentId) => {
    if (!contracts.reputationManager) return null;
    const result = await contracts.reputationManager.getAgentPerformance(agentId);

    const peakPnlBps       = Number(result[0]);
    const currentPnlBps    = Number(result[1]);
    const maxDrawdownBps   = Number(result[2]);
    const avgPnlBps        = Number(result[3]);
    const winRate          = Number(result[4]);      // e.g. 6750 = 67.50%
    const tradeCount       = Number(result[5]);
    const sumSquaredPnlBps = Number(result[6]);

    // Client-side Sharpe proxy: avg / stdDev
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
      winRatePct:    winRate / 100,        // e.g. 67.50
      tradeCount,
      sumSquaredPnlBps,
      sharpeProxy,
    };
  };

  // ════════════════════════════════════════════════════════════════════════════
  // Context value
  // ════════════════════════════════════════════════════════════════════════════

  return (
    <ContractContext.Provider value={{
      contracts,
      addresses: ADDRESSES,

      // AgentRegistry
      registerAgentOnChain,
      deactivateAgent,
      getAgentInfo,
      getTrustScore,
      getAgentsByOwner,
      getTotalAgents,
      getTokenURI,
      isValidAgentSignature,

      // RiskRouter
      getAgentNonce,
      isTradeProcessed,
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