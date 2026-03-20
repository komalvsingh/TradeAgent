from motor.motor_asyncio import AsyncIOMotorClient
from loguru import logger
from core.config import get_settings

settings = get_settings()

client: AsyncIOMotorClient = None


async def connect_db():
    global client
    try:
        client = AsyncIOMotorClient(settings.mongodb_url)
        await client.admin.command("ping")
        logger.info("✅ Connected to MongoDB")
    except Exception as e:
        logger.error(f"❌ MongoDB connection failed: {e}")
        raise


async def close_db():
    global client
    if client:
        client.close()
        logger.info("MongoDB connection closed")


def get_db():
    return client[settings.mongodb_db]