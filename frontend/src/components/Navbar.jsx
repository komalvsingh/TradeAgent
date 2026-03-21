import React, { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { useWallet } from "../context/WalletContext";
import { useAgent }  from "../context/AgentContext";
import { useTheme }  from "../context/ThemeContext";

const NAV = [
  { path: "/",          label: "Home"      },
  { path: "/dashboard", label: "Dashboard" },
  { path: "/trade",     label: "Trade"     },
  { path: "/market",    label: "Market"    },
  { path: "/history",   label: "History"   },
  { path: "/voice",     label: "Voice"     },
];

export default function Navbar() {
  const { pathname } = useLocation();
  const { account, connect, disconnect, loading, isCorrectNetwork, switchToSepolia } = useWallet();
  const { agent }    = useAgent();
  const { isDark, toggleTheme } = useTheme();
  const [scrolled, setScrolled] = useState(false);

  const short = account ? `${account.slice(0,6)}...${account.slice(-4)}` : null;

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 10);
    window.addEventListener("scroll", fn);
    return () => window.removeEventListener("scroll", fn);
  }, []);

  const nb = {
    position:        "fixed",
    top: 0, left: 0, right: 0,
    zIndex:          100,
    height:          52,
    backgroundColor: scrolled
      ? isDark ? "rgba(11,15,20,0.94)" : "rgba(255,255,255,0.94)"
      : "transparent",
    backdropFilter:  scrolled ? "blur(14px)" : "none",
    borderBottom:    scrolled ? `1px solid var(--border)` : "1px solid transparent",
    transition:      "background-color 0.25s, border-color 0.25s, backdrop-filter 0.25s",
  };

  const inner = {
    maxWidth: 1120, margin: "0 auto", padding: "0 20px",
    height: "100%", display: "flex", alignItems: "center",
    justifyContent: "space-between", gap: 12,
  };

  return (
    <nav style={nb}>
      <div style={inner}>

        {/* Logo */}
        <Link to="/" style={{ display:"flex", alignItems:"center", gap:8, flexShrink:0 }}>
          <div style={{
            width:28, height:28, borderRadius:9,
            display:"flex", alignItems:"center", justifyContent:"center",
            fontSize:13, fontWeight:800, color:"white",
            background: isDark
              ? "linear-gradient(135deg,#3B82F6,#06B6D4)"
              : "linear-gradient(135deg,#7C6FF7,#BFA9C9)",
            boxShadow: isDark
              ? "0 2px 10px rgba(59,130,246,0.4)"
              : "0 2px 10px rgba(124,111,247,0.35)",
          }}>
            ◈
          </div>
          <span style={{
            fontFamily:"'Syne',sans-serif", fontWeight:800,
            fontSize:15, color:"var(--text)", letterSpacing:"-0.02em",
          }}>
            AI<span style={{ color:"var(--accent)" }}>Trader</span>
          </span>
        </Link>

        {/* Nav */}
        <div style={{ display:"flex", alignItems:"center", gap:1 }}>
          {NAV.map(({ path, label }) => {
            const active = pathname === path;
            return (
              <Link key={path} to={path} style={{
                padding:         "5px 12px",
                borderRadius:    8,
                fontSize:        13,
                fontWeight:      active ? 600 : 400,
                color:           active ? "var(--text)" : "var(--dim)",
                backgroundColor: active ? "var(--muted)" : "transparent",
                transition:      "color .15s, background-color .15s",
                whiteSpace:      "nowrap",
              }}
                onMouseEnter={e => { if(!active){ e.currentTarget.style.color="var(--text)"; e.currentTarget.style.backgroundColor="var(--muted)"; }}}
                onMouseLeave={e => { if(!active){ e.currentTarget.style.color="var(--dim)"; e.currentTarget.style.backgroundColor="transparent"; }}}
              >
                {label}
              </Link>
            );
          })}
        </div>

        {/* Right */}
        <div style={{ display:"flex", alignItems:"center", gap:7, flexShrink:0 }}>

          {/* Wrong network */}
          {account && !isCorrectNetwork && (
            <button onClick={switchToSepolia} style={{
              fontSize:11, padding:"4px 9px", borderRadius:7,
              background:"rgba(245,158,11,0.1)", color:"#F59E0B",
              border:"1px solid rgba(245,158,11,0.3)",
              fontFamily:"'JetBrains Mono',monospace", cursor:"pointer",
            }}>⚠ Sepolia</button>
          )}

          {/* Agent chip */}
          {account && agent && (
            <div style={{
              display:"flex", alignItems:"center", gap:5,
              padding:"4px 10px", borderRadius:8,
              background:"var(--muted)", border:"1px solid var(--border)",
              fontSize:11, fontFamily:"'JetBrains Mono',monospace",
            }}>
              <span style={{ color:"var(--text)", fontWeight:600 }}>{agent.name}</span>
              <span style={{ color:"var(--border)" }}>·</span>
              <span style={{ color:"var(--accent)", fontWeight:600 }}>{agent.trust_score?.toFixed(0)}pts</span>
            </div>
          )}

          {/* Theme toggle */}
          <button onClick={toggleTheme} title={isDark ? "Light mode" : "Dark mode"} style={{
            width:32, height:32, borderRadius:9, border:"1px solid var(--border)",
            background:"var(--muted)", color:"var(--dim)",
            display:"flex", alignItems:"center", justifyContent:"center",
            fontSize:15, cursor:"pointer",
            transition:"background .15s, color .15s",
          }}
            onMouseEnter={e=>{ e.currentTarget.style.color="var(--text)"; e.currentTarget.style.background="var(--card)"; }}
            onMouseLeave={e=>{ e.currentTarget.style.color="var(--dim)"; e.currentTarget.style.background="var(--muted)"; }}
          >
            {isDark ? "☀" : "🌙"}
          </button>

          {/* Wallet */}
          {account ? (
            <div style={{ display:"flex", alignItems:"center", gap:6 }}>
              <div style={{
                display:"flex", alignItems:"center", gap:6,
                padding:"4px 10px", borderRadius:9,
                background:"rgba(34,197,94,0.08)", border:"1px solid rgba(34,197,94,0.22)",
                fontSize:11, fontFamily:"'JetBrains Mono',monospace", color:"#22C55E",
              }}>
                <span className="pulse" style={{
                  width:5, height:5, borderRadius:"50%",
                  backgroundColor:"#22C55E", flexShrink:0,
                }}/>
                {short}
              </div>
              <button onClick={disconnect} style={{
                fontSize:11, padding:"5px 12px", borderRadius:9,
                background:"var(--muted)", border:"1px solid var(--border)",
                color:"var(--dim)", cursor:"pointer",
                fontFamily:"'JetBrains Mono',monospace",
                transition:"color .15s, border-color .15s",
              }}
                onMouseEnter={e=>{ e.currentTarget.style.color="#EF4444"; e.currentTarget.style.borderColor="rgba(239,68,68,0.35)"; }}
                onMouseLeave={e=>{ e.currentTarget.style.color="var(--dim)"; e.currentTarget.style.borderColor="var(--border)"; }}
              >Disconnect</button>
            </div>
          ) : (
            <button onClick={connect} disabled={loading} className="btn btn-primary"
              style={{ fontSize:12, padding:"7px 16px", borderRadius:9 }}>
              {loading ? "Connecting..." : "Connect Wallet"}
            </button>
          )}
        </div>
      </div>
    </nav>
  );
}