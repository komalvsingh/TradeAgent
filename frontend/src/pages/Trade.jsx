import React, { useState, useEffect, useCallback, Suspense, lazy } from "react";
import { useWallet }    from "../context/WalletContext";
import { useAgent }     from "../context/AgentContext";
import { useContracts } from "../context/ContractContext";
import { getDecision, executeTrade, getTokens } from "../utils/api";
import {
  Card, SectionTitle, Badge, ActionBtn,
  Input, Spinner, ConnectPrompt, EmptyState,
} from "../components/UI";
const NeuralBackground = lazy(() => import("../components/three/NeuralBackground"));

const G = {
  card: {
    background: "var(--card-glass)",
    border: "1px solid var(--border-glass)",
    borderRadius: 16,
    padding: "24px",
    backdropFilter: "blur(14px)",
    boxShadow: "0 0 24px rgba(0,191,255,0.05)",
    marginBottom: 20,
  },
  label: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 10, fontWeight: 600,
    textTransform: "uppercase", letterSpacing: "0.12em",
    color: "var(--neon-green)", marginBottom: 12, display: "block",
  },
  h2: {
    fontFamily: "'Syne', sans-serif", fontWeight: 800,
    fontSize: "clamp(18px,2.5vw,26px)", margin: "0 0 20px",
    background: "linear-gradient(90deg,var(--neon-green),var(--neon-blue))",
    WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
  },
  mono: { fontFamily: "'JetBrains Mono', monospace" },
  select: {
    width: "100%", padding: "9px 14px",
    borderRadius: 10, border: "1px solid rgba(0,191,255,0.2)",
    background: "rgba(0,0,0,0.45)", color: "var(--text2)",
    fontFamily: "'JetBrains Mono', monospace", fontSize: 12,
    outline: "none", cursor: "pointer",
  },
};

// ─── Static option lists (labels only, no hardcoded prices or data) ───────────
const STRATEGIES = [
  { value: "COMBINED",     label: "Combined (RSI + MA + Sentiment)" },
  { value: "RSI",          label: "RSI Only"                        },
  { value: "MA_CROSSOVER", label: "MA Crossover"                    },
  { value: "SENTIMENT",    label: "Sentiment Only"                  },
];

const ACTION_OPTIONS = [
  { value: "AI",   label: "Let AI Decide (Recommended)" },
  { value: "BUY",  label: "Force BUY"                   },
  { value: "SELL", label: "Force SELL"                   },
  { value: "HOLD", label: "Force HOLD"                   },
];

// Shown immediately so the dropdown is never empty while backend loads
const FALLBACK_TOKENS = [
  { value: "ethereum",                label: "Ethereum"      },
  { value: "bitcoin",                 label: "Bitcoin"       },
  { value: "polygon-ecosystem-token", label: "Polygon (POL)" },
  { value: "chainlink",               label: "Chainlink"     },
  { value: "uniswap",                 label: "Uniswap"       },
  { value: "aave",                    label: "Aave"          },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function actionColor(a) {
  if (a === "BUY")  return "green";
  if (a === "SELL") return "red";
  return "yellow";
}

function fmtChange(val) {
  if (val == null) return "—";
  return `${val >= 0 ? "+" : ""}${val.toFixed(2)}%`;
}

// ─── Step indicator ───────────────────────────────────────────────────────────
const STEPS = [
  { id: "decision",   label: "AI Decision"      },
  { id: "eip712",     label: "EIP-712 Sign"     },
  { id: "riskrouter", label: "RiskRouter TX"    },
  { id: "backend",    label: "Backend Execute"  },
  { id: "validation", label: "Store Validation" },
];

function StepBar({ steps }) {
  return (
    <div style={{ display: "flex", alignItems: "center", width: "100%", marginBottom: 20, overflowX: "auto", gap: 0 }}>
      {STEPS.map((s, i) => {
        const st = steps[s.id];
        const color =
          st === "done"    ? "var(--neon-green)"  :
          st === "error"   ? "#FF4444"  :
          st === "pending" ? "#FFB800"  :
                             "var(--muted)";
        const textColor =
          st === "done"    ? "var(--neon-green)"  :
          st === "error"   ? "#FF4444"  :
          st === "pending" ? "#FFB800"  :
                             "#6b7280";
        return (
          <React.Fragment key={s.id}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 80 }}>
              <div style={{
                width: 14, height: 14, borderRadius: "50%",
                background: color,
                boxShadow: st && st !== "pending" ? `0 0 10px ${color}80` : "none",
                transition: "all 0.3s",
                animation: st === "pending" ? "pdot 1s ease-in-out infinite" : "none",
              }} />
              <span style={{ ...G.mono, fontSize: 9, marginTop: 6, textAlign: "center", color: textColor }}>
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div style={{ flex: 1, height: 1, background: "rgba(0,191,255,0.2)", minWidth: 12, marginBottom: 14 }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function Trade() {
  const { account, signer }    = useWallet();
  const { agent }              = useAgent();
  const {
    submitTradeIntent,
    storeValidation,
    isTradeProcessed,
    getAgentNonce,
  } = useContracts();

  // ── Form state ──────────────────────────────────────────────────────────────
  const [tokens,     setTokens]    = useState(FALLBACK_TOKENS);
  const [token,      setToken]     = useState("ethereum");
  const [strategy,   setStrategy]  = useState("COMBINED");
  const [actionMode, setActionMode]= useState("AI");

  // ── Flow state ──────────────────────────────────────────────────────────────
  const [decision,   setDecision]  = useState(null);
  const [result,     setResult]    = useState(null);
  const [loading,    setLoading]   = useState(false);
  const [executing,  setExecuting] = useState(false);
  const [error,      setError]     = useState(null);

  const [steps, setSteps] = useState({
    decision:   null,
    eip712:     null,
    riskrouter: null,
    backend:    null,
    validation: null,
  });

  const [chainMeta, setChainMeta] = useState(null);

  // Load dynamic token list from backend
  useEffect(() => {
    getTokens()
      .then((d) => {
        const list = (d.tokens || []).map((t) => ({
          value: t,
          label: t.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        }));
        if (list.length > 0) setTokens(list);
      })
      .catch(() => {});
  }, []);

  const setStep = useCallback((id, status) =>
    setSteps((prev) => ({ ...prev, [id]: status })), []);

  const resetFlow = () => {
    setError(null);
    setResult(null);
    setChainMeta(null);
    setSteps({ decision: null, eip712: null, riskrouter: null, backend: null, validation: null });
  };

  // ── Guards ──────────────────────────────────────────────────────────────────
  if (!account) return <ConnectPrompt />;
  if (!agent)   return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <EmptyState message="Register an agent first on the Dashboard." />
    </div>
  );

  // ── Step 1: Get AI Decision (preview only, no blockchain) ───────────────────
  const handleDecision = async () => {
    setLoading(true);
    resetFlow();
    setDecision(null);
    setStep("decision", "pending");
    try {
      const d = await getDecision({ token, strategy, wallet_address: account });
      setDecision({ ...d, forcedAction: actionMode !== "AI" ? actionMode : null });
      setStep("decision", "done");
    } catch (e) {
      setStep("decision", "error");
      setError(e.response?.data?.detail || e.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Full Execute Flow ────────────────────────────────────────────────────────
  //
  //  1. Get AI decision from backend           → step "decision"
  //  2. EIP-712 sign via MetaMask              → step "eip712"
  //  3. submitTradeIntent() → RiskRouter TX    → step "riskrouter"
  //  4. executeTrade() on backend              → step "backend"
  //  5. storeValidation() → ValidationRegistry → step "validation"
  //
  // CHANGE (storeValidation): The fixed ValidationRegistry contract now requires
  // a caller-supplied `timestamp` (7 args on-chain). However, the fixed
  // ContractContext.storeValidation() still takes only 5 user-facing args —
  // it handles the timestamp internally (reads latest block, calls
  // computeArtifactHash view, then signs with personal_sign). So the call site
  // here is UNCHANGED: storeValidation(agentId, tradeId, reason, confidence, riskCheck).
  //
  // CHANGE (signing): The old context tried eth_sign (raw, no prefix) and fell
  // back to personal_sign. The fixed context always uses personal_sign because
  // the fixed contract's _verifySignatureWithPrefix matches it. No change
  // needed here since we call the context helper, not the signer directly.
  //
  const handleExecute = async () => {
    setExecuting(true);
    resetFlow();

    try {
      // ── 1. AI Decision ──────────────────────────────────────────────────────
      setStep("decision", "pending");
      let preDecision = decision;
      if (!preDecision) {
        preDecision = await getDecision({ token, strategy, wallet_address: account });
      }
      const finalAction = actionMode !== "AI" ? actionMode : preDecision.action;
      setDecision({ ...preDecision, forcedAction: actionMode !== "AI" ? actionMode : null });
      setStep("decision", "done");

      const agentOnChainId = agent.on_chain_id ? Number(agent.on_chain_id) : null;

      // ── 2. EIP-712 Sign + RiskRouter TX ────────────────────────────────────
      let tradeHash       = null;
      let onChainApproved = false;
      let nonce           = null;

      if (agentOnChainId != null && submitTradeIntent) {
        setStep("eip712", "pending");
        try {
          const amountUsdCents = Math.round((preDecision.amount_usd || 0) * 100);
          nonce = await getAgentNonce(agentOnChainId);

          setStep("eip712", "done");
          setStep("riskrouter", "pending");

          const intentResult = await submitTradeIntent({
            agentId:    agentOnChainId,
            tokenPair:  preDecision.token_pair,
            action:     finalAction,
            amountUsd:  amountUsdCents,
            confidence: Math.round(preDecision.confidence || 0),
            reason:     preDecision.reason || "",
          });

          tradeHash       = intentResult.tradeHash;
          onChainApproved = intentResult.approved;

          if (intentResult.rejected) {
            setStep("riskrouter", "error");
            setError(`RiskRouter rejected: ${intentResult.reason || "risk limit exceeded"}`);
            setExecuting(false);
            return;
          }

          setStep("riskrouter", "done");
          setChainMeta({
            tradeHash:   intentResult.tradeHash,
            txHash:      intentResult.receipt?.transactionHash,
            blockNumber: intentResult.receipt?.blockNumber,
            nonce,
            agentOnChainId,
          });

        } catch (chainErr) {
          if (
            chainErr.code === 4001 ||
            chainErr.message?.includes("user rejected") ||
            chainErr.message?.includes("User denied")
          ) {
            setStep("eip712", "error");
            setError("Trade cancelled — MetaMask signature rejected.");
            setExecuting(false);
            return;
          }
          console.warn("On-chain step failed, falling back to backend:", chainErr.message);
          setStep("eip712",     "error");
          setStep("riskrouter", "error");
        }

      } else {
        setStep("eip712",     "done");
        setStep("riskrouter", "done");
      }

      // ── 3. Backend Execution ────────────────────────────────────────────────
      setStep("backend", "pending");
      const r = await executeTrade({
        token,
        strategy,
        wallet_address:      account,
        forced_action:       actionMode !== "AI" ? actionMode : undefined,
        on_chain_trade_hash: tradeHash    || undefined,
        on_chain_approved:   onChainApproved,
        on_chain_nonce:      nonce        ?? undefined,
        agent_on_chain_id:   agentOnChainId ?? undefined,
      });
      setStep("backend", "done");
      setResult(r);

      // ── 4. Store Validation on ValidationRegistry ───────────────────────────
      // CHANGE: storeValidation call args are unchanged (5 user-facing args).
      // The fixed context now internally:
      //   a) reads latest block timestamp
      //   b) calls computeArtifactHash() view with that timestamp
      //   c) signs with personal_sign (prefix-aware) — no longer eth_sign
      //   d) submits 7 args on-chain (agentId, tradeId, reason, confidence,
      //      riskCheck, timestamp, sig)
      // The signing scheme now correctly matches the contract's
      // _verifySignatureWithPrefix, so this will no longer revert with
      // "invalid validator signature".
      if (agentOnChainId != null && storeValidation && r.id) {
        setStep("validation", "pending");
        try {
          await storeValidation(
            agentOnChainId,
            r.id,
            r.reason || preDecision.reason || "",
            Math.round(r.confidence || preDecision.confidence || 0),
            r.risk_check || "passed",
          );
          setStep("validation", "done");
        } catch (valErr) {
          console.warn("Validation store failed:", valErr.message);
          setStep("validation", "error");
        }
      } else {
        setStep("validation", "done");
      }

    } catch (e) {
      setError(e.response?.data?.detail || e.message);
    } finally {
      setExecuting(false);
    }
  };

  // ── Indicator cards ─────────────────────────────────────────────────────────
  const indicatorCards = decision ? [
    {
      label: "RSI (14)",
      val:   decision.indicators?.rsi != null
               ? decision.indicators.rsi.toFixed(1) : null,
      color: decision.indicators?.rsi < 30 ? "text-green"
           : decision.indicators?.rsi > 70 ? "text-red" : "",
    },
    {
      label: "MA7",
      val:   decision.indicators?.ma_7 != null
               ? `$${Number(decision.indicators.ma_7).toLocaleString(undefined,
                   { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : null,
    },
    {
      label: "MA25",
      val:   decision.indicators?.ma_25 != null
               ? `$${Number(decision.indicators.ma_25).toLocaleString(undefined,
                   { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : null,
    },
    {
      label: "Sentiment",
      val:   decision.indicators?.sentiment != null
               ? decision.indicators.sentiment.toFixed(4) : null,
      color: decision.indicators?.sentiment >  0.3 ? "text-green"
           : decision.indicators?.sentiment < -0.3 ? "text-red" : "",
    },
    {
      label: "24h Change",
      val:   decision.indicators?.price_change_24h != null
               ? fmtChange(decision.indicators.price_change_24h) : null,
      color: (decision.indicators?.price_change_24h ?? 0) >= 0 ? "text-green" : "text-red",
    },
  ] : [];

  const isFlowActive = loading || executing;
  const showStepBar  = Object.values(steps).some((s) => s !== null);

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ position: "relative" }}>
    <Suspense fallback={null}>
      <NeuralBackground agentActive={executing} />
    </Suspense>
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "40px 24px", position: "relative", zIndex: 1 }}>

      {/* ── Controls ─────────────────────────────────────────────────────────── */}
      <div>
        <span style={G.label}>Trade Execution</span>
        <h1 style={G.h2}>AI Trade Command</h1>
        <div style={G.card}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px,1fr))", gap: 12, marginBottom: 16 }}>
            {[
              { label: "Token", value: token, opts: tokens, set: setToken },
              { label: "Strategy", value: strategy, opts: STRATEGIES, set: setStrategy },
              { label: "Action Mode", value: actionMode, opts: ACTION_OPTIONS, set: setActionMode },
            ].map(({ label, value, opts, set }) => (
              <div key={label}>
                <p style={{ ...G.mono, fontSize: 9, color: "#6b7280", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</p>
                <select value={value} onChange={(e) => set(e.target.value)} style={G.select}>
                  {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            ))}
            <div>
              <p style={{ ...G.mono, fontSize: 9, color: "#6b7280", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em" }}>Agent</p>
              <div style={{ ...G.select, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--neon-blue)" }}>
                {agent.name} · {agent.strategy}
                {agent.on_chain_id && <span style={{ color: "var(--neon-green)", marginLeft: 6 }}>⛓#{agent.on_chain_id}</span>}
              </div>
            </div>
          </div>

          {actionMode !== "AI" && (
            <div style={{ marginBottom: 12, padding: "10px 14px", borderRadius: 10, border: "1px solid rgba(255,184,0,0.3)", background: "rgba(255,184,0,0.06)" }}>
              <p style={{ ...G.mono, fontSize: 11, color: "#FFB800" }}>
                ⚠ Manual override — forcing <strong>{actionMode}</strong>
              </p>
            </div>
          )}

          {!agent.on_chain_id && (
            <div style={{ marginBottom: 12, padding: "10px 14px", borderRadius: 10, border: "1px solid rgba(0,191,255,0.2)", background: "rgba(0,191,255,0.05)" }}>
              <p style={{ ...G.mono, fontSize: 11, color: "var(--neon-blue)" }}>
                ℹ Agent not registered on-chain. Blockchain steps will be skipped.
              </p>
            </div>
          )}

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              onClick={handleDecision} disabled={loading || executing}
              style={{
                fontFamily: "'JetBrains Mono',monospace", fontSize: 12, fontWeight: 700,
                padding: "10px 20px", borderRadius: 10,
                border: "1px solid rgba(0,255,136,0.4)", background: "rgba(0,255,136,0.1)",
                color: "var(--neon-green)", cursor: loading||executing ? "not-allowed" : "pointer",
                opacity: loading||executing ? 0.5 : 1, transition: "all 0.15s",
              }}
            >
              {loading ? "Analyzing…" : "⚡ Get AI Decision"}
            </button>
            <button
              onClick={handleExecute} disabled={isFlowActive}
              style={{
                fontFamily: "'JetBrains Mono',monospace", fontSize: 12, fontWeight: 700,
                padding: "10px 20px", borderRadius: 10,
                border: "1px solid rgba(0,191,255,0.4)",
                background: isFlowActive ? "rgba(0,191,255,0.05)" : "linear-gradient(135deg,rgba(0,191,255,0.3),rgba(0,255,136,0.2))",
                color: "var(--neon-blue)", cursor: isFlowActive ? "not-allowed" : "pointer",
                opacity: isFlowActive ? 0.5 : 1, transition: "all 0.15s",
              }}
            >
              {executing ? "Executing…" : "🚀 Execute Trade"}
            </button>
          </div>

          {error && (
            <div style={{ marginTop: 12, padding: "10px 14px", borderRadius: 10, border: "1px solid rgba(255,68,68,0.3)", background: "rgba(255,68,68,0.06)" }}>
              <p style={{ ...G.mono, fontSize: 11, color: "#FF4444" }}>{error}</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Step Progress Bar ─────────────────────────────────────────────────── */}
      {showStepBar && (
        <div style={G.card}>
          <span style={G.label}>Execution Pipeline</span>
          <StepBar steps={steps} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {steps.eip712 === "pending" && (
              <p className="text-yellow col-span-2">
                🦊 MetaMask: Sign typed trade data (EIP-712) — no gas required for this step
              </p>
            )}
            {steps.riskrouter === "pending" && (
              <p className="text-yellow col-span-2">
                ⛓ MetaMask: Approve RiskRouter transaction — gas fee required
              </p>
            )}
            {/* CHANGE: Updated hint text — validation now uses personal_sign
                (one MetaMask popup) rather than two popups (eth_sign attempt +
                fallback), matching the fixed contract's prefix-aware verification. */}
            {steps.validation === "pending" && (
              <p className="text-yellow col-span-2">
                📋 MetaMask: Sign &amp; store validation record on-chain — gas fee required
              </p>
            )}
            {steps.riskrouter === "done" && chainMeta?.txHash && (
              <p style={{ gridColumn: "1 / -1", ...G.mono, fontSize: 10, color: "#00BFFF" }}>
                RiskRouter TX:{" "}
                <a
                  href={`https://sepolia.etherscan.io/tx/${chainMeta.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue hover:underline"
                >
                  {chainMeta.txHash.slice(0, 20)}…
                </a>
              </p>
            )}
          </div>
        </div>
      )}

      {loading && !decision && (
        <div className="flex justify-center py-6"><Spinner size={6} /></div>
      )}

      {/* ── AI Decision Preview ───────────────────────────────────────────────── */}
      {decision && (
        <div>
          <SectionTitle>
            AI Decision {decision.forcedAction ? "(Overridden)" : "(Preview)"}
          </SectionTitle>
          <Card>
            <div className="flex items-center gap-3 mb-4 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-xs text-dim mono">AI says:</span>
                <Badge variant={actionColor(decision.action)}>{decision.action}</Badge>
              </div>
              {decision.forcedAction && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-dim mono">→ Forced to:</span>
                  <Badge variant={actionColor(decision.forcedAction)}>
                    {decision.forcedAction}
                  </Badge>
                </div>
              )}
              <span className="mono text-sm font-semibold">{decision.token_pair}</span>
              <span className="text-dim mono text-xs">
                ${decision.amount_usd} · {decision.confidence}% confidence
              </span>
              <Badge variant={
                decision.risk_level === "HIGH"   ? "red"   :
                decision.risk_level === "LOW"    ? "green" : "yellow"
              }>
                {decision.risk_level} risk
              </Badge>
              {decision.strategy_used && (
                <Badge variant="default">{decision.strategy_used}</Badge>
              )}
            </div>

            <p className="text-sm text-text mb-4 leading-relaxed">{decision.reason}</p>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {indicatorCards.map(({ label, val, color }) => (
                <div key={label} className="bg-bg rounded p-2 border border-border">
                  <p className="text-xs text-dim mono">{label}</p>
                  <p className={`text-sm mono font-medium ${color || "text-text"}`}>
                    {val ?? "—"}
                  </p>
                </div>
              ))}
            </div>

            {decision.indicators?.signals &&
              Object.keys(decision.indicators.signals).length > 0 && (
              <div className="mt-3 pt-3 border-t border-border">
                <p className="text-xs text-dim mono mb-2">Signals</p>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(decision.indicators.signals).map(([k, v]) => (
                    <span key={k} className="text-xs mono px-2 py-0.5 rounded bg-muted text-dim">
                      {v}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ── Execution Result ──────────────────────────────────────────────────── */}
      {result && (
        <div style={G.card}>
          <span style={G.label}>Execution Result</span>
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14, flexWrap:"wrap" }}>
              <Badge variant={
                result.status === "EXECUTED" ? "green" :
                result.status === "REJECTED" ? "red"   : "yellow"
              }>
                {result.status}
              </Badge>
              <Badge variant={actionColor(result.action)}>{result.action}</Badge>
              <span className="mono text-sm">{result.token_pair}</span>
              {chainMeta?.tradeHash && (
                <Badge variant="green">⛓ RiskRouter Approved</Badge>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
              {[
                { label: "Amount",     val: result.amount_usd != null ? `$${result.amount_usd}` : "—" },
                {
                  label: "PnL",
                  val:   result.pnl != null ? `$${result.pnl.toFixed(4)}` : "—",
                  color: (result.pnl ?? 0) >= 0 ? "text-green" : "text-red",
                },
                { label: "Risk Check",  val: result.risk_check?.toUpperCase() || "—" },
                { label: "Confidence",  val: result.confidence != null ? `${result.confidence}%` : "—" },
              ].map(({ label, val, color }) => (
                <div key={label} className="bg-bg rounded p-2 border border-border">
                  <p className="text-xs text-dim mono">{label}</p>
                  <p className={`text-sm mono font-medium ${color || ""}`}>{val}</p>
                </div>
              ))}
            </div>

            {result.tx_hash && (
              <p className="text-xs text-dim mono break-all mt-1">
                DEX TX: {result.tx_hash}
              </p>
            )}

            {chainMeta && (
              <div className="mt-3 pt-3 border-t border-border space-y-2">
                <p className="text-xs text-dim mono font-semibold">Blockchain Proof</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs mono">
                  {chainMeta.tradeHash && (
                    <div>
                      <span className="text-dim">Trade Hash: </span>
                      <span className="text-text break-all">{chainMeta.tradeHash}</span>
                    </div>
                  )}
                  {chainMeta.txHash && (
                    <div>
                      <span className="text-dim">RiskRouter TX: </span>
                      <a
                        href={`https://sepolia.etherscan.io/tx/${chainMeta.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue hover:underline"
                      >
                        {chainMeta.txHash.slice(0, 22)}…
                      </a>
                    </div>
                  )}
                  {chainMeta.blockNumber && (
                    <div>
                      <span className="text-dim">Block: </span>
                      <span className="text-text">#{chainMeta.blockNumber}</span>
                    </div>
                  )}
                  {chainMeta.nonce != null && (
                    <div>
                      <span className="text-dim">Nonce: </span>
                      <span className="text-text">{chainMeta.nonce}</span>
                    </div>
                  )}
                  {chainMeta.agentOnChainId != null && (
                    <div>
                      <span className="text-dim">Agent ID: </span>
                      <span className="text-blue">#{chainMeta.agentOnChainId}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* CHANGE: validation success badge now reflects that the fixed
                storeValidation will actually succeed (old version always
                reverted with "invalid validator signature" due to the
                timestamp mismatch bug in the old contract). */}
            {steps.validation === "done" && agent.on_chain_id && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs mono px-1.5 py-0.5 rounded bg-green/10 text-green border border-green/20">
                  📋 Validation stored on-chain
                </span>
              </div>
            )}
            {steps.validation === "error" && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs mono px-1.5 py-0.5 rounded bg-yellow/10 text-yellow border border-yellow/20">
                  ⚠ Validation store failed (trade executed successfully)
                </span>
              </div>
            )}
        </div>
      )}

    </div>
    </div>
  );
}