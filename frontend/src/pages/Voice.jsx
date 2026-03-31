import React, { useState, useRef, useEffect, useCallback } from "react";
import { useWallet }    from "../context/WalletContext";
import { useAgent }     from "../context/AgentContext";
import { useContracts } from "../context/ContractContext"; // CHANGE: added — needed for on-chain flow
import { sendVoice, getDashboard, executeTrade } from "../utils/api";
import {
  Card, SectionTitle, ActionBtn, Badge,
  ConnectPrompt, EmptyState, Spinner,
} from "../components/UI";

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

  // CHANGE: destructure on-chain helpers from ContractContext.
  // - submitTradeIntent: signs EIP-712 struct + submits to RiskRouter (same as Trade.jsx).
  // - storeValidation:   stores audit record on ValidationRegistry after execution.
  // - getAgentNonce:     read current nonce before building the intent.
  // - getAgentDailyStats: shows real on-chain daily loss in the stats strip now that
  //   the fixed RiskRouter actually increments totalLossUsd.
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

  // CHANGE: replaced single sigStatus string with a richer chainStep object so
  // the UI can reflect each stage of the on-chain flow independently —
  // matching the step-bar pattern from Trade.jsx.
  // Values per key: null | "pending" | "done" | "error"
  const [chainStep, setChainStep] = useState({
    sig:        null,  // MetaMask plain-text approval (kept for Voice UX)
    riskrouter: null,  // submitTradeIntent on-chain TX
    validation: null,  // storeValidation on-chain TX
  });

  // CHANGE: on-chain daily stats for the stats strip
  const [onChainDaily, setOnChainDaily] = useState(null);

  const inputRef = useRef(null);
  const recogRef = useRef(null);

  // Load live stats + on-chain daily stats
  useEffect(() => {
    if (!account || !agent) return;
    getDashboard(account).then(setStats).catch(() => {});

    // CHANGE: fetch on-chain daily stats if agent has an on-chain ID.
    // getAgentDailyStats returns { date, totalLossUsd (cents), tradeCount }.
    // totalLossUsd is now real because the fixed RiskRouter increments it.
    if (agent.on_chain_id && getAgentDailyStats) {
      getAgentDailyStats(Number(agent.on_chain_id))
        .then(setOnChainDaily)
        .catch(() => {});
    }
  }, [account, agent, getAgentDailyStats]);

  if (!account) return <ConnectPrompt />;
  if (!agent)   return (
    <div className="max-w-3xl mx-auto px-4 py-8">
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
    setChainStep({ sig: null, riskrouter: null, validation: null });
  };

  // ── Send command ───────────────────────────────────────────────────────────
  // CHANGE: wrapped in useCallback so toggleMic (which calls send) can safely
  // list it as a dependency without the eslint exhaustive-deps warning caused
  // by the original inline function definition.
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, account, stop, speak, refetch]);

  // ── Execute voice trade ───────────────────────────────────────────────────
  //
  // CHANGE: Now runs the same full on-chain flow as Trade.jsx handleExecute
  // when agent.on_chain_id is present:
  //
  //   1. MetaMask signMessage (soft approval — kept for Voice UX, free/no gas)
  //   2. submitTradeIntent() → EIP-712 sign + RiskRouter TX  (new)
  //   3. executeTrade() on backend with on-chain proof fields  (updated payload)
  //   4. storeValidation() → ValidationRegistry audit record  (new)
  //
  // If agent has no on_chain_id, steps 2 and 4 are skipped gracefully —
  // the trade executes via backend only, same as before.
  //
  const executeVoiceTrade = async () => {
    if (!response?.decision) return;
    setExecuting(true);
    resetFlow();
    stop();

    const agentOnChainId = agent.on_chain_id ? Number(agent.on_chain_id) : null;
    const token    = response.token || "ethereum";
    const strategy = agent.strategy;

    // ── Step 1: MetaMask soft approval (plain text) ─────────────────────────
    // Kept as-is for Voice UX — user hears the prompt, sees the summary.
    // This is NOT the EIP-712 signing; that happens inside submitTradeIntent.
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
    // CHANGE: Added — mirrors Trade.jsx handleExecute steps 2a/2b.
    // Only runs when agent has an on-chain registration.
    let tradeHash       = null;
    let onChainApproved = false;
    let nonce           = null;

    if (agentOnChainId != null && submitTradeIntent) {
      setStep("riskrouter", "pending");
      try {
        // Convert amount_usd (dollars) to integer cents for the contract.
        const amountUsdCents = Math.round((response.decision.amount_usd || 0) * 100);
        nonce = await getAgentNonce(agentOnChainId);

        // submitTradeIntent internally: builds EIP-712 struct, opens MetaMask
        // for typed-data signing (no gas), then submits on-chain TX (gas required).
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
        // Non-rejection chain error: log and continue with backend execution.
        console.warn("RiskRouter step failed, falling back to backend:", chainErr.message);
        setStep("riskrouter", "error");
      }

    } else {
      // No on-chain ID — skip chain steps gracefully.
      setStep("riskrouter", "done");
    }

    // ── Step 3: Backend execution ───────────────────────────────────────────
    // CHANGE: payload now includes the on-chain proof fields so the backend
    // can link the DB trade record to the on-chain TX — same as Trade.jsx.
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
      // CHANGE: Added — mirrors Trade.jsx step 4.
      // storeValidation (5 user-facing args) handles timestamp + personal_sign
      // internally. Non-fatal if it fails — trade already executed.
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

      // CHANGE: refresh on-chain daily stats so the strip shows updated loss
      if (agentOnChainId != null && getAgentDailyStats) {
        getAgentDailyStats(agentOnChainId).then(setOnChainDaily).catch(() => {});
      }

      await refetch();

    } catch (e) {
      const msg = e.response?.data?.detail || e.message;
      setError(msg);
      speak(`Trade execution failed: ${msg}`);
    } finally {
      setExecuting(false);
    }
  };

  // ── Microphone ────────────────────────────────────────────────────────────
  // CHANGE: send is now a stable useCallback ref, so it's safe in this dep array.
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

  // Derive simple sig status for the MetaMask waiting card (kept for Voice UX)
  const sigWaiting = chainStep.sig === "pending";
  const sigSigned  = chainStep.sig === "done";

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">

      {/* Live agent stats strip */}
      {/* CHANGE: added on-chain daily loss column when getAgentDailyStats data
          is available. totalLossUsd comes in cents — divide by 100 for dollars.
          This was always zero before the RiskRouter fix; now it's real. */}
      <Card className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <span className="mono text-sm font-semibold">{agent.name}</span>
          <Badge variant="blue">{agent.strategy}</Badge>
          <Badge variant={
            agent.risk_tolerance === "HIGH" ? "red" :
            agent.risk_tolerance === "LOW"  ? "green" : "yellow"
          }>
            {agent.risk_tolerance}
          </Badge>
          {agent.on_chain_id && (
            <Badge variant="blue">⛓#{agent.on_chain_id}</Badge>
          )}
        </div>
        {stats ? (
          <div className="flex gap-4 text-xs mono flex-wrap">
            <span>
              <span className="text-dim">PnL: </span>
              <span className={stats.total_pnl >= 0 ? "text-green" : "text-red"}>
                ${stats.total_pnl?.toFixed(4)}
              </span>
            </span>
            <span>
              <span className="text-dim">Trust: </span>
              <span className={stats.trust_score >= 60 ? "text-green" : "text-yellow"}>
                {stats.trust_score?.toFixed(0)}/100
              </span>
            </span>
            <span>
              <span className="text-dim">Trades: </span>
              <span className="text-text">{stats.total_trades}</span>
            </span>
            <span>
              <span className="text-dim">Win Rate: </span>
              <span className="text-text">{stats.win_rate?.toFixed(1)}%</span>
            </span>
            {/* CHANGE: on-chain daily loss from fixed RiskRouter */}
            {onChainDaily && (
              <span>
                <span className="text-dim">Chain Loss Today: </span>
                <span className={onChainDaily.totalLossUsd / 100 > 500 ? "text-red" :
                                 onChainDaily.totalLossUsd / 100 > 100 ? "text-yellow" : "text-green"}>
                  ${(onChainDaily.totalLossUsd / 100).toFixed(2)}
                </span>
              </span>
            )}
          </div>
        ) : (
          <Spinner size={3} />
        )}
      </Card>

      <SectionTitle>Voice AI Trader</SectionTitle>

      {/* Input + controls */}
      <Card>
        <div className="flex gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !loading && send()}
            placeholder='Try: "Buy ETH now" or "What is my PnL?"'
            className="flex-1 bg-bg border border-border rounded px-3 py-2 text-sm mono text-text placeholder:text-dim focus:outline-none focus:border-muted"
          />

          <button
            onClick={toggleMic}
            disabled={loading || executing}
            title={SpeechRecognition ? (listening ? "Stop listening" : "Voice input") : "Not supported in this browser"}
            className={`px-3 py-2 rounded border mono text-xs transition-colors disabled:opacity-40 ${
              listening
                ? "bg-red/10 text-red border-red/20 pulse"
                : "bg-muted text-dim border-border hover:text-text"
            }`}
          >
            {listening ? "🎙 Stop" : "🎙"}
          </button>

          <ActionBtn onClick={() => send()} loading={loading} disabled={!input.trim() || executing}>
            Send
          </ActionBtn>
        </div>

        {/* TTS controls */}
        <div className="flex items-center gap-3 mt-3 flex-wrap">
          <button
            onClick={() => { setTtsEnabled((v) => !v); if (speaking) stop(); }}
            className={`text-xs mono px-2 py-1 rounded border transition-colors ${
              ttsEnabled
                ? "border-green/30 bg-green/10 text-green"
                : "border-border bg-muted text-dim"
            }`}
            title="Toggle text-to-speech"
          >
            {ttsEnabled ? "🔊 Voice On" : "🔇 Voice Off"}
          </button>

          {speaking && (
            <button
              onClick={stop}
              className="text-xs mono px-2 py-1 rounded border border-red/30 bg-red/10 text-red transition-colors"
            >
              ⏹ Stop Speaking
            </button>
          )}

          {speaking && (
            <span className="text-xs mono text-green flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-green inline-block pulse" />
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
              className="text-xs mono bg-bg border border-border rounded px-2 py-1 text-dim focus:outline-none"
              title="Select TTS voice"
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
          <p className="text-xs mono text-red mt-2 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-red inline-block pulse" />
            Listening… speak now
          </p>
        )}

        {/* Quick examples */}
        <div className="flex flex-wrap gap-1.5 mt-3">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => send(ex)}
              disabled={loading || executing}
              className="text-xs px-2 py-1 rounded border border-border text-dim hover:text-text hover:border-muted mono transition-colors disabled:opacity-40"
            >
              {ex}
            </button>
          ))}
        </div>

        {error && <p className="text-xs text-red mono mt-2">{error}</p>}
      </Card>

      {/* Loading */}
      {loading && (
        <div className="flex items-center gap-2 text-xs mono text-dim">
          <Spinner size={3} />
          <span>Processing your command...</span>
        </div>
      )}

      {/* CHANGE: Execution pipeline status — replaces the single sigStatus card.
          Shows each on-chain step independently so the user knows exactly where
          in the flow they are. Only visible once execution starts. */}
      {executing && (
        <Card>
          <p className="text-xs text-dim mono font-semibold mb-3">Execution Pipeline</p>
          <div className="space-y-2">
            {[
              { key: "sig",        label: "MetaMask Approval",       hint: "Sign to confirm intent — no gas required" },
              { key: "riskrouter", label: "RiskRouter On-Chain TX",  hint: "EIP-712 sign + submit trade — gas required" },
              { key: "validation", label: "Validation Record",       hint: "Store audit proof on-chain — gas required" },
            ].map(({ key, label, hint }) => {
              const st = chainStep[key];
              const dot =
                st === "done"    ? "bg-green" :
                st === "error"   ? "bg-red"   :
                st === "pending" ? "bg-yellow animate-pulse" :
                                   "bg-muted";
              const text =
                st === "done"    ? "text-green"  :
                st === "error"   ? "text-red"    :
                st === "pending" ? "text-yellow" :
                                   "text-dim";
              return (
                <div key={key} className="flex items-center gap-3">
                  <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${dot} transition-all`} />
                  <div>
                    <p className={`text-xs mono ${text}`}>{label}</p>
                    {st === "pending" && (
                      <p className="text-[10px] mono text-dim">{hint}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* MetaMask waiting card — kept for audio feedback continuity */}
      {sigWaiting && (
        <Card className="flex items-center gap-4 border-yellow/20">
          <div className="w-8 h-8 rounded-full bg-yellow/10 flex items-center justify-center text-lg flex-shrink-0">
            🦊
          </div>
          <div>
            <p className="text-sm mono font-medium text-yellow">MetaMask Signature Required</p>
            <p className="text-xs text-dim mono mt-0.5">
              Check your MetaMask popup. Sign to approve this trade. Free — no ETH required.
            </p>
          </div>
        </Card>
      )}

      {/* AI Response */}
      {response && (
        <Card>
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <Badge variant="blue">{response.intent}</Badge>
            {response.action && (
              <Badge variant={actionColor(response.action)}>{response.action}</Badge>
            )}
            {response.token && (
              <span className="text-xs mono text-dim capitalize">
                {response.token.replace(/-/g, " ")}
              </span>
            )}
            {sigSigned && <Badge variant="green">MetaMask ✓</Badge>}
            {/* CHANGE: show RiskRouter approval badge once done */}
            {chainStep.riskrouter === "done" && agent.on_chain_id && (
              <Badge variant="green">⛓ RiskRouter ✓</Badge>
            )}

            <button
              onClick={() => speak(response.explanation)}
              disabled={speaking}
              className="ml-auto text-xs mono px-2 py-0.5 rounded border border-border text-dim hover:text-text transition-colors disabled:opacity-40"
              title="Replay audio"
            >
              🔊 Replay
            </button>
          </div>

          <p className="text-sm text-text leading-relaxed mb-3">{response.explanation}</p>

          {response.decision && (
            <div className="bg-bg border border-border rounded p-3 space-y-2">
              <p className="text-xs text-dim mono font-semibold">AI Analysis</p>
              <div className="grid grid-cols-2 gap-1 text-xs mono">
                {[
                  {
                    label: "Action",
                    val: <Badge variant={actionColor(response.decision.action)}>{response.decision.action}</Badge>,
                  },
                  { label: "Confidence", val: `${response.decision.confidence}%` },
                  {
                    label: "Risk Level",
                    val: response.decision.risk_level,
                    color:
                      response.decision.risk_level === "HIGH" ? "text-red" :
                      response.decision.risk_level === "LOW"  ? "text-green" : "text-yellow",
                  },
                  { label: "Amount", val: `$${response.decision.amount_usd}` },
                ].map(({ label, val, color }) => (
                  <div
                    key={label}
                    className="flex justify-between bg-surface rounded p-1.5 border border-border/50"
                  >
                    <span className="text-dim">{label}</span>
                    {typeof val === "string"
                      ? <span className={color || "text-text"}>{val}</span>
                      : val}
                  </div>
                ))}
              </div>

              {response.decision.indicators && (
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-1 text-xs mono mt-1">
                  {[
                    {
                      label: "RSI",
                      val:   response.decision.indicators.rsi?.toFixed(1),
                      color: response.decision.indicators.rsi < 30 ? "text-green"
                           : response.decision.indicators.rsi > 70 ? "text-red" : "",
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
                      color: response.decision.indicators.sentiment >  0.3 ? "text-green"
                           : response.decision.indicators.sentiment < -0.3 ? "text-red" : "",
                    },
                    {
                      label: "24h Δ",
                      val:   response.decision.indicators.price_change_24h != null
                               ? `${response.decision.indicators.price_change_24h >= 0 ? "+" : ""}${response.decision.indicators.price_change_24h?.toFixed(2)}%`
                               : null,
                      color: (response.decision.indicators.price_change_24h ?? 0) >= 0
                               ? "text-green" : "text-red",
                    },
                  ].map(({ label, val, color }) => (
                    <div key={label} className="bg-surface rounded p-1.5 border border-border/50">
                      <p className="text-dim">{label}</p>
                      <p className={`font-medium ${color || "text-text"}`}>{val ?? "—"}</p>
                    </div>
                  ))}
                </div>
              )}

              {response.decision.indicators?.signals &&
                Object.keys(response.decision.indicators.signals).length > 0 && (
                <div className="pt-2 border-t border-border mt-1">
                  <p className="text-xs text-dim mono mb-1">Signals</p>
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(response.decision.indicators.signals).map(([k, v]) => (
                      <span key={k} className="text-xs mono px-2 py-0.5 rounded bg-muted text-dim">
                        {v}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {response.intent === "trade" && response.decision.action !== "HOLD" && (
                <div className="pt-2 border-t border-border mt-2">
                  <ActionBtn
                    onClick={executeVoiceTrade}
                    loading={executing}
                    disabled={loading}
                    variant="primary"
                  >
                    ⚡ Execute This Trade
                  </ActionBtn>
                  <p className="text-xs text-dim mono mt-1">
                    {response.decision.action} {response.token?.toUpperCase()} ·
                    ${response.decision.amount_usd} · Requires MetaMask signature
                    {agent.on_chain_id && " + RiskRouter TX"}
                  </p>
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      {executing && chainStep.sig === null && (
        <div className="flex justify-center py-6"><Spinner size={6} /></div>
      )}

      {/* Trade result */}
      {tradeResult && (
        <Card>
          <SectionTitle>Trade Executed</SectionTitle>
          <div className="flex items-center gap-3 mb-3 flex-wrap">
            <Badge variant={
              tradeResult.status === "EXECUTED" ? "green" :
              tradeResult.status === "REJECTED" ? "red" : "yellow"
            }>
              {tradeResult.status}
            </Badge>
            <Badge variant={actionColor(tradeResult.action)}>{tradeResult.action}</Badge>
            <span className="mono text-sm">{tradeResult.token_pair}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs mono">
            {[
              { label: "Amount",     val: `$${tradeResult.amount_usd}` },
              {
                label: "PnL",
                val:   tradeResult.pnl != null ? `$${tradeResult.pnl.toFixed(4)}` : "—",
                color: (tradeResult.pnl ?? 0) >= 0 ? "text-green" : "text-red",
              },
              { label: "Risk Check", val: tradeResult.risk_check?.toUpperCase() },
              { label: "Confidence", val: `${tradeResult.confidence}%` },
            ].map(({ label, val, color }) => (
              <div key={label} className="bg-bg border border-border rounded p-2">
                <p className="text-dim">{label}</p>
                <p className={`font-medium ${color || ""}`}>{val}</p>
              </div>
            ))}
          </div>

          {/* CHANGE: RiskRouter on-chain badge + validation badge */}
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            {tradeResult.on_chain_id && (
              <>
                <span className="text-xs mono px-1.5 py-0.5 rounded bg-green/10 text-green border border-green/20">
                  ⛓ RiskRouter Approved
                </span>
                <a
                  href={`https://sepolia.etherscan.io/tx/${tradeResult.on_chain_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue hover:underline mono"
                >
                  {tradeResult.on_chain_id.startsWith("0x")
                    ? `${tradeResult.on_chain_id.slice(0, 22)}…`
                    : tradeResult.on_chain_id}
                </a>
              </>
            )}
            {chainStep.validation === "done" && agent.on_chain_id && (
              <span className="text-xs mono px-1.5 py-0.5 rounded bg-green/10 text-green border border-green/20">
                📋 Validation stored on-chain
              </span>
            )}
            {chainStep.validation === "error" && (
              <span className="text-xs mono px-1.5 py-0.5 rounded bg-yellow/10 text-yellow border border-yellow/20">
                ⚠ Validation store failed (trade executed successfully)
              </span>
            )}
          </div>
        </Card>
      )}

      {/* Command history */}
      {history.length > 0 && (
        <div>
          <SectionTitle>Command History</SectionTitle>
          <div className="space-y-2">
            {history.map((h, i) => (
              <div
                key={i}
                className="bg-surface border border-border rounded-lg px-3 py-2 flex items-start gap-3 cursor-pointer hover:border-muted transition-colors"
                onClick={() => speak(h.r.explanation)}
                title="Click to replay audio"
              >
                <span className="text-xs text-dim mono flex-shrink-0 mt-0.5">{h.ts}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs mono text-green">"{h.cmd}"</p>
                  <p className="text-xs text-dim mono truncate mt-0.5">{h.r.explanation}</p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <Badge variant="blue">{h.r.intent}</Badge>
                  <span className="text-dim text-xs" title="Replay">🔊</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}