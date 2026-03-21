from pydantic_settings import BaseSettings
from functools import lru_cache
import os

class Settings(BaseSettings):
    # App
    app_name: str = "AI Trading Agent"
    app_env:  str = "development"
    debug:    bool = True

    # Groq
    groq_api_key: str = os.getenv("GROQ_API_KEY","")

    # MongoDB
    mongodb_url: str = "mongodb://localhost:27017"
    mongodb_db:  str = "ai_trading_agent"

    # Blockchain — ALL 4 contract addresses
    sepolia_rpc_url:              str = ""
    private_key:                  str = ""
    agent_registry_address:       str = ""
    validation_registry_address:  str = ""
    risk_router_address:          str = ""
    reputation_manager_address:   str = ""   # ← was missing before

    # Market Data
    coingecko_api_key:  str = os.getenv("COINGECKO_API_KEY", "")
    coingecko_base_url: str = "https://api.coingecko.com/api/v3"

    # Security
    secret_key:                  str = "change-this-in-production"
    algorithm:                   str = "HS256"
    access_token_expire_minutes: int = 60

    class Config:
        env_file = ".env"
        extra    = "ignore"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
