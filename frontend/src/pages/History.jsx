import React, { useEffect, useState, useCallback } from "react";
import { useWallet } from "../context/WalletContext";
import { getHistory, replayTrade } from "../utils/api";
import {
  Card, SectionTitle, Badge, ActionBtn,
  Spinner, EmptyState, ConnectPrompt,
} from "../components/UI";

function actionColor(a) {
  if (a === "BUY")  return "green";
  if (a === "SELL") return "red";
  return "default";
}

function ReplayModal({ tradeId, onClose }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    replayTrade(tradeId)
      .then(setData)
      .catch((e) => setError(e.response?.data?.detail || e.message))
      .finally(() => setLoading(false));
  }, [tradeId]);

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
                    { label: "Action",    val: data.summary.action },
                    { label: "Amount",    val: `$${data.summary.amount_usd}` },
                    { label: "PnL",       val: data.summary.pnl != null ? `$${data.summary.pnl?.toFixed(4)}` : "—" },
                    { label: "Risk",      val: data.summary.risk_level },
                    { label: "Confidence",val: `${data.summary.confidence}%` },
                    { label: "Status",    val: data.summary.status },
                  ].map(({ label, val }) => (
                    <div key={label} className="bg-bg border border-border rounded p-1.5">
                      <span className="text-dim">{label}: </span>
                      <span className="text-text">{val}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : null}
      </Card>
    </div>
  );
}

export default function History() {
  const { account }              = useWallet();
  const [trades,    setTrades]   = useState([]);
  const [loading,   setLoading]  = useState(false);
  const [error,     setError]    = useState(null);
  const [replayId,  setReplayId] = useState(null);
  const [lastFetch, setLastFetch]= useState(null);

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

  if (!account) return <ConnectPrompt />;

  const executedTrades = trades.filter((t) => t.status === "EXECUTED");
  const rejectedTrades = trades.filter((t) => t.status === "REJECTED");
  const totalPnL       = executedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">

      <div className="flex items-center justify-between">
        <SectionTitle>Trade History</SectionTitle>
        <div className="flex items-center gap-3">
          {lastFetch && <span className="text-xs text-dim mono">Updated {lastFetch}</span>}
          <ActionBtn onClick={fetchHistory} loading={loading} variant="secondary">
            Refresh
          </ActionBtn>
        </div>
      </div>

      {/* Summary stats */}
      {trades.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total",    value: trades.length },
            { label: "Executed", value: executedTrades.length },
            { label: "Rejected", value: rejectedTrades.length },
            {
              label: "Total PnL",
              value: `$${totalPnL.toFixed(4)}`,
              color: totalPnL >= 0 ? "text-green" : "text-red",
            },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-surface border border-border rounded-lg p-3">
              <p className="text-xs text-dim mono">{label}</p>
              <p className={`text-lg font-semibold mono ${color || "text-text"}`}>{value}</p>
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
        <EmptyState message="No trades yet. Go to the Trade page to execute your first trade." />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-xs mono min-w-[700px]">
              <thead>
                <tr className="text-dim border-b border-border">
                  <th className="text-left pb-2 font-medium">Pair</th>
                  <th className="text-left pb-2 font-medium">Action</th>
                  <th className="text-left pb-2 font-medium">Amount</th>
                  <th className="text-left pb-2 font-medium">Confidence</th>
                  <th className="text-left pb-2 font-medium">PnL</th>
                  <th className="text-left pb-2 font-medium">Risk</th>
                  <th className="text-left pb-2 font-medium">Status</th>
                  <th className="text-left pb-2 font-medium">On-chain</th>
                  <th className="text-left pb-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t) => (
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
                      {t.on_chain_id && t.on_chain_id.startsWith("0x") ? (
                        <a
                          href={`https://sepolia.etherscan.io/tx/${t.on_chain_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue hover:underline"
                        >
                          Etherscan ↗
                        </a>
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
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {replayId && (
        <ReplayModal tradeId={replayId} onClose={() => setReplayId(null)} />
      )}
    </div>
  );
}