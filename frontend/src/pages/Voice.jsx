import React, { useState, useRef, useEffect, useCallback } from "react";
import { useWallet } from "../context/WalletContext";
import { useAgent } from "../context/AgentContext";
import { sendVoice, getDashboard, executeTrade, getDecision } from "../utils/api";
import { Card, SectionTitle, ActionBtn, Badge, ConnectPrompt, EmptyState, Spinner } from "../components/UI";

const EXAMPLES = [
  "Buy ETH now",
  "Sell Bitcoin",
  "What is my PnL?",
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

export default function Voice() {
  const { account, signer }    = useWallet();
  const { agent, refetch }     = useAgent();
  const [input,     setInput]    = useState("");
  const [response,  setResponse] = useState(null);
  const [tradeResult, setTradeResult] = useState(null);
  const [loading,   setLoading]  = useState(false);
  const [executing, setExecuting] = useState(false);
  const [listening, setListening] = useState(false);
  const [sigStatus, setSigStatus] = useState(null); // "waiting"|"signed"|"rejected"
  const [error,     setError]    = useState(null);
  const [history,   setHistory]  = useState([]);
  const [stats,     setStats]    = useState(null);
  const inputRef  = useRef(null);
  const recogRef  = useRef(null);

  // Load live dashboard stats to show real PnL, trust score
  useEffect(() => {
    if (!account || !agent) return;
    getDashboard(account)
      .then(setStats)
      .catch(() => {});
  }, [account, agent]);

  if (!account) return <ConnectPrompt />;
  if (!agent)   return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <EmptyState message="Register an agent first on the Dashboard." />
    </div>
  );

  // ── Send voice command to backend ─────────────────────────────────────────
  const send = async (text) => {
    const cmd = (text || input).trim();
    if (!cmd) return;
    setLoading(true);
    setError(null);
    setResponse(null);
    setTradeResult(null);
    setSigStatus(null);

    try {
      const r = await sendVoice({ text: cmd, wallet_address: account });
      setResponse(r);
      setHistory((h) => [
        { cmd, r, ts: new Date().toLocaleTimeString() },
        ...h.slice(0, 9),
      ]);
      setInput("");

      // Refresh agent + stats after settings change
      if (r.intent === "settings") {
        await refetch();
        const s = await getDashboard(account).catch(() => null);
        if (s) setStats(s);
      }
    } catch (e) {
      setError(e.response?.data?.detail || e.message);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  // ── Execute the trade from a voice command ────────────────────────────────
  const executeVoiceTrade = async () => {
    if (!response?.decision) return;
    setExecuting(true);
    setError(null);
    setTradeResult(null);
    setSigStatus(null);

    try {
      const token    = response.token || "ethereum";
      const strategy = agent.strategy;

      // Step 1: MetaMask signature
      setSigStatus("waiting");
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
        setSigStatus("signed");
      } catch {
        setSigStatus("rejected");
        setError("Trade cancelled — MetaMask signature rejected.");
        setExecuting(false);
        return;
      }

      // Step 2: Execute
      const result = await executeTrade({
        token,
        strategy,
        wallet_address: account,
      });
      setTradeResult(result);

      // Refresh stats after execution
      const s = await getDashboard(account).catch(() => null);
      if (s) setStats(s);
      await refetch();

    } catch (e) {
      setError(e.response?.data?.detail || e.message);
    } finally {
      setExecuting(false);
    }
  };

  // ── Microphone (Web Speech API) ───────────────────────────────────────────
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

    const recog = new SpeechRecognition();
    recog.lang             = "en-US";
    recog.interimResults   = false;
    recog.maxAlternatives  = 1;

    recog.onresult = (e) => {
      const transcript = e.results[0][0].transcript;
      setInput(transcript);
      setListening(false);
      // Auto-send after a short delay so user sees what was transcribed
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

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">

      {/* Live agent stats strip */}
      <Card className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <span className="mono text-sm font-semibold">{agent.name}</span>
          <Badge variant="blue">{agent.strategy}</Badge>
          <Badge variant={agent.risk_tolerance === "HIGH" ? "red" : agent.risk_tolerance === "LOW" ? "green" : "yellow"}>
            {agent.risk_tolerance}
          </Badge>
        </div>
        {stats ? (
          <div className="flex gap-4 text-xs mono">
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
          </div>
        ) : (
          <Spinner size={3} />
        )}
      </Card>

      <SectionTitle>Voice AI Trader</SectionTitle>

      {/* Input + Mic */}
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

          {/* Mic button */}
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

        {listening && (
          <p className="text-xs mono text-red mt-2 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-red inline-block pulse" />
            Listening… speak now
          </p>
        )}

        {/* Quick example buttons */}
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

      {/* MetaMask waiting */}
      {sigStatus === "waiting" && (
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

      {/* Response from voice command */}
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
            {sigStatus === "signed" && <Badge variant="green">MetaMask ✓</Badge>}
          </div>

          <p className="text-sm text-text leading-relaxed mb-3">{response.explanation}</p>

          {/* AI Decision details */}
          {response.decision && (
            <div className="bg-bg border border-border rounded p-3 space-y-2">
              <p className="text-xs text-dim mono font-semibold">AI Analysis</p>
              <div className="grid grid-cols-2 gap-1 text-xs mono">
                <div className="flex justify-between bg-surface rounded p-1.5 border border-border/50">
                  <span className="text-dim">Action</span>
                  <Badge variant={actionColor(response.decision.action)}>
                    {response.decision.action}
                  </Badge>
                </div>
                <div className="flex justify-between bg-surface rounded p-1.5 border border-border/50">
                  <span className="text-dim">Confidence</span>
                  <span className="text-text">{response.decision.confidence}%</span>
                </div>
                <div className="flex justify-between bg-surface rounded p-1.5 border border-border/50">
                  <span className="text-dim">Risk Level</span>
                  <span className={
                    response.decision.risk_level === "HIGH" ? "text-red" :
                    response.decision.risk_level === "LOW"  ? "text-green" : "text-yellow"
                  }>
                    {response.decision.risk_level}
                  </span>
                </div>
                <div className="flex justify-between bg-surface rounded p-1.5 border border-border/50">
                  <span className="text-dim">Amount</span>
                  <span className="text-text">${response.decision.amount_usd}</span>
                </div>
              </div>

              {/* Indicators */}
              {response.decision.indicators && (
                <div className="grid grid-cols-2 gap-1 text-xs mono mt-1">
                  {[
                    { label: "RSI",       val: response.decision.indicators.rsi?.toFixed(1) },
                    { label: "Sentiment", val: response.decision.indicators.sentiment?.toFixed(3) },
                  ].map(({ label, val }) => (
                    <div key={label} className="text-dim">
                      {label}: <span className="text-text">{val ?? "—"}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Execute button — only for trade intents */}
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
                    Executes {response.decision.action} {response.token?.toUpperCase()} · ${response.decision.amount_usd} · Requires MetaMask signature
                  </p>
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      {/* Trade Execution Result */}
      {tradeResult && (
        <Card>
          <SectionTitle>Trade Executed</SectionTitle>
          <div className="flex items-center gap-3 mb-3 flex-wrap">
            <Badge variant={tradeResult.status === "EXECUTED" ? "green" : tradeResult.status === "REJECTED" ? "red" : "yellow"}>
              {tradeResult.status}
            </Badge>
            <Badge variant={actionColor(tradeResult.action)}>{tradeResult.action}</Badge>
            <span className="mono text-sm">{tradeResult.token_pair}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs mono">
            {[
              { label: "Amount",     val: `$${tradeResult.amount_usd}` },
              { label: "PnL",        val: tradeResult.pnl != null ? `$${tradeResult.pnl?.toFixed(4)}` : "—",
                color: (tradeResult.pnl ?? 0) >= 0 ? "text-green" : "text-red" },
              { label: "Risk Check", val: tradeResult.risk_check?.toUpperCase() },
              { label: "Confidence", val: `${tradeResult.confidence}%` },
            ].map(({ label, val, color }) => (
              <div key={label} className="bg-bg border border-border rounded p-2">
                <p className="text-dim">{label}</p>
                <p className={`font-medium ${color || ""}`}>{val}</p>
              </div>
            ))}
          </div>
          {tradeResult.on_chain_id && (
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <span className="text-xs mono px-1.5 py-0.5 rounded bg-green/10 text-green border border-green/20">
                ⛓ RiskRouter Approved
              </span>
              <a
                href={`https://sepolia.etherscan.io/tx/${tradeResult.on_chain_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue hover:underline mono"
                title={tradeResult.on_chain_id}
              >
                {tradeResult.on_chain_id.startsWith("0x")
                  ? `${tradeResult.on_chain_id.slice(0, 22)}…`
                  : tradeResult.on_chain_id}
              </a>
            </div>
          )}
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
                className="bg-surface border border-border rounded-lg px-3 py-2 flex items-start gap-3"
              >
                <span className="text-xs text-dim mono flex-shrink-0 mt-0.5">{h.ts}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs mono text-green">"{h.cmd}"</p>
                  <p className="text-xs text-dim mono truncate mt-0.5">{h.r.explanation}</p>
                </div>
                <Badge variant="blue">{h.r.intent}</Badge>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}