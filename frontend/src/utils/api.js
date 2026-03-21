import axios from "axios";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";
const BASE = `${API_URL}/api/v1`;

const api = axios.create({ baseURL: BASE, timeout: 30000 });

// ── Agents ─────────────────────────────────────────────────────────────────
export const registerAgent = (data) =>
  api.post("/agents/register", data).then((r) => r.data);

export const getAgent = (wallet) =>
  api.get(`/agents/${wallet}`).then((r) => r.data);

// ── Market ─────────────────────────────────────────────────────────────────
export const getMarket = (token) =>
  api.get(`/market/${token}`).then((r) => r.data);

export const getTokens = () =>
  api.get("/market").then((r) => r.data);

// ── Trading ────────────────────────────────────────────────────────────────
export const getDecision = (payload) =>
  api.post("/trade/decision", payload).then((r) => r.data);

export const executeTrade = (payload) =>
  api.post("/trade/execute", payload).then((r) => r.data);

export const getHistory = (wallet) =>
  api.get(`/trade/history/${wallet}`).then((r) => r.data);

export const replayTrade = (tradeId) =>
  api.get(`/trade/replay/${tradeId}`).then((r) => r.data);

// ── Dashboard ──────────────────────────────────────────────────────────────
export const getDashboard = (wallet) =>
  api.get(`/dashboard/${wallet}`).then((r) => r.data);

export const getHeatmap = (wallet) =>
  api.get(`/dashboard/heatmap/${wallet}`).then((r) => r.data);

export const getPnlChart = (wallet) =>
  api.get(`/dashboard/pnl-chart/${wallet}`).then((r) => r.data);

// ── Voice ──────────────────────────────────────────────────────────────────
export const sendVoice = (payload) =>
  api.post("/voice", payload).then((r) => r.data);

// ── Health ─────────────────────────────────────────────────────────────────
export const getHealth = () =>
  axios.get(`${API_URL}/health`).then((r) => r.data);