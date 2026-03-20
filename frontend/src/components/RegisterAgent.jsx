import React, { useState } from "react";
import { useAgent } from "../context/AgentContext";
import { Card, SectionTitle, ActionBtn, Input } from "./UI";

const STRATEGIES = [
  { value: "COMBINED",    label: "Combined (RSI + MA + Sentiment)" },
  { value: "RSI",         label: "RSI Only" },
  { value: "MA_CROSSOVER",label: "MA Crossover" },
  { value: "SENTIMENT",   label: "Sentiment Only" },
];

const RISK_LEVELS = [
  { value: "LOW",    label: "Low" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH",   label: "High" },
];

export default function RegisterAgent() {
  const { register, loading } = useAgent();
  const [name,      setName]      = useState("AlphaBot");
  const [strategy,  setStrategy]  = useState("COMBINED");
  const [risk,      setRisk]      = useState("MEDIUM");
  const [maxTrade,  setMaxTrade]  = useState("500");
  const [error,     setError]     = useState(null);

  const handleSubmit = async () => {
    if (!name.trim()) { setError("Name required"); return; }
    setError(null);
    try {
      await register(name, strategy, risk, maxTrade);
    } catch (e) {
      setError(e.response?.data?.detail || e.message);
    }
  };

  return (
    <Card className="max-w-md">
      <SectionTitle>Register Agent</SectionTitle>
      <div className="flex flex-col gap-3">
        <Input label="Agent Name" value={name} onChange={setName} placeholder="AlphaBot" />
        <Input label="Strategy" value={strategy} onChange={setStrategy} options={STRATEGIES} />
        <Input label="Risk Tolerance" value={risk} onChange={setRisk} options={RISK_LEVELS} />
        <Input label="Max Trade (USD)" value={maxTrade} onChange={setMaxTrade} type="number" placeholder="500" />

        {error && <p className="text-xs text-red mono">{error}</p>}

        <ActionBtn onClick={handleSubmit} loading={loading}>
          Register Agent
        </ActionBtn>
      </div>
    </Card>
  );
}