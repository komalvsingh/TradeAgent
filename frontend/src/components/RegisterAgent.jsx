import React, { useState, useCallback } from "react";
import { useAgent }     from "../context/AgentContext";
import { useContracts } from "../context/ContractContext";
import { useWallet }    from "../context/WalletContext";
import { linkChainId }  from "../utils/api";

// ─────────────────────────────────────────────────────────────────────────────
// Static data
// ─────────────────────────────────────────────────────────────────────────────

const STRATEGIES = [
  { value: "COMBINED",     label: "Combined (RSI + MA + Sentiment)" },
  { value: "RSI",          label: "RSI Only"                        },
  { value: "MA_CROSSOVER", label: "MA Crossover"                    },
  { value: "SENTIMENT",    label: "Sentiment Only"                  },
];

const RISK_LEVELS = [
  { value: "LOW",    label: "Low"    },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH",   label: "High"   },
];

const STEP_DEFS = [
  { id: "contract", label: "AgentRegistry TX" },
  { id: "event",    label: "Get Agent ID"     },
  { id: "backend",  label: "Save to Backend"  },
  { id: "done",     label: "Ready"            },
];

// ─────────────────────────────────────────────────────────────────────────────
// Design tokens  (mirrors IdentityHub's inline style objects)
// ─────────────────────────────────────────────────────────────────────────────

const T = {
  mono: { fontFamily: "'JetBrains Mono', monospace" },

  label: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 10,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    color: "var(--neon-green)",
    marginBottom: 6,
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

  fieldLabel: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 10,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    color: "#6b7280",
    marginBottom: 5,
    display: "block",
  },

  input: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 13,
    width: "100%",
    padding: "9px 12px",
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 10,
    color: "var(--text)",
    outline: "none",
    transition: "border-color 0.2s, box-shadow 0.2s",
  },

  inputFocus: {
    borderColor: "rgba(0,255,136,0.35)",
    boxShadow: "0 0 0 3px rgba(0,255,136,0.08)",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Small primitives
// ─────────────────────────────────────────────────────────────────────────────

function Label({ children }) {
  return <span style={T.label}>{children}</span>;
}

function FieldLabel({ children }) {
  return <span style={T.fieldLabel}>{children}</span>;
}

function Field({ label, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <FieldLabel>{label}</FieldLabel>
      {children}
    </div>
  );
}

function StyledInput({ value, onChange, type = "text", placeholder, disabled, autoFocus }) {
  const [focused, setFocused] = useState(false);
  return (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        ...T.input,
        ...(focused ? T.inputFocus : {}),
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "not-allowed" : "text",
      }}
    />
  );
}

function StyledSelect({ value, onChange, options, disabled }) {
  const [focused, setFocused] = useState(false);
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        ...T.input,
        ...(focused ? T.inputFocus : {}),
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
        appearance: "none",
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%236b7280' d='M6 8L1 3h10z'/%3E%3C/svg%3E\")",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "right 12px center",
        paddingRight: 32,
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} style={{ background: "#1a1a2e" }}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step progress bar  (mirrors IdentityHub's StepBar in IdentityGlobe section)
// ─────────────────────────────────────────────────────────────────────────────

const STEP_COLORS = {
  done:    { dot: "#00FF88", label: "#00FF88" },
  pending: { dot: "#F5A623", label: "#F5A623" },
  error:   { dot: "#E24B4A", label: "#E24B4A" },
  null:    { dot: "rgba(255,255,255,0.12)", label: "#6b7280" },
};

function StepBar({ steps }) {
  return (
    <div style={{ display: "flex", alignItems: "center", width: "100%", margin: "16px 0 4px" }}>
      {STEP_DEFS.map((s, i) => {
        const st     = steps[s.id];
        const colors = STEP_COLORS[st] ?? STEP_COLORS[null];
        return (
          <React.Fragment key={s.id}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 70 }}>
              {/* Dot */}
              <div style={{
                width: 10, height: 10,
                borderRadius: "50%",
                background: colors.dot,
                transition: "all 0.3s ease",
                boxShadow: st === "done"    ? `0 0 8px ${colors.dot}80`
                         : st === "pending" ? `0 0 8px ${colors.dot}60`
                         : "none",
                animation: st === "pending" ? "stepPulse 1.2s ease-in-out infinite" : "none",
              }} />
              {/* Label */}
              <span style={{
                ...T.mono,
                fontSize: 9,
                marginTop: 5,
                textAlign: "center",
                lineHeight: 1.3,
                color: colors.label,
                transition: "color 0.3s",
              }}>
                {s.label}
              </span>
            </div>

            {i < STEP_DEFS.length - 1 && (
              <div style={{
                flex: 1,
                height: 1,
                background: steps[s.id] === "done"
                  ? "rgba(0,255,136,0.3)"
                  : "rgba(255,255,255,0.07)",
                marginBottom: 14,
                transition: "background 0.4s",
                minWidth: 8,
              }} />
            )}
          </React.Fragment>
        );
      })}

      <style>{`
        @keyframes stepPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.45; transform: scale(0.75); }
        }
      `}</style>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Buttons
// ─────────────────────────────────────────────────────────────────────────────

function PrimaryBtn({ onClick, loading, disabled, children }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        ...T.mono,
        width: "100%",
        padding: "11px 20px",
        fontSize: 13,
        fontWeight: 700,
        borderRadius: 12,
        border: "1px solid rgba(0,255,136,0.4)",
        background: hovered && !disabled && !loading
          ? "rgba(0,255,136,0.18)"
          : "rgba(0,255,136,0.1)",
        color: (disabled || loading) ? "rgba(0,255,136,0.4)" : "var(--neon-green)",
        cursor: (disabled || loading) ? "not-allowed" : "pointer",
        transition: "all 0.2s",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        letterSpacing: "0.04em",
        boxShadow: hovered && !disabled && !loading
          ? "0 0 20px rgba(0,255,136,0.15)"
          : "none",
      }}
    >
      {loading && <Spinner color="var(--neon-green)" />}
      {children}
    </button>
  );
}

function SecondaryBtn({ onClick, disabled, children }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        ...T.mono,
        width: "100%",
        padding: "10px 20px",
        fontSize: 12,
        fontWeight: 600,
        borderRadius: 12,
        border: "1px solid rgba(0,191,255,0.25)",
        background: hovered ? "rgba(0,191,255,0.08)" : "transparent",
        color: disabled ? "rgba(0,191,255,0.3)" : "var(--neon-blue)",
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "all 0.2s",
        letterSpacing: "0.04em",
      }}
    >
      {children}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Spinner
// ─────────────────────────────────────────────────────────────────────────────

function Spinner({ color = "var(--neon-green)", size = 14 }) {
  return (
    <>
      <div style={{
        width: size, height: size,
        borderRadius: "50%",
        border: `2px solid transparent`,
        borderTopColor: color,
        animation: "spin 0.7s linear infinite",
        flexShrink: 0,
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Status message  (info / success / error)
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_STYLES = {
  info: {
    color: "#F5A623",
    border: "1px solid rgba(245,166,35,0.2)",
    background: "rgba(245,166,35,0.06)",
  },
  success: {
    color: "#00FF88",
    border: "1px solid rgba(0,255,136,0.2)",
    background: "rgba(0,255,136,0.06)",
  },
  error: {
    color: "#E24B4A",
    border: "1px solid rgba(226,75,74,0.2)",
    background: "rgba(226,75,74,0.06)",
  },
};

function StatusMsg({ type = "info", children }) {
  return (
    <div style={{
      ...T.mono,
      ...STATUS_STYLES[type],
      fontSize: 11,
      lineHeight: 1.65,
      padding: "10px 13px",
      borderRadius: 10,
    }}>
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Chain ID badge  (mirrors IdentityHub's "VERIFIED ON-CHAIN" pill)
// ─────────────────────────────────────────────────────────────────────────────

function ChainBadge({ agentId }) {
  return (
    <div style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      padding: "5px 12px",
      borderRadius: 999,
      background: "rgba(0,191,255,0.1)",
      border: "1px solid rgba(0,191,255,0.3)",
      ...T.mono,
      fontSize: 10,
      fontWeight: 700,
      color: "var(--neon-blue)",
    }}>
      {/* Animated pulse dot */}
      <span style={{
        display: "inline-block",
        width: 6, height: 6,
        borderRadius: "50%",
        background: "var(--neon-blue)",
        boxShadow: "0 0 6px var(--neon-blue)",
        animation: "chainPulse 2s ease-in-out infinite",
      }} />
      ⛓ On-chain Agent ID: #{agentId}
      <style>{`
        @keyframes chainPulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Success banner  (shown when done === "done")
// ─────────────────────────────────────────────────────────────────────────────

function SuccessBanner() {
  return (
    <div style={{
      ...T.mono,
      textAlign: "center",
      padding: "12px 16px",
      borderRadius: 12,
      background: "rgba(0,255,136,0.08)",
      border: "1px solid rgba(0,255,136,0.25)",
      fontSize: 12,
      fontWeight: 700,
      color: "var(--neon-green)",
      letterSpacing: "0.06em",
      boxShadow: "0 0 24px rgba(0,255,136,0.08)",
    }}>
      ✓ AGENT REGISTERED SUCCESSFULLY
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Divider
// ─────────────────────────────────────────────────────────────────────────────

function Divider() {
  return <div style={{ height: 1, background: "rgba(255,255,255,0.06)", margin: "16px 0" }} />;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export default function RegisterAgent() {
  const { register }             = useAgent();
  const { registerAgentOnChain } = useContracts();
  const { account }              = useWallet();

  const [name,     setName]     = useState("");
  const [strategy, setStrategy] = useState("COMBINED");
  const [risk,     setRisk]     = useState("MEDIUM");
  const [maxTrade, setMaxTrade] = useState("500");

  const [busy,           setBusy]           = useState(false);
  const [error,          setError]          = useState(null);
  const [statusMsg,      setStatus]         = useState(null);
  const [agentId,        setAgentId]        = useState(null);
  const [pendingChainId, setPendingChainId] = useState(null);
  const [steps,          setSteps]          = useState({
    contract: null, event: null, backend: null, done: null,
  });

  const setStep = useCallback(
    (id, status) => setSteps((prev) => ({ ...prev, [id]: status })),
    []
  );

  const resetFlow = () => {
    setError(null);
    setStatus(null);
    setAgentId(null);
    setPendingChainId(null);
    setSteps({ contract: null, event: null, backend: null, done: null });
  };

  // ── Registration flow ──────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!name.trim()) { setError("Agent name is required."); return; }
    if (!account)     { setError("Wallet not connected."); return; }

    setBusy(true);
    resetFlow();

    let resolvedChainId = null;

    try {
      // Step 1 & 2 — On-chain
      setStep("contract", "pending");
      setStatus("MetaMask opening — approve the transaction to register your agent on-chain…");

      try {
        const { agentId: id } = await registerAgentOnChain(
          name.trim(),
          strategy,
          account,
          "",
        );

        setStep("contract", "done");
        setStep("event", "pending");

        if (id != null) {
          resolvedChainId = id;
          setAgentId(id);
          setStep("event", "done");
          setStatus(`On-chain registered! Agent ID: #${id}. Saving to backend…`);
        } else {
          setStep("event", "error");
          setStatus(
            "TX confirmed but could not read Agent ID from event. " +
            "Saving to backend — you can link the chain ID from Dashboard."
          );
        }
      } catch (contractErr) {
        if (
          contractErr.code === 4001 ||
          contractErr.message?.includes("user rejected") ||
          contractErr.message?.includes("User denied") ||
          contractErr.code === "ACTION_REJECTED"
        ) {
          setStep("contract", "error");
          setError("Registration cancelled — MetaMask transaction rejected.");
          setBusy(false);
          return;
        }

        console.warn("On-chain registration failed:", contractErr.message);
        setStep("contract", "error");
        setStep("event",    "error");
        setStatus(
          "On-chain step failed (contract not deployed or wrong network). " +
          "Saving to backend only — you can register on-chain later from Dashboard."
        );
      }

      // Step 3 — Backend
      setStep("backend", "pending");
      setStatus("Saving agent to backend…");

      try {
        await register(name.trim(), strategy, risk, maxTrade, resolvedChainId);
        setStep("backend", "done");
        setStep("done",    "done");
        setStatus(
          resolvedChainId != null
            ? `Agent registered! On-chain ID: #${resolvedChainId}. MetaMask will open on every trade.`
            : "Agent saved to backend. Register on-chain from Dashboard to enable blockchain trading."
        );
      } catch (backendErr) {
        setStep("backend", "error");
        if (resolvedChainId != null) {
          setPendingChainId(resolvedChainId);
          setError(
            `Backend save failed: ${backendErr.response?.data?.detail || backendErr.message}. ` +
            `Your on-chain Agent ID is #${resolvedChainId}. ` +
            `Click "Retry Backend Save" to link it without re-opening MetaMask.`
          );
        } else {
          setError(backendErr.response?.data?.detail || backendErr.message);
        }
      }
    } finally {
      setBusy(false);
    }
  };

  // ── Retry backend link ─────────────────────────────────────────────────────
  const handleRetryBackend = async () => {
    if (!pendingChainId) return;
    setBusy(true);
    setError(null);
    setStatus("Retrying backend save…");
    setStep("backend", "pending");

    try {
      await register(name.trim(), strategy, risk, maxTrade, pendingChainId);
      setStep("backend", "done");
      setStep("done",    "done");
      setPendingChainId(null);
      setStatus(`Agent registered! On-chain ID: #${pendingChainId}.`);
    } catch {
      try {
        await linkChainId(account, pendingChainId);
        setStep("backend", "done");
        setStep("done",    "done");
        setPendingChainId(null);
        setStatus(`Agent linked! On-chain ID: #${pendingChainId}.`);
      } catch (linkErr) {
        setStep("backend", "error");
        setError(linkErr.response?.data?.detail || linkErr.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const showStepBar = Object.values(steps).some((s) => s !== null);
  const isDone      = steps.done === "done";

  return (
    <div style={{ maxWidth: 460, width: "100%" }}>
      <div style={{
        ...T.card,
        // Accent top border — matches IdentityHub verified card
        borderTop: "1px solid rgba(0,255,136,0.25)",
        boxShadow: "0 0 40px rgba(0,255,136,0.06), 0 0 80px rgba(0,191,255,0.04)",
      }}>

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          {/* Avatar — identical to IdentityHub's agent icon */}
          <div style={{
            width: 44, height: 44,
            borderRadius: "50%",
            background: "linear-gradient(135deg, #00FF88, #00BFFF)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 20, flexShrink: 0,
          }}>
            🤖
          </div>
          <div>
            <h2 style={{
              fontFamily: "'Syne', sans-serif",
              fontWeight: 800,
              fontSize: 18,
              color: "var(--text)",
              margin: 0,
              lineHeight: 1.2,
            }}>
              Register Agent
            </h2>
            <p style={{ ...T.mono, fontSize: 9, color: "#6b7280", margin: "3px 0 0" }}>
              AgentRegistry · Sepolia Testnet
            </p>
          </div>
        </div>

        {/* ── MetaMask info banner ────────────────────────────────────────── */}
        <div style={{
          ...T.mono,
          fontSize: 11,
          lineHeight: 1.65,
          padding: "10px 13px",
          borderRadius: 10,
          background: "rgba(0,191,255,0.06)",
          border: "1px solid rgba(0,191,255,0.15)",
          color: "#60a5fa",
          marginBottom: 20,
        }}>
          Clicking <strong style={{ color: "var(--text)" }}>Register</strong> will open MetaMask
          to approve a gas transaction on Sepolia. This writes your agent to the{" "}
          <span style={{ color: "var(--text)" }}>AgentRegistry</span> contract — required for
          EIP-712 signed trades and ValidationRegistry audit logs.
        </div>

        <Divider />

        {/* ── Form fields ────────────────────────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 4 }}>

          <Field label="Agent Name">
            <StyledInput
              value={name}
              onChange={setName}
              placeholder="e.g. AlphaBot"
              disabled={busy || isDone}
              autoFocus
            />
          </Field>

          <Field label="Strategy">
            <StyledSelect
              value={strategy}
              onChange={setStrategy}
              options={STRATEGIES}
              disabled={busy || isDone}
            />
          </Field>

          {/* Two-column row */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Risk Tolerance">
              <StyledSelect
                value={risk}
                onChange={setRisk}
                options={RISK_LEVELS}
                disabled={busy || isDone}
              />
            </Field>
            <Field label="Max Trade (USD)">
              <StyledInput
                type="number"
                value={maxTrade}
                onChange={setMaxTrade}
                placeholder="500"
                disabled={busy || isDone}
              />
            </Field>
          </div>
        </div>

        {/* ── Step progress bar ───────────────────────────────────────────── */}
        {showStepBar && <StepBar steps={steps} />}

        {/* ── Status message ──────────────────────────────────────────────── */}
        {statusMsg && !error && (
          <div style={{ marginTop: 12 }}>
            <StatusMsg type={isDone ? "success" : "info"}>
              {statusMsg}
            </StatusMsg>
          </div>
        )}

        {/* ── On-chain ID badge ───────────────────────────────────────────── */}
        {agentId != null && (
          <div style={{ marginTop: 10 }}>
            <ChainBadge agentId={agentId} />
          </div>
        )}

        {/* ── Error ──────────────────────────────────────────────────────── */}
        {error && (
          <div style={{ marginTop: 12 }}>
            <StatusMsg type="error">{error}</StatusMsg>
          </div>
        )}

        {/* ── Actions ────────────────────────────────────────────────────── */}
        <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 8 }}>
          {!isDone ? (
            <>
              <PrimaryBtn onClick={handleSubmit} loading={busy} disabled={busy}>
                {busy ? "Registering…" : "Register Agent"}
              </PrimaryBtn>

              {pendingChainId != null && !busy && (
                <SecondaryBtn onClick={handleRetryBackend}>
                  Retry Backend Save — Chain ID #{pendingChainId}
                </SecondaryBtn>
              )}
            </>
          ) : (
            <SuccessBanner />
          )}
        </div>

      </div>
    </div>
  );
}

// ── Note: add linkChainId to ../utils/api.js ──────────────────────────────
//
// export const linkChainId = (walletAddress, onChainId) =>
//   axios.patch(`/agents/${walletAddress}/link-chain`, null, {
//     params: { on_chain_id: onChainId },
//   }).then(r => r.data);