import React from "react";

export function Card({ children, className = "" }) {
  return (
    <div className={`bg-surface border border-border rounded-lg p-4 ${className}`}>
      {children}
    </div>
  );
}

export function Badge({ children, variant = "default" }) {
  const styles = {
    default: "bg-muted text-dim",
    green:   "bg-green/10 text-green border border-green/20",
    red:     "bg-red/10 text-red border border-red/20",
    yellow:  "bg-yellow/10 text-yellow border border-yellow/20",
    blue:    "bg-blue/10 text-blue border border-blue/20",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded mono font-medium ${styles[variant]}`}>
      {children}
    </span>
  );
}

export function Spinner({ size = 4 }) {
  return (
    <div
      className={`w-${size} h-${size} border-2 border-muted border-t-green rounded-full animate-spin`}
    />
  );
}

export function EmptyState({ message = "No data yet." }) {
  return (
    <div className="text-center py-10 text-dim text-sm mono">{message}</div>
  );
}

export function SectionTitle({ children }) {
  return (
    <h2 className="text-xs font-semibold text-dim mono uppercase tracking-widest mb-3">
      {children}
    </h2>
  );
}

export function StatBox({ label, value, sub, color = "text-text" }) {
  return (
    <div className="bg-surface border border-border rounded-lg p-4">
      <p className="text-xs text-dim mono mb-1">{label}</p>
      <p className={`text-xl font-semibold mono ${color}`}>{value}</p>
      {sub && <p className="text-xs text-dim mono mt-0.5">{sub}</p>}
    </div>
  );
}

export function ActionBtn({ children, onClick, loading, disabled, variant = "primary", className = "" }) {
  const base = "text-xs px-4 py-2 rounded mono font-medium transition-colors disabled:opacity-40";
  const variants = {
    primary:   "bg-green/10 text-green border border-green/20 hover:bg-green/20",
    danger:    "bg-red/10 text-red border border-red/20 hover:bg-red/20",
    secondary: "bg-muted text-dim hover:text-text border border-border",
  };
  return (
    <button
      onClick={onClick}
      disabled={loading || disabled}
      className={`${base} ${variants[variant]} ${className}`}
    >
      {loading ? "Loading..." : children}
    </button>
  );
}

export function Input({ label, value, onChange, placeholder, type = "text", options }) {
  const inputClass =
    "w-full bg-bg border border-border rounded px-3 py-2 text-sm mono text-text placeholder:text-dim focus:outline-none focus:border-muted";

  return (
    <div className="flex flex-col gap-1">
      {label && <label className="text-xs text-dim mono">{label}</label>}
      {options ? (
        <select value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      ) : (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={inputClass}
        />
      )}
    </div>
  );
}

export function WalletGuard({ children }) {
  const { useWallet } = require("../context/WalletContext");
  // inline usage below — exported separately
  return children;
}

export function ConnectPrompt() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center">
      <span className="text-4xl">⬡</span>
      <p className="text-sm text-dim mono">Connect your wallet to get started</p>
    </div>
  );
}