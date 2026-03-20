import React from "react";
import { Link, useLocation } from "react-router-dom";
import { useWallet } from "../context/WalletContext";
import { useAgent } from "../context/AgentContext";

const NAV = [
  { path: "/",          label: "Dashboard" },
  { path: "/trade",     label: "Trade"     },
  { path: "/market",    label: "Market"    },
  { path: "/history",   label: "History"   },
  { path: "/voice",     label: "Voice"     },
];

export default function Navbar() {
  const { pathname } = useLocation();
  const { account, connect, disconnect, loading, isCorrectNetwork, switchToSepolia } = useWallet();
  const { agent } = useAgent();

  const short = account
    ? `${account.slice(0, 6)}...${account.slice(-4)}`
    : null;

  return (
    <nav className="border-b border-border bg-surface sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4 flex items-center justify-between h-12">

        {/* Logo */}
        <span className="mono text-sm font-semibold text-text tracking-tight">
          ⬡ AI<span className="text-green">Trader</span>
        </span>

        {/* Nav links */}
        <div className="flex items-center gap-1">
          {NAV.map(({ path, label }) => (
            <Link
              key={path}
              to={path}
              className={`px-3 py-1 text-xs rounded mono transition-colors ${
                pathname === path
                  ? "bg-muted text-text"
                  : "text-dim hover:text-text"
              }`}
            >
              {label}
            </Link>
          ))}
        </div>

        {/* Wallet */}
        <div className="flex items-center gap-2">
          {account && !isCorrectNetwork && (
            <button
              onClick={switchToSepolia}
              className="text-xs px-2 py-1 rounded bg-yellow/10 text-yellow border border-yellow/20 mono"
            >
              Wrong network
            </button>
          )}

          {account && agent && (
            <span className="text-xs text-dim mono hidden sm:block">
              {agent.name} · {agent.trust_score?.toFixed(0)}pts
            </span>
          )}

          {account ? (
            <div className="flex items-center gap-2">
              <span className="mono text-xs text-green flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green inline-block pulse" />
                {short}
              </span>
              <button
                onClick={disconnect}
                className="text-xs px-2 py-1 rounded border border-border text-dim hover:text-red hover:border-red/30 mono transition-colors"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <button
              onClick={connect}
              disabled={loading}
              className="text-xs px-3 py-1 rounded bg-green/10 text-green border border-green/20 hover:bg-green/20 mono transition-colors disabled:opacity-50"
            >
              {loading ? "Connecting..." : "Connect Wallet"}
            </button>
          )}
        </div>
      </div>
    </nav>
  );
}