"""ChatGPT/Codex Responses API adapter.

Translates between the chat-completions-shaped internal format used by ai_agent.py
and the Responses API format required by the ChatGPT/Codex backend.

Endpoint: POST https://chatgpt.com/backend-api/codex/responses
Required headers: Authorization: Bearer <token>, ChatGPT-Account-ID: <id>
Wire format: Responses API (input items, not messages)
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any

import httpx
from openai import AsyncOpenAI


class _AccountIDTransport(httpx.AsyncHTTPTransport):
    """Injects ChatGPT-Account-ID header on every request."""

    def __init__(self, account_id: str, **kwargs: Any):
        super().__init__(**kwargs)
        self._account_id = account_id

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        request.headers["ChatGPT-Account-ID"] = self._account_id
        return await super().handle_async_request(request)


# ---------------------------------------------------------------------------
# Shim objects: make Responses API output look like chat-completions output
# so the existing _run_llm_loop / call_llm_streaming code can consume them
# without structural changes.
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
# Streaming shim objects (delta-style, matching chat-completions chunk shape)
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
# Format translation helpers
# ---------------------------------------------------------------------------


def _messages_to_input(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Convert chat-completions messages array to Responses API input items."""
    items: list[dict[str, Any]] = []
    for msg in messages:
        role = msg.get("role", "user")

        if role == "system":
            items.append({
                "role": "developer",
                "content": msg["content"],
            })
        elif role == "user":
            items.append({
                "role": "user",
                "content": msg["content"],
            })
        elif role == "assistant":
            if msg.get("content"):
                items.append({
                    "type": "message",
                    "role": "assistant",
                    "content": [{"type": "output_text", "text": msg["content"]}],
                })
            tool_calls = msg.get("tool_calls", [])
            for tc in tool_calls:
                func = tc.get("function", {})
                items.append({
                    "type": "function_call",
                    "id": tc.get("id", ""),
                    "call_id": tc.get("id", ""),
                    "name": func.get("name", ""),
                    "arguments": func.get("arguments", "{}"),
                })
        elif role == "tool":
            items.append({
                "type": "function_call_output",
                "call_id": msg.get("tool_call_id", ""),
                "output": msg.get("content", ""),
            })

    return items


def _flatten_tools(tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Flatten chat-completions tool definitions to Responses API format."""
    flat: list[dict[str, Any]] = []
    for tool in tools:
        if tool.get("type") == "function":
            func = tool.get("function", {})
            flat.append({
                "type": "function",
                "name": func.get("name", ""),
                "description": func.get("description", ""),
                "parameters": func.get("parameters", {}),
            })
        else:
            flat.append(tool)
    return flat


def _response_to_completion_shim(response: Any) -> _CompletionShim:
    """Convert a Responses API response object into a chat-completions-shaped shim."""
    text_parts: list[str] = []
    tool_calls: list[_ToolCallShim] = []

    for item in (response.output or []):
        item_type = getattr(item, "type", None)

        if item_type == "message":
            for content_item in (getattr(item, "content", None) or []):
                ct = getattr(content_item, "type", None)
                if ct == "output_text":
                    text_parts.append(getattr(content_item, "text", "") or "")

        elif item_type == "function_call":
            tc_id = getattr(item, "call_id", None) or getattr(item, "id", "")
            tc_name = getattr(item, "name", "")
            tc_args = getattr(item, "arguments", "{}")
            tool_calls.append(_ToolCallShim(
                id=tc_id,
                function=_FunctionRef(name=tc_name, arguments=tc_args),
            ))

    stop_reason = getattr(response, "stop_reason", "stop") or "stop"
    finish_reason = "tool_calls" if stop_reason == "tool_use" else "stop"

    message = _MessageShim(
        content="\n".join(text_parts) if text_parts else None,
        tool_calls=tool_calls if tool_calls else None,
    )

    return _CompletionShim(choices=[_ChoiceShim(message=message, finish_reason=finish_reason)])


# ---------------------------------------------------------------------------
# Streaming adapter: wraps Responses API SSE into chat-completions-shaped chunks
# ---------------------------------------------------------------------------


class _ResponsesStreamAdapter:
    """Async iterator that wraps a Responses API stream and yields
    chat-completions-shaped chunk shims."""

    def __init__(self, stream: Any):
        self._stream = stream

    def __aiter__(self):
        return self

    async def __anext__(self) -> _StreamChunkShim:
        while True:
            try:
                event = await self._stream.__anext__()
            except StopAsyncIteration:
                raise

            event_type = getattr(event, "type", None)

            if event_type == "response.output_text.delta":
                delta_text = getattr(event, "delta", "")
                return _StreamChunkShim(choices=[_StreamChoiceShim(
                    delta=_DeltaShim(content=delta_text),
                )])

            elif event_type == "response.output_item.added":
                item = getattr(event, "item", None)
                if item and getattr(item, "type", None) == "function_call":
                    tc_id = getattr(item, "call_id", None) or getattr(item, "id", "")
                    tc_name = getattr(item, "name", "")
                    tc_index = getattr(event, "output_index", 0)
                    return _StreamChunkShim(choices=[_StreamChoiceShim(
                        delta=_DeltaShim(tool_calls=[_DeltaToolCall(
                            index=tc_index,
                            id=tc_id,
                            function=_DeltaFunctionRef(name=tc_name, arguments=""),
                        )]),
                    )])

            elif event_type == "response.function_call_arguments.delta":
                tc_delta = getattr(event, "delta", "")
                tc_index = getattr(event, "output_index", 0)
                return _StreamChunkShim(choices=[_StreamChoiceShim(
                    delta=_DeltaShim(tool_calls=[_DeltaToolCall(
                        index=tc_index,
                        function=_DeltaFunctionRef(arguments=tc_delta),
                    )]),
                )])

            elif event_type == "response.completed":
                raise StopAsyncIteration


# ---------------------------------------------------------------------------
# Provider implementation
# ---------------------------------------------------------------------------


class ChatGPTProvider:
    def create_client(self) -> AsyncOpenAI:
        access_token = os.environ.get("AI_AUTH_CREDENTIAL")
        if not access_token:
            raise ValueError("AI_AUTH_CREDENTIAL (ChatGPT access token) is required")

        account_id = os.environ.get("CHATGPT_ACCOUNT_ID", "")
        transport = _AccountIDTransport(account_id) if account_id else None
        http_client = httpx.AsyncClient(transport=transport) if transport else None

        return AsyncOpenAI(
            base_url="https://chatgpt.com/backend-api/codex/v1",
            api_key=access_token,
            http_client=http_client,
        )

    async def create_completion(self, client: AsyncOpenAI, kwargs: dict[str, Any]) -> Any:
        resp_kwargs = self._translate_request(kwargs)
        response = await client.responses.create(**resp_kwargs)
        return _response_to_completion_shim(response)

    async def create_completion_streaming(self, client: AsyncOpenAI, kwargs: dict[str, Any]) -> Any:
        resp_kwargs = self._translate_request(kwargs)
        resp_kwargs["stream"] = True
        stream = await client.responses.create(**resp_kwargs)
        return _ResponsesStreamAdapter(stream)

    @staticmethod
    def _translate_request(kwargs: dict[str, Any]) -> dict[str, Any]:
        """Translate chat-completions kwargs to Responses API kwargs."""
        messages = kwargs.get("messages", [])
        resp_kwargs: dict[str, Any] = {
            "model": kwargs.get("model", ""),
            "input": _messages_to_input(messages),
        }

        if "max_tokens" in kwargs:
            resp_kwargs["max_output_tokens"] = kwargs["max_tokens"]

        tools = kwargs.get("tools")
        if tools:
            resp_kwargs["tools"] = _flatten_tools(tools)

        tool_choice = kwargs.get("tool_choice")
        if tool_choice:
            resp_kwargs["tool_choice"] = tool_choice

        return resp_kwargs
