import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { WalletProvider } from "./context/WalletContext";
import { ContractProvider } from "./context/ContractContext";
import { AgentProvider } from "./context/AgentContext";
import Navbar from "./components/Navbar";
import Dashboard from "./pages/Dashboard";
import Trade     from "./pages/Trade";
import Market    from "./pages/Market";
import History   from "./pages/History";
import Voice     from "./pages/Voice";

export default function App() {
  return (
    <WalletProvider>
      <ContractProvider>
        <AgentProvider>
          <BrowserRouter>
            <div className="min-h-screen bg-bg">
              <Navbar />
              <main>
                <Routes>
                  <Route path="/"        element={<Dashboard />} />
                  <Route path="/trade"   element={<Trade />} />
                  <Route path="/market"  element={<Market />} />
                  <Route path="/history" element={<History />} />
                  <Route path="/voice"   element={<Voice />} />
                </Routes>
              </main>
            </div>
          </BrowserRouter>
        </AgentProvider>
      </ContractProvider>
    </WalletProvider>
  );
}