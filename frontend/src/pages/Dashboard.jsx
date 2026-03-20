import React, { useEffect, useState, useCallback } from "react";
import { useWallet } from "../context/WalletContext";
import { useAgent } from "../context/AgentContext";
import { getDashboard } from "../utils/api";
import {
  Card, SectionTitle, StatBox, Badge,
  Spinner, EmptyState, ConnectPrompt, ActionBtn,
} from "../components/UI";
import RegisterAgent from "../components/RegisterAgent";

function actionColor(a) {
  if (a === "BUY")  return "green";
  if (a === "SELL") return "red";
  return "default";
}

export default function Dashboard() {
  const { account }                       = useWallet();
  const { agent, loading: agentLoading }  = useAgent();
  const [stats,    setStats]   = useState(null);
  const [loading,  setLoading] = useState(false);
  const [error,    setError]   = useState(null);
  const [lastFetch, setLastFetch] = useState(null);

  const fetchStats = useCallback(async () => {
    if (!account || !agent) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getDashboard(account);
      setStats(data);
      setLastFetch(new Date().toLocaleTimeString());
    } catch (e) {
      setError(e.response?.data?.detail || e.message);
    } finally {
      setLoading(false);
    }
  }, [account, agent]);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  if (!account) return <ConnectPrompt />;

  if (agentLoading) return (
    <div className="flex justify-center py-20"><Spinner size={6} /></div>
  );

  if (!agent) return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-4">
      <div className="px-3 py-2 rounded border border-yellow/20 bg-yellow/5">
        <p className="text-xs mono text-yellow">
          No agent found for <span className="text-text">{account}</span>.
          Register below to start trading.
        </p>
      </div>
      <RegisterAgent />
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-8">

      {/* Agent Info */}
      <div>
        <SectionTitle>Agent</SectionTitle>
        <Card>
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div>
              <p className="text-base font-semibold mono text-text">{agent.name}</p>
              <p className="text-xs text-dim mono mt-0.5 break-all">{agent.wallet_address}</p>
              {agent.on_chain_id && (
                <p className="text-xs text-dim mono mt-0.5">
                  On-chain ID:{" "}
                  <span className="text-blue">{agent.on_chain_id}</span>
                </p>
              )}
            </div>
            <div className="flex gap-2 flex-wrap">
              <Badge variant="blue">{agent.strategy}</Badge>
              <Badge variant={
                agent.risk_tolerance === "HIGH" ? "red" :
                agent.risk_tolerance === "LOW"  ? "green" : "yellow"
              }>
                {agent.risk_tolerance} risk
              </Badge>
              <Badge variant="default">Max ${agent.max_trade_usd}</Badge>
            </div>
          </div>
        </Card>
      </div>

      {/* Stats */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <SectionTitle>Performance</SectionTitle>
          <div className="flex items-center gap-3">
            {lastFetch && (
              <span className="text-xs text-dim mono">Updated {lastFetch}</span>
            )}
            <ActionBtn onClick={fetchStats} loading={loading} variant="secondary">
              Refresh
            </ActionBtn>
          </div>
        </div>

        {loading && !stats ? (
          <div className="flex justify-center py-8"><Spinner size={6} /></div>
        ) : error ? (
          <Card>
            <p className="text-xs text-red mono">{error}</p>
            <button onClick={fetchStats} className="text-xs text-dim hover:text-text mono mt-2 underline">
              Retry
            </button>
          </Card>
        ) : stats ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatBox label="Total Trades"    value={stats.total_trades} />
              <StatBox
                label="Total PnL"
                value={`$${stats.total_pnl?.toFixed(4)}`}
                color={stats.total_pnl >= 0 ? "text-green" : "text-red"}
                sub={stats.total_pnl >= 0 ? "Profitable" : "In loss"}
              />
              <StatBox
                label="Win Rate"
                value={`${stats.win_rate?.toFixed(1)}%`}
                sub={`${stats.profitable_trades} of ${stats.total_trades} trades`}
              />
              <StatBox
                label="Trust Score"
                value={`${stats.trust_score?.toFixed(0)} / 100`}
                color={
                  stats.trust_score >= 70 ? "text-green" :
                  stats.trust_score >= 40 ? "text-yellow" : "text-red"
                }
              />
            </div>

            {/* Risk Heatmap */}
            {stats.risk_heatmap?.length > 0 && (
              <div className="mt-6">
                <SectionTitle>Risk Heatmap</SectionTitle>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {stats.risk_heatmap.map((h) => (
                    <Card key={h.token}>
                      <div className="flex justify-between items-start mb-2">
                        <span className="mono font-semibold text-sm">{h.token}</span>
                        <Badge variant={h.risk_score > 60 ? "red" : h.risk_score > 30 ? "yellow" : "green"}>
                          {h.risk_score.toFixed(0)} / 100
                        </Badge>
                      </div>
                      <div className="text-xs mono space-y-0.5 mb-2">
                        <p><span className="text-dim">Exposure:</span> ${h.exposure_usd.toFixed(2)}</p>
                        <p><span className="text-dim">Volatility:</span> {h.volatility.toFixed(2)}%</p>
                        <p>
                          <span className="text-dim">Sentiment:</span>{" "}
                          <span className={h.sentiment > 0.3 ? "text-green" : h.sentiment < -0.3 ? "text-red" : "text-text"}>
                            {h.sentiment.toFixed(3)}
                          </span>
                        </p>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            h.risk_score > 60 ? "bg-red" : h.risk_score > 30 ? "bg-yellow" : "bg-green"
                          }`}
                          style={{ width: `${Math.min(h.risk_score, 100)}%` }}
                        />
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* Recent Trades */}
            {stats.recent_trades?.length > 0 ? (
              <div className="mt-6">
                <SectionTitle>Recent Trades</SectionTitle>
                <Card>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs mono min-w-[600px]">
                      <thead>
                        <tr className="text-dim border-b border-border">
                          <th className="text-left pb-2 font-medium">Pair</th>
                          <th className="text-left pb-2 font-medium">Action</th>
                          <th className="text-left pb-2 font-medium">Amount</th>
                          <th className="text-left pb-2 font-medium">Confidence</th>
                          <th className="text-left pb-2 font-medium">PnL</th>
                          <th className="text-left pb-2 font-medium">Risk</th>
                          <th className="text-left pb-2 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stats.recent_trades.map((t) => (
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
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </div>
            ) : (
              <EmptyState message="No trades yet. Go to Trade page to execute your first trade." />
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}