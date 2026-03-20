import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useWallet } from "./WalletContext";
import { getAgent, registerAgent } from "../utils/api";

const AgentContext = createContext(null);

export function AgentProvider({ children }) {
  const { account } = useWallet();
  const [agent,    setAgent]    = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);

  // ── Fetch agent when wallet connects ─────────────────────────────────────
  const fetchAgent = useCallback(async () => {
    if (!account) { setAgent(null); return; }
    setLoading(true);
    setError(null);
    try {
      const data = await getAgent(account);
      setAgent(data);
    } catch (e) {
      // 404 means not registered yet — not an error
      if (e.response?.status === 404) setAgent(null);
      else setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [account]);

  useEffect(() => { fetchAgent(); }, [fetchAgent]);

  // ── Register agent ────────────────────────────────────────────────────────
  const register = async (name, strategy, riskTolerance, maxTradeUsd) => {
    setLoading(true);
    setError(null);
    try {
      const data = await registerAgent({
        wallet_address: account,
        name,
        strategy,
        risk_tolerance: riskTolerance,
        max_trade_usd:  parseFloat(maxTradeUsd),
      });
      setAgent(data);
      return data;
    } catch (e) {
      setError(e.response?.data?.detail || e.message);
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