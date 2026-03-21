import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useWallet } from "../context/WalletContext";
import { useTheme }  from "../context/ThemeContext";
import Navbar from "../components/Navbar";

function Counter({ end, suffix = "" }) {
  const [val, setVal] = useState(0);
  const [go,  setGo]  = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => { if(e.isIntersecting) setGo(true); }, { threshold:.5 });
    if(ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);
  useEffect(() => {
    if(!go) return;
    let n = 0; const step = end / 55;
    const t = setInterval(() => { n+=step; if(n>=end){ setVal(end); clearInterval(t); } else setVal(Math.floor(n)); }, 16);
    return () => clearInterval(t);
  }, [go, end]);
  return <span ref={ref}>{val}{suffix}</span>;
}

/* Feature card data — accent colors cycle through CSS vars */
const FEATURES = [
  { icon:"🧠", title:"LangChain AI Brain",    desc:"Groq LLaMA3-70B analyses RSI, MA crossover, and sentiment in real time to decide BUY / SELL / HOLD.", ac:"var(--c1)" },
  { icon:"⛓",  title:"On-Chain Trust Layer",  desc:"Every decision is cryptographically stored on Sepolia via our ERC-8004 ValidationRegistry contract.", ac:"var(--c2)" },
  { icon:"🛡",  title:"Risk Router Contract",  desc:"Trades pass through an on-chain RiskRouter enforcing token allowlists, thresholds, and daily limits.", ac:"var(--c3)" },
  { icon:"⭐",  title:"Reputation Engine",     desc:"ReputationManager updates your agent's trust score (0–100) after every trade based on real PnL.", ac:"var(--c4)" },
  { icon:"🎙",  title:"Voice AI Trader",       desc:'"Buy ETH now" → AI analyses, MetaMask signs, trade executes. Natural language meets DeFi.', ac:"var(--c5)" },
  { icon:"🔥",  title:"Live Risk Heatmap",     desc:"Real-time exposure per token with volatility scores, sentiment analysis, and visual risk bars.", ac:"var(--c6)" },
];

const STEPS = [
  { title:"Connect & Register Agent",  desc:"Connect MetaMask on Sepolia. Set agent name, strategy (RSI / MA / Sentiment / Combined), and risk tolerance." },
  { title:"AI Analyses Live Market",   desc:"LLaMA3-70B fetches live CoinGecko prices, computes RSI and MA, and produces a decision with confidence score." },
  { title:"Sign with MetaMask",        desc:"A MetaMask popup appears. You sign a human-readable approval — free, no ETH spent. Proves user intent." },
  { title:"RiskRouter Validates",      desc:"Trade passes through our Solidity RiskRouter checking token allowlists, confidence thresholds, limits on-chain." },
  { title:"Proof Stored on Sepolia",   desc:"ValidationRegistry permanently records AI reasoning, confidence score, and risk result. Immutable, forever." },
  { title:"Trust Score Updates",       desc:"ReputationManager updates your agent score based on real PnL. High confidence + profit = bigger trust boost.", last:true },
];

const CONTRACTS = [
  { name:"AgentRegistry",      addr:"0x67d7...7925" },
  { name:"ValidationRegistry", addr:"0x7249...7062" },
  { name:"RiskRouter",         addr:"0x27a2...104c" },
  { name:"ReputationManager",  addr:"0x625a...0Bd7" },
];

const TECH = ["FastAPI","LangChain","Groq LLaMA3","Solidity","Hardhat","React","ethers.js","MongoDB","CoinGecko","Sepolia"];

export default function Home() {
  const { account, connect, loading } = useWallet();
  const { isDark } = useTheme();

  const acColors = isDark
    ? ["#3B82F6","#06B6D4","#22C55E","#F59E0B"]
    : ["#7C6FF7","#BFA9C9","#D8A7B1","#B8C3A6"];

  return (
    <>
      <Navbar />
      <div style={{
        minHeight:"100vh", paddingTop:52,
        backgroundColor:"var(--bg)", position:"relative",
      }} className="grid-bg">

        {/* ── Orbs ──────────────────────────────────────────────────────────── */}
        {isDark ? (
          <>
            <div className="orb" style={{ top:"-6%", right:"-3%", width:480, height:480, background:"radial-gradient(circle,rgba(59,130,246,0.12),transparent)" }}/>
            <div className="orb" style={{ bottom:"10%", left:"-3%", width:380, height:380, background:"radial-gradient(circle,rgba(6,182,212,0.09),transparent)" }}/>
          </>
        ) : (
          <>
            <div className="orb" style={{ top:"-6%", right:"-3%", width:500, height:500, background:"radial-gradient(circle,rgba(124,111,247,0.14),transparent)" }}/>
            <div className="orb" style={{ bottom:"8%",  left:"-3%", width:400, height:400, background:"radial-gradient(circle,rgba(191,169,201,0.18),transparent)" }}/>
          </>
        )}

        <div style={{ maxWidth:1100, margin:"0 auto", padding:"0 24px", position:"relative" }}>

          {/* ════════════════════════════════════════════════════
              HERO
          ════════════════════════════════════════════════════ */}
          <section style={{ padding:"80px 0 56px", textAlign:"center" }}>

            <h1 className="font-display fade-up d1" style={{
              fontSize:"clamp(36px,5.5vw,68px)",
              fontWeight:800,
              lineHeight:1.08,
              letterSpacing:"-0.03em",
              color:"var(--text)",
              marginBottom:18,
            }}>
              AI-Powered Trading<br />
              <span className={isDark ? "grad-dark" : "grad-light"}>
                With On-Chain Trust
              </span>
            </h1>

            <p className="fade-up d2" style={{
              fontSize:15,
              lineHeight:1.7,
              color:"var(--dim)",
              maxWidth:520,
              margin:"0 auto 36px",
              fontWeight:400,
            }}>
              Register your AI agent, let LLaMA3-70B analyse live market data,
              sign trades with MetaMask, and store every decision permanently on Sepolia.
            </p>

            {/* CTAs */}
            <div className="fade-up d3" style={{
              display:"flex", gap:10, justifyContent:"center", flexWrap:"wrap",
            }}>
              {account ? (
                <>
                  <Link to="/dashboard" className="btn btn-primary" style={{ fontSize:13 }}>
                    Go to Dashboard →
                  </Link>
                  <Link to="/trade" className="btn btn-ghost" style={{ fontSize:13 }}>
                    Start Trading
                  </Link>
                </>
              ) : (
                <>
                  <button onClick={connect} disabled={loading}
                    className="btn btn-primary" style={{ fontSize:13 }}>
                    {loading ? "Connecting..." : "Connect MetaMask →"}
                  </button>
                  <Link to="/market" className="btn btn-ghost" style={{ fontSize:13 }}>
                    View Market
                  </Link>
                </>
              )}
            </div>
          </section>

          {/* ════════════════════════════════════════════════════
              STATS — Fintechy-style colored boxes
          ════════════════════════════════════════════════════ */}
          <section style={{ paddingBottom:64 }}>
            <div className="fade-up d4" style={{
              display:"grid",
              gridTemplateColumns:"repeat(auto-fit,minmax(210px,1fr))",
              gap:12,
            }}>
              {[
                { label:"Contracts Deployed",   end:4,   suffix:"",     ac: acColors[0] },
                { label:"Strategies Available", end:4,   suffix:"",     ac: acColors[1] },
                { label:"Tokens Supported",     end:6,   suffix:"",     ac: acColors[2] },
                { label:"Trust Score Max",      end:100, suffix:" pts", ac: acColors[3] },
              ].map(({ label, end, suffix, ac }) => (
                <div key={label} className="scard" style={{ borderTop:`3px solid ${ac}` }}>
                  <div className="scard-val" style={{ color: ac }}>
                    <Counter end={end} suffix={suffix} />
                  </div>
                  <div className="scard-label">{label}</div>
                </div>
              ))}
            </div>
          </section>

          {/* ════════════════════════════════════════════════════
              FEATURES — accent-topped cards (Fintechy style)
          ════════════════════════════════════════════════════ */}
          <section style={{ paddingBottom:72 }}>
            <div style={{ textAlign:"center", marginBottom:40 }}>
              <span className="slabel">CAPABILITIES</span>
              <h2 className="font-display" style={{
                fontSize:"clamp(22px,3vw,34px)",
                fontWeight:800,
                color:"var(--text)",
                letterSpacing:"-0.02em",
                lineHeight:1.15,
              }}>
                Everything you need<br />to trade with AI
              </h2>
            </div>

            <div style={{
              display:"grid",
              gridTemplateColumns:"repeat(auto-fit,minmax(285px,1fr))",
              gap:14,
            }}>
              {FEATURES.map(({ icon, title, desc, ac }) => (
                <div key={title} className="acard" style={{ "--ac": ac, "--ac-bg": `${ac}18` }}>
                  <div className="acard-icon">{icon}</div>
                  <div className="acard-title">{title}</div>
                  <div className="acard-desc">{desc}</div>
                </div>
              ))}
            </div>
          </section>

          {/* ════════════════════════════════════════════════════
              HOW IT WORKS  +  CONTRACTS
          ════════════════════════════════════════════════════ */}
          <section style={{ paddingBottom:72 }}>
            <div style={{
              display:"grid",
              gridTemplateColumns:"repeat(auto-fit,minmax(300px,1fr))",
              gap:52,
              alignItems:"start",
            }}>
              {/* Flow */}
              <div>
                <span className="slabel" style={{ color: isDark ? "var(--c2)" : "var(--accent)" }}>
                  HOW IT WORKS
                </span>
                <h2 className="font-display" style={{
                  fontSize:"clamp(20px,2.5vw,30px)", fontWeight:800,
                  color:"var(--text)", marginBottom:32,
                  letterSpacing:"-0.02em", lineHeight:1.2,
                }}>
                  From wallet<br />to on-chain proof
                </h2>
                {STEPS.map(({ title, desc, last }, i) => (
                  <div key={i} style={{ display:"flex", gap:14 }}>
                    <div style={{ display:"flex", flexDirection:"column", alignItems:"center" }}>
                      <div style={{
                        width:28, height:28, borderRadius:"50%", flexShrink:0,
                        display:"flex", alignItems:"center", justifyContent:"center",
                        fontSize:11, fontFamily:"'JetBrains Mono',monospace", fontWeight:700,
                        color:"white",
                        background: isDark
                          ? "linear-gradient(135deg,#3B82F6,#06B6D4)"
                          : "linear-gradient(135deg,#7C6FF7,#BFA9C9)",
                      }}>{i+1}</div>
                      {!last && <div className="flow-line" />}
                    </div>
                    <div style={{ paddingBottom:22 }}>
                      <p className="font-display" style={{
                        fontSize:13, fontWeight:700, color:"var(--text)",
                        marginBottom:3, letterSpacing:"-0.01em",
                      }}>{title}</p>
                      <p style={{ fontSize:12, lineHeight:1.65, color:"var(--dim)" }}>{desc}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Contracts + Tech */}
              <div>
                <span className="slabel" style={{ color:"var(--dim)" }}>
                  DEPLOYED — SEPOLIA TESTNET
                </span>
                <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:20 }}>
                  {CONTRACTS.map(({ name, addr }, i) => (
                    <div key={name} className="crow">
                      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                        <div style={{
                          width:8, height:8, borderRadius:"50%",
                          backgroundColor: acColors[i] || "var(--accent)",
                          flexShrink:0,
                        }}/>
                        <span className="font-display" style={{
                          fontSize:13, fontWeight:700, color:"var(--text)",
                        }}>{name}</span>
                      </div>
                      <span style={{
                        fontFamily:"'JetBrains Mono',monospace",
                        fontSize:11, color:"var(--dim)",
                      }}>{addr}</span>
                    </div>
                  ))}
                </div>

                {/* Tech stack box */}
                <div style={{
                  background:"var(--card)", border:"1px solid var(--border)",
                  borderRadius:14, padding:18,
                }}>
                  <span className="slabel" style={{ color:"var(--dim)" }}>TECH STACK</span>
                  <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                    {TECH.map(t => <span key={t} className="ttag">{t}</span>)}
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ════════════════════════════════════════════════════
              CTA BANNER
          ════════════════════════════════════════════════════ */}
          <section style={{ paddingBottom:72 }}>
            <div style={{
              background: isDark
                ? "linear-gradient(135deg, #0F1828 0%, #0B1220 100%)"
                : "linear-gradient(135deg, #F5F3FF 0%, #FDF2F8 100%)",
              border:`1px solid ${isDark ? "var(--border)" : "rgba(124,111,247,0.2)"}`,
              borderRadius:22,
              padding:"52px 28px",
              textAlign:"center",
              position:"relative",
              overflow:"hidden",
              boxShadow: isDark
                ? "0 0 60px rgba(59,130,246,0.07) inset"
                : "0 4px 40px rgba(124,111,247,0.1)",
            }}>
              {/* Corner accent */}
              <div style={{
                position:"absolute", top:0, left:0, right:0, height:3, borderRadius:"22px 22px 0 0",
                background: isDark
                  ? "linear-gradient(90deg,#3B82F6,#06B6D4)"
                  : "linear-gradient(90deg,#7C6FF7,#BFA9C9)",
              }}/>

              <h2 className="font-display" style={{
                fontSize:"clamp(22px,3vw,34px)", fontWeight:800,
                color:"var(--text)", marginBottom:12,
                letterSpacing:"-0.02em",
              }}>
                Ready to trade with AI?
              </h2>
              <p style={{
                fontSize:14, color:"var(--dim)", lineHeight:1.65,
                maxWidth:400, margin:"0 auto 30px",
              }}>
                Connect your wallet, register an agent, and let AI make its first decision in seconds.
              </p>
              <div style={{ display:"flex", gap:10, justifyContent:"center", flexWrap:"wrap" }}>
                {account ? (
                  <Link to="/trade" className="btn btn-primary" style={{ fontSize:13 }}>
                    Start Trading →
                  </Link>
                ) : (
                  <button onClick={connect} disabled={loading}
                    className="btn btn-primary" style={{ fontSize:13 }}>
                    {loading ? "Connecting..." : "Connect MetaMask →"}
                  </button>
                )}
                <Link to="/market" className="btn btn-ghost" style={{ fontSize:13 }}>
                  View Live Market
                </Link>
              </div>
            </div>
          </section>

          {/* ════════════════════════════════════════════════════
              FOOTER
          ════════════════════════════════════════════════════ */}
          <footer style={{
            borderTop:"1px solid var(--border)",
            paddingTop:18, paddingBottom:32,
            display:"flex", alignItems:"center",
            justifyContent:"space-between", flexWrap:"wrap", gap:12,
          }}>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <span className="font-display" style={{
                fontWeight:800, fontSize:14, color:"var(--text)", letterSpacing:"-0.01em",
              }}>
                AI<span style={{ color:"var(--accent)" }}>Trader</span>
              </span>
              <span style={{
                fontFamily:"'JetBrains Mono',monospace",
                fontSize:10, color:"var(--dim)",
              }}>
                · Hackathon · Sepolia Testnet
              </span>
            </div>
            <div style={{ display:"flex", gap:20 }}>
              {["/dashboard","/trade","/market","/history","/voice"].map(p => (
                <Link key={p} to={p} style={{
                  fontFamily:"'JetBrains Mono',monospace",
                  fontSize:11, color:"var(--dim)", textTransform:"capitalize",
                  transition:"color .15s",
                }}
                  onMouseEnter={e=>e.target.style.color="var(--text)"}
                  onMouseLeave={e=>e.target.style.color="var(--dim)"}
                >
                  {p.replace("/","")}
                </Link>
              ))}
            </div>
          </footer>
        </div>
      </div>
    </>
  );
}