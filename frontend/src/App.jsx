import React from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { WalletProvider }   from "./context/WalletContext";
import { ContractProvider } from "./context/ContractContext";
import { AgentProvider }    from "./context/AgentContext";
import { ThemeProvider }    from "./context/ThemeContext";
import Navbar     from "./components/Navbar";
import Home       from "./pages/Home";
import Dashboard  from "./pages/Dashboard";
import Trade      from "./pages/Trade";
import Market     from "./pages/Market";
import History    from "./pages/History";
import Voice      from "./pages/Voice";

// Home renders its own Navbar internally.
// All other pages use the shared Navbar here.
function AppLayout() {
  const { pathname } = useLocation();
  const isHome = pathname === "/";

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "var(--bg)" }}>
      {/* Show shared navbar on all pages EXCEPT home (home has its own) */}
      {!isHome && <Navbar />}
      <main style={{ paddingTop: isHome ? 0 : 52 }}>
        <Routes>
          <Route path="/"          element={<Home />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/trade"     element={<Trade />} />
          <Route path="/market"    element={<Market />} />
          <Route path="/history"   element={<History />} />
          <Route path="/voice"     element={<Voice />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <WalletProvider>
        <ContractProvider>
          <AgentProvider>
            <BrowserRouter>
              <AppLayout />
            </BrowserRouter>
          </AgentProvider>
        </ContractProvider>
      </WalletProvider>
    </ThemeProvider>
  );
}