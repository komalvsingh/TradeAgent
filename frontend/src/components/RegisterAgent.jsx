import React, { useState, useCallback } from "react";
import { useAgent }     from "../context/AgentContext";
import { useContracts } from "../context/ContractContext";
import { useWallet }    from "../context/WalletContext";
import { Card, SectionTitle, ActionBtn, Input } from "./UI";
import { linkChainId } from "../utils/api"; // see note below

const STRATEGIES = [
  { value: "COMBINED",     label: "Combined (RSI + MA + Sentiment)" },
  { value: "RSI",          label: "RSI Only"                        },
  { value: "MA_CROSSOVER", label: "MA Crossover"                    },
  { value: "SENTIMENT",    label: "Sentiment Only"                  },
];

const RISK_LEVELS = [
  { value: "LOW",    label: "Low"    },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH",   label: "High"   },
];

// ── Step definitions ─────────────────────────────────────────────────────────
const STEPS = [
  { id: "contract", label: "AgentRegistry TX" },
  { id: "event",    label: "Get Agent ID"     },
  { id: "backend",  label: "Save to Backend"  },
  { id: "done",     label: "Ready"            },
];

function StepBar({ steps }) {
  return (
    <div className="flex items-center gap-0 w-full my-4">
      {STEPS.map((s, i) => {
        const st    = steps[s.id];
        const dot   = st === "done"    ? "bg-green"
                    : st === "error"   ? "bg-red"
                    : st === "pending" ? "bg-yellow animate-pulse"
                    :                    "bg-muted";
        const label = st === "done"    ? "text-green"
                    : st === "error"   ? "text-red"
                    : st === "pending" ? "text-yellow"
                    :                    "text-dim";
        return (
          <React.Fragment key={s.id}>
            <div className="flex flex-col items-center min-w-[72px]">
              <div className={`w-3 h-3 rounded-full transition-all ${dot}`} />
              <span className={`text-[10px] mono mt-1 text-center leading-tight ${label}`}>
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className="flex-1 h-px bg-border min-w-[8px] mb-3" />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────
export default function RegisterAgent() {
  const { register }             = useAgent();
  const { registerAgentOnChain } = useContracts();
  const { account }              = useWallet();

  const [name,     setName]     = useState("");
  const [strategy, setStrategy] = useState("COMBINED");
  const [risk,     setRisk]     = useState("MEDIUM");
  const [maxTrade, setMaxTrade] = useState("500");

  const [busy,      setBusy]    = useState(false);
  const [error,     setError]   = useState(null);
  const [statusMsg, setStatus]  = useState(null);
  const [agentId,   setAgentId] = useState(null);
  const [steps,     setSteps]   = useState({
    contract: null, event: null, backend: null, done: null,
  });

  // Track a split-state scenario: chain succeeded but backend failed.
  // Lets the user retry the backend-link without re-triggering MetaMask.
  const [pendingChainId, setPendingChainId] = useState(null);

  const setStep = useCallback(
    (id, status) => setSteps((prev) => ({ ...prev, [id]: status })),
    []
  );

  const resetFlow = () => {
    setError(null);
    setStatus(null);
    setAgentId(null);
    setPendingChainId(null);
    setSteps({ contract: null, event: null, backend: null, done: null });
  };

  // ── Registration flow ────────────────────────────────────────────────────
  //
  //  1. registerAgentOnChain()  — MetaMask gas TX
  //     → AgentRegistry.sol emits AgentRegistered(agentId, owner, name)
  //  2. Parse agentId from receipt event
  //  3. POST to backend with on_chain_id — links DB record to chain
  //  4. AgentContext.setAgent() updates — rest of app knows agent exists
  //
  const handleSubmit = async () => {
    if (!name.trim()) { setError("Agent name is required."); return; }
    if (!account)     { setError("Wallet not connected."); return; }

    setBusy(true);
    resetFlow();

    let resolvedChainId = null; // set once the chain step succeeds

    try {
      // ── Step 1 & 2: On-chain registration ────────────────────────────────
      setStep("contract", "pending");
      setStatus("MetaMask opening — approve the transaction to register your agent on-chain…");

      try {
        // FIX: registerAgentOnChain is now called here and awaited before
        // the backend call. Previously this function was never invoked from
        // RegisterAgent.jsx, which is why on_chain_id was always null.
        const { agentId: id } = await registerAgentOnChain(
          name.trim(),
          strategy,
          account,  // endpoint: wallet address as unique identifier
          "",       // tokenURI: empty — can be set to IPFS metadata URI later
        );

        setStep("contract", "done");
        setStep("event", "pending");

        if (id != null) {
          resolvedChainId = id;
          setAgentId(id);
          setStep("event", "done");
          setStatus(`On-chain registered! Agent ID: #${id}. Saving to backend…`);
        } else {
          // Contract TX mined but event parsing failed — rare.
          // We still proceed; the backend record will have on_chain_id=null
          // and the user can link it later via Dashboard.
          setStep("event", "error");
          setStatus(
            "TX confirmed but could not read Agent ID from event. " +
            "Saving to backend — you can link the chain ID from Dashboard."
          );
        }

      } catch (contractErr) {
        // User rejected MetaMask — abort entirely
        if (
          contractErr.code === 4001 ||
          contractErr.message?.includes("user rejected") ||
          contractErr.message?.includes("User denied") ||
          contractErr.code === "ACTION_REJECTED" // ethers v6 code
        ) {
          setStep("contract", "error");
          setError("Registration cancelled — MetaMask transaction rejected.");
          setBusy(false);
          return;
        }

        // Contract not deployed / wrong network — warn but don't block backend save
        console.warn("On-chain registration failed:", contractErr.message);
        setStep("contract", "error");
        setStep("event",    "error");
        setStatus(
          "On-chain step failed (contract not deployed or wrong network). " +
          "Saving to backend only — you can register on-chain later from Dashboard."
        );
      }

      // ── Step 3: Save to backend ───────────────────────────────────────────
      setStep("backend", "pending");
      setStatus("Saving agent to backend…");

      try {
        await register(
          name.trim(),
          strategy,
          risk,
          maxTrade,
          resolvedChainId, // null if contract step failed — backend still creates record
        );

        setStep("backend", "done");
        setStep("done",    "done");
        setStatus(
          resolvedChainId != null
            ? `Agent registered! On-chain ID: #${resolvedChainId}. MetaMask will open on every trade.`
            : "Agent saved to backend. Register on-chain from Dashboard to enable blockchain trading."
        );

      } catch (backendErr) {
        // FIX: Split-state handling — chain TX succeeded but backend save failed.
        // Store the chain ID so the user can retry linking without re-signing.
        setStep("backend", "error");

        if (resolvedChainId != null) {
          setPendingChainId(resolvedChainId);
          setError(
            `Backend save failed: ${backendErr.response?.data?.detail || backendErr.message}. ` +
            `Your on-chain Agent ID is #${resolvedChainId}. ` +
            `Click "Retry Backend Save" to link it without re-opening MetaMask.`
          );
        } else {
          setError(backendErr.response?.data?.detail || backendErr.message);
        }
      }

    } finally {
      setBusy(false);
    }
  };

  // ── Retry: link on_chain_id to existing backend record ───────────────────
  // Used when the chain TX succeeded but the initial backend POST failed.
  // Calls PATCH /agents/{wallet}/link-chain — no MetaMask needed.
  const handleRetryBackend = async () => {
    if (!pendingChainId) return;
    setBusy(true);
    setError(null);
    setStatus("Retrying backend save…");
    setStep("backend", "pending");

    try {
      // Try re-registering first (idempotent — backend returns existing if present)
      await register(
        name.trim(),
        strategy,
        risk,
        maxTrade,
        pendingChainId,
      );

      setStep("backend", "done");
      setStep("done",    "done");
      setPendingChainId(null);
      setStatus(`Agent registered! On-chain ID: #${pendingChainId}.`);
    } catch (e) {
      // If re-register fails (e.g. agent already in DB without chain id),
      // fall back to the PATCH /link-chain endpoint.
      try {
        await linkChainId(account, pendingChainId);
        setStep("backend", "done");
        setStep("done",    "done");
        setPendingChainId(null);
        setStatus(`Agent linked! On-chain ID: #${pendingChainId}.`);
      } catch (linkErr) {
        setStep("backend", "error");
        setError(linkErr.response?.data?.detail || linkErr.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const showStepBar = Object.values(steps).some((s) => s !== null);
  const isDone      = steps.done === "done";

  return (
    <Card className="max-w-md">
      <SectionTitle>Register Agent</SectionTitle>

      <div className="mb-4 px-3 py-2 rounded border border-blue/20 bg-blue/5">
        <p className="text-xs mono text-blue leading-relaxed">
          Clicking Register will open MetaMask to approve a gas transaction
          on Sepolia. This writes your agent to the{" "}
          <span className="text-text">AgentRegistry</span> contract and gives
          it an on-chain ID — required for EIP-712 signed trades and
          ValidationRegistry audit logs.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <Input
          label="Agent Name"
          value={name}
          onChange={setName}
          placeholder="e.g. AlphaBot"
          disabled={busy || isDone}
        />
        <Input
          label="Strategy"
          value={strategy}
          onChange={setStrategy}
          options={STRATEGIES}
          disabled={busy || isDone}
        />
        <Input
          label="Risk Tolerance"
          value={risk}
          onChange={setRisk}
          options={RISK_LEVELS}
          disabled={busy || isDone}
        />
        <Input
          label="Max Trade (USD)"
          value={maxTrade}
          onChange={setMaxTrade}
          type="number"
          placeholder="500"
          disabled={busy || isDone}
        />

        {showStepBar && <StepBar steps={steps} />}

        {statusMsg && !error && (
          <p className={`text-xs mono px-3 py-2 rounded border ${
            isDone
              ? "text-green border-green/20 bg-green/5"
              : "text-yellow border-yellow/20 bg-yellow/5"
          }`}>
            {statusMsg}
          </p>
        )}

        {agentId != null && (
          <div className="flex items-center gap-2">
            <span className="text-xs mono px-2 py-1 rounded bg-blue/10 text-blue border border-blue/20">
              ⛓ On-chain Agent ID: #{agentId}
            </span>
          </div>
        )}

        {error && (
          <p className="text-xs text-red mono px-3 py-2 rounded border border-red/20 bg-red/5">
            {error}
          </p>
        )}

        {!isDone ? (
          <div className="flex flex-col gap-2">
            <ActionBtn onClick={handleSubmit} loading={busy} disabled={busy}>
              {busy ? "Registering…" : "Register Agent"}
            </ActionBtn>

            {/* Show retry button when chain succeeded but backend failed */}
            {pendingChainId != null && !busy && (
              <ActionBtn onClick={handleRetryBackend} variant="secondary">
                Retry Backend Save (Chain ID: #{pendingChainId})
              </ActionBtn>
            )}
          </div>
        ) : (
          <div className="px-3 py-2 rounded border border-green/20 bg-green/5 text-xs mono text-green text-center">
            ✓ Agent registered successfully
          </div>
        )}
      </div>
    </Card>
  );
}

// ── Note: add linkChainId to ../utils/api.js ──────────────────────────────
//
// export const linkChainId = (walletAddress, onChainId) =>
//   axios.patch(`/agents/${walletAddress}/link-chain`, null, {
//     params: { on_chain_id: onChainId },
//   }).then(r => r.data);