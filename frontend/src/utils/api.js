import axios from "axios";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";
const BASE    = `${API_URL}/api/v1`;

const api = axios.create({
  baseURL: BASE,
  timeout: 90000,   // 90s — trade execution includes blockchain TXs
});

// ── Agents ────────────────────────────────────────────────────────────────────
export const registerAgent = (data) =>
  api.post("/agents/register", data).then((r) => r.data);

export const getAgent = (wallet) =>
  api.get(`/agents/${wallet}`).then((r) => r.data);

export const listAgents = () =>
  api.get("/agents/").then((r) => r.data);

/**
 * Link an on_chain_id to an existing backend-only agent record.
 * Called when the MetaMask TX succeeded but the initial backend POST failed.
 * Uses PATCH /agents/{wallet}/link-chain — no MetaMask interaction needed.
 */
export const linkChainId = (walletAddress, onChainId) =>
  api
    .patch(`/agents/${walletAddress}/link-chain`, null, {
      params: { on_chain_id: onChainId },
    })
    .then((r) => r.data);

// ── Market ────────────────────────────────────────────────────────────────────
export const getMarket = (token) =>
  api.get(`/market/${token}`).then((r) => r.data);

export const getTokens = () =>
  api.get("/market").then((r) => r.data);

// ── Trading — core ────────────────────────────────────────────────────────────
export const getDecision = (payload) =>
  api.post("/trade/decision", payload).then((r) => r.data);

export const executeTrade = (payload) =>
  api.post("/trade/execute", payload).then((r) => r.data);

export const getHistory = (wallet, limit = 20) =>
  api.get(`/trade/history/${wallet}`, { params: { limit } }).then((r) => r.data);

export const replayTrade = (tradeId) =>
  api.get(`/trade/replay/${tradeId}`).then((r) => r.data);

// ── Feature 4: Strategy Comparison Engine ────────────────────────────────────
export const compareStrategies = (payload) =>
  api.post("/trade/compare-strategies", payload).then((r) => r.data);

// ── Feature 5: What-If Simulator ─────────────────────────────────────────────
export const simulateWhatIf = (payload) =>
  api.post("/trade/simulate", payload).then((r) => r.data);

// ── Feature 7: AI Copilot Chat ────────────────────────────────────────────────
export const sendCopilot = (payload) =>
  api.post("/trade/copilot", payload).then((r) => r.data);

// ── Dashboard ─────────────────────────────────────────────────────────────────
export const getDashboard = (wallet) =>
  api.get(`/dashboard/${wallet}`).then((r) => r.data);

export const getHeatmap = (wallet) =>
  api.get(`/dashboard/heatmap/${wallet}`).then((r) => r.data);

export const getPnlChart = (wallet) =>
  api.get(`/dashboard/pnl-chart/${wallet}`).then((r) => r.data);

export const getRiskState = (wallet) =>
  api.get(`/dashboard/risk-state/${wallet}`).then((r) => r.data);

// ── Feature 9: Failure Intelligence ──────────────────────────────────────────
export const getFailureAnalysis = (wallet) =>
  api.get(`/dashboard/failure-analysis/${wallet}`).then((r) => r.data);

// ── Feature 8: Trade Quality Summary ─────────────────────────────────────────
export const getQualitySummary = (wallet) =>
  api.get(`/dashboard/quality-summary/${wallet}`).then((r) => r.data);

// ── Feature 10: Auto-Generated Report ────────────────────────────────────────
export const getReport = (wallet) =>
  api.get(`/dashboard/report/${wallet}`).then((r) => r.data);

// ── Voice ─────────────────────────────────────────────────────────────────────
export const sendVoice = (payload) =>
  api.post("/voice", payload).then((r) => r.data);

// ── Health ────────────────────────────────────────────────────────────────────
export const getHealth = () =>
  axios.get(`${API_URL}/health`).then((r) => r.data);