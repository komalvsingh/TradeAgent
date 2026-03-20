import React, { useState, useRef, useEffect } from "react";
import { useWallet } from "../context/WalletContext";
import { useAgent } from "../context/AgentContext";
import { sendVoice, getDashboard } from "../utils/api";
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

export default function Voice() {
  const { account }         = useWallet();
  const { agent, refetch }  = useAgent();
  const [input,     setInput]    = useState("");
  const [response,  setResponse] = useState(null);
  const [loading,   setLoading]  = useState(false);
  const [error,     setError]    = useState(null);
  const [history,   setHistory]  = useState([]);
  const [stats,     setStats]    = useState(null);
  const inputRef = useRef(null);

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

  const send = async (text) => {
    const cmd = (text || input).trim();
    if (!cmd) return;
    setLoading(true);
    setError(null);
    setResponse(null);

    try {
      const r = await sendVoice({ text: cmd, wallet_address: account });
      setResponse(r);
      setHistory((h) => [
        { cmd, r, ts: new Date().toLocaleTimeString() },
        ...h.slice(0, 9),
      ]);
      setInput("");

      // Refresh agent + stats after any trade or settings command
      if (r.intent === "trade" || r.intent === "settings") {
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

      {/* Input */}
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
          <ActionBtn onClick={() => send()} loading={loading} disabled={!input.trim()}>
            Send
          </ActionBtn>
        </div>

        {/* Quick example buttons */}
        <div className="flex flex-wrap gap-1.5 mt-3">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => send(ex)}
              disabled={loading}
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

      {/* Response */}
      {response && (
        <Card>
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <Badge variant="blue">{response.intent}</Badge>
            {response.action && (
              <Badge variant={actionColor(response.action)}>{response.action}</Badge>
            )}
            {response.token && (
              <span className="text-xs mono text-dim capitalize">
                {response.token.replace("-", " ")}
              </span>
            )}
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
                      {label}: <span className="text-text">{val}</span>
                    </div>
                  ))}
                </div>
              )}
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