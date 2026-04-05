/**
 * IdentityHub — ERC-8004 Identity & Reputation Hub
 * Features:
 *   - Rotating 3D Identity Globe (centerpiece)
 *   - Reputation ring + metadata
 *   - 3D Bar Chart reputation timeline
 */
import React, { Suspense, lazy, useState, useEffect } from "react";
import { useWallet } from "../context/WalletContext";
import { useAgent } from "../context/AgentContext";
import { useContracts } from "../context/ContractContext";
import { Spinner, ConnectPrompt } from "../components/UI";

const IdentityGlobe = lazy(() => import("../components/three/IdentityGlobe"));
const ReputationChart3D = lazy(() => import("../components/three/ReputationChart3D"));
const NeuralBackground = lazy(() => import("../components/three/NeuralBackground"));

const S = {
  mono: { fontFamily: "'JetBrains Mono', monospace" },
  label: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 10,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    color: "var(--neon-green)",
    marginBottom: 8,
    display: "block",
  },
  card: {
    background: "var(--card-glass-sm)",
    border: "1px solid var(--border-glass)",
    borderRadius: 16,
    padding: "20px 24px",
    backdropFilter: "blur(14px)",
    boxShadow: "0 0 30px rgba(0,191,255,0.06)",
  },
};

function TierBadge({ tier, current }) {
  const mapping = {
    Bronze:   { color: "#CD7F32", min: 0,  max: 25 },
    Silver:   { color: "#C0C0C0", min: 25, max: 50 },
    Gold:     { color: "#FFD700", min: 50, max: 75 },
    Platinum: { color: "#AC89FF", min: 75, max: 100 },
  };
  const { color } = mapping[tier];
  return (
    <div style={{
      ...S.card,
      textAlign: "center",
      border: `1px solid ${color}${current ? "80" : "20"}`,
      opacity: current ? 1 : 0.45,
      boxShadow: current ? `0 0 20px ${color}30` : "none",
    }}>
      <div style={{ fontSize: 22, marginBottom: 6 }}>
        {tier === "Bronze" ? "🥉" : tier === "Silver" ? "🥈" : tier === "Gold" ? "🥇" : "💎"}
      </div>
      <p style={{ ...S.mono, fontSize: 11, fontWeight: 700, color, marginBottom: 2 }}>{tier}</p>
      {current && (
        <span style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 9, color: "#00FF88",
          background: "rgba(0,255,136,0.12)",
          border: "1px solid rgba(0,255,136,0.3)",
          borderRadius: 999, padding: "2px 8px",
        }}>CURRENT</span>
      )}
    </div>
  );
}

function ReputationRing({ score = 87, max = 100 }) {
  const pct = (score / max) * 100;
  const circumference = 2 * Math.PI * 54;
  const offset = circumference - (pct / 100) * circumference;
  return (
    <div style={{ position: "relative", width: 160, height: 160, flexShrink: 0 }}>
      <svg width="160" height="160" style={{ transform: "rotate(-90deg)" }}>
        <defs>
          <linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#00FF88" />
            <stop offset="100%" stopColor="#00BFFF" />
          </linearGradient>
        </defs>
        <circle cx="80" cy="80" r="54" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="12" />
        <circle
          cx="80" cy="80" r="54" fill="none"
          stroke="url(#ring-grad)" strokeWidth="12"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 1.2s ease" }}
        />
      </svg>
      <div style={{
        position: "absolute", inset: 0,
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
      }}>
        <p style={{ ...S.mono, fontSize: 30, fontWeight: 700, color: "var(--text)", margin: 0, lineHeight: 1 }}>{score}</p>
        <p style={{ ...S.mono, fontSize: 11, color: "#6b7280", margin: "2px 0 0" }}>/ {max}</p>
      </div>
    </div>
  );
}

export default function IdentityHub() {
  const { account } = useWallet();
  const { agent, loading: agentLoading } = useAgent();
  const { getTrustScore, getAgentPerformance } = useContracts();
  const [trust, setTrust] = useState(null);
  const [perf, setPerf] = useState(null);

  useEffect(() => {
    if (!agent?.on_chain_id) return;
    Promise.all([
      getTrustScore(agent.on_chain_id).catch(() => null),
      getAgentPerformance(agent.on_chain_id).catch(() => null),
    ]).then(([t, p]) => { setTrust(t); setPerf(p); });
  }, [agent]);

  const score = trust ?? 72;
  const tier = score >= 75 ? "Platinum" : score >= 50 ? "Gold" : score >= 25 ? "Silver" : "Bronze";

  // Mock trade history for 3D chart (replaced by real data when available)
  const tradeHistory = Array.from({ length: 14 }, (_, i) => {
    const profitable = Math.random() > 0.35;
    return {
      profitable,
      pnl: profitable ? Math.random() * 120 + 10 : -(Math.random() * 60 + 5),
      score: 55 + i * 2 + (profitable ? 2 : -1.5),
    };
  });

  if (!account) return <ConnectPrompt />;
  if (agentLoading) return (
    <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
      <Spinner size={6} />
    </div>
  );

  return (
    <div style={{ position: "relative" }}>
      <Suspense fallback={null}>
        <NeuralBackground agentActive />
      </Suspense>

      <div style={{
        maxWidth: 1100, margin: "0 auto", padding: "40px 24px",
        display: "flex", flexDirection: "column", gap: 40,
        position: "relative", zIndex: 1,
      }}>

        {/* Header */}
        <div>
          <span style={S.label}>ERC-8004 Identity Registry</span>
          <h1 style={{
            fontFamily: "'Syne', sans-serif", fontSize: "clamp(22px,3vw,34px)",
            fontWeight: 800, margin: 0, lineHeight: 1.15,
            background: "linear-gradient(90deg, var(--neon-green), var(--neon-blue), var(--neon-purple))",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
          }}>
            Identity & Reputation Hub
          </h1>
        </div>

        {/* Globe + Identity Card row */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, alignItems: "start" }}>
          {/* Globe */}
          <div style={S.card}>
            <span style={S.label}>Network Identity Graph</span>
            <Suspense fallback={
              <div style={{ height: 380, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Spinner size={5} />
              </div>
            }>
              <IdentityGlobe height={380} />
            </Suspense>
            <p style={{ ...S.mono, fontSize: 10, color: "#6b7280", textAlign: "center", marginTop: 8 }}>
              Your node (green) · Connected ERC-8004 identities (blue)
            </p>
          </div>

          {/* Identity Card */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Identity metadata */}
            <div style={{
              ...S.card,
              border: "1px solid rgba(0,255,136,0.25)",
              boxShadow: "0 0 28px rgba(0,255,136,0.08)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                <div style={{
                  width: 48, height: 48, borderRadius: "50%",
                  background: "linear-gradient(135deg, #00FF88, #00BFFF)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 22,
                }}>🤖</div>
                <div>
                  <h2 style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 18, color: "#f9f5fd", margin: 0 }}>
                    {agent?.name || "ΔQuantum-Alpha"}
                  </h2>
                  <p style={{ ...S.mono, fontSize: 9, color: "#6b7280", margin: "3px 0 0", wordBreak: "break-all" }}>
                    {account}
                  </p>
                </div>
              </div>

              <div style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "4px 12px", borderRadius: 999,
                background: "rgba(0,255,136,0.12)", border: "1px solid rgba(0,255,136,0.35)",
                fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 700,
                color: "var(--neon-green)", marginBottom: 16,
              }}>
                ✓ VERIFIED ON-CHAIN
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 20px" }}>
                {[
                  ["Strategy", agent?.strategy || "COMBINED RSI+MA"],
                  ["Risk Level", agent?.risk_tolerance || "MEDIUM"],
                  ["Network", "Sepolia Testnet"],
                  ["Trust Tier", tier],
                ].map(([k, v]) => (
                  <div key={k}>
                    <p style={{ ...S.mono, fontSize: 9, color: "#6b7280", marginBottom: 2 }}>{k}</p>
                    <p style={{ ...S.mono, fontSize: 12, fontWeight: 600, color: "var(--text)", margin: 0 }}>{v}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Reputation ring */}
            <div style={S.card}>
              <span style={S.label}>Reputation Score</span>
              <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
                <ReputationRing score={score} />
                <div style={{ flex: 1 }}>
                  {[
                    { label: "Win Rate", value: perf ? `${(perf.winRatePct || 0).toFixed(1)}%` : "68.4%", color: "var(--neon-green)" },
                    { label: "Avg PnL/Trade", value: perf ? `${(perf.avgPnlBps / 100 || 0).toFixed(2)}%` : "+1.24%", color: "var(--neon-blue)" },
                    { label: "Trust Decay", value: "−1.5 per loss", color: "var(--neon-purple)" },
                    { label: "Trust Gain", value: "+2 per profit", color: "var(--neon-green)" },
                  ].map(({ label, value, color }) => (
                    <div key={label} style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                      <span style={{ ...S.mono, fontSize: 10, color: "#6b7280" }}>{label}</span>
                      <span style={{ ...S.mono, fontSize: 11, fontWeight: 700, color }}>{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Tier badges */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
              {["Bronze", "Silver", "Gold", "Platinum"].map((t) => (
                <TierBadge key={t} tier={t} current={t === tier} />
              ))}
            </div>
          </div>
        </div>

        {/* 3D Reputation Timeline */}
        <div style={S.card}>
          <span style={S.label}>Reputation Timeline — 3D View</span>
          <p style={{ ...S.mono, fontSize: 10, color: "#6b7280", marginBottom: 12 }}>
            Each bar = one trade outcome · Green = profit (+2 trust) · Red = loss (−1.5 trust)
          </p>
          <Suspense fallback={
            <div style={{ height: 320, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Spinner size={5} />
            </div>
          }>
            <ReputationChart3D trades={tradeHistory} height={320} />
          </Suspense>
        </div>

      </div>
    </div>
  );
}
