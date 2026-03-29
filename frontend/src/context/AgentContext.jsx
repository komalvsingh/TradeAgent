import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useWallet } from "./WalletContext";
import { getAgent, registerAgent } from "../utils/api";

const AgentContext = createContext(null);

export function AgentProvider({ children }) {
  const { account } = useWallet();
  const [agent,   setAgent]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  // ── Fetch agent whenever wallet connects ─────────────────────────────────
  const fetchAgent = useCallback(async () => {
    if (!account) { setAgent(null); return; }
    setLoading(true);
    setError(null);
    try {
      const data = await getAgent(account);
      setAgent(data);
    } catch (e) {
      if (e.response?.status === 404) setAgent(null); // not registered yet — silent
      else setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [account]);

  useEffect(() => { fetchAgent(); }, [fetchAgent]);

  // ── Register agent ────────────────────────────────────────────────────────
  /**
   * Called by RegisterAgent.jsx AFTER a successful on-chain TX.
   *
   * FIX: on_chain_id is now coerced to an integer before sending to the backend.
   * The Pydantic schema declares `on_chain_id: int | None`. If a JS Number
   * with a decimal (e.g. 1.0) or a BigInt leaked through, FastAPI would reject
   * it with a 422. We cast it with Math.trunc() to guarantee a clean integer.
   *
   * FIX: max_trade_usd is parsed with parseFloat and guarded against NaN.
   *
   * @param {string}      name
   * @param {string}      strategy
   * @param {string}      riskTolerance
   * @param {string|number} maxTradeUsd
   * @param {number|null} onChainId  — set after successful AgentRegistry TX
   */
  const register = async (name, strategy, riskTolerance, maxTradeUsd, onChainId = null) => {
    setLoading(true);
    setError(null);
    try {
      const parsedMax = parseFloat(maxTradeUsd);
      if (isNaN(parsedMax)) throw new Error("max_trade_usd must be a valid number");

      const payload = {
        wallet_address: account,
        name,
        strategy,
        risk_tolerance: riskTolerance,
        max_trade_usd:  parsedMax,
      };

      // FIX: only include on_chain_id when it is a valid integer.
      // Math.trunc handles both Number and coerced BigInt values.
      if (onChainId != null && !isNaN(Number(onChainId))) {
        payload.on_chain_id = Math.trunc(Number(onChainId));
      }

      const data = await registerAgent(payload);
      setAgent(data);
      return data;
    } catch (e) {
      const msg = e.response?.data?.detail || e.message;
      setError(msg);
      throw e;
    } finally {
      setLoading(false);
    }
  };

  return (
    <AgentContext.Provider value={{ agent, loading, error, register, refetch: fetchAgent }}>
      {children}
    </AgentContext.Provider>
  );
}

export const useAgent = () => useContext(AgentContext);