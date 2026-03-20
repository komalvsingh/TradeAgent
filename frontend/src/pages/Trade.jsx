import React, { useState, useEffect } from "react";
import { useWallet } from "../context/WalletContext";
import { useAgent } from "../context/AgentContext";
import { getDecision, executeTrade, getTokens } from "../utils/api";
import {
  Card, SectionTitle, Badge, ActionBtn,
  Input, Spinner, ConnectPrompt, EmptyState,
} from "../components/UI";

const STRATEGIES = [
  { value: "COMBINED",     label: "Combined (RSI + MA + Sentiment)" },
  { value: "RSI",          label: "RSI Only"                        },
  { value: "MA_CROSSOVER", label: "MA Crossover"                    },
  { value: "SENTIMENT",    label: "Sentiment Only"                   },
];

const ACTION_OPTIONS = [
  { value: "AI",   label: "Let AI Decide (Recommended)" },
  { value: "BUY",  label: "Force BUY"                   },
  { value: "SELL", label: "Force SELL"                   },
  { value: "HOLD", label: "Force HOLD"                   },
];

function actionColor(a) {
  if (a === "BUY")  return "green";
  if (a === "SELL") return "red";
  return "yellow";
}

export default function Trade() {
  const { account, signer } = useWallet();
  const { agent }           = useAgent();

  const [tokens,     setTokens]    = useState([]);
  const [token,      setToken]     = useState("ethereum");
  const [strategy,   setStrategy]  = useState("COMBINED");
  const [actionMode, setActionMode]= useState("AI");  // "AI" | "BUY" | "SELL" | "HOLD"
  const [decision,   setDecision]  = useState(null);
  const [result,     setResult]    = useState(null);
  const [loading,    setLoading]   = useState(false);
  const [executing,  setExecuting] = useState(false);
  const [sigStatus,  setSigStatus] = useState(null);
  const [error,      setError]     = useState(null);

  // Load token list dynamically from backend
  useEffect(() => {
    getTokens()
      .then((d) => {
        const list = (d.tokens || []).map((t) => ({
          value: t,
          label: t.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        }));
        setTokens(list);
      })
      .catch(() => {
        // Fallback token list matching backend
        setTokens([
          { value: "ethereum",      label: "Ethereum"  },
          { value: "bitcoin",       label: "Bitcoin"   },
          { value: "matic-network", label: "Polygon"   },
          { value: "chainlink",     label: "Chainlink" },
          { value: "uniswap",       label: "Uniswap"   },
          { value: "aave",          label: "Aave"      },
        ]);
      });
  }, []);

  if (!account) return <ConnectPrompt />;
  if (!agent)   return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <EmptyState message="Register an agent first on the Dashboard." />
    </div>
  );

  const handleDecision = async () => {
    setLoading(true);
    setError(null);
    setDecision(null);
    setResult(null);
    setSigStatus(null);
    try {
      const d = await getDecision({ token, strategy, wallet_address: account });
      // If manual override is set, show what AI said vs what will be forced
      setDecision({ ...d, forcedAction: actionMode !== "AI" ? actionMode : null });
    } catch (e) {
      setError(e.response?.data?.detail || e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleExecute = async () => {
    setExecuting(true);
    setError(null);
    setResult(null);
    setSigStatus(null);

    try {
      // Step 1: Get decision from backend
      const preDecision = await getDecision({ token, strategy, wallet_address: account });
      const finalAction = actionMode !== "AI" ? actionMode : preDecision.action;

      // Step 2: MetaMask signature
      setSigStatus("waiting");
      let signature = null;
      try {
        const message = [
          "═══ AI Trade Approval ═══",
          `Action    : ${finalAction}`,
          `Pair      : ${preDecision.token_pair}`,
          `Amount    : $${preDecision.amount_usd}`,
          `Confidence: ${preDecision.confidence}%`,
          `Risk      : ${preDecision.risk_level}`,
          `Strategy  : ${preDecision.strategy_used}`,
          `Mode      : ${actionMode === "AI" ? "AI Auto" : "Manual Override"}`,
          `Wallet    : ${account}`,
          `Time      : ${new Date().toISOString()}`,
          "─────────────────────────",
          "Signing approves this AI trade. No ETH spent here.",
        ].join("\n");

        signature = await signer.signMessage(message);
        setSigStatus("signed");
      } catch (sigErr) {
        setSigStatus("rejected");
        setError("Trade cancelled — MetaMask signature rejected.");
        setExecuting(false);
        return;
      }

      // Step 3: Execute on backend
      const r = await executeTrade({
        token,
        strategy,
        wallet_address: account,
        signature,
        forced_action: actionMode !== "AI" ? actionMode : undefined,
      });

      setDecision({ ...preDecision, forcedAction: actionMode !== "AI" ? actionMode : null });
      setResult(r);

    } catch (e) {
      setError(e.response?.data?.detail || e.message);
    } finally {
      setExecuting(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">

      {/* Controls */}
      <div>
        <SectionTitle>Trade</SectionTitle>
        <Card>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <Input
              label="Token"
              value={token}
              onChange={setToken}
              options={tokens}
            />
            <Input
              label="Strategy"
              value={strategy}
              onChange={setStrategy}
              options={STRATEGIES}
            />
            <Input
              label="Action Mode"
              value={actionMode}
              onChange={setActionMode}
              options={ACTION_OPTIONS}
            />
            <div className="flex flex-col gap-1">
              <label className="text-xs text-dim mono">Agent</label>
              <div className="bg-bg border border-border rounded px-3 py-2 text-sm mono text-dim truncate">
                {agent.name} · {agent.strategy} · ${agent.max_trade_usd}
              </div>
            </div>
          </div>

          {/* Action mode info */}
          {actionMode !== "AI" && (
            <div className="mb-3 px-3 py-2 rounded border border-yellow/20 bg-yellow/5">
              <p className="text-xs mono text-yellow">
                ⚠ Manual override: Trade will be forced to{" "}
                <strong>{actionMode}</strong> regardless of AI recommendation.
              </p>
            </div>
          )}

          <div className="flex gap-2 items-center flex-wrap">
            <ActionBtn onClick={handleDecision} loading={loading} disabled={executing}>
              Get AI Decision
            </ActionBtn>
            <ActionBtn onClick={handleExecute} loading={executing} variant="primary" disabled={loading}>
              Execute Trade
            </ActionBtn>

            {sigStatus === "waiting" && (
              <span className="text-xs mono text-yellow flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-yellow inline-block pulse" />
                Waiting for MetaMask...
              </span>
            )}
            {sigStatus === "signed" && (
              <span className="text-xs mono text-green flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-green inline-block" />
                Signature confirmed
              </span>
            )}
            {sigStatus === "rejected" && (
              <span className="text-xs mono text-red flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-red inline-block" />
                Signature rejected
              </span>
            )}
          </div>

          {error && <p className="text-xs text-red mono mt-3">{error}</p>}
        </Card>
      </div>

      {loading && <div className="flex justify-center py-6"><Spinner size={6} /></div>}

      {/* MetaMask waiting card */}
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

      {/* AI Decision */}
      {decision && (
        <div>
          <SectionTitle>AI Decision {decision.forcedAction ? "(Overridden)" : "(Preview)"}</SectionTitle>
          <Card>
            <div className="flex items-center gap-3 mb-4 flex-wrap">
              {/* Show AI decision */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-dim mono">AI says:</span>
                <Badge variant={actionColor(decision.action)}>{decision.action}</Badge>
              </div>

              {/* Show override if set */}
              {decision.forcedAction && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-dim mono">→ Forced to:</span>
                  <Badge variant={actionColor(decision.forcedAction)}>{decision.forcedAction}</Badge>
                </div>
              )}

              <span className="mono text-sm font-semibold">{decision.token_pair}</span>
              <span className="text-dim mono text-xs">
                ${decision.amount_usd} · {decision.confidence}% confidence
              </span>
              <Badge
                variant={
                  decision.risk_level === "HIGH" ? "red" :
                  decision.risk_level === "LOW"  ? "green" : "yellow"
                }
              >
                {decision.risk_level} risk
              </Badge>
            </div>

            <p className="text-sm text-text mb-4 leading-relaxed">{decision.reason}</p>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { label: "RSI (14)",  val: decision.indicators?.rsi?.toFixed(1),
                  color: decision.indicators?.rsi < 30 ? "text-green" : decision.indicators?.rsi > 70 ? "text-red" : "" },
                { label: "MA7",       val: `$${decision.indicators?.ma_7?.toFixed(2)}` },
                { label: "MA25",      val: `$${decision.indicators?.ma_25?.toFixed(2)}` },
                { label: "Sentiment", val: decision.indicators?.sentiment?.toFixed(4),
                  color: decision.indicators?.sentiment > 0.3 ? "text-green" : decision.indicators?.sentiment < -0.3 ? "text-red" : "" },
              ].map(({ label, val, color }) => (
                <div key={label} className="bg-bg rounded p-2 border border-border">
                  <p className="text-xs text-dim mono">{label}</p>
                  <p className={`text-sm mono font-medium ${color || "text-text"}`}>{val ?? "—"}</p>
                </div>
              ))}
            </div>

            {/* Signals breakdown */}
            {decision.indicators?.signals && (
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

      {executing && !sigStatus && <div className="flex justify-center py-6"><Spinner size={6} /></div>}

      {/* Execution Result */}
      {result && (
        <div>
          <SectionTitle>Execution Result</SectionTitle>
          <Card>
            <div className="flex items-center gap-3 mb-3 flex-wrap">
              <Badge
                variant={
                  result.status === "EXECUTED" ? "green" :
                  result.status === "REJECTED" ? "red" : "yellow"
                }
              >
                {result.status}
              </Badge>
              <Badge variant={actionColor(result.action)}>{result.action}</Badge>
              <span className="mono text-sm">{result.token_pair}</span>
              {sigStatus === "signed" && <Badge variant="green">MetaMask Approved ✓</Badge>}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
              {[
                { label: "Amount",     val: `$${result.amount_usd}` },
                {
                  label: "PnL",
                  val:   result.pnl != null ? `$${result.pnl.toFixed(4)}` : "—",
                  color: (result.pnl ?? 0) >= 0 ? "text-green" : "text-red",
                },
                { label: "Risk Check",  val: result.risk_check?.toUpperCase() },
                { label: "Confidence",  val: `${result.confidence}%` },
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
            {result.on_chain_id && (
              <p className="text-xs text-dim mono break-all mt-1">
                On-chain proof:{" "}
                <a
                  href={`https://sepolia.etherscan.io/tx/${result.on_chain_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue hover:underline"
                >
                  {result.on_chain_id.slice(0, 20)}...
                </a>
              </p>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}