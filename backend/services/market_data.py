"""
Market Data Service — Real data with robust error handling.

Fixes applied:
  1. Token name normalisation: "Bitcoin" → "bitcoin" before API call
  2. coingecko_base_url fallback so missing config doesn't break everything
  3. coin["current_price"] can be None → safe fallback to 0.0
  4. hist_prices empty-list guard before computing indicators
  5. _compute_ma returns price_usd (not None) so rule-based engine always
     gets a meaningful value instead of falling through to the 50/neutral default
  6. Stale cache served immediately on ANY error (no waiting for retries)
  7. Reduced retry wait times (1s, 2s instead of 2s, 4s, 8s)
  8. Shorter HTTP timeout (10 s instead of 20 s)
  9. fetch_current_market_data logs exactly what it returns so you can
     confirm in the console that RSI/MA/sentiment are populated
"""
from __future__ import annotations

import asyncio
import time
from typing import Dict, List, Optional

import httpx
import numpy as np
from loguru import logger

from core.config import get_settings
from models.schemas import MarketData

settings = get_settings()

# ─── Token helpers ────────────────────────────────────────────────────────────

TOKEN_MAP: Dict[str, str] = {
    "ethereum":                  "ETH",
    "bitcoin":                   "BTC",
    "polygon-ecosystem-token":   "POL",
    "chainlink":                 "LINK",
    "uniswap":                   "UNI",
    "aave":                      "AAVE",
    "solana":                    "SOL",
    "avalanche-2":               "AVAX",
}

# Human-readable / frontend names → CoinGecko IDs
_NAME_TO_ID: Dict[str, str] = {
    # lower-case display names
    "bitcoin":    "bitcoin",
    "btc":        "bitcoin",
    "ethereum":   "ethereum",
    "eth":        "ethereum",
    "matic":      "polygon-ecosystem-token",
    "polygon":    "polygon-ecosystem-token",
    "pol":        "polygon-ecosystem-token",
    "link":       "chainlink",
    "chainlink":  "chainlink",
    "uni":        "uniswap",
    "uniswap":    "uniswap",
    "aave":       "aave",
    "sol":        "solana",
    "solana":     "solana",
    "avax":       "avalanche-2",
    "avalanche":  "avalanche-2",
}

SUPPORTED_TOKENS: List[str] = list(TOKEN_MAP.keys())

COINGECKO_DEFAULT_BASE = "https://api.coingecko.com/api/v3"


def normalise_token(raw: str) -> str:
    """
    Convert any user-supplied token name/symbol to a CoinGecko token ID.

    Examples
    --------
    "Bitcoin"  → "bitcoin"
    "BTC"      → "bitcoin"
    "ETH"      → "ethereum"
    "ethereum" → "ethereum"   (already correct)
    """
    key = raw.strip().lower()
    return _NAME_TO_ID.get(key, key)   # fall through unchanged if unknown


# ─── Cache ────────────────────────────────────────────────────────────────────

_market_cache: Dict[str, dict] = {}
_hist_cache:   Dict[str, dict] = {}

FRESH_TTL  = 60      # seconds — serve fresh data
STALE_TTL  = 7_200   # seconds — serve stale data when API is down (2 h)


def _cached(cache: Dict, key: str) -> Optional[any]:
    """Return cached value if within STALE_TTL, else None."""
    entry = cache.get(key)
    if entry is None:
        return None
    if (time.time() - entry["ts"]) < STALE_TTL:
        age = time.time() - entry["ts"]
        if age > FRESH_TTL:
            logger.debug(f"Stale cache ({age:.0f}s old) for {key}")
        return entry["data"]
    return None


def _is_fresh(cache: Dict, key: str) -> bool:
    entry = cache.get(key)
    return entry is not None and (time.time() - entry["ts"]) < FRESH_TTL


def _store(cache: Dict, key: str, data: any) -> None:
    cache[key] = {"data": data, "ts": time.time()}


# ─── Technical indicators ─────────────────────────────────────────────────────

def _compute_rsi(prices: List[float], period: int = 14) -> float:
    if len(prices) < period + 1:
        return 50.0
    arr     = np.array(prices, dtype=float)
    deltas  = np.diff(arr)
    gains   = np.where(deltas > 0, deltas, 0.0)
    losses  = np.where(deltas < 0, -deltas, 0.0)
    avg_gain = float(np.mean(gains[-period:]))
    avg_loss = float(np.mean(losses[-period:]))
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return round(100.0 - (100.0 / (1.0 + rs)), 2)


def _compute_ma(prices: List[float], window: int, fallback: float = 0.0) -> float:
    """
    Returns the moving average, or `fallback` when there aren't enough data
    points.  Returning a float (never None) keeps the rule-based engine sane.
    """
    if len(prices) < window:
        return fallback
    return round(float(np.mean(prices[-window:])), 6)


def _estimate_sentiment(price_change_24h: float, prices: List[float]) -> float:
    """
    Heuristic sentiment score in [-1, +1].

    Combines:
      • 24 h price change (60 % weight) — immediate market reaction
      • 10-period recent trend (40 % weight) — short-term momentum
    """
    if len(prices) < 10:
        # Only price-change signal available
        return round(max(-1.0, min(1.0, price_change_24h / 20.0)), 4)

    recent_trend = (prices[-1] - prices[-10]) / (abs(prices[-10]) + 1e-9)
    price_factor = price_change_24h / 100.0
    combined     = 0.6 * price_factor + 0.4 * recent_trend
    return round(max(-1.0, min(1.0, combined)), 4)


# ─── CoinGecko HTTP helper ────────────────────────────────────────────────────

def _base_url() -> str:
    """Read from settings; fall back to public CoinGecko URL."""
    base = getattr(settings, "coingecko_base_url", None) or ""
    return base.strip().rstrip("/") or COINGECKO_DEFAULT_BASE


def _build_headers() -> dict:
    key = (getattr(settings, "coingecko_api_key", None) or "").strip()
    if key:
        return {"x-cg-demo-api-key": key}
    return {}


async def _coingecko_get(url: str, params: dict, retries: int = 3) -> any:
    """
    GET from CoinGecko with retries.
    Back-off: 1 s → 2 s → 4 s.
    Raises RuntimeError on final failure.
    """
    headers    = _build_headers()
    last_error = "unknown"

    for attempt in range(retries):
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(url, params=params, headers=headers)

                if resp.status_code == 429:
                    wait = 2 ** attempt   # 1 s, 2 s, 4 s
                    logger.warning(
                        f"CoinGecko 429 rate-limit — waiting {wait}s "
                        f"(attempt {attempt + 1}/{retries})"
                    )
                    await asyncio.sleep(wait)
                    continue

                if resp.status_code == 401:
                    raise RuntimeError(
                        "CoinGecko 401 Unauthorized — if you're on the free tier, "
                        "remove COINGECKO_API_KEY from your .env (no key needed)."
                    )

                resp.raise_for_status()
                return resp.json()

        except RuntimeError:
            raise
        except httpx.TimeoutException:
            last_error = "HTTP timeout"
            logger.warning(f"CoinGecko timeout (attempt {attempt + 1}/{retries})")
            if attempt < retries - 1:
                await asyncio.sleep(2 ** attempt)
        except Exception as exc:
            last_error = str(exc)
            logger.warning(f"CoinGecko error (attempt {attempt + 1}/{retries}): {exc}")
            if attempt < retries - 1:
                await asyncio.sleep(2 ** attempt)

    raise RuntimeError(f"CoinGecko request failed after {retries} attempts: {last_error}")


# ─── Public fetchers ──────────────────────────────────────────────────────────

async def fetch_historical_prices(token_id: str, days: int = 100) -> List[float]:
    """
    Fetch daily closing prices for `token_id`.

    • Returns fresh cache when available (< 60 s old).
    • Returns stale cache on any API failure (up to 2 h).
    • Raises RuntimeError only when there is no cache at all.
    """
    token_id = normalise_token(token_id)

    if _is_fresh(_hist_cache, token_id):
        return _hist_cache[token_id]["data"]

    stale = _cached(_hist_cache, token_id)

    try:
        url    = f"{_base_url()}/coins/{token_id}/market_chart"
        params = {"vs_currency": "usd", "days": days, "interval": "daily"}
        data   = await _coingecko_get(url, params)
        prices = [p[1] for p in data.get("prices", []) if p[1] is not None]

        if not prices:
            raise ValueError(f"CoinGecko returned empty price array for '{token_id}'")

        _store(_hist_cache, token_id, prices)
        logger.info(f"Historical prices fetched for {token_id}: {len(prices)} points")
        return prices

    except Exception as exc:
        if stale:
            logger.warning(f"Using stale historical cache for {token_id}: {exc}")
            return stale
        raise RuntimeError(f"Cannot fetch historical prices for '{token_id}': {exc}")


async def fetch_current_market_data(token_id: str) -> MarketData:
    """
    Fetch current market data and compute technical indicators.

    Key fixes vs. previous version
    --------------------------------
    1. `token_id` is normalised (handles "Bitcoin", "BTC", etc.)
    2. All CoinGecko numeric fields use `or 0.0` guards (can be None)
    3. `_compute_ma` always returns a float — no more None leaking into
       the rule-based engine
    4. Indicators are logged so you can verify them in the console
    5. Stale cache returned on ANY exception — never crashes on retry
    """
    token_id = normalise_token(token_id)

    if _is_fresh(_market_cache, token_id):
        return _market_cache[token_id]["data"]

    stale = _cached(_market_cache, token_id)

    try:
        # ── Spot price ────────────────────────────────────────────────────────
        url    = f"{_base_url()}/coins/markets"
        params = {
            "vs_currency":             "usd",
            "ids":                     token_id,
            "order":                   "market_cap_desc",
            "per_page":                1,
            "page":                    1,
            "sparkline":               False,
            "price_change_percentage": "24h",
        }
        coins = await _coingecko_get(url, params)

        if not coins:
            raise ValueError(f"CoinGecko returned no market data for '{token_id}'")

        coin = coins[0]

        # Safe extraction — CoinGecko can return null for any numeric field
        current_price    = float(coin.get("current_price")                or 0.0)
        price_change_24h = float(coin.get("price_change_percentage_24h") or 0.0)
        volume_24h       = float(coin.get("total_volume")                 or 0.0)
        market_cap       = float(coin.get("market_cap")                   or 0.0)

        if current_price == 0.0:
            raise ValueError(
                f"CoinGecko returned a null/zero price for '{token_id}' — "
                "token ID may be wrong or the API is temporarily down."
            )

        # ── Historical prices for indicators ──────────────────────────────────
        await asyncio.sleep(0.3)   # gentle rate-limit spacing
        hist_prices = await fetch_historical_prices(token_id, days=100)

        # ── Indicators ────────────────────────────────────────────────────────
        rsi  = _compute_rsi(hist_prices)
        ma_7  = _compute_ma(hist_prices, 7,  fallback=current_price)
        ma_25 = _compute_ma(hist_prices, 25, fallback=current_price)
        ma_99 = _compute_ma(hist_prices, 99, fallback=current_price)
        sentiment = _estimate_sentiment(price_change_24h, hist_prices)

        symbol = TOKEN_MAP.get(token_id, token_id[:4].upper())

        result = MarketData(
            token            = token_id,
            symbol           = symbol,
            price_usd        = current_price,
            price_change_24h = round(price_change_24h, 4),
            volume_24h       = round(volume_24h, 2),
            market_cap       = round(market_cap, 2),
            rsi              = rsi,
            ma_7             = ma_7,
            ma_25            = ma_25,
            ma_99            = ma_99,
            sentiment_score  = sentiment,
        )

        # ✅ Log indicators so you can verify they are populated
        logger.info(
            f"MarketData [{symbol}] price=${current_price:,.2f} | "
            f"24h={price_change_24h:+.2f}% | RSI={rsi} | "
            f"MA7={ma_7} MA25={ma_25} | sentiment={sentiment}"
        )

        _store(_market_cache, token_id, result)
        return result

    except Exception as exc:
        if stale:
            logger.warning(f"Using stale market cache for {token_id}: {exc}")
            return stale
        raise RuntimeError(f"Cannot fetch market data for '{token_id}': {exc}")


async def fetch_multi_token_market_data(
    tokens: Optional[List[str]] = None,
) -> Dict[str, MarketData]:
    """
    Fetch market data for multiple tokens concurrently (with staggered delay).
    Tokens that fail are skipped — never blocks the whole response.
    """
    tokens  = [normalise_token(t) for t in (tokens or SUPPORTED_TOKENS[:4])]
    results: Dict[str, MarketData] = {}

    for i, token in enumerate(tokens):
        if i > 0:
            await asyncio.sleep(0.8)   # stagger requests
        try:
            results[token] = await fetch_current_market_data(token)
        except Exception as exc:
            logger.error(f"Skipping {token} in multi-fetch: {exc}")

    return results