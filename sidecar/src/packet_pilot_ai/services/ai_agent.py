"""AI agent for packet analysis using OpenRouter."""

import json
import os
from typing import Optional
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


# Tool definitions for AI function calling
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "search_packets",
            "description": "Search packets using a Wireshark display filter expression. Use this to find specific packets matching criteria like protocol, IP addresses, ports, or flags.",
            "parameters": {
                "type": "object",
                "properties": {
                    "filter": {
                        "type": "string",
                        "description": "Wireshark display filter expression (e.g., 'http.request', 'tcp.port == 443', 'ip.src == 192.168.1.1')"
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of packets to return (default 50)",
                        "default": 50
                    }
                },
                "required": ["filter"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_stream",
            "description": "Reconstruct and return the full content of a TCP, UDP, or HTTP stream/conversation. Use this to see what data was exchanged between two endpoints.",
            "parameters": {
                "type": "object",
                "properties": {
                    "stream_id": {
                        "type": "integer",
                        "description": "Stream index number (e.g., 0 for the first TCP stream)"
                    },
                    "protocol": {
                        "type": "string",
                        "enum": ["TCP", "UDP", "HTTP"],
                        "description": "Protocol type (default TCP)",
                        "default": "TCP"
                    }
                },
                "required": ["stream_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_packet_details",
            "description": "Get detailed protocol dissection for a specific packet by frame number.",
            "parameters": {
                "type": "object",
                "properties": {
                    "packet_num": {
                        "type": "integer",
                        "description": "Frame number of the packet to examine"
                    }
                },
                "required": ["packet_num"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "find_anomalies",
            "description": "Detect network anomalies and potential issues in the capture. Searches for retransmissions, resets, malformed packets, DNS errors, HTTP errors, etc. Use this for a quick health check or to identify problems.",
            "parameters": {
                "type": "object",
                "properties": {
                    "types": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Optional list of anomaly types to search for. If not specified, searches all types. Valid types: retransmission, fast_retransmission, duplicate_ack, reset, zero_window, window_full, malformed, icmp_unreachable, dns_error, http_error, tls_alert"
                    }
                },
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_packet_context",
            "description": "Get a packet with surrounding context. Shows packets before and after the target packet to understand what happened around it. Useful for analyzing sequences, understanding causes/effects, or seeing related traffic.",
            "parameters": {
                "type": "object",
                "properties": {
                    "packet_num": {
                        "type": "integer",
                        "description": "Frame number of the packet to examine"
                    },
                    "before": {
                        "type": "integer",
                        "description": "Number of packets before to include (default 5)",
                        "default": 5
                    },
                    "after": {
                        "type": "integer",
                        "description": "Number of packets after to include (default 5)",
                        "default": 5
                    }
                },
                "required": ["packet_num"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "compare_packets",
            "description": "Compare two packets field by field to see differences. Useful for comparing request/response pairs, identifying what changed between retransmissions, or analyzing similar packets.",
            "parameters": {
                "type": "object",
                "properties": {
                    "packet_a": {
                        "type": "integer",
                        "description": "Frame number of the first packet"
                    },
                    "packet_b": {
                        "type": "integer",
                        "description": "Frame number of the second packet"
                    }
                },
                "required": ["packet_a", "packet_b"]
            }
        }
    }
]


async def execute_tool(name: str, arguments: dict) -> str:
    """Execute a tool and return the result as a string."""
    try:
        if name == "search_packets":
            result = await search_packets(
                filter_str=arguments["filter"],
                limit=arguments.get("limit", 50)
            )
            if result:
                frames = result.get("frames", [])
                total = result.get("total_matching", 0)
                if frames:
                    summary = f"Found {total} packets matching '{arguments['filter']}'. Showing first {len(frames)}:\n"
                    for f in frames[:20]:  # Limit display
                        summary += f"  #{f.get('number', '?')}: {f.get('protocol', '?')} {f.get('source', '?')} -> {f.get('destination', '?')} | {f.get('info', '')[:80]}\n"
                    return summary
                return f"No packets found matching '{arguments['filter']}'"
            return "Error executing search"

        elif name == "get_stream":
            result = await get_stream(
                stream_id=arguments["stream_id"],
                protocol=arguments.get("protocol", "TCP"),
                format="ascii"
            )
            if result:
                server = result.get("server", {})
                client = result.get("client", {})
                combined = result.get("combined_text", "")
                # Truncate if too long
                if len(combined) > 4000:
                    combined = combined[:4000] + "\n... [truncated]"
                return f"Stream {arguments['stream_id']} ({arguments.get('protocol', 'TCP')}):\nServer: {server.get('host', '?')}:{server.get('port', '?')}\nClient: {client.get('host', '?')}:{client.get('port', '?')}\n\n{combined}"
            return "Error fetching stream or stream not found"

        elif name == "get_packet_details":
            result = await get_frame_details(arguments["packet_num"])
            if result:
                # Format the protocol tree
                tree = result.get("tree", [])
                output = f"Packet #{arguments['packet_num']} details:\n"
                for node in tree[:10]:  # First 10 layers
                    label = node.get("l", "")
                    if label:
                        output += f"  - {label}\n"
                return output
            return "Error fetching packet details"

        elif name == "find_anomalies":
            result = await find_anomalies(
                types=arguments.get("types"),
                limit_per_type=10
            )
            summary = result.get("summary", {})
            anomalies = result.get("anomalies", [])

            if summary.get("total_anomalies", 0) == 0:
                return "No anomalies detected in the capture. The network traffic appears healthy."

            # Format the output
            output = f"Found {summary['total_anomalies']} anomalies:\n"
            output += f"  - Errors: {summary['by_severity']['error']}\n"
            output += f"  - Warnings: {summary['by_severity']['warning']}\n"
            output += f"  - Info: {summary['by_severity']['info']}\n\n"

            for anomaly in anomalies:
                severity_icon = {"error": "🔴", "warning": "🟡", "info": "🔵"}.get(anomaly["severity"], "")
                output += f"{severity_icon} {anomaly['type'].upper()} ({anomaly['count']} packets)\n"
                output += f"   {anomaly['description']}\n"
                if anomaly.get("sample_packets"):
                    output += "   Sample packets:\n"
                    for pkt in anomaly["sample_packets"][:3]:
                        output += f"     #{pkt['number']}: {pkt['source']} -> {pkt['destination']} | {pkt['info']}\n"
                output += "\n"

            return output

        elif name == "get_packet_context":
            result = await get_packet_context(
                packet_num=arguments["packet_num"],
                before=arguments.get("before", 5),
                after=arguments.get("after", 5)
            )
            if not result:
                return f"Error fetching context for packet #{arguments['packet_num']}"

            output = f"Context around packet #{arguments['packet_num']}:\n\n"

            # Before packets
            before_pkts = result.get("before", [])
            if before_pkts:
                output += "BEFORE:\n"
                for pkt in before_pkts:
                    output += f"  #{pkt['number']}: {pkt['protocol']} {pkt['source']} -> {pkt['destination']} | {pkt['info']}\n"
                output += "\n"

            # Target packet
            target = result.get("target", {})
            target_summary = target.get("summary", {})
            output += f">>> TARGET #{target_summary.get('number', '?')}:\n"
            output += f"    {target_summary.get('protocol', '?')} {target_summary.get('source', '?')} -> {target_summary.get('destination', '?')}\n"
            output += f"    {target_summary.get('info', '')}\n"

            # Show some details
            details = target.get("details", {})
            tree = details.get("tree", [])
            if tree:
                output += "    Details:\n"
                for node in tree[:6]:
                    label = node.get("l", "")
                    if label:
                        output += f"      - {label}\n"
            output += "\n"

            # After packets
            after_pkts = result.get("after", [])
            if after_pkts:
                output += "AFTER:\n"
                for pkt in after_pkts:
                    output += f"  #{pkt['number']}: {pkt['protocol']} {pkt['source']} -> {pkt['destination']} | {pkt['info']}\n"

            return output

        elif name == "compare_packets":
            result = await compare_packets(
                packet_a=arguments["packet_a"],
                packet_b=arguments["packet_b"]
            )
            if not result:
                return f"Error comparing packets #{arguments['packet_a']} and #{arguments['packet_b']}"

            pkt_a = result.get("packet_a", {})
            pkt_b = result.get("packet_b", {})

            output = f"Comparison of packet #{arguments['packet_a']} vs #{arguments['packet_b']}:\n\n"

            # Summaries
            output += f"Packet A (#{pkt_a.get('number', '?')}):\n"
            output += f"  {pkt_a.get('protocol', '?')} {pkt_a.get('source', '?')} -> {pkt_a.get('destination', '?')}\n"
            output += f"  {pkt_a.get('info', '')}\n\n"

            output += f"Packet B (#{pkt_b.get('number', '?')}):\n"
            output += f"  {pkt_b.get('protocol', '?')} {pkt_b.get('source', '?')} -> {pkt_b.get('destination', '?')}\n"
            output += f"  {pkt_b.get('info', '')}\n\n"

            # Stats
            output += f"Common fields: {result.get('common_fields', 0)}\n"
            output += f"Different fields: {result.get('different_fields', 0)}\n\n"

            # Show key differences
            differences = result.get("differences", {})
            if differences:
                output += "KEY DIFFERENCES:\n"
                # Show most important differences first
                important_keys = ["Sequence Number", "Acknowledgment Number", "Time", "Length", "Flags"]
                shown = 0
                for key in important_keys:
                    if key in differences and shown < 10:
                        diff = differences[key]
                        output += f"  {key}:\n"
                        output += f"    A: {diff.get('packet_a', 'N/A')}\n"
                        output += f"    B: {diff.get('packet_b', 'N/A')}\n"
                        shown += 1

                # Show remaining differences up to limit
                for key, diff in list(differences.items())[:15 - shown]:
                    if key not in important_keys:
                        output += f"  {key}:\n"
                        output += f"    A: {diff.get('packet_a', 'N/A')}\n"
                        output += f"    B: {diff.get('packet_b', 'N/A')}\n"

            return output

        return f"Unknown tool: {name}"
    except Exception as e:
        return f"Tool error: {str(e)}"


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


SYSTEM_PROMPT = """You are PacketPilot AI, an expert network packet analyst assistant. You help users understand network traffic captured in PCAP files.

You have access to these tools to explore the packet capture:
- search_packets(filter, limit): Search for packets using Wireshark display filters
- get_stream(stream_id, protocol): Reconstruct TCP/UDP/HTTP stream conversations
- get_packet_details(packet_num): Get detailed protocol dissection for a specific packet
- find_anomalies(types): Detect network issues like retransmissions, resets, errors. Great for quick health checks.
- get_packet_context(packet_num, before, after): Get a packet with surrounding context to see what happened before/after
- compare_packets(packet_a, packet_b): Compare two packets field by field to find differences

Your capabilities:
- Analyze packet captures to identify patterns, issues, and anomalies
- Explain network protocols and their behavior
- Generate Wireshark display filters from natural language descriptions
- Identify potential security issues or performance problems
- Summarize network conversations and streams
- Search for specific packets and examine their contents
- Follow and analyze TCP/UDP streams
- Run health checks to find network problems (retransmissions, resets, DNS errors, etc.)
- Show context around specific packets (what happened before/after)
- Compare packets to identify differences (useful for request/response or retransmissions)

When analyzing packets, consider:
- Protocol layers (Ethernet, IP, TCP/UDP, Application)
- Source and destination addresses/ports
- Packet timing and sequence
- Error conditions and retransmissions
- Common attack patterns

When you need specific information about the capture, USE YOUR TOOLS to search for packets or examine streams. Don't just guess - search and verify.

Always provide clear, concise explanations. When suggesting filters, use valid Wireshark display filter syntax."""


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


async def call_llm(
    messages: list[dict],
    system: str,
    max_tokens: int = 1024,
    use_tools: bool = False,
    model_override: str | None = None,
) -> str:
    """Call the OpenRouter API with optional tool support."""
    client = get_openrouter_client()
    model = model_override or get_model()

    log(f"LLM request: model={model}, tools={use_tools}")

    # OpenRouter uses OpenAI format - system message goes in messages array
    full_messages = [{"role": "system", "content": system}] + messages

    # Note: Gemini models may have issues with tool calling via OpenRouter
    # but returning empty responses is worse, so we enable tools and handle errors

    try:
        # Make initial request
        kwargs = {
            "model": model,
            "max_tokens": max_tokens,
            "messages": full_messages,
        }
        if use_tools:
            kwargs["tools"] = TOOLS
            kwargs["tool_choice"] = "auto"

        response = await client.chat.completions.create(**kwargs)
        log("Response received")
        message = response.choices[0].message
        log(f"Response content length: {len(message.content) if message.content else 0}")
        log(f"Response finish_reason: {response.choices[0].finish_reason}")
        if not message.content:
            log(f"WARNING: Empty content. Full message: {message}")

        # Handle tool calls in a loop (max 5 iterations to prevent infinite loops)
        max_iterations = 5
        current_message = message

        for iteration in range(max_iterations):
            log(f"Iteration {iteration + 1}: has_tool_calls={bool(current_message.tool_calls)}")

            if not current_message.tool_calls:
                # No more tool calls, return the content
                return current_message.content or ""

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
                log(f"Executing tool: {tool_call.function.name} with args: {tool_call.function.arguments}")
                args = json.loads(tool_call.function.arguments)
                result = await execute_tool(tool_call.function.name, args)
                log(f"Tool result: {result[:200] if result else 'None'}...")
                full_messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": result
                })

            # Get next response after tool execution
            log(f"Making LLM call after tool execution (iteration {iteration + 1})...")
            next_response = await client.chat.completions.create(
                model=model,
                max_tokens=max_tokens,
                messages=full_messages,
                tools=TOOLS if use_tools else None,
                tool_choice="auto" if use_tools else None,
            )
            current_message = next_response.choices[0].message
            log(f"Response content length: {len(current_message.content) if current_message.content else 0}")
            log(f"Response finish_reason: {next_response.choices[0].finish_reason}")

            # If we got a response without tool calls, return it immediately
            if not current_message.tool_calls:
                log(f"Got final response after {iteration + 1} tool iterations")
                return current_message.content or ""

        # If we exhausted iterations, return whatever content we have
        log(f"WARNING: Exhausted {max_iterations} tool call iterations, returning last response")
        return current_message.content or "I ran into an issue processing your request. Please try again."

    except AuthenticationError as e:
        log(f"AuthenticationError: {e}")
        raise AIServiceError(
            str(e),
            "Invalid API key. Please update your OpenRouter API key in Settings."
        )
    except APIStatusError as e:
        log(f"APIStatusError: status_code={e.status_code}")
        log(f"APIStatusError message: {e.message}")
        log(f"APIStatusError body: {e.body}")
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
        import traceback
        traceback.print_exc()
        raise


from typing import AsyncIterator
from dataclasses import dataclass, field


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

    log(f"LLM streaming request: model={model}, tools={use_tools}")

    # OpenRouter uses OpenAI format - system message goes in messages array
    full_messages = [{"role": "system", "content": system}] + messages

    max_iterations = 5

    try:
        for iteration in range(max_iterations):
            log(f"Streaming iteration {iteration + 1}")

            # Build request kwargs
            kwargs = {
                "model": model,
                "max_tokens": max_tokens,
                "messages": full_messages,
                "stream": True,
            }
            if use_tools:
                kwargs["tools"] = TOOLS
                kwargs["tool_choice"] = "auto"

            stream = await client.chat.completions.create(**kwargs)

            # Accumulate the response
            accumulated_content = ""
            tool_calls: dict[int, ToolCallAccumulator] = {}

            async for chunk in stream:
                if not chunk.choices:
                    continue

                delta = chunk.choices[0].delta

                # Yield text content immediately
                if delta.content:
                    accumulated_content += delta.content
                    yield delta.content

                # Accumulate tool calls (they come in pieces)
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
                            # Append to existing
                            if tc_delta.id:
                                tool_calls[idx].id = tc_delta.id
                            if tc_delta.function:
                                if tc_delta.function.name:
                                    tool_calls[idx].name += tc_delta.function.name
                                if tc_delta.function.arguments:
                                    tool_calls[idx].arguments += tc_delta.function.arguments

            # Check if we have tool calls to execute
            if not tool_calls:
                log(f"Streaming complete after {iteration + 1} iterations")
                return

            # Execute tool calls
            log(f"Executing {len(tool_calls)} tool calls")

            # Add assistant message with tool calls to history
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

            # Execute each tool and add results
            for tc in tool_calls.values():
                log(f"Executing tool: {tc.name}")
                try:
                    args = json.loads(tc.arguments)
                    result = await execute_tool(tc.name, args)
                    log(f"Tool result: {result[:200] if result else 'None'}...")
                except Exception as e:
                    result = f"Tool error: {str(e)}"
                    log(f"Tool error: {e}")

                full_messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": result
                })

            # Yield a marker that tools were executed (UI can show this)
            yield "\n\n"  # Small visual break before continuing

        # If we exhausted iterations
        log(f"WARNING: Exhausted {max_iterations} streaming iterations")

    except AuthenticationError as e:
        log(f"AuthenticationError: {e}")
        raise AIServiceError(
            str(e),
            "Invalid API key. Please update your OpenRouter API key in Settings."
        )
    except APIStatusError as e:
        log(f"APIStatusError: status_code={e.status_code}")
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
        raise


async def analyze_packets(
    query: str,
    context: CaptureContext,
    packet_data: dict,
    history: list[ChatMessage],
    model: str | None = None,
) -> AnalyzeResponse:
    """Analyze packets based on user query and context."""
    # Build context message (skip slow capture-stats call for faster responses)
    context_parts = []

    if context.file_name:
        context_parts.append(f"Current file: {context.file_name}")
    if context.total_frames:
        context_parts.append(f"Total frames: {context.total_frames}")
    if context.current_filter:
        context_parts.append(f"Active filter: {context.current_filter}")
    if context.selected_packet_id:
        context_parts.append(f"Selected packet: #{context.selected_packet_id}")

    context_str = "\n".join(context_parts) if context_parts else "No capture loaded"

    # Build packet data context
    packet_context = ""
    if packet_data.get("selected_packet"):
        packet_context += f"\n\nSelected packet details:\n{_format_packet(packet_data['selected_packet'])}"
    if packet_data.get("visible_frames"):
        frames_summary = _summarize_frames(packet_data["visible_frames"])
        packet_context += f"\n\nVisible frames summary:\n{frames_summary}"

    # Build messages from history
    messages = []
    for msg in history[-10:]:  # Last 10 messages for context
        if msg.role in ("user", "assistant"):
            messages.append({"role": msg.role, "content": msg.content})

    # Add current query with context
    user_message = f"""Capture Context:
{context_str}
{packet_context}

User query: {query}"""

    messages.append({"role": "user", "content": user_message})

    # Call LLM with tool support enabled
    response_text = await call_llm(messages, SYSTEM_PROMPT, max_tokens=1024, use_tools=True, model_override=model)

    # Check if response suggests a filter
    suggested_filter = None
    suggested_action = None

    # Simple heuristic to detect filter suggestions
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

    return AnalyzeResponse(
        message=response_text or "I couldn't generate a response. Please try again.",
        suggested_filter=suggested_filter,
        suggested_action=suggested_action,
    )


async def stream_analyze_packets(
    query: str,
    context: CaptureContext,
    packet_data: dict,
    history: list[ChatMessage],
    model: str | None = None,
) -> AsyncIterator[str]:
    """Stream analyze packets - yields text chunks as they arrive.

    Supports tool calling: when the AI needs to search packets, follow streams,
    or use other tools, it will execute them and continue streaming the response.
    """
    # Build context message (same as analyze_packets)
    context_parts = []

    if context.file_name:
        context_parts.append(f"Current file: {context.file_name}")
    if context.total_frames:
        context_parts.append(f"Total frames: {context.total_frames}")
    if context.current_filter:
        context_parts.append(f"Active filter: {context.current_filter}")
    if context.selected_packet_id:
        context_parts.append(f"Selected packet: #{context.selected_packet_id}")

    context_str = "\n".join(context_parts) if context_parts else "No capture loaded"

    # Build packet data context
    packet_context = ""
    if packet_data.get("selected_packet"):
        packet_context += f"\n\nSelected packet details:\n{_format_packet(packet_data['selected_packet'])}"
    if packet_data.get("visible_frames"):
        frames_summary = _summarize_frames(packet_data["visible_frames"])
        packet_context += f"\n\nVisible frames summary:\n{frames_summary}"

    # Build messages from history
    messages = []
    for msg in history[-10:]:  # Last 10 messages for context
        if msg.role in ("user", "assistant"):
            messages.append({"role": msg.role, "content": msg.content})

    # Add current query with context
    user_message = f"""Capture Context:
{context_str}
{packet_context}

User query: {query}"""

    messages.append({"role": "user", "content": user_message})

    # Stream the response with tool support enabled
    async for chunk in call_llm_streaming(
        messages, SYSTEM_PROMPT, max_tokens=1024, use_tools=True, model_override=model
    ):
        yield chunk


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
