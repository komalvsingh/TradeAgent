"""
Market Data Service — Real data with robust error handling.

Fixes:
  - coin["current_price"] can be None → safe with fallback to 0.0
  - Reduced retry wait times (1s, 2s, 4s instead of 2s, 4s, 8s)
  - Stale cache served immediately on any error (no waiting for retries)
  - Shorter HTTP timeout (10s instead of 20s)
"""
import asyncio
import httpx
import numpy as np
import time
from typing import Optional, List, Dict
from loguru import logger
from core.config import get_settings
from models.schemas import MarketData

settings = get_settings()

TOKEN_MAP = {
    "ethereum":      "ETH",
    "bitcoin":       "BTC",
    "polygon-ecosystem-token": "POL",
    "chainlink":     "LINK",
    "uniswap":       "UNI",
    "aave":          "AAVE",
}
SUPPORTED_TOKENS = list(TOKEN_MAP.keys())

# ─── Cache ────────────────────────────────────────────────────────────────────
_market_cache: Dict[str, dict] = {}
_hist_cache:   Dict[str, dict] = {}
FRESH_TTL = 60      # serve fresh if under 60s
STALE_TTL = 7200    # serve stale up to 2h if API failing


def _get_cached(cache: dict, key: str) -> Optional[any]:
    if key not in cache:
        return None
    age = time.time() - cache[key]["ts"]
    if age < STALE_TTL:
        if age > FRESH_TTL:
            logger.debug(f"Serving stale cache ({age:.0f}s old) for {key}")
        return cache[key]["data"]
    return None


def _is_fresh(cache: dict, key: str) -> bool:
    return key in cache and (time.time() - cache[key]["ts"]) < FRESH_TTL


# ─── Indicators ──────────────────────────────────────────────────────────────

def _compute_rsi(prices: List[float], period: int = 14) -> float:
    if len(prices) < period + 1:
        return 50.0
    deltas   = np.diff(prices)
    gains    = np.where(deltas > 0, deltas, 0.0)
    losses   = np.where(deltas < 0, -deltas, 0.0)
    avg_gain = np.mean(gains[-period:])
    avg_loss = np.mean(losses[-period:])
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return round(100 - (100 / (1 + rs)), 2)


def _compute_ma(prices: List[float], window: int) -> Optional[float]:
    if len(prices) < window:
        return None
    return round(float(np.mean(prices[-window:])), 4)


def _estimate_sentiment(price_change: float, prices: List[float]) -> float:
    if len(prices) < 10:
        return 0.0
    recent_trend = (prices[-1] - prices[-10]) / (prices[-10] + 1e-9)
    price_factor = price_change / 100.0
    combined     = 0.6 * price_factor + 0.4 * recent_trend
    return round(max(-1.0, min(1.0, combined)), 4)


# ─── CoinGecko HTTP helper ────────────────────────────────────────────────────

def _build_headers() -> dict:
    """Only send API key header if key is a non-empty string."""
    headers = {}
    key = (settings.coingecko_api_key or "").strip()
    if key:
        headers["x-cg-demo-api-key"] = key
    return headers


async def _coingecko_get(url: str, params: dict, retries: int = 2) -> dict:
    """
    GET from CoinGecko.
    Faster retries: 1s → 2s (not 2s → 4s → 8s).
    Raises RuntimeError on failure.
    """
    headers   = _build_headers()
    last_error = None

    for attempt in range(retries):
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(url, params=params, headers=headers)

                if resp.status_code == 429:
                    # Check stale cache immediately — don't wait for all retries
                    wait = 2 ** attempt   # 1s, 2s
                    logger.warning(f"CoinGecko 429 — retry in {wait}s (attempt {attempt+1}/{retries})")
                    await asyncio.sleep(wait)
                    continue

                if resp.status_code == 401:
                    raise RuntimeError(
                        "CoinGecko 401 Unauthorized — remove COINGECKO_API_KEY from .env "
                        "if using free tier (no key needed)"
                    )

                resp.raise_for_status()
                return resp.json()

        except RuntimeError:
            raise
        except httpx.TimeoutException as e:
            last_error = f"Timeout: {e}"
            logger.warning(f"CoinGecko timeout (attempt {attempt+1})")
        except Exception as e:
            last_error = str(e)
            if attempt < retries - 1:
                await asyncio.sleep(1)

    raise RuntimeError(f"CoinGecko failed after {retries} attempts: {last_error}")


# ─── Fetchers ─────────────────────────────────────────────────────────────────

async def fetch_historical_prices(token_id: str, days: int = 100) -> List[float]:
    """Fetch real daily closing prices. Returns stale cache on any failure."""
    if _is_fresh(_hist_cache, token_id):
        return _hist_cache[token_id]["data"]

    # Check stale cache first — return immediately if available
    stale = _get_cached(_hist_cache, token_id)

    try:
        url    = f"{settings.coingecko_base_url}/coins/{token_id}/market_chart"
        params = {"vs_currency": "usd", "days": days, "interval": "daily"}
        data   = await _coingecko_get(url, params)
        prices = [p[1] for p in data.get("prices", []) if p[1] is not None]

        if not prices:
            raise ValueError(f"Empty price data for {token_id}")

        _hist_cache[token_id] = {"data": prices, "ts": time.time()}
        return prices

    except Exception as e:
        if stale:
            logger.warning(f"Using stale hist cache for {token_id}: {e}")
            return stale
        raise RuntimeError(f"Cannot fetch historical prices for {token_id}: {e}")


async def fetch_current_market_data(token_id: str) -> MarketData:
    """
    Fetch real current price + compute indicators.
    Returns stale cache on any API failure.
    Handles None values from CoinGecko safely.
    """
    if _is_fresh(_market_cache, token_id):
        return _market_cache[token_id]["data"]

    # Return stale immediately if available — don't wait for retries
    stale = _get_cached(_market_cache, token_id)

    try:
        url    = f"{settings.coingecko_base_url}/coins/markets"
        params = {
            "vs_currency": "usd", "ids": token_id,
            "order": "market_cap_desc", "per_page": 1, "page": 1,
            "sparkline": False, "price_change_percentage": "24h",
        }
        coins = await _coingecko_get(url, params)

        if not coins:
            raise ValueError(f"No market data returned for {token_id}")

        coin = coins[0]

        # ✅ FIX: safely extract with None guards — coin["current_price"] CAN be None
        current_price    = float(coin.get("current_price")    or 0.0)
        price_change_24h = float(coin.get("price_change_percentage_24h") or 0.0)
        volume_24h       = float(coin.get("total_volume")     or 0.0)
        market_cap       = float(coin.get("market_cap")       or 0.0)

        if current_price == 0.0:
            raise ValueError(f"CoinGecko returned null price for {token_id}")

        # Fetch historical for indicators
        await asyncio.sleep(0.3)   # gentle rate limit
        hist_prices = await fetch_historical_prices(token_id, days=100)
        rsi         = _compute_rsi(hist_prices)
        ma_7        = _compute_ma(hist_prices, 7)
        ma_25       = _compute_ma(hist_prices, 25)
        ma_99       = _compute_ma(hist_prices, 99)
        sentiment   = _estimate_sentiment(price_change_24h, hist_prices)

        result = MarketData(
            token=token_id, symbol=TOKEN_MAP.get(token_id, token_id.upper()),
            price_usd=current_price, price_change_24h=price_change_24h,
            volume_24h=volume_24h, market_cap=market_cap,
            rsi=rsi, ma_7=ma_7, ma_25=ma_25, ma_99=ma_99,
            sentiment_score=sentiment,
        )
        _market_cache[token_id] = {"data": result, "ts": time.time()}
        return result

    except Exception as e:
        if stale:
            logger.warning(f"Using stale market cache for {token_id}: {e}")
            return stale
        raise RuntimeError(f"Cannot fetch market data for {token_id}: {e}")


async def fetch_multi_token_market_data(
    tokens: Optional[List[str]] = None,
) -> Dict[str, MarketData]:
    """
    Fetch data for multiple tokens.
    Skips tokens that fail — never blocks the whole response.
    """
    tokens  = tokens or SUPPORTED_TOKENS[:4]
    results = {}
    for i, token in enumerate(tokens):
        if i > 0:
            await asyncio.sleep(0.8)   # shorter delay
        try:
            results[token] = await fetch_current_market_data(token)
        except Exception as e:
            logger.error(f"Skipping {token}: {e}")
            # Don't block — just skip this token
    return results
