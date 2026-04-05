import React, { useEffect, useState, Suspense, lazy } from "react";
import { getMarket, getTokens } from "../utils/api";
import { Spinner } from "../components/UI";
const NeuralBackground = lazy(() => import("../components/three/NeuralBackground"));

const G = {
  card: {
    background: "rgba(13,17,23,0.8)",
    border: "1px solid rgba(0,191,255,0.14)",
    borderRadius: 16,
    padding: "20px",
    backdropFilter: "blur(14px)",
    boxShadow: "0 0 20px rgba(0,191,255,0.04)",
    transition: "transform 0.2s, box-shadow 0.2s, border-color 0.2s",
    cursor: "default",
  },
  mono: { fontFamily: "'JetBrains Mono', monospace" },
  syne: { fontFamily: "'Syne', sans-serif" },
};

function rsiColor(rsi) {
  if (!rsi) return "default";
  if (rsi < 30) return "green";
  if (rsi > 70) return "red";
  return "default";
}

function rsiLabel(rsi) {
  if (!rsi) return "—";
  if (rsi < 30) return "Oversold";
  if (rsi > 70) return "Overbought";
  return "Neutral";
}

function TokenCard({ tokenId, index }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    const delay = index * 1800;
    const timer = setTimeout(() => {
      setLoading(true);
      getMarket(tokenId)
        .then((d) => { setData(d); setError(null); })
        .catch((e) => setError(e.response?.data?.detail || e.message))
        .finally(() => setLoading(false));
    }, delay);
    return () => clearTimeout(timer);
  }, [tokenId, index]);

  const positive = data?.price_change_24h >= 0;
  const changeColor = positive ? "#00FF88" : "#FF4444";
  const rsiColor = data?.rsi < 30 ? "#00FF88" : data?.rsi > 70 ? "#FF4444" : "#e5e7eb";
  const sentColor = data?.sentiment_score > 0.3 ? "#00FF88" : data?.sentiment_score < -0.3 ? "#FF4444" : "#e5e7eb";
  const bullish = data?.ma_7 > data?.ma_25;

  return (
    <div
      style={{
        ...G.card,
        transform: hovered ? "translateY(-4px)" : "none",
        boxShadow: hovered ? `0 12px 34px rgba(0,191,255,0.12), 0 0 0 1px rgba(0,191,255,0.2)` : G.card.boxShadow,
        borderColor: hovered ? "rgba(0,191,255,0.35)" : "rgba(0,191,255,0.14)",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Top neon bar */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, borderRadius: "16px 16px 0 0", background: data ? (positive ? "#00FF88" : "#FF4444") : "rgba(0,191,255,0.3)" }} />

      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px 0", gap: 8 }}>
          <Spinner />
          <p style={{ ...G.mono, fontSize: 10, color: "#6b7280" }}>Loading {tokenId}…</p>
        </div>
      ) : error ? (
        <div>
          <p style={{ ...G.mono, fontSize: 12, color: "#FF4444", marginBottom: 8 }}>{TOKEN_LABELS[tokenId] || tokenId}</p>
          <p style={{ ...G.mono, fontSize: 11, color: "#FF4444" }}>{error}</p>
          <button
            onClick={() => { setLoading(true); setError(null); getMarket(tokenId).then((d)=>{setData(d);setError(null);}).catch((e)=>setError(e.message)).finally(()=>setLoading(false)); }}
            style={{ ...G.mono, fontSize: 10, color: "#6b7280", background:"none", border:"none", cursor:"pointer", textDecoration:"underline", marginTop: 8 }}
          >Retry</button>
        </div>
      ) : data ? (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
            <div>
              <span style={{ ...G.syne, fontWeight: 800, fontSize: 16, color: "#f9f5fd" }}>{data.symbol}</span>
              <span style={{ ...G.mono, fontSize: 10, color: "#6b7280", marginLeft: 8 }}>{TOKEN_LABELS[tokenId] || tokenId}</span>
            </div>
            <span style={{
              ...G.mono, fontSize: 11, fontWeight: 700, color: changeColor,
              background: `${changeColor}18`, border: `1px solid ${changeColor}40`,
              borderRadius: 999, padding: "3px 10px",
            }}>
              {positive ? "+" : ""}{data.price_change_24h?.toFixed(2)}%
            </span>
          </div>

          <p style={{ ...G.syne, fontWeight: 800, fontSize: 22, color: changeColor, marginBottom: 4, letterSpacing: "-0.02em" }}>
            ${data.price_usd?.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
          </p>
          <p style={{ ...G.mono, fontSize: 10, color: "#6b7280", marginBottom: 14 }}>
            MCap ${(data.market_cap / 1e9)?.toFixed(2)}B · Vol ${(data.volume_24h / 1e9)?.toFixed(2)}B
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
            {[
              { label: "RSI (14)", value: `${data.rsi?.toFixed(1)} — ${rsiLabel(data.rsi)}`, color: rsiColor },
              { label: "Sentiment", value: data.sentiment_score?.toFixed(3), color: sentColor },
              { label: "MA7", value: `$${data.ma_7?.toLocaleString("en-US",{maximumFractionDigits:2})}`, color: "#00BFFF" },
              { label: "MA25", value: `$${data.ma_25?.toLocaleString("en-US",{maximumFractionDigits:2})}`, color: "#AC89FF" },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: "9px 12px" }}>
                <p style={{ ...G.mono, fontSize: 9, color: "#6b7280", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</p>
                <p style={{ ...G.mono, fontSize: 12, fontWeight: 700, color }}>{value}</p>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ ...G.mono, fontSize: 10, color: "#6b7280" }}>Trend:</span>
            {data.ma_7 && data.ma_25 ? (
              <span style={{
                ...G.mono, fontSize: 10, fontWeight: 700,
                color: bullish ? "#00FF88" : "#FF4444",
                background: bullish ? "rgba(0,255,136,0.12)" : "rgba(255,68,68,0.12)",
                border: `1px solid ${bullish ? "rgba(0,255,136,0.3)" : "rgba(255,68,68,0.3)"}`,
                borderRadius: 999, padding: "2px 10px",
              }}>
                {bullish ? "▲ Bullish" : "▼ Bearish"}
              </span>
            ) : <span style={{ color: "#6b7280", fontSize: 11 }}>—</span>}
          </div>
        </>
      ) : null}
    </div>
  );
}

// Dynamic token labels from API
const TOKEN_LABELS = {
  "ethereum":      "Ethereum",
  "bitcoin":       "Bitcoin",
  "polygon-ecosystem-token": "Polygon (POL)",
  "chainlink":     "Chainlink",
  "uniswap":       "Uniswap",
  "aave":          "Aave",
};

export default function Market() {
  const [tokens,  setTokens]  = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getTokens()
      .then((d) => setTokens(d.tokens || []))
      .catch(() => setTokens(Object.keys(TOKEN_LABELS)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div style={{ display:"flex", justifyContent:"center", padding:"80px 0" }}><Spinner size={6} /></div>
  );

  return (
    <div style={{ position: "relative" }}>
      <Suspense fallback={null}>
        <NeuralBackground agentActive={false} />
      </Suspense>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "40px 24px", position: "relative", zIndex: 1 }}>
        <div style={{ display:"flex", alignItems:"flex-end", justifyContent:"space-between", marginBottom: 28 }}>
          <div>
            <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.12em", color:"#00FF88", display:"block", marginBottom:8 }}>
              CoinGecko · Auto-cached 60s
            </span>
            <h1 style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:"clamp(22px,3vw,34px)", margin:0, background:"linear-gradient(90deg,#00FF88,#00BFFF)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>
              Live Market Data
            </h1>
          </div>
          <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:11, color:"#6b7280" }}>{tokens.length} tokens</span>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(290px,1fr))", gap:16 }}>
          {tokens.map((t, i) => (
            <div key={t} style={{ position:"relative" }}>
              <TokenCard tokenId={t} index={i} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}