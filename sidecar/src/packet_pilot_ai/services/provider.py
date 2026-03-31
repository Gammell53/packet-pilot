"""AI provider abstraction for multi-backend support."""

from __future__ import annotations

import os
from typing import Any, AsyncIterator, Protocol

from openai import AsyncOpenAI


class LLMProvider(Protocol):
    def create_client(self) -> AsyncOpenAI: ...
    async def create_completion(self, client: AsyncOpenAI, kwargs: dict[str, Any]) -> Any: ...
    async def create_completion_streaming(self, client: AsyncOpenAI, kwargs: dict[str, Any]) -> Any: ...


SUPPORTED_AUTH_MODES = {"openrouter", "chatgpt"}


class OpenRouterProvider:
    def create_client(self) -> AsyncOpenAI:
        api_key = os.environ.get("AI_AUTH_CREDENTIAL") or os.environ.get("OPENROUTER_API_KEY")
        if not api_key:
            raise ValueError("OPENROUTER_API_KEY environment variable is required")
        return AsyncOpenAI(
            base_url="https://openrouter.ai/api/v1",
            api_key=api_key,
            default_headers={
                "HTTP-Referer": "https://packetpilot.app",
                "X-Title": "PacketPilot",
            },
        )

    async def create_completion(self, client: AsyncOpenAI, kwargs: dict[str, Any]) -> Any:
        return await client.chat.completions.create(**kwargs)

    async def create_completion_streaming(self, client: AsyncOpenAI, kwargs: dict[str, Any]) -> Any:
        return await client.chat.completions.create(**kwargs)


_provider_instance: LLMProvider | None = None
_client_instance: AsyncOpenAI | None = None


def get_auth_mode() -> str:
    return (os.environ.get("AI_AUTH_MODE", "openrouter").strip().lower()) or "openrouter"


def get_provider() -> LLMProvider:
    global _provider_instance
    if _provider_instance is not None:
        return _provider_instance

    auth_mode = get_auth_mode()
    if auth_mode == "chatgpt":
        from .chatgpt_client import ChatGPTProvider
        _provider_instance = ChatGPTProvider()
    elif auth_mode == "anthropic":
        from .anthropic_client import AnthropicProvider
        _provider_instance = AnthropicProvider()
    else:
        _provider_instance = OpenRouterProvider()
    return _provider_instance


def get_client() -> AsyncOpenAI:
    global _client_instance
    if _client_instance is not None:
        return _client_instance
    _client_instance = get_provider().create_client()
    return _client_instance


def get_auth_capabilities() -> dict[str, Any]:
    return {
        "modes": [
            {
                "mode": "openrouter",
                "label": "OpenRouter API key",
                "supported": True,
            },
            {
                "mode": "chatgpt",
                "label": "OpenAI sign-in",
                "supported": True,
                "reason": None,
            },
            {
                "mode": "anthropic",
                "label": "Anthropic API key",
                "supported": True,
            },
        ]
    }
