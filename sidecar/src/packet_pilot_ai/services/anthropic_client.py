"""Direct Anthropic API provider.

Uses the anthropic Python SDK to talk directly to api.anthropic.com,
then shims the response into chat-completions-compatible objects so
the existing ai_agent.py loop code works unchanged.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any

import anthropic
from openai import AsyncOpenAI


# ---------------------------------------------------------------------------
# Shim objects: make Anthropic Messages API output look like
# OpenAI chat-completions output for the existing loop code.
# ---------------------------------------------------------------------------


@dataclass
class _FunctionRef:
    name: str
    arguments: str


@dataclass
class _ToolCallShim:
    id: str
    type: str = "function"
    function: _FunctionRef = field(default_factory=lambda: _FunctionRef("", ""))


@dataclass
class _MessageShim:
    content: str | None = None
    tool_calls: list[_ToolCallShim] | None = None
    role: str = "assistant"


@dataclass
class _ChoiceShim:
    message: _MessageShim = field(default_factory=_MessageShim)
    finish_reason: str = "stop"


@dataclass
class _CompletionShim:
    choices: list[_ChoiceShim] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Streaming shim objects
# ---------------------------------------------------------------------------


@dataclass
class _DeltaFunctionRef:
    name: str | None = None
    arguments: str | None = None


@dataclass
class _DeltaToolCall:
    index: int = 0
    id: str | None = None
    type: str = "function"
    function: _DeltaFunctionRef = field(default_factory=_DeltaFunctionRef)


@dataclass
class _DeltaShim:
    content: str | None = None
    tool_calls: list[_DeltaToolCall] | None = None
    role: str | None = None


@dataclass
class _StreamChoiceShim:
    delta: _DeltaShim = field(default_factory=_DeltaShim)
    finish_reason: str | None = None


@dataclass
class _StreamChunkShim:
    choices: list[_StreamChoiceShim] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Format translation
# ---------------------------------------------------------------------------


def _extract_system(messages: list[dict[str, Any]]) -> tuple[str, list[dict[str, Any]]]:
    system_parts: list[str] = []
    rest: list[dict[str, Any]] = []
    for msg in messages:
        if msg.get("role") == "system":
            system_parts.append(msg.get("content", ""))
        else:
            rest.append(msg)
    return "\n\n".join(system_parts), rest


def _messages_to_anthropic(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for msg in messages:
        role = msg.get("role", "user")

        if role == "user":
            result.append({"role": "user", "content": msg.get("content", "")})

        elif role == "assistant":
            content_blocks: list[dict[str, Any]] = []
            text = msg.get("content", "")
            if text:
                content_blocks.append({"type": "text", "text": text})
            for tc in msg.get("tool_calls", []):
                func = tc.get("function", {})
                import json
                try:
                    args = json.loads(func.get("arguments", "{}"))
                except (json.JSONDecodeError, TypeError):
                    args = {}
                content_blocks.append({
                    "type": "tool_use",
                    "id": tc.get("id", ""),
                    "name": func.get("name", ""),
                    "input": args,
                })
            result.append({"role": "assistant", "content": content_blocks or text})

        elif role == "tool":
            result.append({
                "role": "user",
                "content": [{
                    "type": "tool_result",
                    "tool_use_id": msg.get("tool_call_id", ""),
                    "content": msg.get("content", ""),
                }],
            })

    return result


def _tools_to_anthropic(tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for tool in tools:
        if tool.get("type") == "function":
            func = tool.get("function", {})
            result.append({
                "name": func.get("name", ""),
                "description": func.get("description", ""),
                "input_schema": func.get("parameters", {}),
            })
    return result


def _response_to_shim(response: Any) -> _CompletionShim:
    import json

    text_parts: list[str] = []
    tool_calls: list[_ToolCallShim] = []

    for block in (response.content or []):
        if block.type == "text":
            text_parts.append(block.text)
        elif block.type == "tool_use":
            tool_calls.append(_ToolCallShim(
                id=block.id,
                function=_FunctionRef(
                    name=block.name,
                    arguments=json.dumps(block.input) if isinstance(block.input, dict) else str(block.input),
                ),
            ))

    finish_reason = "tool_calls" if response.stop_reason == "tool_use" else "stop"

    message = _MessageShim(
        content="\n".join(text_parts) if text_parts else None,
        tool_calls=tool_calls if tool_calls else None,
    )

    return _CompletionShim(choices=[_ChoiceShim(message=message, finish_reason=finish_reason)])


# ---------------------------------------------------------------------------
# Streaming adapter
# ---------------------------------------------------------------------------


class _AnthropicStreamAdapter:
    def __init__(self, stream: Any):
        self._stream = stream
        self._tool_index = 0

    def __aiter__(self):
        return self

    async def __anext__(self) -> _StreamChunkShim:
        while True:
            try:
                event = await self._stream.__anext__()
            except StopAsyncIteration:
                raise

            event_type = event.type

            if event_type == "content_block_delta":
                delta = event.delta
                if delta.type == "text_delta":
                    return _StreamChunkShim(choices=[_StreamChoiceShim(
                        delta=_DeltaShim(content=delta.text),
                    )])
                elif delta.type == "input_json_delta":
                    return _StreamChunkShim(choices=[_StreamChoiceShim(
                        delta=_DeltaShim(tool_calls=[_DeltaToolCall(
                            index=self._tool_index,
                            function=_DeltaFunctionRef(arguments=delta.partial_json),
                        )]),
                    )])

            elif event_type == "content_block_start":
                block = event.content_block
                if block.type == "tool_use":
                    self._tool_index = event.index
                    return _StreamChunkShim(choices=[_StreamChoiceShim(
                        delta=_DeltaShim(tool_calls=[_DeltaToolCall(
                            index=event.index,
                            id=block.id,
                            function=_DeltaFunctionRef(name=block.name, arguments=""),
                        )]),
                    )])

            elif event_type == "message_stop":
                raise StopAsyncIteration


# ---------------------------------------------------------------------------
# Provider
# ---------------------------------------------------------------------------


class AnthropicProvider:
    def create_client(self) -> AsyncOpenAI:
        api_key = os.environ.get("AI_AUTH_CREDENTIAL") or os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            raise ValueError("Anthropic API key is required")
        # Store key for our own async client; return a dummy AsyncOpenAI
        # so the caller has something to pass around (it won't be used).
        self._api_key = api_key
        self._async_client = anthropic.AsyncAnthropic(api_key=api_key)
        return AsyncOpenAI(api_key="unused-placeholder", base_url="https://api.anthropic.com")

    async def create_completion(self, client: AsyncOpenAI, kwargs: dict[str, Any]) -> Any:
        req = self._translate_request(kwargs)
        response = await self._async_client.messages.create(**req)
        return _response_to_shim(response)

    async def create_completion_streaming(self, client: AsyncOpenAI, kwargs: dict[str, Any]) -> Any:
        req = self._translate_request(kwargs)
        req["stream"] = True
        stream = await self._async_client.messages.create(**req)
        return _AnthropicStreamAdapter(stream.__aiter__())

    def _translate_request(self, kwargs: dict[str, Any]) -> dict[str, Any]:
        messages = kwargs.get("messages", [])
        system_text, user_messages = _extract_system(messages)
        anthropic_messages = _messages_to_anthropic(user_messages)

        req: dict[str, Any] = {
            "model": kwargs.get("model", "claude-sonnet-4-20250514"),
            "messages": anthropic_messages,
            "max_tokens": kwargs.get("max_tokens", 1024),
        }

        if system_text:
            req["system"] = system_text

        tools = kwargs.get("tools")
        if tools:
            req["tools"] = _tools_to_anthropic(tools)

        tool_choice = kwargs.get("tool_choice")
        if tool_choice == "auto":
            req["tool_choice"] = {"type": "auto"}

        return req
