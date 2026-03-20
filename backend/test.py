"""
Backend Test Script — AI Trading Agent
Run this to test all endpoints in one go.

Usage:
    python test_backend.py
"""

import requests
import json
import time

BASE_URL = "http://localhost:8000"
WALLET = "0x937dCeeAdBFD02D5453C7937E2217957D74E912d"

# ── Colors for terminal output ─────────────────────────────────────────────
GREEN  = "\033[92m"
RED    = "\033[91m"
YELLOW = "\033[93m"
BLUE   = "\033[94m"
BOLD   = "\033[1m"
RESET  = "\033[0m"

passed = 0
failed = 0
trade_id = None


def print_header(title):
    print(f"\n{BLUE}{BOLD}{'═' * 55}{RESET}")
    print(f"{BLUE}{BOLD}  {title}{RESET}")
    print(f"{BLUE}{BOLD}{'═' * 55}{RESET}")


def print_result(test_name, success, response_data=None, error=None):
    global passed, failed
    status = f"{GREEN}✅ PASSED{RESET}" if success else f"{RED}❌ FAILED{RESET}"
    print(f"\n  {status}  {BOLD}{test_name}{RESET}")
    if success and response_data:
        # Print a short summary of the response
        if isinstance(response_data, dict):
            for key, val in list(response_data.items())[:5]:
                print(f"    {YELLOW}{key}{RESET}: {val}")
        elif isinstance(response_data, list):
            print(f"    {YELLOW}count{RESET}: {len(response_data)} items")
    if error:
        print(f"    {RED}Error: {error}{RESET}")
    if success:
        passed += 1
    else:
        failed += 1


def test(test_name, method, endpoint, payload=None, expected_status=200):
    url = f"{BASE_URL}{endpoint}"
    try:
        if method == "GET":
            resp = requests.get(url, timeout=30)
        elif method == "POST":
            resp = requests.post(url, json=payload, timeout=30)

        data = resp.json()

        if resp.status_code == expected_status:
            print_result(test_name, True, data)
            return data
        else:
            print_result(test_name, False, error=f"Status {resp.status_code} → {data}")
            return None
    except requests.exceptions.ConnectionError:
        print_result(test_name, False, error="Cannot connect to server. Is it running?")
        return None
    except Exception as e:
        print_result(test_name, False, error=str(e))
        return None


# ══════════════════════════════════════════════════════════
print(f"\n{BOLD}  🤖 AI Trading Agent — Backend Test Suite{RESET}")
print(f"  Wallet : {YELLOW}{WALLET}{RESET}")
print(f"  Server : {YELLOW}{BASE_URL}{RESET}")
# ══════════════════════════════════════════════════════════


# ── 1. Health Check ───────────────────────────────────────
print_header("1. HEALTH CHECK")

result = test("Server is running", "GET", "/health")
test("Root endpoint", "GET", "/")


# ── 2. Market Data ────────────────────────────────────────
print_header("2. MARKET DATA")

test("List supported tokens",        "GET", "/api/v1/market")
test("Ethereum market data + RSI",   "GET", "/api/v1/market/ethereum")
test("Bitcoin market data + RSI",    "GET", "/api/v1/market/bitcoin")
test("Matic market data",            "GET", "/api/v1/market/matic-network")


# ── 3. Agent Registration ─────────────────────────────────
print_header("3. AGENT REGISTRATION")

agent_result = test(
    "Register agent (COMBINED strategy)",
    "POST",
    "/api/v1/agents/register",
    payload={
        "wallet_address": WALLET,
        "name": "AlphaBot",
        "strategy": "COMBINED",
        "risk_tolerance": "MEDIUM",
        "max_trade_usd": 500
    }
)

test(
    "Fetch agent by wallet",
    "GET",
    f"/api/v1/agents/{WALLET}"
)

test(
    "List all agents",
    "GET",
    "/api/v1/agents/"
)


# ── 4. AI Decision (Preview) ──────────────────────────────
print_header("4. AI DECISION (PREVIEW — NO EXECUTION)")

time.sleep(1)  # small delay to avoid rate limits

test(
    "AI decision — COMBINED strategy (ETH)",
    "POST",
    "/api/v1/trade/decision",
    payload={
        "token": "ethereum",
        "strategy": "COMBINED",
        "wallet_address": WALLET
    }
)

test(
    "AI decision — RSI strategy (BTC)",
    "POST",
    "/api/v1/trade/decision",
    payload={
        "token": "bitcoin",
        "strategy": "RSI",
        "wallet_address": WALLET
    }
)

test(
    "AI decision — MA Crossover (ETH)",
    "POST",
    "/api/v1/trade/decision",
    payload={
        "token": "ethereum",
        "strategy": "MA_CROSSOVER",
        "wallet_address": WALLET
    }
)

test(
    "AI decision — Sentiment strategy (MATIC)",
    "POST",
    "/api/v1/trade/decision",
    payload={
        "token": "matic-network",
        "strategy": "SENTIMENT",
        "wallet_address": WALLET
    }
)


# ── 5. Trade Execution (Full Pipeline) ────────────────────
print_header("5. TRADE EXECUTION (FULL PIPELINE)")

time.sleep(1)

trade_result = test(
    "Execute trade — ETH (full pipeline)",
    "POST",
    "/api/v1/trade/execute",
    payload={
        "token": "ethereum",
        "strategy": "COMBINED",
        "wallet_address": WALLET
    }
)

if trade_result and trade_result.get("id"):
    trade_id = trade_result["id"]
    print(f"\n    {YELLOW}Trade ID captured:{RESET} {trade_id}")

test(
    "Execute trade — BTC",
    "POST",
    "/api/v1/trade/execute",
    payload={
        "token": "bitcoin",
        "strategy": "RSI",
        "wallet_address": WALLET
    }
)

test(
    "Execute trade — MATIC",
    "POST",
    "/api/v1/trade/execute",
    payload={
        "token": "matic-network",
        "strategy": "SENTIMENT",
        "wallet_address": WALLET
    }
)


# ── 6. Trade History ──────────────────────────────────────
print_header("6. TRADE HISTORY")

test(
    "Get trade history",
    "GET",
    f"/api/v1/trade/history/{WALLET}"
)


# ── 7. Replay Mode ────────────────────────────────────────
print_header("7. REPLAY MODE (BONUS)")

if trade_id:
    test(
        "Replay trade step-by-step",
        "GET",
        f"/api/v1/trade/replay/{trade_id}"
    )
else:
    print(f"\n  {YELLOW}⚠  Skipped — no trade_id captured from execution{RESET}")


# ── 8. Dashboard ──────────────────────────────────────────
print_header("8. DASHBOARD")

test(
    "Full dashboard stats",
    "GET",
    f"/api/v1/dashboard/{WALLET}"
)

test(
    "Risk heatmap",
    "GET",
    f"/api/v1/dashboard/heatmap/{WALLET}"
)

test(
    "PnL chart data",
    "GET",
    f"/api/v1/dashboard/pnl-chart/{WALLET}"
)


# ── 9. Voice AI Trader ────────────────────────────────────
print_header("9. VOICE AI TRADER (BONUS)")

time.sleep(1)

test(
    "Voice — Buy ETH",
    "POST",
    "/api/v1/voice",
    payload={"text": "Buy ETH now", "wallet_address": WALLET}
)

test(
    "Voice — Check PnL",
    "POST",
    "/api/v1/voice",
    payload={"text": "What is my PnL?", "wallet_address": WALLET}
)

test(
    "Voice — Switch to conservative",
    "POST",
    "/api/v1/voice",
    payload={"text": "Switch to conservative mode", "wallet_address": WALLET}
)

test(
    "Voice — Show risk",
    "POST",
    "/api/v1/voice",
    payload={"text": "Show my risk heatmap", "wallet_address": WALLET}
)

test(
    "Voice — Sell BTC",
    "POST",
    "/api/v1/voice",
    payload={"text": "Sell Bitcoin", "wallet_address": WALLET}
)


# ── Final Summary ─────────────────────────────────────────
print(f"\n{BLUE}{BOLD}{'═' * 55}{RESET}")
print(f"{BOLD}  TEST SUMMARY{RESET}")
print(f"{BLUE}{BOLD}{'═' * 55}{RESET}")
print(f"  {GREEN}{BOLD}Passed : {passed}{RESET}")
print(f"  {RED}{BOLD}Failed : {failed}{RESET}")
print(f"  Total  : {passed + failed}")

if failed == 0:
    print(f"\n  {GREEN}{BOLD}🎉 ALL TESTS PASSED! Backend is working perfectly.{RESET}")
elif passed == 0:
    print(f"\n  {RED}{BOLD}💀 ALL TESTS FAILED. Is the server running?{RESET}")
    print(f"  {YELLOW}Run: uvicorn main:app --reload --port 8000{RESET}")
else:
    print(f"\n  {YELLOW}{BOLD}⚠  Some tests failed. Check errors above.{RESET}")

print()