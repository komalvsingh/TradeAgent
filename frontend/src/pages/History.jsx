import React, { useEffect, useState, useCallback, Suspense, lazy } from "react";
import { useWallet }    from "../context/WalletContext";
import { useAgent }     from "../context/AgentContext";
import { useContracts } from "../context/ContractContext";
import { getHistory, replayTrade } from "../utils/api";
import {
  Card, SectionTitle, Badge, ActionBtn,
  Spinner, EmptyState, ConnectPrompt,
} from "../components/UI";
const NeuralBackground = lazy(() => import("../components/three/NeuralBackground"));

const G = {
  mono: { fontFamily: "'JetBrains Mono', monospace" },
  syne: { fontFamily: "'Syne', sans-serif" },
  statCard: {
    background: "rgba(13,17,23,0.8)",
    border: "1px solid rgba(0,191,255,0.14)",
    borderRadius: 14,
    padding: "16px 18px",
    backdropFilter: "blur(12px)",
  },
};

function actionColor(a) {
  if (a === "BUY")  return "green";
  if (a === "SELL") return "red";
  return "default";
}

// ── Replay + Validation Modal ─────────────────────────────────────────────────
// CHANGE: ReplayModal now accepts verifyValidationArtifact from the parent so
// users can trigger an on-chain proof check for any trade that has a stored
// ValidationRegistry artifact. The verify call is lazy (button-triggered) to
// avoid N RPC calls when the modal opens — it only hits the chain on demand.
function ReplayModal({ tradeId, onClose, verifyValidationArtifact }) {
  const [data,        setData]        = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState(null);
  // CHANGE: per-trade validation proof state
  const [proofStatus, setProofStatus] = useState(null); // null | "checking" | "verified" | "invalid" | "not_found"

  useEffect(() => {
    replayTrade(tradeId)
      .then(setData)
      .catch((e) => setError(e.response?.data?.detail || e.message))
      .finally(() => setLoading(false));
  }, [tradeId]);

  // CHANGE: on-demand proof verification via ValidationRegistry.
  // verifyValidationArtifact(tradeId) is a view call — no gas, no MetaMask popup.
  // Returns true if the stored artifact hash matches the recomputed hash AND
  // the validator signature is still valid. Returns false if tampered or missing.
  const handleVerify = async () => {
    if (!verifyValidationArtifact) return;
    setProofStatus("checking");
    try {
      const verified = await verifyValidationArtifact(tradeId);
      setProofStatus(verified ? "verified" : "invalid");
    } catch (e) {
      // Contract reverts with "trade not found" if no artifact was stored
      const msg = e.message?.toLowerCase() || "";
      if (msg.includes("trade not found") || msg.includes("not found")) {
        setProofStatus("not_found");
      } else {
        setProofStatus("invalid");
        console.warn("Artifact verification error:", e.message);
      }
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <Card className="max-w-lg w-full max-h-[80vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <div>
            <SectionTitle>Replay Trade</SectionTitle>
            <p className="text-xs text-dim mono -mt-2">
              {tradeId.slice(0, 20)}...
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-dim hover:text-text text-xs mono px-2 py-1 border border-border rounded"
          >
            ✕ Close
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-8"><Spinner size={6} /></div>
        ) : error ? (
          <p className="text-xs text-red mono">{error}</p>
        ) : data ? (
          <div className="space-y-3">
            {data.steps?.map((step) => (
              <div key={step.step} className="flex gap-3">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs mono font-bold flex-shrink-0 ${
                  step.step <= 5 ? "bg-green/10 text-green border border-green/20" : "bg-muted text-dim"
                }`}>
                  {step.step}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium mono text-text">{step.title}</p>
                  <p className="text-xs text-dim mono mt-0.5">{step.description}</p>
                  {step.detail && step.detail !== "N/A" && (
                    <p className="text-xs mono mt-0.5 break-all">
                      {step.detail.startsWith("0x") ? (
                        <a
                          href={`https://sepolia.etherscan.io/tx/${step.detail}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue hover:underline"
                        >
                          {step.detail.slice(0, 30)}...
                        </a>
                      ) : (
                        <span className="text-dim">{step.detail}</span>
                      )}
                    </p>
                  )}
                </div>
              </div>
            ))}

            {/* Trade summary */}
            {data.summary && (
              <div className="mt-4 pt-4 border-t border-border">
                <p className="text-xs text-dim mono font-semibold mb-2">Trade Summary</p>
                <div className="grid grid-cols-2 gap-1.5 text-xs mono">
                  {[
                    { label: "Action",     val: data.summary.action },
                    { label: "Amount",     val: `$${data.summary.amount_usd}` },
                    { label: "PnL",        val: data.summary.pnl != null ? `$${data.summary.pnl?.toFixed(4)}` : "—" },
                    { label: "Risk",       val: data.summary.risk_level },
                    { label: "Confidence", val: `${data.summary.confidence}%` },
                    { label: "Status",     val: data.summary.status },
                  ].map(({ label, val }) => (
                    <div key={label} className="bg-bg border border-border rounded p-1.5">
                      <span className="text-dim">{label}: </span>
                      <span className="text-text">{val}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* CHANGE: On-chain artifact verification section.
                Only shown when verifyValidationArtifact is available (i.e. the
                ValidationRegistry contract is connected). The call is a pure
                view — no MetaMask, no gas. It recomputes the artifact hash from
                stored fields and checks the validator signature, returning true
                only if both match exactly. */}
            {verifyValidationArtifact && (
              <div className="mt-4 pt-4 border-t border-border">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-dim mono font-semibold">On-Chain Proof</p>
                  {proofStatus === null && (
                    <button
                      onClick={handleVerify}
                      className="text-xs mono px-2 py-1 rounded border border-border text-dim hover:text-text hover:border-muted transition-colors"
                    >
                      Verify Artifact
                    </button>
                  )}
                  {proofStatus === "checking" && (
                    <span className="flex items-center gap-1.5 text-xs mono text-yellow">
                      <Spinner size={3} /> Checking chain...
                    </span>
                  )}
                </div>

                {proofStatus === "verified" && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded border border-green/20 bg-green/5">
                    <span className="text-green text-sm">✓</span>
                    <div>
                      <p className="text-xs mono text-green font-medium">Artifact Verified</p>
                      <p className="text-[10px] mono text-dim mt-0.5">
                        Hash matches · Validator signature valid · ValidationRegistry confirmed
                      </p>
                    </div>
                  </div>
                )}
                {proofStatus === "invalid" && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded border border-red/20 bg-red/5">
                    <span className="text-red text-sm">✕</span>
                    <div>
                      <p className="text-xs mono text-red font-medium">Artifact Invalid</p>
                      <p className="text-[10px] mono text-dim mt-0.5">
                        Hash mismatch or signature invalid — artifact may have been tampered with
                      </p>
                    </div>
                  </div>
                )}
                {proofStatus === "not_found" && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded border border-border bg-muted/5">
                    <span className="text-dim text-sm">—</span>
                    <div>
                      <p className="text-xs mono text-dim font-medium">No Artifact Found</p>
                      <p className="text-[10px] mono text-dim mt-0.5">
                        This trade was executed before on-chain validation was enabled
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : null}
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function History() {
  const { account }   = useWallet();
  // CHANGE: useAgent for agent.on_chain_id — needed to call getAgentTradeCount
  const { agent }     = useAgent();
  // CHANGE: useContracts for on-chain data — getAgentTradeCount and
  // verifyValidationArtifact (passed into ReplayModal).
  const {
    getAgentTradeCount,
    verifyValidationArtifact,
  } = useContracts();

  const [trades,         setTrades]         = useState([]);
  const [loading,        setLoading]        = useState(false);
  const [error,          setError]          = useState(null);
  const [replayId,       setReplayId]       = useState(null);
  const [lastFetch,      setLastFetch]      = useState(null);
  // CHANGE: on-chain settled trade count from ValidationRegistry
  const [onChainCount,   setOnChainCount]   = useState(null);

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

  // CHANGE: fetch on-chain trade count from ValidationRegistry once the agent
  // and contract are available. This is how many trades have a stored
  // validation artifact on-chain — may differ from the backend count if some
  // trades ran before on-chain validation was enabled, or if storeValidation
  // failed for a trade. Non-fatal if the contract isn't connected.
  useEffect(() => {
    if (!agent?.on_chain_id || !getAgentTradeCount) return;
    getAgentTradeCount(Number(agent.on_chain_id))
      .then(setOnChainCount)
      .catch(() => {}); // non-fatal — contract may not be deployed yet
  }, [agent, getAgentTradeCount]);

  if (!account) return <ConnectPrompt />;

  const executedTrades = trades.filter((t) => t.status === "EXECUTED");
  const rejectedTrades = trades.filter((t) => t.status === "REJECTED");
  const totalPnL       = executedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);

  return (
    <div style={{ position: "relative" }}>
    <Suspense fallback={null}>
      <NeuralBackground agentActive={false} />
    </Suspense>
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "40px 24px", position: "relative", zIndex: 1, display: "flex", flexDirection: "column", gap: 24 }}>

      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <span style={{ ...G.mono, fontSize:10, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.12em", color:"#00FF88", display:"block", marginBottom:8 }}>Validated Trades</span>
          <h1 style={{ ...G.syne, fontWeight:800, fontSize:"clamp(22px,3vw,30px)", margin:0, background:"linear-gradient(90deg,#00FF88,#00BFFF)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>Trade History</h1>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          {lastFetch && <span style={{ ...G.mono, fontSize:10, color:"#6b7280" }}>Updated {lastFetch}</span>}
          <button onClick={fetchHistory} disabled={loading} style={{ ...G.mono, fontSize:11, fontWeight:700, padding:"8px 16px", borderRadius:9, border:"1px solid rgba(0,191,255,0.3)", background:"rgba(0,191,255,0.08)", color:"#00BFFF", cursor:loading?"not-allowed":"pointer", opacity:loading?0.5:1 }}>
            {loading ? "Loading…" : "↻ Refresh"}
          </button>
        </div>
      </div>

      {/* Summary stats */}
      {/* CHANGE: added "On-Chain Validated" stat box showing how many trades
          have a confirmed ValidationRegistry artifact. onChainCount comes from
          getAgentTradeCount(agent.on_chain_id). When it differs from the
          backend executed count it signals trades that ran before the
          storeValidation step was added, or where it failed. */}
      {trades.length > 0 && (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))", gap:12 }}>
          {[
            { label:"Total", value:trades.length, color:"#e5e7eb" },
            { label:"Executed", value:executedTrades.length, color:"#00FF88" },
            { label:"Rejected", value:rejectedTrades.length, color:"#FF4444" },
            { label:"Total PnL", value:`$${totalPnL.toFixed(4)}`, color: totalPnL>=0?"#00FF88":"#FF4444" },
            {
              label:"On-Chain Validated",
              value: onChainCount!=null ? onChainCount : "—",
              color: onChainCount!=null && onChainCount < executedTrades.length ? "#FFB800" : "#00FF88",
              sub: onChainCount!=null && onChainCount < executedTrades.length
                ? `${executedTrades.length - onChainCount} without proof` : "ValidationRegistry",
            },
          ].map(({ label, value, color, sub }) => (
            <div key={label} style={G.statCard}>
              <p style={{ ...G.mono, fontSize:9, color:"#6b7280", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:6 }}>{label}</p>
              <p style={{ ...G.syne, fontSize:22, fontWeight:800, color, margin:0, lineHeight:1 }}>{value}</p>
              {sub && <p style={{ ...G.mono, fontSize:9, color:"#6b7280", marginTop:4 }}>{sub}</p>}
            </div>
          ))}
        </div>
      )}

      {/* Table */}
      {loading && trades.length === 0 ? (
        <div className="flex justify-center py-10"><Spinner size={6} /></div>
      ) : error ? (
        <Card>
          <p className="text-xs text-red mono">{error}</p>
          <button onClick={fetchHistory} className="text-xs text-dim hover:text-text mono mt-2 underline">
            Retry
          </button>
        </Card>
      ) : trades.length === 0 ? (
        <div style={{ textAlign:"center", padding:"48px 0", ...G.mono, fontSize:12, color:"#6b7280" }}>No trades yet. Go to the Trade page.</div>
      ) : (
        <div style={{ background:"rgba(13,17,23,0.8)", border:"1px solid rgba(0,191,255,0.14)", borderRadius:16, padding:"20px 24px", backdropFilter:"blur(14px)" }}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs mono min-w-[760px]">
              <thead>
                <tr className="text-dim border-b border-border">
                  <th className="text-left pb-2 font-medium">Pair</th>
                  <th className="text-left pb-2 font-medium">Action</th>
                  <th className="text-left pb-2 font-medium">Amount</th>
                  <th className="text-left pb-2 font-medium">Confidence</th>
                  <th className="text-left pb-2 font-medium">PnL</th>
                  <th className="text-left pb-2 font-medium">Risk</th>
                  <th className="text-left pb-2 font-medium">Status</th>
                  {/* CHANGE: renamed "On-chain" → "Chain TX" and widened the
                      column to show on_chain_trade_hash (the RiskRouter bytes32
                      trade hash) preferentially — this is what Trade.jsx and
                      Voice.jsx now submit to the backend as on_chain_trade_hash.
                      Falls back to on_chain_id if it starts with 0x. */}
                  <th className="text-left pb-2 font-medium">Chain TX</th>
                  <th className="text-left pb-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t) => {
                  // CHANGE: prefer on_chain_trade_hash (RiskRouter TX hash, 0x…)
                  // over on_chain_id for the Etherscan link. on_chain_id stores
                  // the agent NFT id (integer) from AgentRegistry — not a TX hash.
                  // on_chain_trade_hash is the bytes32 tradeHash from RiskRouter.
                  const txHash =
                    (t.on_chain_trade_hash?.startsWith("0x") && t.on_chain_trade_hash) ||
                    (t.on_chain_id?.startsWith?.("0x")       && t.on_chain_id)         ||
                    null;

                  return (
                    <tr key={t.id} className="border-b border-border/40 last:border-0 hover:bg-muted/10">
                      <td className="py-2 text-text font-medium">{t.token_pair}</td>
                      <td className="py-2">
                        <Badge variant={actionColor(t.action)}>{t.action}</Badge>
                      </td>
                      <td className="py-2 text-dim">${t.amount_usd?.toFixed(2)}</td>
                      <td className="py-2 text-dim">{t.confidence?.toFixed(0)}%</td>
                      <td className={`py-2 font-medium ${(t.pnl ?? 0) >= 0 ? "text-green" : "text-red"}`}>
                        {t.pnl != null ? `$${t.pnl.toFixed(4)}` : "—"}
                      </td>
                      <td className="py-2">
                        <Badge variant={
                          t.risk_level === "HIGH" ? "red" :
                          t.risk_level === "LOW"  ? "green" : "yellow"
                        }>
                          {t.risk_level}
                        </Badge>
                      </td>
                      <td className="py-2">
                        <Badge variant={
                          t.status === "EXECUTED" ? "green" :
                          t.status === "REJECTED" ? "red" : "default"
                        }>
                          {t.status}
                        </Badge>
                      </td>
                      <td className="py-2">
                        {txHash ? (
                          <a
                            href={`https://sepolia.etherscan.io/tx/${txHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue hover:underline"
                          >
                            {txHash.slice(0, 10)}…↗
                          </a>
                        ) : t.on_chain_approved ? (
                          // CHANGE: show "approved" badge when RiskRouter approved
                          // but we don't have a hash to link (pre-fix trades)
                          <span className="text-green text-[10px]">⛓ approved</span>
                        ) : (
                          <span className="text-dim">—</span>
                        )}
                      </td>
                      <td className="py-2">
                        <button
                          onClick={() => setReplayId(t.id)}
                          className="text-dim hover:text-blue mono transition-colors underline"
                        >
                          replay
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* CHANGE: pass verifyValidationArtifact into ReplayModal so it can run
          the on-chain proof check. If the contract isn't connected,
          verifyValidationArtifact will be undefined and the modal hides the
          verify section gracefully. */}
      {replayId && (
        <ReplayModal
          tradeId={replayId}
          onClose={() => setReplayId(null)}
          verifyValidationArtifact={verifyValidationArtifact}
        />
      )}
    </div>
    </div>
  );
}