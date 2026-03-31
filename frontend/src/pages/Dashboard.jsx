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

// ── Inline styles (matching Home.jsx design language) ─────────────────────────
const S = {
  // Section label — same as .slabel in CSS
  slabel: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 10,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    color: "var(--accent)",
    marginBottom: 10,
    display: "block",
  },
  // Section heading
  h2: {
    fontFamily: "'Syne', sans-serif",
    fontSize: "clamp(16px,2vw,22px)",
    fontWeight: 800,
    color: "var(--text)",
    letterSpacing: "-0.02em",
    lineHeight: 1.15,
    margin: 0,
  },
  // Accent card (same as .acard)
  acard: {
    background: "var(--card)",
    border: "1px solid var(--border)",
    borderRadius: 16,
    padding: "18px 20px",
    position: "relative",
    overflow: "hidden",
    transition: "transform 0.2s ease, box-shadow 0.2s ease",
  },
  // Metric value
  metricVal: {
    fontFamily: "'Syne', sans-serif",
    fontSize: 26,
    fontWeight: 800,
    lineHeight: 1,
    letterSpacing: "-0.03em",
    marginBottom: 4,
  },
  metricLabel: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 10,
    color: "var(--dim)",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  },
  metricSub: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 10,
    color: "var(--dim)",
    marginTop: 2,
  },
  mono: { fontFamily: "'JetBrains Mono', monospace" },
  tag: {
    display: "inline-flex",
    alignItems: "center",
    padding: "3px 10px",
    borderRadius: 999,
    fontSize: 11,
    fontFamily: "'JetBrains Mono', monospace",
    fontWeight: 600,
    border: "1px solid var(--border)",
  },
};

// ── Accent Card (matches acard CSS class) ─────────────────────────────────────
function ACard({ children, ac = "var(--accent)", style = {}, onHover }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      style={{
        ...S.acard,
        transform: hov ? "translateY(-3px)" : "none",
        boxShadow: hov ? "0 10px 32px rgba(0,0,0,0.14)" : "none",
        ...style,
      }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
    >
      {/* Top accent bar */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: 3,
        borderRadius: "16px 16px 0 0", background: ac,
      }} />
      {children}
    </div>
  );
}

// ── Stat Metric ───────────────────────────────────────────────────────────────
function Metric({ label, value, sub, color = "var(--text)", ac }) {
  return (
    <ACard ac={ac || "var(--accent)"}>
      <p style={S.metricLabel}>{label}</p>
      <p style={{ ...S.metricVal, color, marginTop: 6 }}>{value}</p>
      {sub && <p style={S.metricSub}>{sub}</p>}
    </ACard>
  );
}

// ── Colored Tag / Badge ───────────────────────────────────────────────────────
function Tag({ children, variant = "default" }) {
  const colors = {
    green:   { bg: "rgba(34,197,94,0.12)",  color: "var(--green)",  border: "rgba(34,197,94,0.3)" },
    red:     { bg: "rgba(239,68,68,0.12)",  color: "var(--red)",    border: "rgba(239,68,68,0.3)" },
    blue:    { bg: "rgba(59,130,246,0.12)", color: "var(--accent)",  border: "rgba(59,130,246,0.3)" },
    yellow:  { bg: "rgba(245,158,11,0.12)", color: "var(--yellow)",  border: "rgba(245,158,11,0.3)" },
    default: { bg: "var(--muted)",           color: "var(--dim)",    border: "var(--border)" },
  };
  const c = colors[variant] || colors.default;
  return (
    <span style={{ ...S.tag, background: c.bg, color: c.color, borderColor: c.border }}>
      {children}
    </span>
  );
}

// ── Divider ───────────────────────────────────────────────────────────────────
function Divider() {
  return <div style={{ height: 1, background: "var(--border)", margin: "0" }} />;
}

// ── Equity Curve ──────────────────────────────────────────────────────────────
function EquityCurve({ data }) {
  if (!data || data.length < 2)
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        height: 96, color: "var(--dim)", fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
      }}>
        Execute trades to see your equity curve
      </div>
    );

  const W = 600, H = 120, PAD = 10;
  const values = data.map((d) => d.equity);
  const minV = Math.min(...values), maxV = Math.max(...values);
  const range = maxV - minV || 1;
  const toX = (i) => PAD + (i / (data.length - 1)) * (W - PAD * 2);
  const toY = (v) => H - PAD - ((v - minV) / range) * (H - PAD * 2);
  const pathD = data.map((d, i) => `${i === 0 ? "M" : "L"} ${toX(i).toFixed(1)} ${toY(d.equity).toFixed(1)}`).join(" ");
  const areaD = pathD + ` L ${toX(data.length - 1).toFixed(1)} ${H - PAD} L ${PAD} ${H - PAD} Z`;
  const isProfit = values[values.length - 1] >= values[0];
  const lastVal = values[values.length - 1];

  return (
    <div style={{ width: "100%", overflowX: "auto" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 112 }} preserveAspectRatio="none">
        <defs>
          <linearGradient id="eq-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={isProfit ? "#22c55e" : "#ef4444"} stopOpacity="0.25" />
            <stop offset="100%" stopColor={isProfit ? "#22c55e" : "#ef4444"} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaD} fill="url(#eq-grad)" />
        <path d={pathD} fill="none" stroke={isProfit ? "#22c55e" : "#ef4444"} strokeWidth="1.5" />
      </svg>
      <div style={{
        display: "flex", justifyContent: "space-between",
        fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
        color: "var(--dim)", marginTop: 4, padding: "0 4px",
      }}>
        <span>{data[0]?.timestamp}</span>
        <span style={{ color: isProfit ? "var(--green)" : "var(--red)", fontWeight: 600 }}>
          ${lastVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
        <span>{data[data.length - 1]?.timestamp}</span>
      </div>
    </div>
  );
}

// ── Drawdown Bar ──────────────────────────────────────────────────────────────
function DrawdownBar({ pct, label }) {
  const color = pct > 15 ? "var(--red)" : pct > 8 ? "var(--yellow)" : "var(--green)";
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontFamily: "'JetBrains Mono', monospace", marginBottom: 5 }}>
        <span style={{ color: "var(--dim)" }}>{label}</span>
        <span style={{ color, fontWeight: 600 }}>{fmt2(pct)}%</span>
      </div>
      <div style={{ height: 4, background: "var(--muted)", borderRadius: 99, overflow: "hidden" }}>
        <div style={{
          height: "100%", borderRadius: 99,
          width: `${Math.min(pct, 100)}%`,
          background: color,
          transition: "width 0.6s ease",
        }} />
      </div>
    </div>
  );
}

// ── On-Chain Performance Panel ────────────────────────────────────────────────
function OnChainPerformance({ agentId }) {
  const { getAgentPerformance, getAgentInfo, getTrustScore, getAgentDailyStats } = useContracts();
  const [perf, setPerf] = useState(null);
  const [info, setInfo] = useState(null);
  const [trust, setTrust] = useState(null);
  const [dailyStats, setDailyStats] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!agentId) return;
    setBusy(true);
    try {
      const [p, i, t, ds] = await Promise.all([
        getAgentPerformance(agentId),
        getAgentInfo(agentId),
        getTrustScore(agentId),
        getAgentDailyStats(agentId).catch(() => null),
      ]);
      setPerf(p); setInfo(i); setTrust(t); setDailyStats(ds);
    } catch (e) {
      console.warn("On-chain fetch failed:", e.message);
    } finally {
      setBusy(false);
    }
  }, [agentId, getAgentPerformance, getAgentInfo, getTrustScore, getAgentDailyStats]);

  useEffect(() => { load(); }, [load]);
  if (!agentId) return null;

  const dailyLossUsd    = dailyStats ? dailyStats.totalLossUsd / 100 : null;
  const dailyTradeCount = dailyStats?.tradeCount ?? null;

  return (
    <section>
      {/* Section header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <span style={S.slabel}>On-Chain</span>
          <h2 style={S.h2}>Live Blockchain Metrics</h2>
        </div>
        <button
          onClick={load}
          disabled={busy}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "7px 14px", borderRadius: 10,
            border: "1px solid var(--border)", background: "var(--card)",
            color: "var(--dim)", cursor: busy ? "not-allowed" : "pointer",
            fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 600,
            opacity: busy ? 0.5 : 1, transition: "border-color 0.15s, color 0.15s",
          }}
        >
          {busy ? "Syncing…" : "↻ Sync"}
        </button>
      </div>

      {busy && !perf ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "32px 0" }}>
          <Spinner size={5} />
        </div>
      ) : perf || info || trust != null ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          {trust != null && (
            <Metric
              label="Trust Score"
              value={`${trust} / 100`}
              sub="Reputation Manager"
              color={trust >= 70 ? "var(--green)" : trust >= 40 ? "var(--yellow)" : "var(--red)"}
              ac={trust >= 70 ? "var(--green)" : trust >= 40 ? "var(--yellow)" : "var(--red)"}
            />
          )}
          {perf && (
            <>
              <Metric
                label="Win Rate (chain)"
                value={`${fmt2(perf.winRatePct)}%`}
                sub={`${perf.tradeCount} settled trades`}
                ac="var(--accent)"
              />
              <Metric
                label="Max Drawdown"
                value={`${fmt2(perf.maxDrawdownBps / 100)}%`}
                color={perf.maxDrawdownBps / 100 > 15 ? "var(--red)" : perf.maxDrawdownBps / 100 > 8 ? "var(--yellow)" : "var(--green)"}
                sub="Peak → Trough"
                ac={perf.maxDrawdownBps / 100 > 15 ? "var(--red)" : "var(--accent)"}
              />
              <Metric
                label="Avg PnL / Trade"
                value={`${perf.avgPnlBps > 0 ? "+" : ""}${fmt2(perf.avgPnlBps / 100)}%`}
                color={perf.avgPnlBps >= 0 ? "var(--green)" : "var(--red)"}
                sub={perf.sharpeProxy != null ? `Sharpe ≈ ${perf.sharpeProxy.toFixed(2)}` : "Sharpe: N/A"}
                ac={perf.avgPnlBps >= 0 ? "var(--green)" : "var(--red)"}
              />
            </>
          )}

          {dailyStats && (
            <ACard ac="var(--accent2)" style={{ gridColumn: "span 2" }}>
              <p style={{ ...S.metricLabel, marginBottom: 12 }}>On-Chain Daily Exposure</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <p style={{ ...S.metricLabel, marginBottom: 4 }}>Loss Exposure Today</p>
                  <p style={{
                    ...S.metricVal, fontSize: 20,
                    color: dailyLossUsd > 500 ? "var(--red)" : dailyLossUsd > 100 ? "var(--yellow)" : "var(--green)",
                  }}>
                    ${fmt2(dailyLossUsd)}
                  </p>
                  <p style={S.metricSub}>Tracked by RiskRouter</p>
                </div>
                <div>
                  <p style={{ ...S.metricLabel, marginBottom: 4 }}>Trades Today</p>
                  <p style={{ ...S.metricVal, fontSize: 20, color: "var(--text)" }}>
                    {dailyTradeCount ?? "—"}
                  </p>
                  <p style={S.metricSub}>Approved by RiskRouter</p>
                </div>
              </div>
            </ACard>
          )}

          {info && (
            <ACard ac="var(--purple)" style={{ gridColumn: "1 / -1" }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "12px 24px" }}>
                {[
                  ["Contract", info.name],
                  ["Strategy", info.strategy],
                  ["Total Trades", info.totalTrades],
                  ["Profitable", info.profitableTrades],
                  ["Active", info.active ? "Yes" : "No"],
                ].map(([k, v]) => (
                  <div key={k}>
                    <p style={S.metricLabel}>{k}</p>
                    <p style={{
                      ...S.mono, fontSize: 13, fontWeight: 600, color: "var(--text)", marginTop: 2,
                      ...(k === "Active" ? { color: info.active ? "var(--green)" : "var(--red)" } : {}),
                      ...(k === "Strategy" ? { color: "var(--accent)" } : {}),
                    }}>{v}</p>
                  </div>
                ))}
              </div>
            </ACard>
          )}
        </div>
      ) : (
        <ACard ac="var(--border)">
          <p style={{ ...S.mono, fontSize: 12, color: "var(--dim)" }}>
            No on-chain data for agent ID{" "}
            <span style={{ color: "var(--text)" }}>{agentId}</span>.
            Data appears after trades are settled on-chain.
          </p>
        </ACard>
      )}
    </section>
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
    <section>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <span style={S.slabel}>Intelligence</span>
          <h2 style={S.h2}>Failure Analysis</h2>
        </div>
        <button
          onClick={load}
          disabled={busy}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "7px 14px", borderRadius: 10,
            border: "1px solid var(--border)", background: "var(--card)",
            color: "var(--dim)", cursor: busy ? "not-allowed" : "pointer",
            fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 600,
            opacity: busy ? 0.5 : 1,
          }}
        >
          {busy ? "Analysing…" : open ? "↻ Refresh" : "Analyse →"}
        </button>
      </div>

      {open && data && (
        <ACard ac="var(--red)">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 16, marginBottom: 20 }}>
            <div>
              <p style={S.metricLabel}>Total Failures</p>
              <p style={{ ...S.metricVal, fontSize: 28, color: "var(--red)", marginTop: 4 }}>{data.total_failures}</p>
            </div>
            <div>
              <p style={S.metricLabel}>Total Loss</p>
              <p style={{ ...S.metricVal, fontSize: 28, color: "var(--red)", marginTop: 4 }}>${fmt4(data.total_loss)}</p>
            </div>
            <div>
              <p style={S.metricLabel}>Top Pattern</p>
              <p style={{ ...S.mono, fontSize: 12, color: "var(--yellow)", fontWeight: 600, marginTop: 4 }}>
                {data.top_failure_pattern || "None identified"}
              </p>
            </div>
          </div>

          {data.recommendations?.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <p style={{ ...S.metricLabel, marginBottom: 8 }}>AI Recommendations</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {data.recommendations.map((r, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <span style={{ color: "var(--accent)", fontSize: 12, marginTop: 1, flexShrink: 0 }}>→</span>
                    <span style={{ ...S.mono, fontSize: 11, color: "var(--text2)", lineHeight: 1.5 }}>{r}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {data.failed_trades?.length > 0 && (
            <>
              <Divider />
              <p style={{ ...S.metricLabel, margin: "12px 0 8px" }}>Failed Trades</p>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 480 }}>
                  <thead>
                    <tr>
                      {["Pair","Action","Loss","Reason"].map(h => (
                        <th key={h} style={{
                          textAlign: "left", paddingBottom: 8,
                          ...S.metricLabel, borderBottom: "1px solid var(--border)",
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.failed_trades.map((t) => (
                      <tr key={t.id} style={{ borderBottom: "1px solid rgba(30,42,58,0.4)" }}>
                        <td style={{ padding: "10px 0", ...S.mono, fontSize: 12, color: "var(--text)" }}>{t.token_pair}</td>
                        <td style={{ padding: "10px 0" }}><Tag variant={actionColor(t.action)}>{t.action}</Tag></td>
                        <td style={{ padding: "10px 0", ...S.mono, fontSize: 12, color: "var(--red)", fontWeight: 600 }}>${fmt4(t.pnl)}</td>
                        <td style={{ padding: "10px 0", ...S.mono, fontSize: 11, color: "var(--dim)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </ACard>
      )}
    </section>
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
    <div>
      <p style={{ ...S.metricLabel, marginBottom: 12 }}>Trade Quality</p>
      {busy ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "16px 0" }}><Spinner size={4} /></div>
      ) : data ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
          <Metric
            label="Avg Quality Score"
            value={`${data.avg_quality_score?.toFixed(1)} / 100`}
            sub={data.label}
            color={data.avg_quality_score >= 70 ? "var(--green)" : data.avg_quality_score >= 40 ? "var(--yellow)" : "var(--red)"}
            ac={data.avg_quality_score >= 70 ? "var(--green)" : "var(--accent)"}
          />
          <Metric label="Scored Trades" value={data.total_scored_trades} sub="Total evaluated" ac="var(--accent2)" />
          {data.best && (
            <ACard ac="var(--green)">
              <p style={S.metricLabel}>Best Trade</p>
              <p style={{ ...S.mono, fontSize: 14, fontWeight: 700, color: "var(--green)", margin: "6px 0 2px" }}>{data.best.token_pair}</p>
              <p style={S.metricSub}>Score: {data.best.quality_score?.toFixed(1)}</p>
            </ACard>
          )}
          {data.worst && (
            <ACard ac="var(--red)">
              <p style={S.metricLabel}>Worst Trade</p>
              <p style={{ ...S.mono, fontSize: 14, fontWeight: 700, color: "var(--red)", margin: "6px 0 2px" }}>{data.worst.token_pair}</p>
              <p style={S.metricSub}>Score: {data.worst.quality_score?.toFixed(1)}</p>
            </ACard>
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

  useEffect(() => {
    if (!agent || !account) { setOnChainId(null); return; }
    if (agent.on_chain_id) { setOnChainId(Number(agent.on_chain_id)); return; }
    getAgentsByOwner(account)
      .then((ids) => { if (ids.length > 0) setOnChainId(ids[ids.length - 1]); })
      .catch(() => {});
  }, [agent, account, getAgentsByOwner]);

  const fetchStats = useCallback(async () => {
    if (!account || !agent) return;
    setLoading(true); setError(null);
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
  if (agentLoading) return <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}><Spinner size={6} /></div>;
  if (!agent)
    return (
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "32px 24px" }}>
        <div style={{
          padding: "10px 16px", borderRadius: 10,
          border: "1px solid rgba(245,158,11,0.25)",
          background: "rgba(245,158,11,0.06)",
          marginBottom: 16,
        }}>
          <p style={{ ...S.mono, fontSize: 11, color: "var(--yellow)" }}>
            No agent found for <span style={{ color: "var(--text)" }}>{account}</span>. Register below to start trading.
          </p>
        </div>
        <RegisterAgent />
      </div>
    );

  // Accent colors (same palette as Home.jsx)
  const acColors = ["var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)", "var(--c5)", "var(--c6)"];

  return (
    <div style={{
      maxWidth: 1100,
      margin: "0 auto",
      padding: "40px 24px",
      display: "flex",
      flexDirection: "column",
      gap: 52,
    }}>

      {/* ════════════════════════════════════════════════════
          AGENT HERO CARD
      ════════════════════════════════════════════════════ */}
      <section>
        <span style={S.slabel}>Agent</span>
        <div style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: 20,
          padding: "24px 28px",
          position: "relative",
          overflow: "hidden",
        }}>
          {/* Gradient top bar */}
          <div style={{
            position: "absolute", top: 0, left: 0, right: 0, height: 3,
            background: "linear-gradient(90deg, var(--accent), var(--accent2))",
            borderRadius: "20px 20px 0 0",
          }} />

          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                {/* Live dot */}
                {onChainId != null && (
                  <span style={{
                    display: "inline-flex", alignItems: "center", gap: 5,
                    padding: "2px 8px", borderRadius: 99,
                    background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.3)",
                    fontFamily: "'JetBrains Mono', monospace", fontSize: 9, fontWeight: 600,
                    color: "var(--green)", textTransform: "uppercase", letterSpacing: "0.08em",
                  }}>
                    <span style={{
                      width: 5, height: 5, borderRadius: "50%",
                      background: "var(--green)", animation: "pdot 2s ease-in-out infinite",
                      display: "inline-block",
                    }} />
                    On-chain
                  </span>
                )}
              </div>

              <h1 style={{
                fontFamily: "'Syne', sans-serif", fontSize: 22, fontWeight: 800,
                color: "var(--text)", letterSpacing: "-0.02em", margin: 0,
              }}>
                {agent.name}
              </h1>
              <p style={{ ...S.mono, fontSize: 11, color: "var(--dim)", marginTop: 4, wordBreak: "break-all" }}>
                {agent.wallet_address}
              </p>
              {onChainId != null && (
                <p style={{ ...S.mono, fontSize: 11, color: "var(--dim)", marginTop: 4 }}>
                  On-chain ID: <span style={{ color: "var(--accent)", fontWeight: 700 }}>#{onChainId}</span>
                </p>
              )}
            </div>

            {/* Tags */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-start" }}>
              <Tag variant="blue">{agent.strategy}</Tag>
              <Tag variant={agent.risk_tolerance === "HIGH" ? "red" : agent.risk_tolerance === "LOW" ? "green" : "yellow"}>
                {agent.risk_tolerance} risk
              </Tag>
              <Tag variant="default">Max ${agent.max_trade_usd}</Tag>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════
          ON-CHAIN METRICS
      ════════════════════════════════════════════════════ */}
      <OnChainPerformance agentId={onChainId} />

      {/* ════════════════════════════════════════════════════
          AI PERFORMANCE
      ════════════════════════════════════════════════════ */}
      <section>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div>
            <span style={S.slabel}>AI Performance</span>
            <h2 style={S.h2}>Portfolio Overview</h2>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {lastFetch && (
              <span style={{ ...S.mono, fontSize: 10, color: "var(--dim)" }}>Updated {lastFetch}</span>
            )}
            <button
              onClick={fetchStats}
              disabled={loading}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "7px 14px", borderRadius: 10,
                border: "1px solid var(--border)", background: "var(--card)",
                color: "var(--dim)", cursor: loading ? "not-allowed" : "pointer",
                fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 600,
                opacity: loading ? 0.5 : 1,
              }}
            >
              {loading ? "Loading…" : "↻ Refresh"}
            </button>
          </div>
        </div>

        {loading && !stats ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "48px 0" }}>
            <Spinner size={6} />
          </div>
        ) : error ? (
          <ACard ac="var(--red)">
            <p style={{ ...S.mono, fontSize: 12, color: "var(--red)", marginBottom: 8 }}>{error}</p>
            <button
              onClick={fetchStats}
              style={{ ...S.mono, fontSize: 11, color: "var(--dim)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
            >
              Retry
            </button>
          </ACard>
        ) : stats ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

            {/* ── Circuit Breaker Banner ───────────────────── */}
            {stats.circuit_breaker_active && (
              <div style={{
                padding: "14px 18px",
                borderRadius: 14,
                border: "1px solid rgba(239,68,68,0.3)",
                background: "rgba(239,68,68,0.08)",
                display: "flex", alignItems: "center", gap: 12,
              }}>
                <span style={{ fontSize: 20 }}>⛔</span>
                <div>
                  <p style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 14, color: "var(--red)", margin: 0 }}>
                    Circuit Breaker Active
                  </p>
                  <p style={{ ...S.mono, fontSize: 10, color: "var(--dim)", marginTop: 3 }}>
                    Trading halted — drawdown exceeded 15% or daily loss &gt; 5%. Capital protection mode.
                  </p>
                </div>
              </div>
            )}

            {/* ── Core 4 stats ────────────────────────────── */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
              <Metric label="Total Trades" value={stats.total_trades} ac={acColors[0]} />
              <Metric
                label="Total PnL"
                value={`$${fmt4(stats.total_pnl)}`}
                color={stats.total_pnl >= 0 ? "var(--green)" : "var(--red)"}
                sub={stats.total_pnl >= 0 ? "Profitable" : "In loss"}
                ac={stats.total_pnl >= 0 ? "var(--green)" : "var(--red)"}
              />
              <Metric
                label="Win Rate"
                value={`${stats.win_rate?.toFixed(1)}%`}
                sub={`${stats.profitable_trades} of ${stats.total_trades} trades`}
                ac={acColors[2]}
              />
              <Metric
                label="AI Trust Score"
                value={`${stats.trust_score?.toFixed(0)} / 100`}
                color={stats.trust_score >= 70 ? "var(--green)" : stats.trust_score >= 40 ? "var(--yellow)" : "var(--red)"}
                ac={stats.trust_score >= 70 ? "var(--green)" : "var(--accent)"}
              />
            </div>

            {/* ── Risk Adjusted Metrics ────────────────────── */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
              {[
                {
                  label: "Sharpe Ratio",
                  value: stats.sharpe_ratio != null ? stats.sharpe_ratio.toFixed(3) : "—",
                  sub: "Annualised (√252)",
                  color: stats.sharpe_ratio == null ? "var(--dim)" : stats.sharpe_ratio >= 1 ? "var(--green)" : stats.sharpe_ratio >= 0 ? "var(--yellow)" : "var(--red)",
                  ac: acColors[1],
                },
                {
                  label: "Max Drawdown",
                  value: stats.max_drawdown_pct != null ? `${fmt2(stats.max_drawdown_pct)}%` : "—",
                  sub: stats.max_drawdown != null ? `$${fmt2(stats.max_drawdown)} peak→trough` : "No trades yet",
                  color: stats.max_drawdown_pct == null ? "var(--dim)" : stats.max_drawdown_pct > 15 ? "var(--red)" : stats.max_drawdown_pct > 8 ? "var(--yellow)" : "var(--green)",
                  ac: stats.max_drawdown_pct > 15 ? "var(--red)" : acColors[3],
                },
                {
                  label: "Vault Balance",
                  value: `$${stats.vault_balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                  sub: `of $${stats.vault_initial.toLocaleString()} initial`,
                  color: stats.vault_balance >= stats.vault_initial ? "var(--green)" : "var(--red)",
                  ac: acColors[2],
                },
                {
                  label: "Daily Loss",
                  value: `${fmt2(stats.daily_loss_pct)}%`,
                  sub: `$${fmt2(stats.daily_loss_usd)} today`,
                  color: stats.daily_loss_pct === 0 ? "var(--green)" : stats.daily_loss_pct > 5 ? "var(--red)" : "var(--yellow)",
                  ac: stats.daily_loss_pct > 5 ? "var(--red)" : acColors[4],
                },
              ].map((m) => (
                <Metric key={m.label} {...m} />
              ))}
            </div>

            {/* ── Drawdown Monitor ─────────────────────────── */}
            {(stats.current_drawdown != null || stats.max_drawdown_pct != null) && (
              <ACard ac="var(--purple)">
                <p style={{ ...S.metricLabel, marginBottom: 14 }}>Drawdown Monitor</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {stats.current_drawdown != null && <DrawdownBar pct={stats.current_drawdown} label="Current Drawdown" />}
                  {stats.max_drawdown_pct != null && <DrawdownBar pct={stats.max_drawdown_pct} label="Max Drawdown (All-time)" />}
                  <DrawdownBar pct={stats.daily_loss_pct} label="Daily Loss Cap (5%)" />
                </div>
                <div style={{ display: "flex", gap: 16, marginTop: 14, flexWrap: "wrap" }}>
                  {[
                    { dot: "var(--green)",  label: "< 8% normal" },
                    { dot: "var(--yellow)", label: "8–15% reduced sizing" },
                    { dot: "var(--red)",    label: "> 15% circuit breaker" },
                  ].map(({ dot, label }) => (
                    <div key={label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ width: 7, height: 7, borderRadius: "50%", background: dot, flexShrink: 0 }} />
                      <span style={{ ...S.mono, fontSize: 10, color: "var(--dim)" }}>{label}</span>
                    </div>
                  ))}
                </div>
              </ACard>
            )}

            {/* ── Equity Curve ─────────────────────────────── */}
            {stats.equity_curve?.length > 0 && (
              <div>
                <p style={{ ...S.metricLabel, marginBottom: 10 }}>Equity Curve</p>
                <ACard ac="linear-gradient(90deg, var(--accent), var(--accent2))">
                  <EquityCurve data={stats.equity_curve} />
                </ACard>
              </div>
            )}

            {/* ── Risk Heatmap ─────────────────────────────── */}
            {stats.risk_heatmap?.length > 0 && (
              <div>
                <p style={{ ...S.metricLabel, marginBottom: 10 }}>Risk Heatmap</p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
                  {stats.risk_heatmap.map((h) => {
                    const riskColor = h.risk_score > 60 ? "var(--red)" : h.risk_score > 30 ? "var(--yellow)" : "var(--green)";
                    return (
                      <ACard key={h.token} ac={riskColor}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                          <p style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 15, color: "var(--text)" }}>
                            {h.token}
                          </p>
                          <Tag variant={h.risk_score > 60 ? "red" : h.risk_score > 30 ? "yellow" : "green"}>
                            {h.risk_score.toFixed(0)} / 100
                          </Tag>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
                          {[
                            ["Exposure",   `$${fmt2(h.exposure_usd)}`],
                            ["Volatility", `${fmt2(h.volatility)}%`],
                            ["Sentiment",  h.sentiment.toFixed(3)],
                          ].map(([k, v]) => (
                            <div key={k} style={{ display: "flex", justifyContent: "space-between" }}>
                              <span style={{ ...S.mono, fontSize: 10, color: "var(--dim)" }}>{k}</span>
                              <span style={{
                                ...S.mono, fontSize: 10, fontWeight: 600,
                                color: k === "Sentiment"
                                  ? (h.sentiment > 0.3 ? "var(--green)" : h.sentiment < -0.3 ? "var(--red)" : "var(--text)")
                                  : "var(--text)",
                              }}>{v}</span>
                            </div>
                          ))}
                        </div>
                        <div style={{ height: 4, background: "var(--muted)", borderRadius: 99, overflow: "hidden" }}>
                          <div style={{
                            height: "100%", borderRadius: 99,
                            width: `${Math.min(h.risk_score, 100)}%`,
                            background: riskColor, transition: "width 0.6s ease",
                          }} />
                        </div>
                      </ACard>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Trade Quality ────────────────────────────── */}
            <QualityPanel account={account} />

            {/* ── Recent Trades ────────────────────────────── */}
            {stats.recent_trades?.length > 0 ? (
              <div>
                <p style={{ ...S.metricLabel, marginBottom: 10 }}>Recent Trades</p>
                <ACard ac="var(--accent2)">
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 680 }}>
                      <thead>
                        <tr>
                          {["Pair","Action","Amount","Confidence","PnL","Pos%","Risk","Status"].map(h => (
                            <th key={h} style={{
                              textAlign: "left", paddingBottom: 10,
                              ...S.metricLabel,
                              borderBottom: "1px solid var(--border)",
                              paddingRight: 12,
                            }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {stats.recent_trades.map((t) => (
                          <tr key={t.id} style={{ borderBottom: "1px solid rgba(30,42,58,0.35)" }}>
                            <td style={{ padding: "11px 12px 11px 0", fontFamily: "'Syne', sans-serif", fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
                              {t.token_pair}
                            </td>
                            <td style={{ padding: "11px 12px 11px 0" }}>
                              <Tag variant={actionColor(t.action)}>{t.action}</Tag>
                            </td>
                            <td style={{ padding: "11px 12px 11px 0", ...S.mono, fontSize: 11, color: "var(--dim)" }}>
                              ${fmt2(t.amount_usd)}
                            </td>
                            <td style={{ padding: "11px 12px 11px 0", ...S.mono, fontSize: 11, color: "var(--dim)" }}>
                              {t.confidence?.toFixed(0)}%
                            </td>
                            <td style={{
                              padding: "11px 12px 11px 0",
                              ...S.mono, fontSize: 12, fontWeight: 700,
                              color: (t.pnl ?? 0) >= 0 ? "var(--green)" : "var(--red)",
                            }}>
                              {t.pnl != null ? `$${fmt4(t.pnl)}` : "—"}
                            </td>
                            <td style={{ padding: "11px 12px 11px 0", ...S.mono, fontSize: 11, color: "var(--dim)" }}>
                              {t.position_size_pct != null ? `${t.position_size_pct.toFixed(1)}%` : "—"}
                            </td>
                            <td style={{ padding: "11px 12px 11px 0" }}>
                              <Tag variant={t.risk_level === "HIGH" ? "red" : t.risk_level === "LOW" ? "green" : "yellow"}>
                                {t.risk_level}
                              </Tag>
                            </td>
                            <td style={{ padding: "11px 0" }}>
                              <Tag variant={t.status === "EXECUTED" ? "green" : t.status === "REJECTED" ? "red" : "default"}>
                                {t.status}
                              </Tag>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </ACard>
              </div>
            ) : (
              <div style={{
                textAlign: "center", padding: "40px 0",
                ...S.mono, fontSize: 12, color: "var(--dim)",
              }}>
                No trades yet. Go to Trade page to execute your first trade.
              </div>
            )}

          </div>
        ) : null}
      </section>

      {/* ════════════════════════════════════════════════════
          FAILURE INTELLIGENCE
      ════════════════════════════════════════════════════ */}
      <FailurePanel account={account} />

    </div>
  );
}