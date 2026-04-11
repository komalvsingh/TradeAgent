import React, { useEffect, useState, useCallback, Suspense, lazy } from "react";
import { useWallet }    from "../context/WalletContext";
import { useAgent }     from "../context/AgentContext";
import { useContracts } from "../context/ContractContext";
import { getHistory, replayTrade } from "../utils/api";
import { Spinner, ConnectPrompt } from "../components/UI";
const NeuralBackground = lazy(() => import("../components/three/NeuralBackground"));

// ─────────────────────────────────────────────────────────────────────────────
// Design tokens  (identical system to IdentityHub + RegisterAgent)
// ─────────────────────────────────────────────────────────────────────────────

const T = {
  mono: { fontFamily: "'JetBrains Mono', monospace" },
  syne: { fontFamily: "'Syne', sans-serif" },

  label: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 10,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    color: "var(--neon-green)",
    display: "block",
    marginBottom: 8,
  },

  card: {
    background: "var(--card-glass-sm)",
    border: "1px solid var(--border-glass)",
    borderRadius: 16,
    padding: "20px 24px",
    backdropFilter: "blur(14px)",
    boxShadow: "0 0 30px rgba(0,191,255,0.06)",
  },

  statCard: {
    background: "rgba(13,17,23,0.8)",
    border: "1px solid rgba(0,191,255,0.14)",
    borderRadius: 14,
    padding: "16px 18px",
    backdropFilter: "blur(12px)",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Colour helpers
// ─────────────────────────────────────────────────────────────────────────────

const ACTION_COLOR = {
  BUY:  { bg: "rgba(0,255,136,0.1)",  border: "rgba(0,255,136,0.3)",  text: "#00FF88" },
  SELL: { bg: "rgba(226,75,74,0.1)",  border: "rgba(226,75,74,0.3)",  text: "#E24B4A" },
  HOLD: { bg: "rgba(107,114,128,0.1)",border: "rgba(107,114,128,0.3)",text: "#9ca3af" },
};

const STATUS_COLOR = {
  EXECUTED: { bg: "rgba(0,255,136,0.08)",  border: "rgba(0,255,136,0.25)",  text: "#00FF88" },
  REJECTED: { bg: "rgba(226,75,74,0.08)",  border: "rgba(226,75,74,0.25)",  text: "#E24B4A" },
  PENDING:  { bg: "rgba(245,166,35,0.08)", border: "rgba(245,166,35,0.25)", text: "#F5A623" },
};

const RISK_COLOR = {
  HIGH:   { bg: "rgba(226,75,74,0.08)",  border: "rgba(226,75,74,0.25)",  text: "#E24B4A" },
  MEDIUM: { bg: "rgba(245,166,35,0.08)", border: "rgba(245,166,35,0.25)", text: "#F5A623" },
  LOW:    { bg: "rgba(0,255,136,0.08)",  border: "rgba(0,255,136,0.25)",  text: "#00FF88" },
};

// ─────────────────────────────────────────────────────────────────────────────
// Primitives
// ─────────────────────────────────────────────────────────────────────────────

function Pill({ colors, children }) {
  return (
    <span style={{
      ...T.mono,
      fontSize: 9,
      fontWeight: 700,
      letterSpacing: "0.08em",
      padding: "3px 9px",
      borderRadius: 999,
      background: colors.bg,
      border: `1px solid ${colors.border}`,
      color: colors.text,
      whiteSpace: "nowrap",
    }}>
      {children}
    </span>
  );
}

function Divider({ style }) {
  return <div style={{ height: 1, background: "rgba(255,255,255,0.06)", ...style }} />;
}

function SectionLabel({ children }) {
  return <span style={T.label}>{children}</span>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stat card
// ─────────────────────────────────────────────────────────────────────────────

function StatCard({ label, value, color, sub }) {
  return (
    <div style={T.statCard}>
      <p style={{ ...T.mono, fontSize: 9, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
        {label}
      </p>
      <p style={{ ...T.syne, fontSize: 22, fontWeight: 800, color, margin: 0, lineHeight: 1 }}>
        {value}
      </p>
      {sub && (
        <p style={{ ...T.mono, fontSize: 9, color: "#6b7280", marginTop: 4 }}>{sub}</p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Table header cell
// ─────────────────────────────────────────────────────────────────────────────

function TH({ children, right }) {
  return (
    <th style={{
      ...T.mono,
      fontSize: 9,
      fontWeight: 600,
      textTransform: "uppercase",
      letterSpacing: "0.1em",
      color: "#6b7280",
      padding: "0 12px 12px",
      textAlign: right ? "right" : "left",
      borderBottom: "1px solid rgba(255,255,255,0.06)",
      whiteSpace: "nowrap",
    }}>
      {children}
    </th>
  );
}

function TD({ children, right, style }) {
  return (
    <td style={{
      padding: "11px 12px",
      textAlign: right ? "right" : "left",
      borderBottom: "1px solid rgba(255,255,255,0.04)",
      verticalAlign: "middle",
      ...style,
    }}>
      {children}
    </td>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Proof verification result block  (inside ReplayModal)
// ─────────────────────────────────────────────────────────────────────────────

function ProofResult({ status }) {
  if (!status || status === "checking") return null;

  const cfg = {
    verified:  {
      icon: "✓", color: "#00FF88",
      bg: "rgba(0,255,136,0.06)", border: "rgba(0,255,136,0.2)",
      title: "Artifact Verified",
      sub: "Hash matches · Validator signature valid · ValidationRegistry confirmed",
    },
    invalid: {
      icon: "✕", color: "#E24B4A",
      bg: "rgba(226,75,74,0.06)", border: "rgba(226,75,74,0.2)",
      title: "Artifact Invalid",
      sub: "Hash mismatch or signature invalid — artifact may have been tampered with",
    },
    not_found: {
      icon: "—", color: "#6b7280",
      bg: "rgba(255,255,255,0.03)", border: "rgba(255,255,255,0.08)",
      title: "No Artifact Found",
      sub: "This trade was executed before on-chain validation was enabled",
    },
  }[status];

  if (!cfg) return null;

  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: 10,
      padding: "10px 13px", borderRadius: 10,
      background: cfg.bg, border: `1px solid ${cfg.border}`,
    }}>
      <span style={{ ...T.mono, fontSize: 14, color: cfg.color, lineHeight: 1, flexShrink: 0 }}>
        {cfg.icon}
      </span>
      <div>
        <p style={{ ...T.mono, fontSize: 11, fontWeight: 700, color: cfg.color, margin: 0 }}>
          {cfg.title}
        </p>
        <p style={{ ...T.mono, fontSize: 9, color: "#6b7280", marginTop: 4, lineHeight: 1.5 }}>
          {cfg.sub}
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Replay + Validation Modal
// ─────────────────────────────────────────────────────────────────────────────

function ReplayModal({ tradeId, onClose, verifyValidationArtifact }) {
  const [data,        setData]        = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState(null);
  const [proofStatus, setProofStatus] = useState(null);

  useEffect(() => {
    replayTrade(tradeId)
      .then(setData)
      .catch((e) => setError(e.response?.data?.detail || e.message))
      .finally(() => setLoading(false));
  }, [tradeId]);

  const handleVerify = async () => {
    if (!verifyValidationArtifact) return;
    setProofStatus("checking");
    try {
      const verified = await verifyValidationArtifact(tradeId);
      setProofStatus(verified ? "verified" : "invalid");
    } catch (e) {
      const msg = e.message?.toLowerCase() || "";
      setProofStatus(msg.includes("trade not found") || msg.includes("not found") ? "not_found" : "invalid");
    }
  };

  return (
    /* Overlay */
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.75)",
        backdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 50, padding: 24,
      }}
    >
      {/* Panel — stop propagation so clicking inside doesn't close */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          ...T.card,
          width: "100%", maxWidth: 520,
          maxHeight: "85vh", overflowY: "auto",
          border: "1px solid rgba(0,255,136,0.2)",
          boxShadow: "0 0 60px rgba(0,255,136,0.08), 0 0 120px rgba(0,191,255,0.04)",
          display: "flex", flexDirection: "column", gap: 0,
        }}
      >
        {/* Modal header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16 }}>
          <div>
            <SectionLabel>Replay Trade</SectionLabel>
            <h2 style={{ ...T.syne, fontWeight: 800, fontSize: 18, color: "var(--text)", margin: 0, lineHeight: 1.2 }}>
              Execution Trace
            </h2>
            <p style={{ ...T.mono, fontSize: 9, color: "#6b7280", marginTop: 3, wordBreak: "break-all" }}>
              {tradeId.slice(0, 24)}…
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              ...T.mono, fontSize: 11, fontWeight: 700,
              padding: "6px 12px", borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.1)",
              background: "rgba(255,255,255,0.04)",
              color: "#6b7280", cursor: "pointer",
              transition: "all 0.15s",
              flexShrink: 0,
            }}
            onMouseEnter={(e) => { e.target.style.color = "var(--text)"; e.target.style.borderColor = "rgba(255,255,255,0.2)"; }}
            onMouseLeave={(e) => { e.target.style.color = "#6b7280"; e.target.style.borderColor = "rgba(255,255,255,0.1)"; }}
          >
            ✕ Close
          </button>
        </div>

        <Divider style={{ marginBottom: 16 }} />

        {/* Body */}
        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "40px 0" }}>
            <Spinner size={6} />
          </div>
        ) : error ? (
          <p style={{ ...T.mono, fontSize: 11, color: "#E24B4A" }}>{error}</p>
        ) : data ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

            {/* Steps */}
            {data.steps?.map((step, i) => {
              const done = step.step <= 5;
              return (
                <div key={step.step} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  {/* Step number bubble */}
                  <div style={{
                    width: 26, height: 26, borderRadius: "50%", flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    ...T.mono, fontSize: 10, fontWeight: 700,
                    background: done ? "rgba(0,255,136,0.1)" : "rgba(255,255,255,0.04)",
                    border: `1px solid ${done ? "rgba(0,255,136,0.3)" : "rgba(255,255,255,0.08)"}`,
                    color: done ? "#00FF88" : "#6b7280",
                    boxShadow: done ? "0 0 8px rgba(0,255,136,0.15)" : "none",
                  }}>
                    {step.step}
                  </div>

                  {/* Step content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ ...T.mono, fontSize: 12, fontWeight: 700, color: "var(--text)", margin: 0 }}>
                      {step.title}
                    </p>
                    <p style={{ ...T.mono, fontSize: 10, color: "#6b7280", marginTop: 2, lineHeight: 1.5 }}>
                      {step.description}
                    </p>
                    {step.detail && step.detail !== "N/A" && (
                      <p style={{ ...T.mono, fontSize: 10, marginTop: 3, wordBreak: "break-all" }}>
                        {step.detail.startsWith("0x") ? (
                          <a
                            href={`https://sepolia.etherscan.io/tx/${step.detail}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: "#00BFFF", textDecoration: "none" }}
                            onMouseEnter={(e) => e.target.style.textDecoration = "underline"}
                            onMouseLeave={(e) => e.target.style.textDecoration = "none"}
                          >
                            {step.detail.slice(0, 32)}… ↗
                          </a>
                        ) : (
                          <span style={{ color: "#6b7280" }}>{step.detail}</span>
                        )}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Trade summary grid */}
            {data.summary && (
              <>
                <Divider />
                <div>
                  <p style={{ ...T.mono, fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#6b7280", marginBottom: 10 }}>
                    Trade Summary
                  </p>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    {[
                      { label: "Action",     val: data.summary.action },
                      { label: "Amount",     val: `$${data.summary.amount_usd}` },
                      { label: "PnL",        val: data.summary.pnl != null ? `$${data.summary.pnl?.toFixed(4)}` : "—" },
                      { label: "Risk",       val: data.summary.risk_level },
                      { label: "Confidence", val: `${data.summary.confidence}%` },
                      { label: "Status",     val: data.summary.status },
                    ].map(({ label, val }) => (
                      <div key={label} style={{
                        padding: "8px 11px", borderRadius: 10,
                        background: "rgba(255,255,255,0.03)",
                        border: "1px solid rgba(255,255,255,0.07)",
                      }}>
                        <p style={{ ...T.mono, fontSize: 9, color: "#6b7280", margin: 0 }}>{label}</p>
                        <p style={{ ...T.mono, fontSize: 12, fontWeight: 700, color: "var(--text)", margin: "2px 0 0" }}>{val}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* On-chain proof section */}
            {verifyValidationArtifact && (
              <>
                <Divider />
                <div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                    <p style={{ ...T.mono, fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#6b7280", margin: 0 }}>
                      On-Chain Proof
                    </p>
                    {proofStatus === null && (
                      <VerifyBtn onClick={handleVerify} />
                    )}
                    {proofStatus === "checking" && (
                      <span style={{ display: "flex", alignItems: "center", gap: 6, ...T.mono, fontSize: 10, color: "#F5A623" }}>
                        <Spinner size={3} /> Checking chain…
                      </span>
                    )}
                  </div>
                  <ProofResult status={proofStatus} />
                </div>
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// Small verify button (extracted to keep hover logic clean)
function VerifyBtn({ onClick }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        ...T.mono, fontSize: 10, fontWeight: 700,
        padding: "5px 12px", borderRadius: 8,
        border: `1px solid ${hov ? "rgba(0,191,255,0.4)" : "rgba(255,255,255,0.1)"}`,
        background: hov ? "rgba(0,191,255,0.08)" : "transparent",
        color: hov ? "#00BFFF" : "#6b7280",
        cursor: "pointer", transition: "all 0.15s",
        letterSpacing: "0.04em",
      }}
    >
      Verify Artifact
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Refresh button
// ─────────────────────────────────────────────────────────────────────────────

function RefreshBtn({ onClick, loading }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      disabled={loading}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        ...T.mono, fontSize: 11, fontWeight: 700,
        padding: "8px 16px", borderRadius: 9,
        border: `1px solid ${hov && !loading ? "rgba(0,191,255,0.45)" : "rgba(0,191,255,0.25)"}`,
        background: hov && !loading ? "rgba(0,191,255,0.12)" : "rgba(0,191,255,0.06)",
        color: loading ? "rgba(0,191,255,0.35)" : "#00BFFF",
        cursor: loading ? "not-allowed" : "pointer",
        transition: "all 0.2s",
        display: "flex", alignItems: "center", gap: 6,
        boxShadow: hov && !loading ? "0 0 14px rgba(0,191,255,0.12)" : "none",
      }}
    >
      {loading ? <><Spinner size={3} color="#00BFFF" /> Loading…</> : "↻ Refresh"}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Replay link button (table row)
// ─────────────────────────────────────────────────────────────────────────────

function ReplayBtn({ onClick }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        ...T.mono, fontSize: 10, fontWeight: 700,
        padding: "4px 10px", borderRadius: 7,
        border: `1px solid ${hov ? "rgba(172,137,255,0.4)" : "rgba(172,137,255,0.15)"}`,
        background: hov ? "rgba(172,137,255,0.1)" : "transparent",
        color: hov ? "var(--neon-purple, #AC89FF)" : "#6b7280",
        cursor: "pointer", transition: "all 0.15s",
        letterSpacing: "0.04em",
      }}
    >
      ⟳ replay
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export default function History() {
  const { account }                                     = useWallet();
  const { agent }                                       = useAgent();
  const { getAgentTradeCount, verifyValidationArtifact } = useContracts();

  const [trades,       setTrades]       = useState([]);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState(null);
  const [replayId,     setReplayId]     = useState(null);
  const [lastFetch,    setLastFetch]    = useState(null);
  const [onChainCount, setOnChainCount] = useState(null);

  const fetchHistory = useCallback(async () => {
    if (!account) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getHistory(account);
      setTrades(data);
      setLastFetch(new Date().toLocaleTimeString());
    } catch (e) {
      setError(e.response?.data?.detail || e.message);
    } finally {
      setLoading(false);
    }
  }, [account]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  useEffect(() => {
    if (!agent?.on_chain_id || !getAgentTradeCount) return;
    getAgentTradeCount(Number(agent.on_chain_id))
      .then(setOnChainCount)
      .catch(() => {});
  }, [agent, getAgentTradeCount]);

  if (!account) return <ConnectPrompt />;

  const executedTrades = trades.filter((t) => t.status === "EXECUTED");
  const rejectedTrades = trades.filter((t) => t.status === "REJECTED");
  const totalPnL       = executedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
  const chainGap       = onChainCount != null ? executedTrades.length - onChainCount : null;

  return (
    <div style={{ position: "relative" }}>
      <Suspense fallback={null}>
        <NeuralBackground agentActive={false} />
      </Suspense>

      <div style={{
        maxWidth: 1100, margin: "0 auto",
        padding: "40px 24px",
        position: "relative", zIndex: 1,
        display: "flex", flexDirection: "column", gap: 28,
      }}>

        {/* ── Page header ──────────────────────────────────────────────────── */}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <SectionLabel>Validated Trades</SectionLabel>
            <h1 style={{
              ...T.syne, fontWeight: 800,
              fontSize: "clamp(22px, 3vw, 30px)",
              margin: 0, lineHeight: 1.1,
              background: "linear-gradient(90deg, #00FF88, #00BFFF, #AC89FF)",
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
            }}>
              Trade History
            </h1>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {lastFetch && (
              <span style={{ ...T.mono, fontSize: 9, color: "#6b7280" }}>
                Updated {lastFetch}
              </span>
            )}
            <RefreshBtn onClick={fetchHistory} loading={loading} />
          </div>
        </div>

        {/* ── Summary stat cards ────────────────────────────────────────────── */}
        {trades.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
            <StatCard label="Total"     value={trades.length}                color="#e5e7eb" />
            <StatCard label="Executed"  value={executedTrades.length}        color="#00FF88" />
            <StatCard label="Rejected"  value={rejectedTrades.length}        color="#E24B4A" />
            <StatCard
              label="Total PnL"
              value={`$${totalPnL.toFixed(4)}`}
              color={totalPnL >= 0 ? "#00FF88" : "#E24B4A"}
            />
            <StatCard
              label="On-Chain Validated"
              value={onChainCount != null ? onChainCount : "—"}
              color={chainGap != null && chainGap > 0 ? "#F5A623" : "#00FF88"}
              sub={
                chainGap != null && chainGap > 0
                  ? `${chainGap} without proof`
                  : "ValidationRegistry"
              }
            />
          </div>
        )}

        {/* ── Table / empty / error states ─────────────────────────────────── */}
        {loading && trades.length === 0 ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "60px 0" }}>
            <Spinner size={6} />
          </div>

        ) : error ? (
          <div style={{ ...T.card, borderColor: "rgba(226,75,74,0.25)" }}>
            <p style={{ ...T.mono, fontSize: 11, color: "#E24B4A", marginBottom: 8 }}>{error}</p>
            <button
              onClick={fetchHistory}
              style={{ ...T.mono, fontSize: 10, color: "#6b7280", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
            >
              Retry
            </button>
          </div>

        ) : trades.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 0", ...T.mono, fontSize: 12, color: "#6b7280" }}>
            No trades yet — head to the Trade page to get started.
          </div>

        ) : (
          /* ── Main table card ──────────────────────────────────────────────── */
          <div style={{
            ...T.card,
            padding: 0,
            overflow: "hidden",
            border: "1px solid rgba(0,191,255,0.14)",
          }}>
            {/* Table header bar */}
            <div style={{
              padding: "14px 24px",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
              <span style={{ ...T.mono, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#6b7280" }}>
                {trades.length} trade{trades.length !== 1 ? "s" : ""}
              </span>
              {loading && <Spinner size={3} color="#00BFFF" />}
            </div>

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 780 }}>
                <thead>
                  <tr>
                    <TH>Pair</TH>
                    <TH>Action</TH>
                    <TH right>Amount</TH>
                    <TH right>Confidence</TH>
                    <TH right>PnL</TH>
                    <TH>Risk</TH>
                    <TH>Status</TH>
                    <TH>Chain TX</TH>
                    <TH></TH>
                  </tr>
                </thead>

                <tbody>
                  {trades.map((t, idx) => {
                    const txHash =
                      (t.on_chain_trade_hash?.startsWith("0x") && t.on_chain_trade_hash) ||
                      (t.on_chain_id?.startsWith?.("0x")       && t.on_chain_id)         ||
                      null;

                    const pnlPos = (t.pnl ?? 0) >= 0;

                    return (
                      <tr
                        key={t.id}
                        style={{
                          transition: "background 0.15s",
                          animation: `rowFadeIn 0.3s ease both`,
                          animationDelay: `${idx * 0.03}s`,
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.025)"}
                        onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                      >
                        {/* Pair */}
                        <TD>
                          <span style={{ ...T.mono, fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
                            {t.token_pair}
                          </span>
                        </TD>

                        {/* Action */}
                        <TD>
                          <Pill colors={ACTION_COLOR[t.action] ?? ACTION_COLOR.HOLD}>
                            {t.action}
                          </Pill>
                        </TD>

                        {/* Amount */}
                        <TD right>
                          <span style={{ ...T.mono, fontSize: 12, color: "#9ca3af" }}>
                            ${t.amount_usd?.toFixed(2)}
                          </span>
                        </TD>

                        {/* Confidence */}
                        <TD right>
                          <span style={{ ...T.mono, fontSize: 12, color: "#9ca3af" }}>
                            {t.confidence?.toFixed(0)}%
                          </span>
                        </TD>

                        {/* PnL */}
                        <TD right>
                          <span style={{
                            ...T.mono, fontSize: 12, fontWeight: 700,
                            color: pnlPos ? "#00FF88" : "#E24B4A",
                          }}>
                            {t.pnl != null ? `${pnlPos ? "+" : ""}$${t.pnl.toFixed(4)}` : "—"}
                          </span>
                        </TD>

                        {/* Risk */}
                        <TD>
                          <Pill colors={RISK_COLOR[t.risk_level] ?? RISK_COLOR.MEDIUM}>
                            {t.risk_level}
                          </Pill>
                        </TD>

                        {/* Status */}
                        <TD>
                          <Pill colors={STATUS_COLOR[t.status] ?? STATUS_COLOR.PENDING}>
                            {t.status}
                          </Pill>
                        </TD>

                        {/* Chain TX */}
                        <TD>
                          {txHash ? (
                            <a
                              href={`https://sepolia.etherscan.io/tx/${txHash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ ...T.mono, fontSize: 10, color: "#00BFFF", textDecoration: "none" }}
                              onMouseEnter={(e) => e.target.style.textDecoration = "underline"}
                              onMouseLeave={(e) => e.target.style.textDecoration = "none"}
                            >
                              {txHash.slice(0, 10)}… ↗
                            </a>
                          ) : t.on_chain_approved ? (
                            <span style={{ ...T.mono, fontSize: 10, color: "#00FF88" }}>⛓ approved</span>
                          ) : (
                            <span style={{ ...T.mono, fontSize: 10, color: "#374151" }}>—</span>
                          )}
                        </TD>

                        {/* Replay */}
                        <TD>
                          <ReplayBtn onClick={() => setReplayId(t.id)} />
                        </TD>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Row fade-in keyframe */}
            <style>{`
              @keyframes rowFadeIn {
                from { opacity: 0; transform: translateY(6px); }
                to   { opacity: 1; transform: translateY(0); }
              }
            `}</style>
          </div>
        )}
      </div>

      {/* ── Replay Modal ────────────────────────────────────────────────────── */}
      {replayId && (
        <ReplayModal
          tradeId={replayId}
          onClose={() => setReplayId(null)}
          verifyValidationArtifact={verifyValidationArtifact}
        />
      )}
    </div>
  );
}