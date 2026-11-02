"""
Web Gemini Bridge for Futures Radar
Direct Web channel via gemini-webapi, locked to Gemini 3.8 Flash (gemini-flash).
Ensures linear turn continuation without UI branch fork.
"""

import asyncio
import os
import re
from typing import Optional
from gemini_webapi import GeminiClient, ChatSession, ModelOutput

DEFAULT_MODEL = None  # Uses Google Web account's active model (Gemini 3.8 Flash), avoids custom header hanging
DEFAULT_PROXY = "http://127.0.0.1:7897"

class WebGeminiBridge:
    def __init__(self, env_path: Optional[str] = None, proxy: str = DEFAULT_PROXY, model: str = DEFAULT_MODEL):
        if env_path is None:
            env_path = os.path.join(os.path.dirname(__file__), "..", "..", ".env.gemini_web")
            if not os.path.exists(env_path):
                env_path = os.path.join(os.path.dirname(__file__), "..", ".env.gemini_web")
        
        self.env_path = env_path
        self.proxy = proxy
        self.model = model
        self.client: Optional[GeminiClient] = None

    def _load_credentials(self) -> tuple[str, str]:
        psid, psidts = "", ""
        if os.path.exists(self.env_path):
            with open(self.env_path, "r", encoding="utf-8") as f:
                for line in f:
                    if line.startswith("SECURE_1PSID="):
                        psid = line.split("=", 1)[1].strip()
                    elif line.startswith("SECURE_1PSIDTS="):
                        psidts = line.split("=", 1)[1].strip()
        if not psid:
            raise ValueError(f"SECURE_1PSID not found in {self.env_path}")
        return psid, psidts

    async def init(self):
        psid, psidts = self._load_credentials()
        self.client = GeminiClient(
            secure_1psid=psid,
            secure_1psidts=psidts,
            proxy=self.proxy
        )
        await self.client.init(timeout=300, watchdog_timeout=180)

    async def send_to_chat(self, cid: str, prompt: str, deep_research: bool = False) -> ModelOutput:
        """
        Sends a message to an existing conversation by dynamically attaching
        to the latest turn (rid/rcid), preserving linear conversation history in Chrome UI.
        Strictly uses the configured model (gemini-flash 3.8).
        """
        if not self.client:
            await self.init()

        # Read chat history to locate the active leaf turn
        history = await self.client.read_chat(cid)
        rid, rcid = "", ""
        if history and history.turns:
            # First turn in read_chat is the latest assistant candidate
            latest_turn = history.turns[0]
            if hasattr(latest_turn, "model_output") and latest_turn.model_output:
                metadata = latest_turn.model_output.metadata
                if len(metadata) >= 2 and metadata[1]:
                    rid = metadata[1]
                if latest_turn.model_output.candidates:
                    rcid = latest_turn.model_output.candidates[0].rcid

        chat = self.client.start_chat(
            cid=cid,
            rid=rid,
            rcid=rcid,
            model=self.model
        )
        return await chat.send_message(prompt, deep_research=deep_research)

    async def start_new_chat(self, prompt: str, deep_research: bool = False) -> tuple[str, ModelOutput]:
        """
        Starts a brand new chat thread with Gemini 3.8 Flash.
        Returns (cid, ModelOutput).
        """
        if not self.client:
            await self.init()

        chat = self.client.start_chat(model=self.model)
        output = await chat.send_message(prompt, deep_research=deep_research)
        cid = output.metadata[0] if output.metadata else ""
        return cid, output
