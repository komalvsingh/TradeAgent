import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";

const WalletContext = createContext(null);

export function WalletProvider({ children }) {
  const [account,  setAccount]  = useState(null);
  const [provider, setProvider] = useState(null);
  const [signer,   setSigner]   = useState(null);
  const [chainId,  setChainId]  = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);

  const isCorrectNetwork = chainId === 11155111; // Sepolia

  // ── Connect ──────────────────────────────────────────────────────────────
  const connect = useCallback(async () => {
    setError(null);
    if (!window.ethereum) {
      setError("MetaMask not found. Please install it.");
      return;
    }
    setLoading(true);
    try {
      const web3Provider = new ethers.BrowserProvider(window.ethereum);
      await web3Provider.send("eth_requestAccounts", []);
      const web3Signer  = await web3Provider.getSigner();
      const address     = await web3Signer.getAddress();
      const network     = await web3Provider.getNetwork();

      setProvider(web3Provider);
      setSigner(web3Signer);
      setAccount(address);
      setChainId(Number(network.chainId));
    } catch (e) {
      setError(e.message || "Connection failed");
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Disconnect ───────────────────────────────────────────────────────────
  const disconnect = useCallback(() => {
    setAccount(null);
    setProvider(null);
    setSigner(null);
    setChainId(null);
    setError(null);
  }, []);

  // ── Switch to Sepolia ────────────────────────────────────────────────────
  const switchToSepolia = useCallback(async () => {
    if (!window.ethereum) return;
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0xaa36a7" }], // 11155111 in hex
      });
    } catch (e) {
      setError("Please switch to Sepolia network manually in MetaMask.");
    }
  }, []);

  // ── Listen for account/chain changes ─────────────────────────────────────
  useEffect(() => {
    if (!window.ethereum) return;

    const onAccountsChanged = (accounts) => {
      if (accounts.length === 0) disconnect();
      else setAccount(accounts[0]);
    };

    const onChainChanged = (hex) => {
      setChainId(parseInt(hex, 16));
    };

    window.ethereum.on("accountsChanged", onAccountsChanged);
    window.ethereum.on("chainChanged",    onChainChanged);

    return () => {
      window.ethereum.removeListener("accountsChanged", onAccountsChanged);
      window.ethereum.removeListener("chainChanged",    onChainChanged);
    };
  }, [disconnect]);

  // ── Auto-reconnect if previously connected ────────────────────────────────
  useEffect(() => {
    if (!window.ethereum) return;
    window.ethereum
      .request({ method: "eth_accounts" })
      .then((accounts) => { if (accounts.length > 0) connect(); })
      .catch(() => {});
  }, [connect]);

  return (
    <WalletContext.Provider value={{
      account, provider, signer, chainId,
      loading, error, isCorrectNetwork,
      connect, disconnect, switchToSepolia,
    }}>
      {children}
    </WalletContext.Provider>
  );
}

export const useWallet = () => useContext(WalletContext);