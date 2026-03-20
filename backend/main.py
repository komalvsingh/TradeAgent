"""
AI Trading Agent — FastAPI Application
"""
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from loguru import logger

from core.config import get_settings
from core.database import connect_db, close_db
from services.blockchain import blockchain_service
from api import agents, trading, dashboard, market_voice

settings = get_settings()

# CORS headers attached to every error response manually
CORS_HEADERS = {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Methods": "*",
    "Access-Control-Allow-Headers": "*",
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(f"🚀 Starting {settings.app_name}")
    await connect_db()
    blockchain_service.connect()
    yield
    await close_db()
    logger.info("Shutdown complete")


# ── 1. Create app ─────────────────────────────────────────────────────────────
app = FastAPI(
    title=settings.app_name,
    description="AI-powered DeFi trading agent with on-chain trust layer. Sepolia testnet.",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# ── 2. CORS middleware — added ONCE, right after app creation ─────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── 3. Global exception handlers ─────────────────────────────────────────────
# These catch ANY unhandled exception and return JSON WITH CORS headers.
# Without these, a 500 crash never gets CORS headers → browser sees CORS error.

@app.exception_handler(RuntimeError)
async def runtime_error_handler(request: Request, exc: RuntimeError):
    logger.error(f"RuntimeError on {request.url}: {exc}")
    return JSONResponse(
        status_code=503,
        content={"detail": str(exc), "type": "RuntimeError"},
        headers=CORS_HEADERS,
    )


@app.exception_handler(ValueError)
async def value_error_handler(request: Request, exc: ValueError):
    logger.error(f"ValueError on {request.url}: {exc}")
    return JSONResponse(
        status_code=422,
        content={"detail": str(exc), "type": "ValueError"},
        headers=CORS_HEADERS,
    )


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled {type(exc).__name__} on {request.url}: {exc}")
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc), "type": type(exc).__name__},
        headers=CORS_HEADERS,
    )


# ── 4. Routers ────────────────────────────────────────────────────────────────
app.include_router(agents.router,       prefix="/api/v1")
app.include_router(trading.router,      prefix="/api/v1")
app.include_router(dashboard.router,    prefix="/api/v1")
app.include_router(market_voice.router, prefix="/api/v1")


# ── 5. Health & Root ──────────────────────────────────────────────────────────
@app.get("/health", tags=["Health"])
async def health():
    net_info = blockchain_service.get_network_info()
    return {
        "status":     "ok",
        "app":        settings.app_name,
        "env":        settings.app_env,
        "blockchain": net_info,
    }


@app.get("/", tags=["Root"])
async def root():
    return {
        "message": f"Welcome to {settings.app_name} API",
        "docs":    "/docs",
        "health":  "/health",
    }