"""
Blockchain Service — ALL 4 contracts properly wired

Contract → Address mapping:
  AgentRegistry      → settings.agent_registry_address
  ValidationRegistry → settings.validation_registry_address
  RiskRouter         → settings.risk_router_address        ← was unused
  ReputationManager  → settings.reputation_manager_address ← was pointing to wrong address
"""
import json
import os
from typing import Optional
from loguru import logger
from web3 import Web3
from core.config import get_settings
from models.schemas import Agent, ValidationProof

settings = get_settings()


def _load_abi(filename: str) -> list:
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    abi_path = os.path.join(base_dir, "abis", filename)
    if not os.path.exists(abi_path):
        logger.warning(f"ABI file not found: {abi_path} — using fallback ABI")
        return []
    with open(abi_path, "r") as f:
        data = json.load(f)
    if isinstance(data, list):         return data
    if isinstance(data, dict) and "abi" in data: return data["abi"]
    logger.error(f"Unrecognized ABI format in {filename}")
    return []


AGENT_REGISTRY_ABI      = _load_abi("AgentRegistry.json")
VALIDATION_REGISTRY_ABI = _load_abi("ValidationRegistry.json")
REPUTATION_MANAGER_ABI  = _load_abi("ReputationManager.json")
RISK_ROUTER_ABI         = _load_abi("RiskRouter.json")


# ─── Fallback ABIs ────────────────────────────────────────────────────────────

if not AGENT_REGISTRY_ABI:
    AGENT_REGISTRY_ABI = [
        {"inputs": [{"name": "name", "type": "string"}, {"name": "strategy", "type": "string"}, {"name": "endpoint", "type": "string"}], "name": "registerAgent", "outputs": [{"name": "agentId", "type": "uint256"}], "stateMutability": "nonpayable", "type": "function"},
        {"inputs": [{"name": "agentId", "type": "uint256"}], "name": "getAgent", "outputs": [{"name": "name", "type": "string"}, {"name": "strategy", "type": "string"}, {"name": "owner", "type": "address"}, {"name": "trustScore", "type": "uint256"}, {"name": "active", "type": "bool"}, {"name": "totalTrades", "type": "uint256"}, {"name": "profitableTrades", "type": "uint256"}], "stateMutability": "view", "type": "function"},
        {"inputs": [{"name": "agentId", "type": "uint256"}], "name": "getTrustScore", "outputs": [{"name": "score", "type": "uint256"}], "stateMutability": "view", "type": "function"},
    ]

if not VALIDATION_REGISTRY_ABI:
    VALIDATION_REGISTRY_ABI = [
        {"inputs": [{"name": "agentId", "type": "uint256"}, {"name": "tradeId", "type": "string"}, {"name": "reason", "type": "string"}, {"name": "confidence", "type": "uint256"}, {"name": "riskCheck", "type": "string"}], "name": "storeValidation", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
        {"inputs": [{"name": "tradeId", "type": "string"}], "name": "getValidation", "outputs": [{"name": "agentId", "type": "uint256"}, {"name": "reason", "type": "string"}, {"name": "confidence", "type": "uint256"}, {"name": "riskCheck", "type": "string"}, {"name": "timestamp", "type": "uint256"}, {"name": "outcomeRecorded", "type": "bool"}, {"name": "profitable", "type": "bool"}, {"name": "pnlBps", "type": "int256"}], "stateMutability": "view", "type": "function"},
    ]

if not REPUTATION_MANAGER_ABI:
    REPUTATION_MANAGER_ABI = [
        {"inputs": [{"name": "agentId", "type": "uint256"}, {"name": "tradeId", "type": "string"}, {"name": "profitable", "type": "bool"}, {"name": "pnlBps", "type": "int256"}], "name": "updateReputation", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
        {"inputs": [{"name": "agentId", "type": "uint256"}], "name": "getTrustScore", "outputs": [{"name": "score", "type": "uint256"}], "stateMutability": "view", "type": "function"},
    ]

if not RISK_ROUTER_ABI:
    RISK_ROUTER_ABI = [
        {"inputs": [{"name": "token", "type": "string"}], "name": "allowedTokens", "outputs": [{"name": "", "type": "bool"}], "stateMutability": "view", "type": "function"},
        {"inputs": [{"name": "agentId", "type": "uint256"}], "name": "getAgentNonce", "outputs": [{"name": "", "type": "uint256"}], "stateMutability": "view", "type": "function"},
    ]


def _get_raw_tx(signed) -> bytes:
    raw = getattr(signed, "raw_transaction", None)
    if raw is None:
        raw = getattr(signed, "rawTransaction", None)
    if raw is None:
        raise AttributeError("Cannot find raw transaction bytes on SignedTransaction")
    return raw


class BlockchainService:
    def __init__(self):
        self.w3: Optional[Web3] = None
        self.account = None
        self._connected = False

    def connect(self):
        if not settings.sepolia_rpc_url:
            logger.warning("No SEPOLIA_RPC_URL — blockchain features disabled")
            return
        try:
            self.w3 = Web3(Web3.HTTPProvider(settings.sepolia_rpc_url))
            try:
                from web3.middleware import geth_poa_middleware
                self.w3.middleware_onion.inject(geth_poa_middleware, layer=0)
            except ImportError:
                pass
            if not self.w3.is_connected():
                raise ConnectionError("Cannot connect to Sepolia RPC")
            if settings.private_key:
                self.account = self.w3.eth.account.from_key(settings.private_key)
                logger.info(f"Wallet: {self.account.address}")
            self._connected = True
            logger.info("✅ Connected to Sepolia testnet")
        except Exception as e:
            logger.error(f"Blockchain connection failed: {e}")
            self._connected = False

    def _get_contract(self, address: str, abi: list):
        if not self._connected or not address or address.startswith("0x000"):
            return None
        if not abi:
            return None
        return self.w3.eth.contract(address=Web3.to_checksum_address(address), abi=abi)

    def _send_tx(self, contract_fn) -> Optional[str]:
        if not self._connected or not self.account:
            return None
        try:
            nonce     = self.w3.eth.get_transaction_count(self.account.address)
            gas_price = int(self.w3.eth.gas_price * 1.2)
            tx = contract_fn.build_transaction({
                "from": self.account.address, "nonce": nonce,
                "gasPrice": gas_price, "gas": 300_000,
            })
            signed  = self.w3.eth.account.sign_transaction(tx, self.account.key)
            raw     = _get_raw_tx(signed)
            tx_hash = self.w3.eth.send_raw_transaction(raw)
            receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
            if receipt.status == 1:
                logger.info(f"TX confirmed: {tx_hash.hex()}")
                return tx_hash.hex()
            logger.error("Transaction reverted")
            return None
        except Exception as e:
            logger.error(f"TX send failed: {e}")
            return None

    # ── 1. AgentRegistry — register agent ────────────────────────────────────
    async def register_agent_on_chain(self, agent: Agent) -> Optional[str]:
        contract = self._get_contract(settings.agent_registry_address, AGENT_REGISTRY_ABI)
        if not contract:
            logger.info("AgentRegistry not configured — mock registration")
            return f"mock-agent-{agent.wallet_address[:8]}"
        fn = contract.functions.registerAgent(
            agent.name, agent.strategy.value, f"/api/agents/{agent.wallet_address}"
        )
        return self._send_tx(fn)

    # ── 2. ValidationRegistry — store proof ──────────────────────────────────
    async def store_validation_proof(self, proof: ValidationProof) -> Optional[str]:
        # ✅ Uses validation_registry_address
        contract = self._get_contract(settings.validation_registry_address, VALIDATION_REGISTRY_ABI)
        if not contract:
            logger.info("ValidationRegistry not configured — mock tx")
            return f"0x{'ab' * 32}"
        try:
            agent_id_int = int(proof.agent_id)
        except (ValueError, TypeError):
            agent_id_int = 0
        fn = contract.functions.storeValidation(
            agent_id_int, proof.trade_id, proof.reason,
            int(proof.confidence), proof.risk_check,
        )
        return self._send_tx(fn)

    # ── 3. ReputationManager — update trust score ─────────────────────────────
    async def update_reputation(
        self, agent_id: str, trade_id: str, profitable: bool, pnl_usd: float
    ) -> Optional[str]:
        # ✅ FIXED: now uses reputation_manager_address (was wrongly using validation_registry_address before)
        contract = self._get_contract(settings.reputation_manager_address, REPUTATION_MANAGER_ABI)
        if not contract:
            logger.info("ReputationManager not configured — skipping")
            return None
        try:
            agent_id_int = int(agent_id)
        except (ValueError, TypeError):
            agent_id_int = 0
        fn = contract.functions.updateReputation(
            agent_id_int, trade_id, profitable, int(pnl_usd * 100)
        )
        return self._send_tx(fn)

    # ── 4. RiskRouter — check token allowed (read-only) ───────────────────────
    async def is_token_allowed(self, token_symbol: str) -> bool:
        contract = self._get_contract(settings.risk_router_address, RISK_ROUTER_ABI)
        if not contract:
            return True
        try:
            return contract.functions.allowedTokens(token_symbol.upper()).call()
        except Exception as e:
            logger.warning(f"RiskRouter token check failed: {e}")
            return True

    # ── 4b. RiskRouter — get agent nonce (read-only) ──────────────────────────
    async def get_agent_nonce(self, agent_id: int) -> int:
        contract = self._get_contract(settings.risk_router_address, RISK_ROUTER_ABI)
        if not contract:
            return 0
        try:
            return contract.functions.getAgentNonce(agent_id).call()
        except Exception as e:
            logger.warning(f"RiskRouter nonce check failed: {e}")
            return 0

    def get_network_info(self) -> dict:
        if not self._connected:
            return {"connected": False, "network": "disconnected"}
        try:
            chain_id = self.w3.eth.chain_id
            return {
                "connected":    True,
                "network":      "sepolia" if chain_id == 11155111 else f"chain-{chain_id}",
                "chain_id":     chain_id,
                "latest_block": self.w3.eth.block_number,
                "wallet":       self.account.address if self.account else None,
            }
        except Exception as e:
            return {"connected": False, "error": str(e)}


blockchain_service = BlockchainService()