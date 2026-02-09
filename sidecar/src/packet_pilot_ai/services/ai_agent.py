"""AI agent for packet analysis using OpenRouter."""

import json
import os
import asyncio
import random
import time
import uuid
import traceback
from dataclasses import dataclass
from typing import Any, Optional, AsyncIterator
from openai import AsyncOpenAI, AuthenticationError, APIStatusError

from ..models.schemas import (
    AnalyzeResponse,
    FilterResponse,
    CaptureContext,
    ChatMessage,
)
from .rust_bridge import (
    check_filter as validate_filter,
    search_packets,
    get_stream,
    get_capture_stats,
    get_frame_details,
    find_anomalies,
    get_packet_context,
    compare_packets,
)
from .ai_tools import (
    TOOLS,
    TOOL_SCHEMAS,
    TOOL_NUMERIC_BOUNDS,
    TOOL_GUARDRAIL_PHRASES,
)
from .ai_tool_handlers import build_tool_executors, ToolRuntime


def _env_int(name: str, default: int) -> int:
    value = os.environ.get(name)
    if value is None:
        return default
    try:
        return int(value)
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    value = os.environ.get(name)
    if value is None:
        return default
    try:
        return float(value)
    except ValueError:
        return default


@dataclass
class LoopPolicy:
    max_iterations: int
    max_tool_calls: int
    max_wall_ms: int
    max_model_calls: int

    @classmethod
    def from_env(cls) -> "LoopPolicy":
        return cls(
            max_iterations=max(1, _env_int("AI_LOOP_MAX_ITERATIONS", 5)),
            max_tool_calls=max(1, _env_int("AI_LOOP_MAX_TOOL_CALLS", 12)),
            max_wall_ms=max(1000, _env_int("AI_LOOP_MAX_WALL_MS", 15000)),
            max_model_calls=max(1, _env_int("AI_LOOP_MAX_MODEL_CALLS", 6)),
        )


@dataclass
class LoopState:
    request_id: str
    route: str
    started_monotonic: float
    iterations: int = 0
    model_calls: int = 0
    tool_calls: int = 0
    retry_count: int = 0
    completion_status: str = "complete"
    stop_reason: str = "completed"


@dataclass
class LoopResult:
    text: str
    state: LoopState


def _new_request_id() -> str:
    return str(uuid.uuid4())


def _elapsed_ms(state: LoopState) -> int:
    return int((time.monotonic() - state.started_monotonic) * 1000)


def _limit_note(stop_reason: str) -> str:
    notes = {
        "max_iterations_exceeded": "I reached the maximum reasoning iterations for this request.",
        "max_tool_calls_exceeded": "I reached the maximum tool-call budget for this request.",
        "max_wall_ms_exceeded": "I reached the maximum execution time budget for this request.",
        "max_model_calls_exceeded": "I reached the maximum model-call budget for this request.",
    }
    return notes.get(stop_reason, "I hit an execution limit while analyzing this request.")


def _partial_text(last_text: str, stop_reason: str) -> str:
    note = _limit_note(stop_reason)
    base = (last_text or "I gathered partial results but hit an execution limit.").strip()
    if note in base:
        return base
    return f"{base}\n\n{note}"


def _current_limit_reason(state: LoopState, policy: LoopPolicy) -> str | None:
    if _elapsed_ms(state) > policy.max_wall_ms:
        return "max_wall_ms_exceeded"
    if state.iterations >= policy.max_iterations:
        return "max_iterations_exceeded"
    if state.model_calls >= policy.max_model_calls:
        return "max_model_calls_exceeded"
    if state.tool_calls >= policy.max_tool_calls:
        return "max_tool_calls_exceeded"
    return None


def _mark_partial(state: LoopState, stop_reason: str) -> None:
    state.completion_status = "partial"
    state.stop_reason = stop_reason


def _mark_complete(state: LoopState) -> None:
    state.completion_status = "complete"
    state.stop_reason = "completed"


def _tool_error(
    tool_name: str,
    code: str,
    message: str,
    *,
    retryable: bool = False,
    details: dict[str, Any] | None = None,
) -> str:
    payload: dict[str, Any] = {
        "ok": False,
        "tool": tool_name,
        "error": {
            "code": code,
            "message": message,
            "retryable": retryable,
        },
    }
    if details:
        payload["error"]["details"] = details
    return f"Tool error: {json.dumps(payload, ensure_ascii=True)}"


def _validate_tool_arguments(name: str, arguments: Any) -> str | None:
    if name not in TOOL_SCHEMAS:
        return f"Unknown tool: {name}"
    if not isinstance(arguments, dict):
        return "Tool arguments must be an object"

    schema = TOOL_SCHEMAS[name]
    properties = schema.get("properties", {})
    required = schema.get("required", [])

    missing = [key for key in required if key not in arguments]
    if missing:
        return f"Missing required arguments: {', '.join(missing)}"

    unknown = [key for key in arguments if key not in properties]
    if unknown:
        return f"Unexpected arguments: {', '.join(unknown)}"

    for key, value in arguments.items():
        expected_type = properties.get(key, {}).get("type")
        if expected_type == "integer" and (not isinstance(value, int) or isinstance(value, bool)):
            return f"Argument '{key}' must be an integer"
        if expected_type == "string" and not isinstance(value, str):
            return f"Argument '{key}' must be a string"
        if expected_type == "array" and not isinstance(value, list):
            return f"Argument '{key}' must be an array"
        if expected_type == "object" and not isinstance(value, dict):
            return f"Argument '{key}' must be an object"

        enum_values = properties.get(key, {}).get("enum")
        if enum_values and value not in enum_values:
            return f"Argument '{key}' must be one of: {', '.join(enum_values)}"

    bounds = TOOL_NUMERIC_BOUNDS.get(name, {})
    for key, (min_value, max_value) in bounds.items():
        if key not in arguments:
            continue
        value = arguments[key]
        if not isinstance(value, int) or isinstance(value, bool):
            continue
        if min_value is not None and value < min_value:
            return f"Argument '{key}' must be >= {min_value}"
        if max_value is not None and value > max_value:
            return f"Argument '{key}' must be <= {max_value}"

    return None


def _check_tool_guardrail(arguments: dict[str, Any]) -> str | None:
    serialized = json.dumps(arguments, ensure_ascii=True).lower()
    max_len = _env_int("AI_MAX_TOOL_ARGUMENT_CHARS", 4000)
    if len(serialized) > max_len:
        return f"Tool arguments too large ({len(serialized)} chars > {max_len})"

    for phrase in TOOL_GUARDRAIL_PHRASES:
        if phrase in serialized:
            return f"Tool arguments matched blocked phrase '{phrase}'"

    return None


def _decode_tool_arguments(name: str, raw_arguments: str | None) -> tuple[dict[str, Any] | None, str | None]:
    raw = raw_arguments or "{}"
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        return None, _tool_error(name, "invalid_json_arguments", f"Invalid JSON arguments: {exc.msg}")

    if not isinstance(parsed, dict):
        return None, _tool_error(name, "invalid_arguments", "Tool arguments JSON must decode to an object")

    return parsed, None


def _is_retryable_llm_error(error: Exception) -> bool:
    if isinstance(error, APIStatusError):
        return error.status_code in {408, 409, 425, 429, 500, 502, 503, 504}

    lowered = type(error).__name__.lower()
    if "timeout" in lowered or "connection" in lowered:
        return True

    return isinstance(error, (TimeoutError, ConnectionError, OSError))


async def _create_chat_completion_with_retry(
    client: AsyncOpenAI,
    request_kwargs: dict[str, Any],
    *,
    operation: str,
    loop_state: LoopState | None = None,
):
    max_attempts = max(1, _env_int("AI_RETRY_MAX_ATTEMPTS", 3))
    base_delay = max(0.05, _env_float("AI_RETRY_BASE_DELAY_SECONDS", 0.4))
    max_delay = max(base_delay, _env_float("AI_RETRY_MAX_DELAY_SECONDS", 4.0))

    for attempt in range(1, max_attempts + 1):
        try:
            return await client.chat.completions.create(**request_kwargs)
        except Exception as exc:
            if attempt == max_attempts or not _is_retryable_llm_error(exc):
                raise

            delay = min(max_delay, base_delay * (2 ** (attempt - 1)))
            delay *= random.uniform(0.8, 1.2)
            if loop_state is not None:
                loop_state.retry_count += 1
            log(
                f"{operation} transient failure ({type(exc).__name__}); "
                f"retrying {attempt + 1}/{max_attempts} in {delay:.2f}s"
            )
            await asyncio.sleep(delay)


def _build_runtime_tool_executors():
    runtime = ToolRuntime(
        search_packets=search_packets,
        get_stream=get_stream,
        get_capture_stats=get_capture_stats,
        get_frame_details=get_frame_details,
        find_anomalies=find_anomalies,
        get_packet_context=get_packet_context,
        compare_packets=compare_packets,
    )
    return build_tool_executors(runtime)


async def execute_tool(name: str, arguments: dict) -> str:
    """Execute a tool and return the result as a string."""
    validation_error = _validate_tool_arguments(name, arguments)
    if validation_error:
        return _tool_error(name, "invalid_arguments", validation_error)

    guardrail_error = _check_tool_guardrail(arguments)
    if guardrail_error:
        return _tool_error(name, "guardrail_blocked", guardrail_error)

    executor = _build_runtime_tool_executors().get(name)
    if executor is None:
        return _tool_error(name, "unknown_tool", f"Unknown tool: {name}")

    try:
        return await executor(arguments)
    except Exception as e:
        return _tool_error(name, "execution_failed", str(e))


class AIServiceError(Exception):
    """Custom exception for AI service errors with user-friendly messages."""
    def __init__(self, message: str, user_message: str):
        super().__init__(message)
        self.user_message = user_message


# OpenRouter client instance
openai_client: Optional[AsyncOpenAI] = None


def get_model() -> str:
    """Get the configured model."""
    return os.environ.get("AI_MODEL", "google/gemini-3-flash-preview")


def get_openrouter_client() -> AsyncOpenAI:
    """Get or create the OpenRouter client (uses OpenAI SDK)."""
    global openai_client
    if openai_client is None:
        api_key = os.environ.get("OPENROUTER_API_KEY")
        if not api_key:
            raise ValueError("OPENROUTER_API_KEY environment variable is required")
        openai_client = AsyncOpenAI(
            base_url="https://openrouter.ai/api/v1",
            api_key=api_key,
            default_headers={
                "HTTP-Referer": "https://packetpilot.app",
                "X-Title": "PacketPilot",
            }
        )
    return openai_client


SYSTEM_PROMPT = """You are PacketPilot AI, an expert network packet analyst. You help users understand network traffic in PCAP files.

## YOUR APPROACH: Progressive Exploration

When analyzing a capture, explore progressively - start broad, then drill down:

1. **Start with Overview** (for open-ended questions like "what's in this capture?"):
   - get_capture_overview: See protocols, conversation counts, duration
   - get_conversations: See who is talking to whom
   - get_endpoints: Find the busiest hosts

2. **Drill Down** (once you know what to look for):
   - search_packets: Find specific traffic with Wireshark filters
   - get_stream: See actual data exchanged in a conversation
   - get_packet_details: Examine one packet in full detail

3. **Investigate Issues**:
   - find_anomalies: Quick health check for problems
   - get_packet_context: Understand what happened around an event
   - compare_packets: Find differences between related packets

## TOOLS AVAILABLE

**Overview Tools** - Start here for exploration:
- get_capture_overview(): Protocol stats, conversation counts, duration
- get_conversations(protocol, limit): List TCP/UDP connections
- get_endpoints(limit): Top hosts by traffic

**Search & Inspect** - Drill down into specifics:
- search_packets(filter, limit): Find packets with Wireshark filters
- get_stream(stream_id, protocol): Reconstruct conversation content
- get_packet_details(packet_num): Full protocol dissection

**Analysis Tools**:
- find_anomalies(types): Detect retransmissions, errors, resets
- get_packet_context(packet_num, before, after): See surrounding packets
- compare_packets(packet_a, packet_b): Diff two packets

## KEY PRINCIPLES

- **Don't guess - verify**: Always use tools to confirm your analysis
- **Be efficient**: Start broad, narrow down based on what you find
- **Explain your reasoning**: Tell the user what you're looking for and why
- **Suggest filters**: When relevant, provide Wireshark filters users can apply

When analyzing, consider: protocol layers, addresses/ports, timing, retransmissions, and security patterns."""


import sys
import logging

# Set up file logging (INFO level to reduce noise)
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [AI_AGENT] %(message)s',
    handlers=[
        logging.FileHandler('/tmp/packet-pilot-ai.log'),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)

# Silence verbose httpx/httpcore logging
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logging.getLogger("openai").setLevel(logging.WARNING)

def log(msg: str):
    """Print and flush log message."""
    logger.info(msg)
    print(f"[AI_AGENT] {msg}", flush=True)
    sys.stdout.flush()


def _log_loop_event(event: str, state: LoopState, **fields: Any) -> None:
    payload: dict[str, Any] = {
        "event": event,
        "request_id": state.request_id,
        "route": state.route,
        "iteration": state.iterations,
        "model_calls": state.model_calls,
        "tool_calls": state.tool_calls,
        "retry_count": state.retry_count,
        "elapsed_ms": _elapsed_ms(state),
        "completion_status": state.completion_status,
        "stop_reason": state.stop_reason,
    }
    payload.update(fields)
    logger.info(json.dumps(payload, ensure_ascii=True, sort_keys=True))


async def _run_llm_loop(
    messages: list[dict],
    system: str,
    max_tokens: int = 1024,
    use_tools: bool = False,
    model_override: str | None = None,
    request_id: str | None = None,
    route: str = "llm_loop",
) -> LoopResult:
    """Run a bounded model/tool loop and return text + loop metadata."""
    client = get_openrouter_client()
    model = model_override or get_model()
    policy = LoopPolicy.from_env()
    state = LoopState(
        request_id=request_id or _new_request_id(),
        route=route,
        started_monotonic=time.monotonic(),
    )

    log(f"LLM request: model={model}, tools={use_tools}, request_id={state.request_id}")
    _log_loop_event("loop.start", state, model=model, tools=use_tools)

    # OpenRouter uses OpenAI format - system message goes in messages array
    full_messages = [{"role": "system", "content": system}] + messages

    # Note: Gemini models may have issues with tool calling via OpenRouter
    # but returning empty responses is worse, so we enable tools and handle errors

    try:
        reason = _current_limit_reason(state, policy)
        if reason:
            _mark_partial(state, reason)
            _log_loop_event("loop.stop", state, model=model, tools=use_tools)
            return LoopResult(text=_partial_text("", reason), state=state)

        # Make initial request
        kwargs = {
            "model": model,
            "max_tokens": max_tokens,
            "messages": full_messages,
        }
        if use_tools:
            kwargs["tools"] = TOOLS
            kwargs["tool_choice"] = "auto"

        state.model_calls += 1
        _log_loop_event("model.call.start", state, model=model, operation="initial")
        response = await _create_chat_completion_with_retry(
            client,
            kwargs,
            operation="initial completion",
            loop_state=state,
        )
        _log_loop_event("model.call.end", state, model=model, operation="initial")
        log("Response received")
        message = response.choices[0].message
        log(f"Response content length: {len(message.content) if message.content else 0}")
        log(f"Response finish_reason: {response.choices[0].finish_reason}")
        if not message.content:
            log(f"WARNING: Empty content. Full message: {message}")

        current_message = message

        while True:
            log(f"Iteration {state.iterations + 1}: has_tool_calls={bool(current_message.tool_calls)}")
            if not current_message.tool_calls:
                _mark_complete(state)
                _log_loop_event("loop.stop", state, model=model, tools=use_tools)
                return LoopResult(text=current_message.content or "", state=state)

            reason = _current_limit_reason(state, policy)
            if reason:
                _mark_partial(state, reason)
                _log_loop_event("loop.stop", state, model=model, tools=use_tools)
                return LoopResult(text=_partial_text(current_message.content or "", reason), state=state)

            state.iterations += 1

            # Add assistant's tool call message
            full_messages.append({
                "role": "assistant",
                "content": current_message.content or "",
                "tool_calls": [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {
                            "name": tc.function.name,
                            "arguments": tc.function.arguments
                        }
                    }
                    for tc in current_message.tool_calls
                ]
            })

            # Execute each tool and add results
            for tool_call in current_message.tool_calls:
                reason = _current_limit_reason(state, policy)
                if reason:
                    _mark_partial(state, reason)
                    _log_loop_event("loop.stop", state, model=model, tools=use_tools)
                    return LoopResult(text=_partial_text(current_message.content or "", reason), state=state)

                tool_name = tool_call.function.name
                raw_arguments = tool_call.function.arguments
                state.tool_calls += 1
                _log_loop_event("tool.call.start", state, tool_name=tool_name)
                log(f"Executing tool: {tool_name} with args: {raw_arguments}")
                args, parse_error = _decode_tool_arguments(tool_name, raw_arguments)
                if parse_error:
                    result = parse_error
                else:
                    result = await execute_tool(tool_name, args)
                log(f"Tool result: {result[:200] if result else 'None'}...")
                _log_loop_event("tool.call.end", state, tool_name=tool_name)
                full_messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": result
                })

            # Get next response after tool execution
            reason = _current_limit_reason(state, policy)
            if reason:
                _mark_partial(state, reason)
                _log_loop_event("loop.stop", state, model=model, tools=use_tools)
                return LoopResult(text=_partial_text(current_message.content or "", reason), state=state)

            log(f"Making LLM call after tool execution (iteration {state.iterations})...")
            state.model_calls += 1
            _log_loop_event("model.call.start", state, model=model, operation="post_tools")
            next_response = await _create_chat_completion_with_retry(
                client,
                {
                    "model": model,
                    "max_tokens": max_tokens,
                    "messages": full_messages,
                    "tools": TOOLS if use_tools else None,
                    "tool_choice": "auto" if use_tools else None,
                },
                operation=f"tool iteration {state.iterations}",
                loop_state=state,
            )
            _log_loop_event("model.call.end", state, model=model, operation="post_tools")
            current_message = next_response.choices[0].message
            log(f"Response content length: {len(current_message.content) if current_message.content else 0}")
            log(f"Response finish_reason: {next_response.choices[0].finish_reason}")

    except AuthenticationError as e:
        log(f"AuthenticationError: {e}")
        state.completion_status = "error"
        state.stop_reason = "authentication_error"
        _log_loop_event("loop.stop", state, model=model, tools=use_tools, error_class=type(e).__name__)
        raise AIServiceError(
            str(e),
            "Invalid API key. Please update your OpenRouter API key in Settings."
        )
    except APIStatusError as e:
        log(f"APIStatusError: status_code={e.status_code}")
        log(f"APIStatusError message: {e.message}")
        log(f"APIStatusError body: {e.body}")
        state.completion_status = "error"
        state.stop_reason = "api_status_error"
        _log_loop_event(
            "loop.stop",
            state,
            model=model,
            tools=use_tools,
            error_class=type(e).__name__,
            status_code=e.status_code,
        )
        if e.status_code == 401:
            raise AIServiceError(
                str(e),
                "Invalid API key. Please update your OpenRouter API key in Settings."
            )
        elif e.status_code == 402:
            raise AIServiceError(
                str(e),
                "Insufficient credits. Please add credits to your OpenRouter account or select a free model."
            )
        elif e.status_code == 429:
            raise AIServiceError(
                str(e),
                "Rate limit exceeded. Please wait a moment and try again."
            )
        else:
            raise AIServiceError(
                str(e),
                f"AI service error ({e.status_code}). Please try again later."
            )
    except Exception as e:
        log(f"Unexpected error: {type(e).__name__}: {e}")
        state.completion_status = "error"
        state.stop_reason = "unexpected_error"
        _log_loop_event("loop.stop", state, model=model, tools=use_tools, error_class=type(e).__name__)
        traceback.print_exc()
        raise


async def call_llm(
    messages: list[dict],
    system: str,
    max_tokens: int = 1024,
    use_tools: bool = False,
    model_override: str | None = None,
    request_id: str | None = None,
    route: str = "llm_loop",
) -> str:
    """Compatibility wrapper that returns only the final text."""
    result = await _run_llm_loop(
        messages,
        system,
        max_tokens=max_tokens,
        use_tools=use_tools,
        model_override=model_override,
        request_id=request_id,
        route=route,
    )
    return result.text


@dataclass
class ToolCallAccumulator:
    """Accumulates tool call deltas from streaming."""
    id: str
    name: str = ""
    arguments: str = ""


async def call_llm_streaming(
    messages: list[dict],
    system: str,
    max_tokens: int = 1024,
    use_tools: bool = False,
    model_override: str | None = None,
    loop_policy: LoopPolicy | None = None,
    loop_state: LoopState | None = None,
    request_id: str | None = None,
    route: str = "llm_stream",
) -> AsyncIterator[str]:
    """Call the OpenRouter API with streaming and optional tool support.

    Yields text chunks as they arrive. When tools are enabled:
    - Streams text from the model
    - When tool calls are detected, executes them
    - Makes another streaming request with tool results
    - Repeats until no more tool calls (max 5 iterations)
    """
    client = get_openrouter_client()
    model = model_override or get_model()
    policy = loop_policy or LoopPolicy.from_env()
    state = loop_state or LoopState(
        request_id=request_id or _new_request_id(),
        route=route,
        started_monotonic=time.monotonic(),
    )

    log(f"LLM streaming request: model={model}, tools={use_tools}, request_id={state.request_id}")
    _log_loop_event("loop.start", state, model=model, tools=use_tools)

    # OpenRouter uses OpenAI format - system message goes in messages array
    full_messages = [{"role": "system", "content": system}] + messages

    try:
        while True:
            reason = _current_limit_reason(state, policy)
            if reason:
                _mark_partial(state, reason)
                _log_loop_event("loop.stop", state, model=model, tools=use_tools)
                return

            log(f"Streaming iteration {state.iterations + 1}")
            state.model_calls += 1
            _log_loop_event("model.call.start", state, model=model, operation="stream")

            kwargs = {
                "model": model,
                "max_tokens": max_tokens,
                "messages": full_messages,
                "stream": True,
            }
            if use_tools:
                kwargs["tools"] = TOOLS
                kwargs["tool_choice"] = "auto"

            stream = await _create_chat_completion_with_retry(
                client,
                kwargs,
                operation=f"streaming iteration {state.iterations + 1}",
                loop_state=state,
            )
            _log_loop_event("model.call.end", state, model=model, operation="stream")

            accumulated_content = ""
            tool_calls: dict[int, ToolCallAccumulator] = {}

            async for chunk in stream:
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta
                if delta.content:
                    accumulated_content += delta.content
                    yield delta.content
                if delta.tool_calls:
                    for tc_delta in delta.tool_calls:
                        idx = tc_delta.index
                        if idx not in tool_calls:
                            tool_calls[idx] = ToolCallAccumulator(
                                id=tc_delta.id or "",
                                name=tc_delta.function.name if tc_delta.function and tc_delta.function.name else "",
                                arguments=tc_delta.function.arguments if tc_delta.function and tc_delta.function.arguments else "",
                            )
                        else:
                            if tc_delta.id:
                                tool_calls[idx].id = tc_delta.id
                            if tc_delta.function:
                                if tc_delta.function.name:
                                    tool_calls[idx].name += tc_delta.function.name
                                if tc_delta.function.arguments:
                                    tool_calls[idx].arguments += tc_delta.function.arguments

            if not tool_calls:
                _mark_complete(state)
                _log_loop_event("loop.stop", state, model=model, tools=use_tools)
                return

            reason = _current_limit_reason(state, policy)
            if reason:
                _mark_partial(state, reason)
                _log_loop_event("loop.stop", state, model=model, tools=use_tools)
                return

            state.iterations += 1
            log(f"Executing {len(tool_calls)} tool calls")

            tool_calls_for_message = [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {
                        "name": tc.name,
                        "arguments": tc.arguments
                    }
                }
                for tc in tool_calls.values()
            ]
            full_messages.append({
                "role": "assistant",
                "content": accumulated_content or "",
                "tool_calls": tool_calls_for_message
            })

            for tc in tool_calls.values():
                reason = _current_limit_reason(state, policy)
                if reason:
                    _mark_partial(state, reason)
                    _log_loop_event("loop.stop", state, model=model, tools=use_tools)
                    return

                state.tool_calls += 1
                _log_loop_event("tool.call.start", state, tool_name=tc.name)
                log(f"Executing tool: {tc.name}")
                args, parse_error = _decode_tool_arguments(tc.name, tc.arguments)
                if parse_error:
                    result = parse_error
                else:
                    result = await execute_tool(tc.name, args)
                _log_loop_event("tool.call.end", state, tool_name=tc.name)
                log(f"Tool result: {result[:200] if result else 'None'}...")

                full_messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": result
                })

    except AuthenticationError as e:
        log(f"AuthenticationError: {e}")
        state.completion_status = "error"
        state.stop_reason = "authentication_error"
        _log_loop_event("loop.stop", state, model=model, tools=use_tools, error_class=type(e).__name__)
        raise AIServiceError(
            str(e),
            "Invalid API key. Please update your OpenRouter API key in Settings."
        )
    except APIStatusError as e:
        log(f"APIStatusError: status_code={e.status_code}")
        state.completion_status = "error"
        state.stop_reason = "api_status_error"
        _log_loop_event(
            "loop.stop",
            state,
            model=model,
            tools=use_tools,
            error_class=type(e).__name__,
            status_code=e.status_code,
        )
        if e.status_code == 401:
            raise AIServiceError(str(e), "Invalid API key.")
        elif e.status_code == 402:
            raise AIServiceError(str(e), "Insufficient credits.")
        elif e.status_code == 429:
            raise AIServiceError(str(e), "Rate limit exceeded.")
        else:
            raise AIServiceError(str(e), f"AI service error ({e.status_code}).")
    except Exception as e:
        log(f"Streaming error: {type(e).__name__}: {e}")
        state.completion_status = "error"
        state.stop_reason = "unexpected_error"
        _log_loop_event("loop.stop", state, model=model, tools=use_tools, error_class=type(e).__name__)
        raise


def _build_capture_context_string(context: CaptureContext, *, compact: bool) -> str:
    context_parts = []
    if context.file_name:
        context_parts.append(f"{'File' if compact else 'Current file'}: {context.file_name}")
    if context.total_frames:
        if compact:
            context_parts.append(f"Total: {context.total_frames} packets")
        else:
            context_parts.append(f"Total frames: {context.total_frames}")
    if context.current_filter:
        context_parts.append(f"{'Filter' if compact else 'Active filter'}: {context.current_filter}")
    if context.selected_packet_id:
        if compact:
            context_parts.append(f"Selected: #{context.selected_packet_id}")
        else:
            context_parts.append(f"Selected packet: #{context.selected_packet_id}")

    return " | ".join(context_parts) if context_parts else "No capture loaded"


def _build_selected_packet_context(context: CaptureContext, packet_data: dict) -> str:
    if packet_data.get("selected_packet"):
        return (
            f"\n\nUser-selected packet #{context.selected_packet_id} details:\n"
            f"{_format_packet(packet_data['selected_packet'])}"
        )
    return ""


def _history_to_messages(history: list[ChatMessage], *, limit: int = 10) -> list[dict[str, str]]:
    messages: list[dict[str, str]] = []
    for msg in history[-limit:]:
        if msg.role in ("user", "assistant"):
            messages.append({"role": msg.role, "content": msg.content})
    return messages


def _build_analyze_user_message(query: str, context_str: str, packet_context: str) -> str:
    return f"""Capture: {context_str}{packet_context}

Query: {query}"""


def _extract_suggested_filter(response_text: str) -> tuple[str | None, str | None]:
    suggested_filter = None
    suggested_action = None

    if response_text and ("filter:" in response_text.lower() or "```" in response_text):
        # Try to extract filter from backticks or after "filter:"
        import re
        filter_match = re.search(r'`([^`]+)`', response_text)
        if filter_match:
            potential_filter = filter_match.group(1)
            # Basic validation - contains common filter operators
            if any(op in potential_filter for op in ["==", "!=", "&&", "||", ".", "contains"]):
                suggested_filter = potential_filter
                suggested_action = "apply_filter"

    return suggested_filter, suggested_action


async def analyze_packets(
    query: str,
    context: CaptureContext,
    packet_data: dict,
    history: list[ChatMessage],
    model: str | None = None,
    request_id: str | None = None,
) -> AnalyzeResponse:
    """Analyze packets based on user query and context."""
    context_str = _build_capture_context_string(context, compact=False)
    packet_context = _build_selected_packet_context(context, packet_data)
    messages = _history_to_messages(history)
    user_message = _build_analyze_user_message(query, context_str, packet_context)
    messages.append({"role": "user", "content": user_message})

    # Call LLM with tool support enabled
    loop_result = await _run_llm_loop(
        messages,
        SYSTEM_PROMPT,
        max_tokens=1024,
        use_tools=True,
        model_override=model,
        request_id=request_id,
        route="analyze",
    )
    response_text = loop_result.text

    suggested_filter, suggested_action = _extract_suggested_filter(response_text)

    return AnalyzeResponse(
        message=response_text or "I couldn't generate a response. Please try again.",
        suggested_filter=suggested_filter,
        suggested_action=suggested_action,
        request_id=loop_result.state.request_id,
        completion_status=loop_result.state.completion_status,
        stop_reason=loop_result.state.stop_reason,
    )


async def stream_analyze_packets(
    query: str,
    context: CaptureContext,
    packet_data: dict,
    history: list[ChatMessage],
    model: str | None = None,
    request_id: str | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """Stream analyze packets - yields text chunks as they arrive.

    Supports tool calling: when the AI needs to search packets, follow streams,
    or use other tools, it will execute them and continue streaming the response.
    """
    context_str = _build_capture_context_string(context, compact=True)
    packet_context = _build_selected_packet_context(context, packet_data)
    messages = _history_to_messages(history)
    user_message = _build_analyze_user_message(query, context_str, packet_context)
    messages.append({"role": "user", "content": user_message})

    policy = LoopPolicy.from_env()
    state = LoopState(
        request_id=request_id or _new_request_id(),
        route="analyze_stream",
        started_monotonic=time.monotonic(),
    )

    yield {"type": "meta", "request_id": state.request_id}

    # Stream the response with tool support enabled
    async for chunk in call_llm_streaming(
        messages,
        SYSTEM_PROMPT,
        max_tokens=1024,
        use_tools=True,
        model_override=model,
        loop_policy=policy,
        loop_state=state,
        request_id=state.request_id,
        route="analyze_stream",
    ):
        yield {"type": "text", "text": chunk}

    if state.completion_status == "partial":
        yield {
            "type": "warning",
            "warning": "limit_exhausted",
            "stop_reason": state.stop_reason,
        }


def _format_protocol_hierarchy(hierarchy: list, indent: int = 0) -> str:
    """Format protocol hierarchy into readable string."""
    lines = []
    for proto in hierarchy[:10]:  # Limit to top 10
        prefix = "  " * indent
        name = proto.get("protocol", "?")
        frames = proto.get("frames", 0)
        bytes_count = proto.get("bytes", 0)
        lines.append(f"{prefix}- {name}: {frames} packets, {bytes_count} bytes")

        # Recurse into children (one level deep)
        children = proto.get("children", [])
        if children and indent < 1:
            for child in children[:5]:
                child_name = child.get("protocol", "?")
                child_frames = child.get("frames", 0)
                lines.append(f"{prefix}  - {child_name}: {child_frames} packets")

    return "\n".join(lines)


async def generate_filter(
    query: str,
    context: CaptureContext,
) -> FilterResponse:
    """Generate a Wireshark display filter from natural language."""
    user_message = f"""Generate a Wireshark display filter for the following request:

"{query}"

Current context:
- File: {context.file_name or 'Unknown'}
- Total frames: {context.total_frames}
- Current filter: {context.current_filter or 'None'}

Respond with ONLY the filter expression, nothing else. Use valid Wireshark display filter syntax."""

    filter_system = "You are a Wireshark display filter expert. Generate valid display filters from natural language descriptions. Respond with only the filter expression."

    response_text = await call_llm(
        [{"role": "user", "content": user_message}],
        filter_system,
        max_tokens=256,
    )

    filter_str = response_text.strip()

    # Remove any backticks or quotes that might have been added
    filter_str = filter_str.strip("`'\"")

    # Validate filter via Rust bridge
    is_valid = await validate_filter(filter_str)

    return FilterResponse(
        filter=filter_str,
        is_valid=is_valid,
        explanation=f"Filter to show: {query}",
    )


def _format_packet(packet: dict) -> str:
    """Format packet details for AI context."""
    parts = []
    if "tree" in packet:
        # Extract key protocol info from tree
        for node in packet.get("tree", [])[:5]:  # First 5 protocol layers
            label = node.get("l", "")
            if label:
                parts.append(f"  - {label}")
    return "\n".join(parts) if parts else "  No details available"


def _summarize_frames(frames: list[dict]) -> str:
    """Create a summary of visible frames."""
    if not frames:
        return "  No frames available"

    # Count protocols
    protocols = {}
    for frame in frames:
        proto = frame.get("protocol", "Unknown")
        protocols[proto] = protocols.get(proto, 0) + 1

    parts = [f"  {len(frames)} frames visible"]
    parts.append("  Protocol breakdown:")
    for proto, count in sorted(protocols.items(), key=lambda x: -x[1])[:5]:
        parts.append(f"    - {proto}: {count}")

    return "\n".join(parts)
