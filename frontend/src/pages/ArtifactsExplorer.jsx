/**
 * ArtifactsExplorer — Validation Artifacts Explorer
 * Shows a live feed of validation artifacts rendered as floating 3D cubes.
 * Filterable by artifact type.
 */
import React, { Suspense, lazy, useState, useEffect, useRef } from "react";
import { useWallet } from "../context/WalletContext";
import { ConnectPrompt } from "../components/UI";

const ArtifactCard = lazy(() => import("../components/three/ArtifactCube"));
const NeuralBackground = lazy(() => import("../components/three/NeuralBackground"));

const FILTERS = ["ALL", "TRADE_INTENT", "RISK_CHECK", "STRATEGY_CHECKPOINT", "REPUTATION_UPDATE"];

const FILTER_LABELS = {
  ALL: "All",
  TRADE_INTENT: "Trade Intent",
  RISK_CHECK: "Risk Check",
  STRATEGY_CHECKPOINT: "Strategy",
  REPUTATION_UPDATE: "Reputation",
};

const FILTER_COLORS = {
  ALL: "var(--text)",
  TRADE_INTENT: "var(--neon-blue)",
  RISK_CHECK: "var(--yellow)",
  STRATEGY_CHECKPOINT: "var(--neon-purple)",
  REPUTATION_UPDATE: "var(--neon-green)",
};

// Mock artifact generator (replace with real API call)
function generateMockArtifacts(count = 12) {
  const types = ["TRADE_INTENT", "RISK_CHECK", "STRATEGY_CHECKPOINT", "REPUTATION_UPDATE"];
  const pairs = ["ETH/USDC", "BTC/USDC", "LINK/USDC", "MATIC/USDC", "UNI/USDC"];
  const statuses = {
    TRADE_INTENT: ["EXECUTED", "REJECTED"],
    RISK_CHECK: ["PASSED", "FAILED"],
    STRATEGY_CHECKPOINT: ["RECORDED"],
    REPUTATION_UPDATE: ["APPLIED"],
  };

  return Array.from({ length: count }, (_, i) => {
    const type = types[Math.floor(Math.random() * types.length)];
    const status = statuses[type][Math.floor(Math.random() * statuses[type].length)];
    const profitable = status === "EXECUTED" || status === "PASSED";
    const now = new Date(Date.now() - i * 47000);
    return {
      id: `artifact-${i}`,
      type,
      status,
      txHash: `0x${Math.random().toString(16).slice(2, 10)}...${Math.random().toString(16).slice(2, 6)}`,
      timestamp: now.toISOString().replace("T", " ").slice(0, 19) + " UTC",
      pair: type === "TRADE_INTENT" ? pairs[Math.floor(Math.random() * pairs.length)] : undefined,
      amount: type === "TRADE_INTENT" ? (Math.random() * 400 + 50).toFixed(0) : undefined,
      confidence: type === "TRADE_INTENT" ? Math.floor(Math.random() * 40 + 50) : undefined,
    };
  });
}

const S = {
  mono: { fontFamily: "'JetBrains Mono', monospace" },
  label: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 10, fontWeight: 600,
    textTransform: "uppercase", letterSpacing: "0.12em",
    color: "var(--neon-green)", marginBottom: 8, display: "block",
  },
};

export default function ArtifactsExplorer() {
  const { account } = useWallet();
  const [activeFilter, setActiveFilter] = useState("ALL");
  const [artifacts, setArtifacts] = useState([]);
  const [search, setSearch] = useState("");
  const intervalRef = useRef(null);

  useEffect(() => {
    setArtifacts(generateMockArtifacts(12));
    // Simulate new artifact dropping in every 8s
    intervalRef.current = setInterval(() => {
      setArtifacts((prev) => {
        const types = ["TRADE_INTENT", "RISK_CHECK", "STRATEGY_CHECKPOINT"];
        const type = types[Math.floor(Math.random() * types.length)];
        const newArtifact = {
          id: `artifact-live-${Date.now()}`,
          type,
          status: type === "TRADE_INTENT" ? "EXECUTED" : "PASSED",
          txHash: `0x${Math.random().toString(16).slice(2, 10)}...${Math.random().toString(16).slice(2, 6)}`,
          timestamp: new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC",
          pair: type === "TRADE_INTENT" ? "ETH/USDC" : undefined,
          amount: type === "TRADE_INTENT" ? "342" : undefined,
          confidence: type === "TRADE_INTENT" ? 78 : undefined,
          isNew: true,
        };
        return [newArtifact, ...prev.slice(0, 19)];
      });
    }, 8000);
    return () => clearInterval(intervalRef.current);
  }, []);

  if (!account) return <ConnectPrompt />;

  const filtered = artifacts.filter((a) => {
    const matchesFilter = activeFilter === "ALL" || a.type === activeFilter;
    const matchesSearch = !search || a.txHash.includes(search) || (a.pair || "").includes(search.toUpperCase());
    return matchesFilter && matchesSearch;
  });

  const counts = {
    ALL: artifacts.length,
    TRADE_INTENT: artifacts.filter((a) => a.type === "TRADE_INTENT").length,
    RISK_CHECK: artifacts.filter((a) => a.type === "RISK_CHECK").length,
    STRATEGY_CHECKPOINT: artifacts.filter((a) => a.type === "STRATEGY_CHECKPOINT").length,
    REPUTATION_UPDATE: artifacts.filter((a) => a.type === "REPUTATION_UPDATE").length,
  };

  return (
    <div style={{ position: "relative" }}>
      <Suspense fallback={null}>
        <NeuralBackground agentActive />
      </Suspense>

      <div style={{
        maxWidth: 1100, margin: "0 auto", padding: "40px 24px",
        display: "flex", flexDirection: "column", gap: 32,
        position: "relative", zIndex: 1,
      }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <span style={S.label}>Cryptographic Proof Layer</span>
            <h1 style={{
              fontFamily: "'Syne', sans-serif", fontSize: "clamp(22px,3vw,34px)",
              fontWeight: 800, margin: 0, lineHeight: 1.15,
              background: "linear-gradient(90deg, #00FF88, #00BFFF)",
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
            }}>
              Validation Artifacts
            </h1>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--neon-green)", animation: "pdot 2s ease-in-out infinite", display: "inline-block" }} />
            <span style={{ ...S.mono, fontSize: 11, color: "var(--neon-green)", fontWeight: 700 }}>{artifacts.length} ARTIFACTS</span>
          </div>
        </div>

        {/* Stats row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
          {[
          { label: "Total", value: counts.ALL, color: "var(--text)" },
            { label: "Trade Intents", value: counts.TRADE_INTENT, color: "var(--neon-blue)" },
            { label: "Risk Checks", value: counts.RISK_CHECK, color: "var(--yellow)" },
            { label: "Checkpoints", value: counts.STRATEGY_CHECKPOINT, color: "var(--neon-purple)" },
          ].map(({ label, value, color }) => (
            <div key={label} style={{
              background: "var(--card-glass-sm)", border: "1px solid rgba(255,255,255,0.07)",
              borderRadius: 12, padding: "14px 16px",
              backdropFilter: "blur(12px)",
            }}>
              <p style={{ ...S.mono, fontSize: 9, color: "#6b7280", marginBottom: 4 }}>{label.toUpperCase()}</p>
              <p style={{ fontFamily: "'Syne', sans-serif", fontSize: 22, fontWeight: 800, color, margin: 0 }}>{value}</p>
            </div>
          ))}
        </div>

        {/* Filter bar + search */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {FILTERS.map((f) => {
              const active = activeFilter === f;
              const color = FILTER_COLORS[f];
              return (
                <button
                  key={f}
                  onClick={() => setActiveFilter(f)}
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 10, fontWeight: 700,
                    padding: "6px 14px", borderRadius: 999,
                    border: `1px solid ${active ? color : "rgba(255,255,255,0.1)"}`,
                    background: active ? `${color}22` : "var(--card-glass-sm)",
                    color: active ? color : "var(--dim)",
                    cursor: "pointer",
                    transition: "all 0.15s",
                  }}
                >
                  {FILTER_LABELS[f]} {counts[f] > 0 && `(${counts[f]})`}
                </button>
              );
            })}
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tx hash or pair..."
            style={{
              flex: 1, minWidth: 180, padding: "7px 14px",
              borderRadius: 10, border: "1px solid rgba(255,255,255,0.1)",
              background: "rgba(0,0,0,0.4)", color: "var(--text)",
              fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
              outline: "none",
            }}
          />
        </div>

        {/* Artifact feed */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {filtered.length === 0 ? (
            <div style={{
              textAlign: "center", padding: "48px 0",
              fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: "var(--dim)",
            }}>
              No artifacts match your filters.
            </div>
          ) : (
            <Suspense fallback={null}>
              {filtered.map((artifact, i) => (
                <ArtifactCard
                  key={artifact.id}
                  type={artifact.type}
                  txHash={artifact.txHash}
                  timestamp={artifact.timestamp}
                  status={artifact.status}
                  pair={artifact.pair}
                  amount={artifact.amount}
                  confidence={artifact.confidence}
                  isNew={artifact.isNew}
                  index={i}
                />
              ))}
            </Suspense>
          )}
        </div>
      </div>
    </div>
  );
}
