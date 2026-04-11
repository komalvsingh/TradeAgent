import React, { useState, useRef, useEffect, useCallback, Suspense, lazy } from "react";
import { useWallet }    from "../context/WalletContext";
import { useAgent }     from "../context/AgentContext";
import { useContracts } from "../context/ContractContext";
import { sendVoice, getDashboard, executeTrade } from "../utils/api";
import {
  Badge, Spinner, ConnectPrompt, EmptyState,
} from "../components/UI";
const NeuralBackground = lazy(() => import("../components/three/NeuralBackground"));

// ── Style system (matches Trade.jsx / Dashboard.jsx "Command Center" look) ────
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
  metricVal: {
    fontFamily: "'Syne', sans-serif",
    fontSize: 24, fontWeight: 800, lineHeight: 1,
    letterSpacing: "-0.03em",
  },
  metricLabel: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 10, color: "var(--dim)",
    textTransform: "uppercase", letterSpacing: "0.08em",
  },
  metricSub: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 10, color: "var(--dim)", marginTop: 2,
  },
  tag: {
    display: "inline-flex", alignItems: "center",
    padding: "3px 10px", borderRadius: 999,
    fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
    fontWeight: 600, border: "1px solid var(--border)",
  },
};

const TAG_COLORS = {
  green:   { bg: "rgba(34,197,94,0.12)",  color: "var(--green)",  border: "rgba(34,197,94,0.3)" },
  red:     { bg: "rgba(239,68,68,0.12)",  color: "var(--red)",    border: "rgba(239,68,68,0.3)" },
  blue:    { bg: "rgba(59,130,246,0.12)", color: "var(--accent)",  border: "rgba(59,130,246,0.3)" },
  yellow:  { bg: "rgba(245,158,11,0.12)", color: "var(--yellow)",  border: "rgba(245,158,11,0.3)" },
  default: { bg: "var(--muted)",           color: "var(--dim)",    border: "var(--border)" },
};

function Tag({ children, variant = "default" }) {
  const c = TAG_COLORS[variant] || TAG_COLORS.default;
  return (
    <span style={{ ...G.tag, background: c.bg, color: c.color, borderColor: c.border }}>
      {children}
    </span>
  );
}

// ── Accent Card (matches Dashboard.jsx ACard) ─────────────────────────────────
function ACard({ children, ac = "var(--accent)", style = {} }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 16,
        padding: "18px 20px",
        position: "relative",
        overflow: "hidden",
        transition: "transform 0.2s ease, box-shadow 0.2s ease",
        transform: hov ? "translateY(-3px)" : "none",
        boxShadow: hov ? "0 10px 32px rgba(0,0,0,0.14)" : "none",
        ...style,
      }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
    >
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: 3,
        borderRadius: "16px 16px 0 0", background: ac,
      }} />
      {children}
    </div>
  );
}

// ── Pipeline Step Bar (matches Trade.jsx StepBar) ─────────────────────────────
const VOICE_STEPS = [
  { id: "sig",        label: "Wallet Approval" },
  { id: "riskrouter", label: "RiskRouter TX"   },
  { id: "backend",    label: "Backend Execute" },
  { id: "validation", label: "Store Validation" },
];

function StepBar({ steps }) {
  return (
    <div style={{ display: "flex", alignItems: "center", width: "100%", marginBottom: 16, overflowX: "auto", gap: 0 }}>
      {VOICE_STEPS.map((s, i) => {
        const st = steps[s.id];
        const color =
          st === "done"    ? "var(--neon-green)" :
          st === "error"   ? "#FF4444" :
          st === "pending" ? "#FFB800" :
                             "var(--muted)";
        const textColor =
          st === "done"    ? "var(--neon-green)" :
          st === "error"   ? "#FF4444" :
          st === "pending" ? "#FFB800" :
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
            {i < VOICE_STEPS.length - 1 && (
              <div style={{ flex: 1, height: 1, background: "rgba(0,191,255,0.2)", minWidth: 12, marginBottom: 14 }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

const EXAMPLES = [
  "Buy ETH now",
  "Sell Bitcoin",
  "What is my PnL?",
  "What is my status?",
  "Show my risk heatmap",
  "Switch to conservative mode",
  "Switch to aggressive mode",
  "Buy MATIC",
  "Sell Chainlink",
];

function actionColor(a) {
  if (a === "BUY")  return "green";
  if (a === "SELL") return "red";
  return "yellow";
}

// ── Browser Speech Recognition ────────────────────────────────────────────────
const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition || null;

// ── Text-to-Speech helper ─────────────────────────────────────────────────────
function useTTS() {
  const synthRef     = useRef(window.speechSynthesis);
  const utteranceRef = useRef(null);
  const [speaking,   setSpeaking]   = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [ttsVoice,   setTtsVoice]   = useState(null);
  const [voices,     setVoices]     = useState([]);

  useEffect(() => {
    const loadVoices = () => {
      const v = synthRef.current.getVoices();
      if (v.length > 0) {
        setVoices(v);
        const preferred =
          v.find((x) => x.name === "Google US English") ||
          v.find((x) => x.lang === "en-US" && !x.localService) ||
          v.find((x) => x.lang.startsWith("en")) ||
          v[0];
        setTtsVoice(preferred);
      }
    };
    loadVoices();
    synthRef.current.onvoiceschanged = loadVoices;
    return () => { synthRef.current.onvoiceschanged = null; };
  }, []);

  const speak = useCallback((text) => {
    if (!ttsEnabled || !text) return;
    synthRef.current.cancel();
    const clean = text
      .replace(/[$]/g, " dollars ")
      .replace(/[%]/g, " percent ")
      .replace(/[_\-*#]/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
    const utt    = new SpeechSynthesisUtterance(clean);
    utt.voice    = ttsVoice;
    utt.lang     = "en-US";
    utt.rate     = 1.0;
    utt.pitch    = 1.0;
    utt.volume   = 1.0;
    utt.onstart  = () => setSpeaking(true);
    utt.onend    = () => setSpeaking(false);
    utt.onerror  = () => setSpeaking(false);
    utteranceRef.current = utt;
    synthRef.current.speak(utt);
  }, [ttsEnabled, ttsVoice]);

  const stop = useCallback(() => {
    synthRef.current.cancel();
    setSpeaking(false);
  }, []);

  return { speak, stop, speaking, ttsEnabled, setTtsEnabled, voices, ttsVoice, setTtsVoice };
}

// ─────────────────────────────────────────────────────────────────────────────

export default function Voice() {
  const { account, signer }  = useWallet();
  const { agent, refetch }   = useAgent();

  const {
    submitTradeIntent,
    storeValidation,
    getAgentNonce,
    getAgentDailyStats,
  } = useContracts();

  const {
    speak, stop, speaking,
    ttsEnabled, setTtsEnabled,
    voices, ttsVoice, setTtsVoice,
  } = useTTS();

  const [input,        setInput]        = useState("");
  const [response,     setResponse]     = useState(null);
  const [tradeResult,  setTradeResult]  = useState(null);
  const [loading,      setLoading]      = useState(false);
  const [executing,    setExecuting]    = useState(false);
  const [listening,    setListening]    = useState(false);
  const [error,        setError]        = useState(null);
  const [history,      setHistory]      = useState([]);
  const [stats,        setStats]        = useState(null);

  const [chainStep, setChainStep] = useState({
    sig:        null,
    riskrouter: null,
    backend:    null,
    validation: null,
  });

  const [onChainDaily, setOnChainDaily] = useState(null);

  const inputRef = useRef(null);
  const recogRef = useRef(null);

  // Load live stats + on-chain daily stats
  useEffect(() => {
    if (!account || !agent) return;
    getDashboard(account).then(setStats).catch(() => {});

    if (agent.on_chain_id && getAgentDailyStats) {
      getAgentDailyStats(Number(agent.on_chain_id))
        .then(setOnChainDaily)
        .catch(() => {});
    }
  }, [account, agent, getAgentDailyStats]);

  if (!account) return <ConnectPrompt />;
  if (!agent)   return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "40px 24px" }}>
      <EmptyState message="Register an agent first on the Dashboard." />
    </div>
  );

  // ── Helper to update a single chain step ──────────────────────────────────
  const setStep = (key, status) =>
    setChainStep((prev) => ({ ...prev, [key]: status }));

  // ── Reset flow state ──────────────────────────────────────────────────────
  const resetFlow = () => {
    setError(null);
    setTradeResult(null);
    setChainStep({ sig: null, riskrouter: null, backend: null, validation: null });
  };

  // ── Send command ───────────────────────────────────────────────────────────
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const send = useCallback(async (text) => {
    const cmd = (text || input).trim();
    if (!cmd) return;

    stop();
    setLoading(true);
    setError(null);
    setResponse(null);
    setTradeResult(null);
    resetFlow();

    try {
      const r = await sendVoice({ text: cmd, wallet_address: account });
      setResponse(r);
      setHistory((h) => [
        { cmd, r, ts: new Date().toLocaleTimeString() },
        ...h.slice(0, 9),
      ]);
      setInput("");

      if (r.explanation) speak(r.explanation);

      if (r.intent === "settings") {
        await refetch();
        const s = await getDashboard(account).catch(() => null);
        if (s) setStats(s);
      }
    } catch (e) {
      const msg = e.response?.data?.detail || e.message;
      setError(msg);
      speak(`Sorry, there was an error: ${msg}`);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }, [input, account, stop, speak, refetch]);

  // ── Execute voice trade ───────────────────────────────────────────────────
  const executeVoiceTrade = async () => {
    if (!response?.decision) return;
    setExecuting(true);
    resetFlow();
    stop();

    const agentOnChainId = agent.on_chain_id ? Number(agent.on_chain_id) : null;
    const token    = response.token || "ethereum";
    const strategy = agent.strategy;

    // ── Step 1: MetaMask soft approval (plain text) ─────────────────────────
    setStep("sig", "pending");
    speak("Please approve the trade in your MetaMask wallet.");

    try {
      const message = [
        "═══ Voice AI Trade Approval ═══",
        `Command   : "${history[0]?.cmd || ""}"`,
        `Action    : ${response.decision.action}`,
        `Token     : ${token.toUpperCase()}`,
        `Amount    : $${response.decision.amount_usd}`,
        `Confidence: ${response.decision.confidence}%`,
        `Wallet    : ${account}`,
        `Time      : ${new Date().toISOString()}`,
        "────────────────────────────────",
        "Signing approves this AI trade. No ETH spent.",
      ].join("\n");
      await signer.signMessage(message);
      setStep("sig", "done");
      speak("Signature confirmed. Executing trade now.");
    } catch {
      setStep("sig", "error");
      setError("Trade cancelled — MetaMask signature rejected.");
      speak("Trade cancelled. MetaMask signature was rejected.");
      setExecuting(false);
      return;
    }

    // ── Step 2: EIP-712 sign + RiskRouter on-chain TX ───────────────────────
    let tradeHash       = null;
    let onChainApproved = false;
    let nonce           = null;

    if (agentOnChainId != null && submitTradeIntent) {
      setStep("riskrouter", "pending");
      try {
        const amountUsdCents = Math.round((response.decision.amount_usd || 0) * 100);
        nonce = await getAgentNonce(agentOnChainId);

        speak("Approve the RiskRouter transaction in MetaMask.");
        const intentResult = await submitTradeIntent({
          agentId:    agentOnChainId,
          tokenPair:  response.decision.token_pair || `${token.toUpperCase()}/USDC`,
          action:     response.decision.action,
          amountUsd:  amountUsdCents,
          confidence: Math.round(response.decision.confidence || 0),
          reason:     response.decision.reason || response.explanation || "",
        });

        tradeHash       = intentResult.tradeHash;
        onChainApproved = intentResult.approved;

        if (intentResult.rejected) {
          setStep("riskrouter", "error");
          setError(`RiskRouter rejected: ${intentResult.reason || "risk limit exceeded"}`);
          speak(`Trade rejected by risk router. ${intentResult.reason || "Risk limit exceeded."}`);
          setExecuting(false);
          return;
        }

        setStep("riskrouter", "done");
        speak("Risk check passed.");

      } catch (chainErr) {
        if (
          chainErr.code === 4001 ||
          chainErr.message?.includes("user rejected") ||
          chainErr.message?.includes("User denied")
        ) {
          setStep("riskrouter", "error");
          setError("Trade cancelled — RiskRouter transaction rejected.");
          speak("Trade cancelled. MetaMask transaction was rejected.");
          setExecuting(false);
          return;
        }
        console.warn("RiskRouter step failed, falling back to backend:", chainErr.message);
        setStep("riskrouter", "error");
      }

    } else {
      setStep("riskrouter", "done");
    }

    // ── Step 3: Backend execution ───────────────────────────────────────────
    setStep("backend", "pending");
    try {
      const result = await executeTrade({
        token,
        strategy,
        wallet_address:      account,
        on_chain_trade_hash: tradeHash        || undefined,
        on_chain_approved:   onChainApproved,
        on_chain_nonce:      nonce            ?? undefined,
        agent_on_chain_id:   agentOnChainId   ?? undefined,
      });
      setStep("backend", "done");
      setTradeResult(result);

      const pnlStr = result.pnl != null
        ? `PnL is ${result.pnl >= 0 ? "positive" : "negative"} ${Math.abs(result.pnl).toFixed(4)} dollars.`
        : "";
      speak(
        `Trade ${result.status.toLowerCase()}. ` +
        `${result.action} ${result.token_pair} for ${result.amount_usd} dollars. ` +
        `${pnlStr}`
      );

      // ── Step 4: ValidationRegistry audit record ─────────────────────────
      if (agentOnChainId != null && storeValidation && result.id) {
        setStep("validation", "pending");
        try {
          await storeValidation(
            agentOnChainId,
            result.id,
            result.reason || response.explanation || "",
            Math.round(result.confidence || response.decision.confidence || 0),
            result.risk_check || "passed",
          );
          setStep("validation", "done");
        } catch (valErr) {
          console.warn("Validation store failed:", valErr.message);
          setStep("validation", "error");
        }
      } else {
        setStep("validation", "done");
      }

      // Refresh dashboard stats + on-chain daily stats after trade
      const s = await getDashboard(account).catch(() => null);
      if (s) setStats(s);

      if (agentOnChainId != null && getAgentDailyStats) {
        getAgentDailyStats(agentOnChainId).then(setOnChainDaily).catch(() => {});
      }

      await refetch();

    } catch (e) {
      const msg = e.response?.data?.detail || e.message;
      setStep("backend", "error");
      setError(msg);
      speak(`Trade execution failed: ${msg}`);
    } finally {
      setExecuting(false);
    }
  };

  // ── Microphone ────────────────────────────────────────────────────────────
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const toggleMic = useCallback(() => {
    if (!SpeechRecognition) {
      setError("Your browser doesn't support voice input. Try Chrome.");
      return;
    }
    if (listening) {
      recogRef.current?.stop();
      setListening(false);
      return;
    }

    const recog           = new SpeechRecognition();
    recog.lang            = "en-US";
    recog.interimResults  = false;
    recog.maxAlternatives = 1;

    recog.onresult = (e) => {
      const transcript = e.results[0][0].transcript;
      setInput(transcript);
      setListening(false);
      setTimeout(() => send(transcript), 300);
    };
    recog.onerror = (e) => {
      setListening(false);
      if (e.error !== "no-speech") {
        setError(`Mic error: ${e.error}. Check browser permissions.`);
      }
    };
    recog.onend = () => setListening(false);

    recogRef.current = recog;
    recog.start();
    setListening(true);
    setError(null);
  }, [listening, send]);

  const sigWaiting = chainStep.sig === "pending";
  const showStepBar = Object.values(chainStep).some((s) => s !== null);

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ position: "relative" }}>
    <Suspense fallback={null}>
      <NeuralBackground agentActive={executing || listening} />
    </Suspense>
    <div style={{
      maxWidth: 1100,
      margin: "0 auto",
      padding: "40px 24px",
      display: "flex",
      flexDirection: "column",
      gap: 32,
      position: "relative",
      zIndex: 1,
    }}>

      {/* ════════════════════════════════════════════════════
          AGENT HERO STRIP
      ════════════════════════════════════════════════════ */}
      <section>
        <span style={G.label}>Agent</span>
        <div style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: 20,
          padding: "20px 24px",
          position: "relative",
          overflow: "hidden",
        }}>
          {/* Gradient top bar */}
          <div style={{
            position: "absolute", top: 0, left: 0, right: 0, height: 3,
            background: "linear-gradient(90deg, var(--accent), var(--accent2))",
            borderRadius: "20px 20px 0 0",
          }} />

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ ...G.mono, fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{agent.name}</span>
              <Tag variant="blue">{agent.strategy}</Tag>
              <Tag variant={
                agent.risk_tolerance === "HIGH" ? "red" :
                agent.risk_tolerance === "LOW"  ? "green" : "yellow"
              }>
                {agent.risk_tolerance} risk
              </Tag>
              {agent.on_chain_id && (
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  padding: "2px 8px", borderRadius: 99,
                  background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.3)",
                  ...G.mono, fontSize: 9, fontWeight: 600,
                  color: "var(--green)", textTransform: "uppercase", letterSpacing: "0.08em",
                }}>
                  <span style={{
                    width: 5, height: 5, borderRadius: "50%",
                    background: "var(--green)", animation: "pdot 2s ease-in-out infinite",
                    display: "inline-block",
                  }} />
                  ⛓#{agent.on_chain_id}
                </span>
              )}
            </div>
            {stats ? (
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                {[
                  { label: "PnL",   val: `$${stats.total_pnl?.toFixed(4)}`, color: stats.total_pnl >= 0 ? "var(--green)" : "var(--red)" },
                  { label: "Trust", val: `${stats.trust_score?.toFixed(0)}/100`, color: stats.trust_score >= 60 ? "var(--green)" : "var(--yellow)" },
                  { label: "Trades", val: stats.total_trades, color: "var(--text)" },
                  { label: "Win",   val: `${stats.win_rate?.toFixed(1)}%`, color: "var(--text)" },
                  ...(onChainDaily ? [{
                    label: "Chain Loss",
                    val: `$${(onChainDaily.totalLossUsd / 100).toFixed(2)}`,
                    color: onChainDaily.totalLossUsd / 100 > 500 ? "var(--red)" :
                           onChainDaily.totalLossUsd / 100 > 100 ? "var(--yellow)" : "var(--green)",
                  }] : []),
                ].map(({ label, val, color }) => (
                  <div key={label} style={{ textAlign: "center" }}>
                    <p style={G.metricLabel}>{label}</p>
                    <p style={{ ...G.mono, fontSize: 13, fontWeight: 600, color, marginTop: 2 }}>{val}</p>
                  </div>
                ))}
              </div>
            ) : (
              <Spinner size={3} />
            )}
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════
          VOICE COMMAND INPUT
      ════════════════════════════════════════════════════ */}
      <section>
        <span style={G.label}>Voice Interface</span>
        <h1 style={G.h2}>Voice AI Trader</h1>

        <div style={G.card}>
          {/* Input row */}
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !loading && send()}
              placeholder='Try: "Buy ETH now" or "What is my PnL?"'
              style={{
                flex: 1, padding: "10px 14px",
                borderRadius: 10, border: "1px solid rgba(0,191,255,0.2)",
                background: "rgba(0,0,0,0.45)", color: "var(--text2)",
                ...G.mono, fontSize: 12,
                outline: "none",
              }}
            />

            <button
              onClick={toggleMic}
              disabled={loading || executing}
              title={SpeechRecognition ? (listening ? "Stop listening" : "Voice input") : "Not supported"}
              style={{
                padding: "10px 14px", borderRadius: 10,
                border: listening
                  ? "1px solid rgba(239,68,68,0.4)"
                  : "1px solid rgba(0,191,255,0.2)",
                background: listening
                  ? "rgba(239,68,68,0.15)"
                  : "rgba(0,0,0,0.45)",
                color: listening ? "var(--red)" : "var(--neon-blue)",
                ...G.mono, fontSize: 12, fontWeight: 600,
                cursor: loading || executing ? "not-allowed" : "pointer",
                opacity: loading || executing ? 0.4 : 1,
                transition: "all 0.15s",
                animation: listening ? "pdot 1s ease-in-out infinite" : "none",
              }}
            >
              {listening ? "🎙 Stop" : "🎙"}
            </button>

            <button
              onClick={() => send()}
              disabled={!input.trim() || loading || executing}
              style={{
                ...G.mono, fontSize: 12, fontWeight: 700,
                padding: "10px 20px", borderRadius: 10,
                border: "1px solid rgba(0,255,136,0.4)",
                background: "rgba(0,255,136,0.1)",
                color: "var(--neon-green)",
                cursor: !input.trim() || loading || executing ? "not-allowed" : "pointer",
                opacity: !input.trim() || loading || executing ? 0.5 : 1,
                transition: "all 0.15s",
              }}
            >
              {loading ? "Sending…" : "⚡ Send"}
            </button>
          </div>

          {/* TTS controls */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
            <button
              onClick={() => { setTtsEnabled((v) => !v); if (speaking) stop(); }}
              style={{
                ...G.mono, fontSize: 10, fontWeight: 600,
                padding: "5px 12px", borderRadius: 8,
                border: ttsEnabled ? "1px solid rgba(0,255,136,0.3)" : "1px solid var(--border)",
                background: ttsEnabled ? "rgba(0,255,136,0.1)" : "rgba(0,0,0,0.3)",
                color: ttsEnabled ? "var(--neon-green)" : "var(--dim)",
                cursor: "pointer", transition: "all 0.15s",
              }}
            >
              {ttsEnabled ? "🔊 Voice On" : "🔇 Voice Off"}
            </button>

            {speaking && (
              <button
                onClick={stop}
                style={{
                  ...G.mono, fontSize: 10, fontWeight: 600,
                  padding: "5px 12px", borderRadius: 8,
                  border: "1px solid rgba(239,68,68,0.3)",
                  background: "rgba(239,68,68,0.1)",
                  color: "var(--red)", cursor: "pointer",
                }}
              >
                ⏹ Stop Speaking
              </button>
            )}

            {speaking && (
              <span style={{ ...G.mono, fontSize: 10, color: "var(--neon-green)", display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{
                  width: 6, height: 6, borderRadius: "50%",
                  background: "var(--neon-green)", display: "inline-block",
                  animation: "pdot 1s ease-in-out infinite",
                }} />
                Speaking...
              </span>
            )}

            {voices.length > 1 && ttsEnabled && (
              <select
                value={ttsVoice?.name || ""}
                onChange={(e) => {
                  const v = voices.find((x) => x.name === e.target.value);
                  if (v) setTtsVoice(v);
                }}
                style={{
                  ...G.mono, fontSize: 10,
                  padding: "5px 10px", borderRadius: 8,
                  border: "1px solid rgba(0,191,255,0.2)",
                  background: "rgba(0,0,0,0.45)", color: "var(--dim)",
                  outline: "none",
                }}
              >
                {voices
                  .filter((v) => v.lang.startsWith("en"))
                  .map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name}
                    </option>
                  ))}
              </select>
            )}
          </div>

          {listening && (
            <div style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "8px 14px", borderRadius: 10,
              border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.06)",
              marginBottom: 12,
            }}>
              <span style={{
                width: 6, height: 6, borderRadius: "50%",
                background: "var(--red)", display: "inline-block",
                animation: "pdot 1s ease-in-out infinite",
              }} />
              <span style={{ ...G.mono, fontSize: 11, color: "var(--red)" }}>
                Listening… speak now
              </span>
            </div>
          )}

          {/* Quick examples */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                onClick={() => send(ex)}
                disabled={loading || executing}
                style={{
                  ...G.mono, fontSize: 10, padding: "5px 12px",
                  borderRadius: 8,
                  border: "1px solid rgba(0,191,255,0.15)",
                  background: "rgba(0,0,0,0.3)",
                  color: "var(--dim)",
                  cursor: loading || executing ? "not-allowed" : "pointer",
                  opacity: loading || executing ? 0.4 : 1,
                  transition: "all 0.15s",
                }}
                onMouseEnter={(e) => { e.target.style.color = "var(--neon-blue)"; e.target.style.borderColor = "rgba(0,191,255,0.4)"; }}
                onMouseLeave={(e) => { e.target.style.color = "var(--dim)"; e.target.style.borderColor = "rgba(0,191,255,0.15)"; }}
              >
                {ex}
              </button>
            ))}
          </div>

          {error && (
            <div style={{
              marginTop: 12, padding: "10px 14px", borderRadius: 10,
              border: "1px solid rgba(255,68,68,0.3)", background: "rgba(255,68,68,0.06)",
            }}>
              <p style={{ ...G.mono, fontSize: 11, color: "#FF4444" }}>{error}</p>
            </div>
          )}
        </div>
      </section>

      {/* ════════════════════════════════════════════════════
          LOADING INDICATOR
      ════════════════════════════════════════════════════ */}
      {loading && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "center", padding: "12px 0" }}>
          <Spinner size={4} />
          <span style={{ ...G.mono, fontSize: 11, color: "var(--dim)" }}>Processing your command...</span>
        </div>
      )}

      {/* ════════════════════════════════════════════════════
          EXECUTION PIPELINE (Step Bar)
      ════════════════════════════════════════════════════ */}
      {showStepBar && (
        <div style={G.card}>
          <span style={G.label}>Execution Pipeline</span>
          <StepBar steps={chainStep} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 6 }}>
            {chainStep.sig === "pending" && (
              <p style={{ ...G.mono, fontSize: 11, color: "#FFB800" }}>
                🦊 MetaMask: Sign to confirm intent — no gas required
              </p>
            )}
            {chainStep.riskrouter === "pending" && (
              <p style={{ ...G.mono, fontSize: 11, color: "#FFB800" }}>
                ⛓ MetaMask: Approve RiskRouter transaction — gas fee required
              </p>
            )}
            {chainStep.validation === "pending" && (
              <p style={{ ...G.mono, fontSize: 11, color: "#FFB800" }}>
                📋 MetaMask: Sign & store validation record on-chain — gas fee required
              </p>
            )}
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════
          MetaMask Waiting Card
      ════════════════════════════════════════════════════ */}
      {sigWaiting && (
        <ACard ac="#FFB800" style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12,
            background: "rgba(255,184,0,0.1)", display: "flex",
            alignItems: "center", justifyContent: "center",
            fontSize: 22, flexShrink: 0,
          }}>
            🦊
          </div>
          <div>
            <p style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 14, color: "#FFB800", margin: 0 }}>
              MetaMask Signature Required
            </p>
            <p style={{ ...G.mono, fontSize: 10, color: "var(--dim)", marginTop: 3 }}>
              Check your MetaMask popup. Sign to approve this trade. Free — no ETH required.
            </p>
          </div>
        </ACard>
      )}

      {/* ════════════════════════════════════════════════════
          AI RESPONSE
      ════════════════════════════════════════════════════ */}
      {response && (
        <section>
          <span style={G.label}>AI Response</span>
          <div style={G.card}>
            {/* Intent + action badges */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
              <Tag variant="blue">{response.intent}</Tag>
              {response.action && (
                <Tag variant={actionColor(response.action)}>{response.action}</Tag>
              )}
              {response.token && (
                <span style={{ ...G.mono, fontSize: 12, color: "var(--dim)", textTransform: "capitalize" }}>
                  {response.token.replace(/-/g, " ")}
                </span>
              )}
              {chainStep.sig === "done" && <Tag variant="green">MetaMask ✓</Tag>}
              {chainStep.riskrouter === "done" && agent.on_chain_id && (
                <Tag variant="green">⛓ RiskRouter ✓</Tag>
              )}

              <button
                onClick={() => speak(response.explanation)}
                disabled={speaking}
                style={{
                  marginLeft: "auto", ...G.mono, fontSize: 10, fontWeight: 600,
                  padding: "5px 12px", borderRadius: 8,
                  border: "1px solid rgba(0,191,255,0.2)",
                  background: "rgba(0,0,0,0.3)",
                  color: "var(--neon-blue)",
                  cursor: speaking ? "not-allowed" : "pointer",
                  opacity: speaking ? 0.4 : 1, transition: "all 0.15s",
                }}
              >
                🔊 Replay
              </button>
            </div>

            {/* Explanation text */}
            <p style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.6, marginBottom: 16 }}>
              {response.explanation}
            </p>

            {/* AI Decision details */}
            {response.decision && (
              <div style={{
                background: "rgba(0,0,0,0.3)", border: "1px solid rgba(0,191,255,0.1)",
                borderRadius: 12, padding: 16,
              }}>
                <p style={{ ...G.metricLabel, marginBottom: 12 }}>AI Analysis</p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, marginBottom: 12 }}>
                  {[
                    {
                      label: "Action",
                      val: response.decision.action,
                      isTag: true,
                    },
                    { label: "Confidence", val: `${response.decision.confidence}%` },
                    {
                      label: "Risk Level",
                      val: response.decision.risk_level,
                      color:
                        response.decision.risk_level === "HIGH" ? "var(--red)" :
                        response.decision.risk_level === "LOW"  ? "var(--green)" : "var(--yellow)",
                    },
                    { label: "Amount", val: `$${response.decision.amount_usd}` },
                  ].map(({ label, val, color, isTag }) => (
                    <div
                      key={label}
                      style={{
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                        background: "rgba(0,0,0,0.2)", borderRadius: 8,
                        padding: "8px 12px", border: "1px solid rgba(0,191,255,0.08)",
                      }}
                    >
                      <span style={{ ...G.mono, fontSize: 10, color: "var(--dim)" }}>{label}</span>
                      {isTag
                        ? <Tag variant={actionColor(val)}>{val}</Tag>
                        : <span style={{ ...G.mono, fontSize: 12, fontWeight: 600, color: color || "var(--text)" }}>{val}</span>
                      }
                    </div>
                  ))}
                </div>

                {/* Indicators */}
                {response.decision.indicators && (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: 6, marginBottom: 8 }}>
                    {[
                      {
                        label: "RSI",
                        val:   response.decision.indicators.rsi?.toFixed(1),
                        color: response.decision.indicators.rsi < 30 ? "var(--green)"
                             : response.decision.indicators.rsi > 70 ? "var(--red)" : null,
                      },
                      {
                        label: "MA7",
                        val:   response.decision.indicators.ma_7 != null
                                 ? `$${Number(response.decision.indicators.ma_7).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                                 : null,
                      },
                      {
                        label: "MA25",
                        val:   response.decision.indicators.ma_25 != null
                                 ? `$${Number(response.decision.indicators.ma_25).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                                 : null,
                      },
                      {
                        label: "Sentiment",
                        val:   response.decision.indicators.sentiment?.toFixed(3),
                        color: response.decision.indicators.sentiment >  0.3 ? "var(--green)"
                             : response.decision.indicators.sentiment < -0.3 ? "var(--red)" : null,
                      },
                      {
                        label: "24h Δ",
                        val:   response.decision.indicators.price_change_24h != null
                                 ? `${response.decision.indicators.price_change_24h >= 0 ? "+" : ""}${response.decision.indicators.price_change_24h?.toFixed(2)}%`
                                 : null,
                        color: (response.decision.indicators.price_change_24h ?? 0) >= 0
                                 ? "var(--green)" : "var(--red)",
                      },
                    ].map(({ label, val, color }) => (
                      <div key={label} style={{
                        background: "rgba(0,0,0,0.2)", borderRadius: 8,
                        padding: "8px 10px", border: "1px solid rgba(0,191,255,0.08)",
                      }}>
                        <p style={{ ...G.mono, fontSize: 9, color: "var(--dim)", textTransform: "uppercase", marginBottom: 3 }}>{label}</p>
                        <p style={{ ...G.mono, fontSize: 12, fontWeight: 600, color: color || "var(--text)" }}>{val ?? "—"}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Signals */}
                {response.decision.indicators?.signals &&
                  Object.keys(response.decision.indicators.signals).length > 0 && (
                  <div style={{ borderTop: "1px solid rgba(0,191,255,0.1)", paddingTop: 10, marginTop: 6 }}>
                    <p style={{ ...G.mono, fontSize: 9, color: "var(--dim)", textTransform: "uppercase", marginBottom: 6 }}>Signals</p>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {Object.entries(response.decision.indicators.signals).map(([k, v]) => (
                        <span key={k} style={{
                          ...G.mono, fontSize: 10, padding: "3px 10px",
                          borderRadius: 6, background: "rgba(0,191,255,0.08)",
                          color: "var(--dim)", border: "1px solid rgba(0,191,255,0.1)",
                        }}>
                          {v}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Execute button */}
                {response.intent === "trade" && response.decision.action !== "HOLD" && (
                  <div style={{ borderTop: "1px solid rgba(0,191,255,0.1)", paddingTop: 14, marginTop: 12 }}>
                    <button
                      onClick={executeVoiceTrade}
                      disabled={executing || loading}
                      style={{
                        ...G.mono, fontSize: 12, fontWeight: 700,
                        padding: "10px 24px", borderRadius: 10,
                        border: "1px solid rgba(0,191,255,0.4)",
                        background: executing
                          ? "rgba(0,191,255,0.05)"
                          : "linear-gradient(135deg,rgba(0,191,255,0.3),rgba(0,255,136,0.2))",
                        color: "var(--neon-blue)",
                        cursor: executing || loading ? "not-allowed" : "pointer",
                        opacity: executing || loading ? 0.5 : 1,
                        transition: "all 0.15s",
                      }}
                    >
                      {executing ? "Executing…" : "🚀 Execute This Trade"}
                    </button>
                    <p style={{ ...G.mono, fontSize: 10, color: "var(--dim)", marginTop: 6 }}>
                      {response.decision.action} {response.token?.toUpperCase()} ·
                      ${response.decision.amount_usd} · Requires MetaMask signature
                      {agent.on_chain_id && " + RiskRouter TX"}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      {executing && !showStepBar && (
        <div style={{ display: "flex", justifyContent: "center", padding: "20px 0" }}><Spinner size={6} /></div>
      )}

      {/* ════════════════════════════════════════════════════
          TRADE RESULT
      ════════════════════════════════════════════════════ */}
      {tradeResult && (
        <section>
          <span style={G.label}>Execution Result</span>
          <div style={G.card}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
              <Tag variant={
                tradeResult.status === "EXECUTED" ? "green" :
                tradeResult.status === "REJECTED" ? "red" : "yellow"
              }>
                {tradeResult.status}
              </Tag>
              <Tag variant={actionColor(tradeResult.action)}>{tradeResult.action}</Tag>
              <span style={{ ...G.mono, fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{tradeResult.token_pair}</span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, marginBottom: 12 }}>
              {[
                { label: "Amount",     val: `$${tradeResult.amount_usd}` },
                {
                  label: "PnL",
                  val:   tradeResult.pnl != null ? `$${tradeResult.pnl.toFixed(4)}` : "—",
                  color: (tradeResult.pnl ?? 0) >= 0 ? "var(--green)" : "var(--red)",
                },
                { label: "Risk Check", val: tradeResult.risk_check?.toUpperCase() },
                { label: "Confidence", val: `${tradeResult.confidence}%` },
              ].map(({ label, val, color }) => (
                <div key={label} style={{
                  background: "rgba(0,0,0,0.2)", borderRadius: 8,
                  padding: "8px 12px", border: "1px solid rgba(0,191,255,0.08)",
                }}>
                  <p style={{ ...G.mono, fontSize: 9, color: "var(--dim)", textTransform: "uppercase", marginBottom: 3 }}>{label}</p>
                  <p style={{ ...G.mono, fontSize: 13, fontWeight: 600, color: color || "var(--text)" }}>{val}</p>
                </div>
              ))}
            </div>

            {/* On-chain badges */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {tradeResult.on_chain_id && (
                <>
                  <span style={{
                    ...G.mono, fontSize: 10, padding: "3px 10px", borderRadius: 6,
                    background: "rgba(0,255,136,0.1)", color: "var(--neon-green)",
                    border: "1px solid rgba(0,255,136,0.3)",
                  }}>
                    ⛓ RiskRouter Approved
                  </span>
                  <a
                    href={`https://sepolia.etherscan.io/tx/${tradeResult.on_chain_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ ...G.mono, fontSize: 10, color: "var(--neon-blue)", textDecoration: "none" }}
                    onMouseEnter={(e) => e.target.style.textDecoration = "underline"}
                    onMouseLeave={(e) => e.target.style.textDecoration = "none"}
                  >
                    {tradeResult.on_chain_id.startsWith("0x")
                      ? `${tradeResult.on_chain_id.slice(0, 22)}…`
                      : tradeResult.on_chain_id}
                  </a>
                </>
              )}
              {chainStep.validation === "done" && agent.on_chain_id && (
                <span style={{
                  ...G.mono, fontSize: 10, padding: "3px 10px", borderRadius: 6,
                  background: "rgba(0,255,136,0.1)", color: "var(--neon-green)",
                  border: "1px solid rgba(0,255,136,0.3)",
                }}>
                  📋 Validation stored on-chain
                </span>
              )}
              {chainStep.validation === "error" && (
                <span style={{
                  ...G.mono, fontSize: 10, padding: "3px 10px", borderRadius: 6,
                  background: "rgba(255,184,0,0.1)", color: "#FFB800",
                  border: "1px solid rgba(255,184,0,0.3)",
                }}>
                  ⚠ Validation store failed (trade executed successfully)
                </span>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ════════════════════════════════════════════════════
          COMMAND HISTORY
      ════════════════════════════════════════════════════ */}
      {history.length > 0 && (
        <section>
          <span style={G.label}>History</span>
          <h2 style={{ ...G.h2, fontSize: "clamp(14px,2vw,20px)", marginBottom: 14 }}>Command History</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {history.map((h, i) => (
              <div
                key={i}
                onClick={() => speak(h.r.explanation)}
                title="Click to replay audio"
                style={{
                  display: "flex", alignItems: "flex-start", gap: 12,
                  padding: "12px 16px", borderRadius: 12,
                  background: "var(--card)", border: "1px solid var(--border)",
                  cursor: "pointer", transition: "border-color 0.15s, transform 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "rgba(0,191,255,0.3)";
                  e.currentTarget.style.transform = "translateX(3px)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "var(--border)";
                  e.currentTarget.style.transform = "none";
                }}
              >
                <span style={{ ...G.mono, fontSize: 10, color: "var(--dim)", flexShrink: 0, marginTop: 2 }}>{h.ts}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ ...G.mono, fontSize: 11, color: "var(--neon-green)", marginBottom: 2 }}>"{h.cmd}"</p>
                  <p style={{
                    ...G.mono, fontSize: 10, color: "var(--dim)",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>{h.r.explanation}</p>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  <Tag variant="blue">{h.r.intent}</Tag>
                  <span style={{ ...G.mono, fontSize: 12, color: "var(--dim)" }} title="Replay">🔊</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

    </div>
    </div>
  );
}