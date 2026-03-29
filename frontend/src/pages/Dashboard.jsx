import React, { useEffect, useState, useCallback } from "react";
import { useWallet } from "../context/WalletContext";
import { useAgent } from "../context/AgentContext";
import { useContracts } from "../context/ContractContext";
import {
  getDashboard,
  getFailureAnalysis,
  getQualitySummary,
} from "../utils/api";
import {
  Card, SectionTitle, StatBox, Badge,
  Spinner, EmptyState, ConnectPrompt, ActionBtn,
} from "../components/UI";
import RegisterAgent from "../components/RegisterAgent";

// ── Helpers ───────────────────────────────────────────────────────────────────
function actionColor(a) {
  if (a === "BUY")  return "green";
  if (a === "SELL") return "red";
  return "default";
}

function fmt2(n) { return n != null ? n.toFixed(2) : "—"; }
function fmt4(n) { return n != null ? n.toFixed(4) : "—"; }

// ── Equity Curve ──────────────────────────────────────────────────────────────
function EquityCurve({ data }) {
  if (!data || data.length < 2)
    return (
      <div className="flex items-center justify-center h-32 text-xs text-dim mono">
        Execute trades to see your equity curve
      </div>
    );

  const W = 600, H = 120, PAD = 10;
  const values = data.map((d) => d.equity);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const range = maxV - minV || 1;

  const toX = (i) => PAD + (i / (data.length - 1)) * (W - PAD * 2);
  const toY = (v) => H - PAD - ((v - minV) / range) * (H - PAD * 2);

  const pathD = data
    .map((d, i) => `${i === 0 ? "M" : "L"} ${toX(i).toFixed(1)} ${toY(d.equity).toFixed(1)}`)
    .join(" ");
  const areaD =
    pathD +
    ` L ${toX(data.length - 1).toFixed(1)} ${H - PAD} L ${PAD} ${H - PAD} Z`;
  const isProfit = values[values.length - 1] >= values[0];
  const lastVal = values[values.length - 1];

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-28" preserveAspectRatio="none">
        <defs>
          <linearGradient id="eq-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={isProfit ? "#22c55e" : "#ef4444"} stopOpacity="0.3" />
            <stop offset="100%" stopColor={isProfit ? "#22c55e" : "#ef4444"} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaD} fill="url(#eq-grad)" />
        <path d={pathD} fill="none" stroke={isProfit ? "#22c55e" : "#ef4444"} strokeWidth="1.5" />
      </svg>
      <div className="flex justify-between text-xs mono text-dim mt-0.5 px-1">
        <span>{data[0]?.timestamp}</span>
        <span className={isProfit ? "text-green" : "text-red"}>
          ${lastVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
        <span>{data[data.length - 1]?.timestamp}</span>
      </div>
    </div>
  );
}

// ── Drawdown Bar ──────────────────────────────────────────────────────────────
function DrawdownBar({ pct, label }) {
  const color = pct > 15 ? "bg-red" : pct > 8 ? "bg-yellow" : "bg-green";
  return (
    <div>
      <div className="flex justify-between text-xs mono mb-1">
        <span className="text-dim">{label}</span>
        <span className={pct > 15 ? "text-red" : pct > 8 ? "text-yellow" : "text-green"}>
          {fmt2(pct)}%
        </span>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
    </div>
  );
}

// ── On-Chain Performance Panel ────────────────────────────────────────────────
function OnChainPerformance({ agentId }) {
  // CHANGE: added getAgentDailyStats to destructure — now available from fixed
  // ContractContext. Used to show the real on-chain daily loss exposure, which
  // was previously dead (totalLossUsd was never incremented in the old contract).
  const {
    getAgentPerformance,
    getAgentInfo,
    getTrustScore,
    getAgentDailyStats,
  } = useContracts();

  const [perf,       setPerf]       = useState(null);
  const [info,       setInfo]       = useState(null);
  const [trust,      setTrust]      = useState(null);
  const [dailyStats, setDailyStats] = useState(null); // CHANGE: new state
  const [busy,       setBusy]       = useState(false);

  const load = useCallback(async () => {
    if (!agentId) return;
    setBusy(true);
    try {
      // CHANGE: fetch daily stats in parallel with the existing calls.
      // getAgentDailyStats is new — returns { date, totalLossUsd, tradeCount }.
      // totalLossUsd is now real because the fixed RiskRouter actually increments
      // it on every approved trade. In the old contract this was always 0.
      const [p, i, t, ds] = await Promise.all([
        getAgentPerformance(agentId),
        getAgentInfo(agentId),
        getTrustScore(agentId),
        getAgentDailyStats(agentId).catch(() => null), // non-fatal if contract old
      ]);
      setPerf(p);
      setInfo(i);
      setTrust(t);
      setDailyStats(ds);
    } catch (e) {
      console.warn("On-chain fetch failed:", e.message);
    } finally {
      setBusy(false);
    }
  }, [agentId, getAgentPerformance, getAgentInfo, getTrustScore, getAgentDailyStats]);

  useEffect(() => { load(); }, [load]);

  if (!agentId) return null;

  // CHANGE: compute USD value from cents (contract stores amountUsd in cents)
  const dailyLossUsd   = dailyStats ? dailyStats.totalLossUsd / 100 : null;
  const dailyTradeCount = dailyStats?.tradeCount ?? null;

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-3">
        <SectionTitle>
          <span className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue animate-pulse inline-block" />
            On-Chain Metrics
          </span>
        </SectionTitle>
        <ActionBtn onClick={load} loading={busy} variant="secondary">Sync</ActionBtn>
      </div>

      {busy && !perf ? (
        <div className="flex justify-center py-6"><Spinner size={5} /></div>
      ) : perf || info || trust != null ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {trust != null && (
            <StatBox
              label="On-Chain Trust"
              value={`${trust} / 100`}
              color={trust >= 70 ? "text-green" : trust >= 40 ? "text-yellow" : "text-red"}
              sub="Reputation Manager"
            />
          )}
          {perf && (
            <>
              <StatBox
                label="Win Rate (chain)"
                value={`${fmt2(perf.winRatePct)}%`}
                sub={`${perf.tradeCount} settled trades`}
              />
              <StatBox
                label="Max Drawdown"
                value={`${fmt2(perf.maxDrawdownBps / 100)}%`}
                color={perf.maxDrawdownBps / 100 > 15 ? "text-red" : perf.maxDrawdownBps / 100 > 8 ? "text-yellow" : "text-green"}
                sub="Peak → Trough"
              />
              <StatBox
                label="Avg PnL / Trade"
                value={`${perf.avgPnlBps > 0 ? "+" : ""}${fmt2(perf.avgPnlBps / 100)}%`}
                color={perf.avgPnlBps >= 0 ? "text-green" : "text-red"}
                sub={perf.sharpeProxy != null ? `Sharpe ≈ ${perf.sharpeProxy.toFixed(2)}` : "Sharpe: N/A"}
              />
            </>
          )}

          {/* CHANGE: On-chain daily loss card — powered by the fixed RiskRouter.
              Previously totalLossUsd was always 0 because _updateDailyStats
              never incremented it. The fix makes this card show real data. */}
          {dailyStats && (
            <Card className="col-span-2 sm:col-span-2">
              <p className="text-xs text-dim mono font-semibold mb-2">On-Chain Daily Exposure</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-dim mono">Today's Loss Exposure</p>
                  <p className={`text-base font-semibold mono mt-0.5 ${
                    dailyLossUsd > 500 ? "text-red" :
                    dailyLossUsd > 100 ? "text-yellow" : "text-green"
                  }`}>
                    ${fmt2(dailyLossUsd)}
                  </p>
                  <p className="text-xs text-dim mono mt-0.5">Tracked by RiskRouter</p>
                </div>
                <div>
                  <p className="text-xs text-dim mono">Trades Today (chain)</p>
                  <p className="text-base font-semibold mono mt-0.5 text-text">
                    {dailyTradeCount ?? "—"}
                  </p>
                  <p className="text-xs text-dim mono mt-0.5">Approved by RiskRouter</p>
                </div>
              </div>
            </Card>
          )}

          {info && (
            <Card className="col-span-2 sm:col-span-4">
              <div className="flex flex-wrap gap-4 text-xs mono">
                <div>
                  <span className="text-dim">Contract Name: </span>
                  <span className="text-text">{info.name}</span>
                </div>
                <div>
                  <span className="text-dim">Strategy: </span>
                  <span className="text-blue">{info.strategy}</span>
                </div>
                <div>
                  <span className="text-dim">Total Trades (chain): </span>
                  <span className="text-text">{info.totalTrades}</span>
                </div>
                <div>
                  <span className="text-dim">Active: </span>
                  <span className={info.active ? "text-green" : "text-red"}>
                    {info.active ? "Yes" : "No"}
                  </span>
                </div>
                <div>
                  <span className="text-dim">Profitable Trades: </span>
                  <span className="text-green">{info.profitableTrades}</span>
                </div>
              </div>
            </Card>
          )}
        </div>
      ) : (
        <Card>
          <p className="text-xs mono text-dim">
            No on-chain data found for agent ID <span className="text-text">{agentId}</span>.
            Data appears after trades are settled on-chain.
          </p>
        </Card>
      )}
    </div>
  );
}

// ── Failure Intelligence Panel ────────────────────────────────────────────────
function FailurePanel({ account }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const load = async () => {
    if (!account || busy) return;
    setBusy(true);
    try {
      const d = await getFailureAnalysis(account);
      setData(d);
      setOpen(true);
    } catch (e) {
      console.warn("Failure analysis failed:", e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-3">
        <SectionTitle>Failure Intelligence</SectionTitle>
        <ActionBtn onClick={load} loading={busy} variant="secondary">
          {open ? "Refresh" : "Analyse"}
        </ActionBtn>
      </div>

      {open && data && (
        <Card>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-4">
            <div>
              <p className="text-xs text-dim mono">Total Failures</p>
              <p className="text-lg font-semibold mono text-red mt-0.5">{data.total_failures}</p>
            </div>
            <div>
              <p className="text-xs text-dim mono">Total Loss</p>
              <p className="text-lg font-semibold mono text-red mt-0.5">${fmt4(data.total_loss)}</p>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <p className="text-xs text-dim mono">Top Pattern</p>
              <p className="text-sm font-semibold mono text-yellow mt-0.5">{data.top_failure_pattern || "None"}</p>
            </div>
          </div>

          {data.recommendations?.length > 0 && (
            <div className="mb-4">
              <p className="text-xs mono text-dim font-semibold mb-2">AI Recommendations</p>
              <ul className="space-y-1.5">
                {data.recommendations.map((r, i) => (
                  <li key={i} className="flex gap-2 text-xs mono text-text">
                    <span className="text-blue shrink-0">→</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.failed_trades?.length > 0 && (
            <div className="overflow-x-auto">
              <p className="text-xs mono text-dim font-semibold mb-2">Failed Trades</p>
              <table className="w-full text-xs mono min-w-[500px]">
                <thead>
                  <tr className="text-dim border-b border-border">
                    <th className="text-left pb-2 font-medium">Pair</th>
                    <th className="text-left pb-2 font-medium">Action</th>
                    <th className="text-left pb-2 font-medium">Loss</th>
                    <th className="text-left pb-2 font-medium">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {data.failed_trades.map((t) => (
                    <tr key={t.id} className="border-b border-border/40 last:border-0">
                      <td className="py-1.5 text-text">{t.token_pair}</td>
                      <td className="py-1.5"><Badge variant={actionColor(t.action)}>{t.action}</Badge></td>
                      <td className="py-1.5 text-red">${fmt4(t.pnl)}</td>
                      <td className="py-1.5 text-dim truncate max-w-[200px]">{t.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

// ── Quality Summary Panel ─────────────────────────────────────────────────────
function QualityPanel({ account }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!account) return;
    setBusy(true);
    try {
      const d = await getQualitySummary(account);
      setData(d);
    } catch (e) {
      console.warn("Quality summary failed:", e.message);
    } finally {
      setBusy(false);
    }
  }, [account]);

  useEffect(() => { load(); }, [load]);

  if (!data && !busy) return null;

  return (
    <div className="mt-4">
      <SectionTitle>Trade Quality</SectionTitle>
      {busy ? (
        <div className="flex justify-center py-4"><Spinner size={4} /></div>
      ) : data ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatBox
            label="Avg Quality Score"
            value={`${data.avg_quality_score?.toFixed(1)} / 100`}
            color={
              data.avg_quality_score >= 70 ? "text-green" :
              data.avg_quality_score >= 40 ? "text-yellow" : "text-red"
            }
            sub={data.label}
          />
          <StatBox label="Scored Trades" value={data.total_scored_trades} sub="Total evaluated" />
          {data.best && (
            <Card>
              <p className="text-xs text-dim mono">Best Trade</p>
              <p className="text-sm font-semibold mono text-green mt-1">{data.best.token_pair}</p>
              <p className="text-xs mono text-dim mt-0.5">Score: {data.best.quality_score?.toFixed(1)}</p>
            </Card>
          )}
          {data.worst && (
            <Card>
              <p className="text-xs text-dim mono">Worst Trade</p>
              <p className="text-sm font-semibold mono text-red mt-1">{data.worst.token_pair}</p>
              <p className="text-xs mono text-dim mt-0.5">Score: {data.worst.quality_score?.toFixed(1)}</p>
            </Card>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Dashboard
// ─────────────────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { account }                      = useWallet();
  const { agent, loading: agentLoading } = useAgent();
  const { getAgentsByOwner }             = useContracts();

  const [stats,     setStats]     = useState(null);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState(null);
  const [lastFetch, setLastFetch] = useState(null);
  const [onChainId, setOnChainId] = useState(null);

  // Resolve on-chain agent ID: prefer agent.on_chain_id, else lookup via contract
  useEffect(() => {
    if (!agent || !account) { setOnChainId(null); return; }

    if (agent.on_chain_id) {
      setOnChainId(Number(agent.on_chain_id));
      return;
    }

    getAgentsByOwner(account)
      .then((ids) => { if (ids.length > 0) setOnChainId(ids[ids.length - 1]); })
      .catch(() => {});
  }, [agent, account, getAgentsByOwner]);

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

  // ── Guard states ────────────────────────────────────────────────────────────
  if (!account)     return <ConnectPrompt />;
  if (agentLoading) return <div className="flex justify-center py-20"><Spinner size={6} /></div>;
  if (!agent)
    return (
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

      {/* ── Agent Info ────────────────────────────────────────────────────── */}
      <div>
        <SectionTitle>Agent</SectionTitle>
        <Card>
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div>
              <p className="text-base font-semibold mono text-text">{agent.name}</p>
              <p className="text-xs text-dim mono mt-0.5 break-all">{agent.wallet_address}</p>
              {onChainId != null && (
                <p className="text-xs text-dim mono mt-0.5">
                  On-chain ID:{" "}
                  <span className="text-blue font-semibold">#{onChainId}</span>
                </p>
              )}
              {agent.on_chain_id && (
                <p className="text-xs text-dim mono mt-0.5">
                  Registry ID:{" "}
                  <span className="text-blue">{agent.on_chain_id}</span>
                </p>
              )}
            </div>
            <div className="flex gap-2 flex-wrap">
              <Badge variant="blue">{agent.strategy}</Badge>
              <Badge
                variant={
                  agent.risk_tolerance === "HIGH" ? "red" :
                  agent.risk_tolerance === "LOW"  ? "green" : "yellow"
                }
              >
                {agent.risk_tolerance} risk
              </Badge>
              <Badge variant="default">Max ${agent.max_trade_usd}</Badge>
              {onChainId != null && <Badge variant="blue">⛓ On-chain</Badge>}
            </div>
          </div>
        </Card>
      </div>

      {/* ── On-Chain Metrics (live from blockchain) ─────────────────────── */}
      {/* CHANGE: OnChainPerformance now also fetches and renders
          getAgentDailyStats() — the on-chain daily loss exposure panel.
          This was always rendered before but showed $0 because the old
          RiskRouter never wrote to totalLossUsd. Now it shows real values. */}
      <OnChainPerformance agentId={onChainId} />

      {/* ── AI Performance (from backend) ───────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <SectionTitle>AI Performance</SectionTitle>
          <div className="flex items-center gap-3">
            {lastFetch && <span className="text-xs text-dim mono">Updated {lastFetch}</span>}
            <ActionBtn onClick={fetchStats} loading={loading} variant="secondary">Refresh</ActionBtn>
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
            {/* Circuit Breaker Banner */}
            {stats.circuit_breaker_active && (
              <div className="mb-4 px-4 py-3 rounded-lg border border-red/30 bg-red/10 flex items-center gap-3">
                <span className="text-xl">⛔</span>
                <div>
                  <p className="text-sm mono font-semibold text-red">Circuit Breaker Active</p>
                  <p className="text-xs mono text-dim">
                    Trading halted — drawdown exceeded 15% or daily loss &gt; 5%. Capital protection mode.
                  </p>
                </div>
              </div>
            )}

            {/* Core stats grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatBox label="Total Trades" value={stats.total_trades} />
              <StatBox
                label="Total PnL"
                value={`$${fmt4(stats.total_pnl)}`}
                color={stats.total_pnl >= 0 ? "text-green" : "text-red"}
                sub={stats.total_pnl >= 0 ? "Profitable" : "In loss"}
              />
              <StatBox
                label="Win Rate"
                value={`${stats.win_rate?.toFixed(1)}%`}
                sub={`${stats.profitable_trades} of ${stats.total_trades} trades`}
              />
              <StatBox
                label="Trust Score (AI)"
                value={`${stats.trust_score?.toFixed(0)} / 100`}
                color={
                  stats.trust_score >= 70 ? "text-green" :
                  stats.trust_score >= 40 ? "text-yellow" : "text-red"
                }
              />
            </div>

            {/* Risk-Adjusted Metrics */}
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Card>
                <p className="text-xs text-dim mono">Sharpe Ratio</p>
                <p className={`text-lg font-semibold mono mt-1 ${
                  stats.sharpe_ratio == null ? "text-dim" :
                  stats.sharpe_ratio >= 1    ? "text-green" :
                  stats.sharpe_ratio >= 0    ? "text-yellow" : "text-red"
                }`}>
                  {stats.sharpe_ratio != null ? stats.sharpe_ratio.toFixed(3) : "—"}
                </p>
                <p className="text-xs text-dim mono mt-0.5">annualised (√252)</p>
              </Card>

              <Card>
                <p className="text-xs text-dim mono">Max Drawdown</p>
                <p className={`text-lg font-semibold mono mt-1 ${
                  stats.max_drawdown_pct == null ? "text-dim" :
                  stats.max_drawdown_pct > 15   ? "text-red" :
                  stats.max_drawdown_pct > 8    ? "text-yellow" : "text-green"
                }`}>
                  {stats.max_drawdown_pct != null ? `${fmt2(stats.max_drawdown_pct)}%` : "—"}
                </p>
                <p className="text-xs text-dim mono mt-0.5">
                  {stats.max_drawdown != null ? `$${fmt2(stats.max_drawdown)} peak→trough` : "No trades yet"}
                </p>
              </Card>

              <Card>
                <p className="text-xs text-dim mono">Vault Balance</p>
                <p className={`text-lg font-semibold mono mt-1 ${
                  stats.vault_balance >= stats.vault_initial ? "text-green" : "text-red"
                }`}>
                  ${stats.vault_balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
                <p className="text-xs text-dim mono mt-0.5">
                  of ${stats.vault_initial.toLocaleString()} initial
                </p>
              </Card>

              <Card>
                <p className="text-xs text-dim mono">Daily Loss</p>
                <p className={`text-lg font-semibold mono mt-1 ${
                  stats.daily_loss_pct === 0 ? "text-green" :
                  stats.daily_loss_pct > 5  ? "text-red" : "text-yellow"
                }`}>
                  {fmt2(stats.daily_loss_pct)}%
                </p>
                <p className="text-xs text-dim mono mt-0.5">${fmt2(stats.daily_loss_usd)} today</p>
              </Card>
            </div>

            {/* Drawdown Monitor */}
            {(stats.current_drawdown != null || stats.max_drawdown_pct != null) && (
              <Card className="mt-4 space-y-3">
                <p className="text-xs text-dim mono font-semibold mb-1">Drawdown Monitor</p>
                {stats.current_drawdown != null && (
                  <DrawdownBar pct={stats.current_drawdown} label="Current Drawdown" />
                )}
                {stats.max_drawdown_pct != null && (
                  <DrawdownBar pct={stats.max_drawdown_pct} label="Max Drawdown (All-time)" />
                )}
                <DrawdownBar pct={stats.daily_loss_pct} label="Daily Loss Cap (5%)" />
                <div className="flex gap-3 text-xs mono text-dim mt-2 flex-wrap">
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-green inline-block" /> &lt;8% normal
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-yellow inline-block" /> 8–15% reduced sizing
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-red inline-block" /> &gt;15% circuit breaker
                  </span>
                </div>
              </Card>
            )}

            {/* Equity Curve */}
            {stats.equity_curve?.length > 0 && (
              <div className="mt-4">
                <SectionTitle>Equity Curve</SectionTitle>
                <Card>
                  <EquityCurve data={stats.equity_curve} />
                </Card>
              </div>
            )}

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
                        <p><span className="text-dim">Exposure:</span> ${fmt2(h.exposure_usd)}</p>
                        <p><span className="text-dim">Volatility:</span> {fmt2(h.volatility)}%</p>
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

            {/* Trade Quality (AI scored) */}
            <QualityPanel account={account} />

            {/* Recent Trades */}
            {stats.recent_trades?.length > 0 ? (
              <div className="mt-6">
                <SectionTitle>Recent Trades</SectionTitle>
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
                          <th className="text-left pb-2 font-medium">Pos%</th>
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
                            <td className="py-2 text-dim">${fmt2(t.amount_usd)}</td>
                            <td className="py-2 text-dim">{t.confidence?.toFixed(0)}%</td>
                            <td className={`py-2 font-medium ${(t.pnl ?? 0) >= 0 ? "text-green" : "text-red"}`}>
                              {t.pnl != null ? `$${fmt4(t.pnl)}` : "—"}
                            </td>
                            <td className="py-2 text-dim">
                              {t.position_size_pct != null ? `${t.position_size_pct.toFixed(1)}%` : "—"}
                            </td>
                            <td className="py-2">
                              <Badge
                                variant={
                                  t.risk_level === "HIGH" ? "red" :
                                  t.risk_level === "LOW"  ? "green" : "yellow"
                                }
                              >
                                {t.risk_level}
                              </Badge>
                            </td>
                            <td className="py-2">
                              <Badge
                                variant={
                                  t.status === "EXECUTED" ? "green" :
                                  t.status === "REJECTED" ? "red" : "default"
                                }
                              >
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

      {/* ── Failure Intelligence (AI backend) ───────────────────────────── */}
      <FailurePanel account={account} />

    </div>
  );
}