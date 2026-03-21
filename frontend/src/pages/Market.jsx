import React, { useEffect, useState } from "react";
import { getMarket, getTokens } from "../utils/api";
import { Card, SectionTitle, Badge, Spinner, EmptyState } from "../components/UI";

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

  useEffect(() => {
    // Stagger requests to avoid rate limiting — 1.5s gap between each
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

  return (
    <Card>
      {loading ? (
        <div className="flex flex-col items-center justify-center py-6 gap-2">
          <Spinner />
          <p className="text-xs text-dim mono">Loading {tokenId}...</p>
        </div>
      ) : error ? (
        <div className="py-4">
          <p className="text-xs font-semibold mono text-dim mb-1">
            {TOKEN_LABELS[tokenId] || tokenId}
          </p>
          <p className="text-xs text-red mono">{error}</p>
          <button
            onClick={() => {
              setLoading(true);
              setError(null);
              getMarket(tokenId)
                .then((d) => { setData(d); setError(null); })
                .catch((e) => setError(e.response?.data?.detail || e.message))
                .finally(() => setLoading(false));
            }}
            className="text-xs text-dim hover:text-text mono mt-2 underline"
          >
            Retry
          </button>
        </div>
      ) : data ? (
        <>
          <div className="flex justify-between items-start mb-3">
            <div>
              <span className="mono font-semibold text-sm text-text">{data.symbol}</span>
              <span className="text-dim mono text-xs ml-2 capitalize">{tokenId.replace("-", " ")}</span>
            </div>
            <Badge variant={data.price_change_24h >= 0 ? "green" : "red"}>
              {data.price_change_24h >= 0 ? "+" : ""}{data.price_change_24h?.toFixed(2)}%
            </Badge>
          </div>

          <p className="mono text-lg font-semibold mb-1">
            ${data.price_usd?.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
          </p>

          <p className="text-xs text-dim mono mb-3">
            MCap: ${(data.market_cap / 1e9)?.toFixed(2)}B · Vol: ${(data.volume_24h / 1e9)?.toFixed(2)}B
          </p>

          <div className="grid grid-cols-2 gap-1.5 text-xs mono mb-3">
            <div className="bg-bg border border-border rounded p-2">
              <span className="text-dim">RSI (14): </span>
              <span className={data.rsi < 30 ? "text-green" : data.rsi > 70 ? "text-red" : "text-text"}>
                {data.rsi?.toFixed(1)} — {rsiLabel(data.rsi)}
              </span>
            </div>
            <div className="bg-bg border border-border rounded p-2">
              <span className="text-dim">Sentiment: </span>
              <span className={data.sentiment_score > 0.3 ? "text-green" : data.sentiment_score < -0.3 ? "text-red" : "text-text"}>
                {data.sentiment_score?.toFixed(3)}
              </span>
            </div>
            <div className="bg-bg border border-border rounded p-2">
              <span className="text-dim">MA7: </span>
              <span className="text-text">
                ${data.ma_7?.toLocaleString("en-US", { maximumFractionDigits: 4 })}
              </span>
            </div>
            <div className="bg-bg border border-border rounded p-2">
              <span className="text-dim">MA25: </span>
              <span className="text-text">
                ${data.ma_25?.toLocaleString("en-US", { maximumFractionDigits: 4 })}
              </span>
            </div>
          </div>

          {/* MA trend indicator */}
          <div className="flex items-center gap-2 text-xs mono">
            <span className="text-dim">Trend:</span>
            {data.ma_7 && data.ma_25 ? (
              <Badge variant={data.ma_7 > data.ma_25 ? "green" : "red"}>
                {data.ma_7 > data.ma_25 ? "Bullish (MA7 > MA25)" : "Bearish (MA7 < MA25)"}
              </Badge>
            ) : (
              <span className="text-dim">—</span>
            )}
          </div>
        </>
      ) : null}
    </Card>
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
    <div className="flex justify-center py-20"><Spinner size={6} /></div>
  );

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-4">
        <SectionTitle>Live Market Data</SectionTitle>
        <p className="text-xs text-dim mono">
          {tokens.length} tokens · auto-cached 60s
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {tokens.map((t, i) => (
          <TokenCard key={t} tokenId={t} index={i} />
        ))}
      </div>
    </div>
  );
}