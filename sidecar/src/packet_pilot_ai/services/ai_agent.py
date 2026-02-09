"""AI agent for packet analysis using OpenRouter."""

import json
import os
import asyncio
import random
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


# Tool definitions for AI function calling
TOOLS = [
    # === OVERVIEW TOOLS (start here for exploration) ===
    {
        "type": "function",
        "function": {
            "name": "get_capture_overview",
            "description": """Get a high-level overview of the entire capture.

RETURNS: Total packets, duration, protocol hierarchy, conversation counts, endpoint counts.

WHEN TO USE: Start here when you need to understand the capture before drilling down.
- "What's in this capture?"
- "Give me an overview"
- "What protocols are being used?"
- Any exploratory analysis

EXAMPLE: User asks "What kind of traffic is in this capture?" -> Use this first, then search for specific protocols.""",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_conversations",
            "description": """List network conversations (connections between endpoints).

RETURNS: TCP and/or UDP conversations with addresses, ports, packet/byte counts.

WHEN TO USE: When you need to see who is talking to whom.
- "Show me the connections"
- "What hosts are communicating?"
- "Find the largest data transfers"
- "Who is this IP talking to?"

EXAMPLE: User asks about connections from 192.168.1.100 -> Use this to list conversations.""",
            "parameters": {
                "type": "object",
                "properties": {
                    "protocol": {
                        "type": "string",
                        "enum": ["tcp", "udp", "both"],
                        "description": "Filter by protocol (default: both)",
                        "default": "both"
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Max conversations to return (default 20)",
                        "default": 20
                    }
                },
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_endpoints",
            "description": """List top network endpoints (hosts) by traffic volume.

RETURNS: IP addresses with packets sent/received and bytes sent/received.

WHEN TO USE: When you need to identify the most active hosts.
- "What are the busiest hosts?"
- "Who is sending the most data?"
- "List all IPs in this capture"
- "Find the top talkers"

EXAMPLE: User asks "Which host is generating the most traffic?" -> Use this.""",
            "parameters": {
                "type": "object",
                "properties": {
                    "limit": {
                        "type": "integer",
                        "description": "Max endpoints to return (default 20)",
                        "default": 20
                    }
                },
                "required": []
            }
        }
    },
    # === SEARCH & INSPECT TOOLS (drill down) ===
    {
        "type": "function",
        "function": {
            "name": "search_packets",
            "description": """Search packets using a Wireshark display filter expression.

RETURNS: List of matching packets with frame number, protocol, addresses, and info.

WHEN TO USE: When you need to find specific packets. Use after overview to drill down.

FILTER EXAMPLES:
- Protocol: 'http', 'dns', 'tcp', 'tls'
- IP: 'ip.addr == 192.168.1.1', 'ip.src == 10.0.0.1'
- Port: 'tcp.port == 443', 'udp.port == 53'
- Flags: 'tcp.flags.syn == 1', 'tcp.flags.rst == 1'
- Combined: 'http.request && ip.dst == 10.0.0.1'
- Content: 'http.request.uri contains "api"'""",
            "parameters": {
                "type": "object",
                "properties": {
                    "filter": {
                        "type": "string",
                        "description": "Wireshark display filter (e.g., 'http.request', 'tcp.port == 443')"
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Max packets to return (default 50)",
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
            "description": """Reconstruct the full content of a TCP, UDP, or HTTP conversation.

RETURNS: Complete data exchanged between client and server.

WHEN TO USE: When you need to see actual payload data, not just headers.
- "What data was sent to the server?"
- "Show me the HTTP response body"
- "What did they download?"

WORKFLOW: First search_packets to find traffic, note the stream number, then use this.""",
            "parameters": {
                "type": "object",
                "properties": {
                    "stream_id": {
                        "type": "integer",
                        "description": "Stream index (from packet info, e.g., tcp.stream=0)"
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
            "description": """Get detailed protocol dissection for a specific packet.

RETURNS: Full protocol tree with all layers and field values.

WHEN TO USE: When you need to examine one packet in detail.
- After finding a packet of interest via search
- To see all protocol fields and flags
- To examine packet payload""",
            "parameters": {
                "type": "object",
                "properties": {
                    "packet_num": {
                        "type": "integer",
                        "description": "Frame number of the packet"
                    }
                },
                "required": ["packet_num"]
            }
        }
    },
    # === ANALYSIS TOOLS ===
    {
        "type": "function",
        "function": {
            "name": "find_anomalies",
            "description": """Detect network anomalies and issues in the capture.

RETURNS: Summary of issues with severity and sample packets.

WHEN TO USE: For quick health checks or troubleshooting.
- "Is there anything wrong?"
- "Why is it slow?"
- "Are there any errors?"

DETECTS: retransmissions, duplicate ACKs, resets, zero window, malformed packets, ICMP errors, DNS errors, HTTP 4xx/5xx, TLS alerts""",
            "parameters": {
                "type": "object",
                "properties": {
                    "types": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Specific types to check (omit for all): retransmission, reset, dns_error, http_error, tls_alert, etc."
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
            "description": """Get a packet with surrounding packets for context.

RETURNS: Target packet plus packets before and after it.

WHEN TO USE: To understand what happened around a specific event.
- "What caused this reset?"
- "What happened before the error?"
- Analyzing sequences and timing""",
            "parameters": {
                "type": "object",
                "properties": {
                    "packet_num": {
                        "type": "integer",
                        "description": "Frame number of the target packet"
                    },
                    "before": {
                        "type": "integer",
                        "description": "Packets before to include (default 5)",
                        "default": 5
                    },
                    "after": {
                        "type": "integer",
                        "description": "Packets after to include (default 5)",
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
            "description": """Compare two packets field by field.

RETURNS: Differences between the packets.

WHEN TO USE: To analyze related packets.
- Compare request vs response
- Compare original vs retransmission
- Find what changed between two similar packets""",
            "parameters": {
                "type": "object",
                "properties": {
                    "packet_a": {
                        "type": "integer",
                        "description": "Frame number of first packet"
                    },
                    "packet_b": {
                        "type": "integer",
                        "description": "Frame number of second packet"
                    }
                },
                "required": ["packet_a", "packet_b"]
            }
        }
    }
]


TOOL_SCHEMAS = {
    tool["function"]["name"]: tool["function"].get("parameters", {})
    for tool in TOOLS
}

TOOL_NUMERIC_BOUNDS: dict[str, dict[str, tuple[int | None, int | None]]] = {
    "search_packets": {"limit": (1, 200)},
    "get_stream": {"stream_id": (0, 1000000)},
    "get_packet_details": {"packet_num": (1, 100000000)},
    "get_packet_context": {
        "packet_num": (1, 100000000),
        "before": (0, 50),
        "after": (0, 50),
    },
    "compare_packets": {
        "packet_a": (1, 100000000),
        "packet_b": (1, 100000000),
    },
    "get_conversations": {"limit": (1, 100)},
    "get_endpoints": {"limit": (1, 100)},
}

TOOL_GUARDRAIL_PHRASES = (
    "ignore previous instructions",
    "system prompt",
    "developer message",
    "openrouter_api_key",
    "api key",
)


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
            log(
                f"{operation} transient failure ({type(exc).__name__}); "
                f"retrying {attempt + 1}/{max_attempts} in {delay:.2f}s"
            )
            await asyncio.sleep(delay)


async def execute_tool(name: str, arguments: dict) -> str:
    """Execute a tool and return the result as a string."""
    validation_error = _validate_tool_arguments(name, arguments)
    if validation_error:
        return _tool_error(name, "invalid_arguments", validation_error)

    guardrail_error = _check_tool_guardrail(arguments)
    if guardrail_error:
        return _tool_error(name, "guardrail_blocked", guardrail_error)

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

        elif name == "get_capture_overview":
            result = await get_capture_stats()
            if result:
                summary = result.get("summary", {})
                hierarchy = result.get("protocol_hierarchy", [])

                output = "CAPTURE OVERVIEW:\n"
                output += f"  Total frames: {summary.get('total_frames', 0)}\n"
                if summary.get('duration'):
                    output += f"  Duration: {summary.get('duration'):.2f} seconds\n"
                output += f"  TCP conversations: {summary.get('tcp_conversation_count', 0)}\n"
                output += f"  UDP conversations: {summary.get('udp_conversation_count', 0)}\n"
                output += f"  Endpoints: {summary.get('endpoint_count', 0)}\n\n"

                output += "PROTOCOL HIERARCHY:\n"
                for proto in hierarchy[:10]:
                    frames = proto.get('frames', 0)
                    bytes_count = proto.get('bytes', 0)
                    output += f"  - {proto.get('protocol', '?')}: {frames} packets, {bytes_count} bytes\n"
                    for child in proto.get('children', [])[:3]:
                        output += f"    - {child.get('protocol', '?')}: {child.get('frames', 0)} packets\n"

                return output
            return "Error fetching capture overview"

        elif name == "get_conversations":
            result = await get_capture_stats()
            if result:
                protocol = arguments.get("protocol", "both")
                limit = arguments.get("limit", 20)

                output = "NETWORK CONVERSATIONS:\n\n"

                if protocol in ["tcp", "both"]:
                    tcp_convs = result.get("tcp_conversations", [])[:limit]
                    if tcp_convs:
                        output += f"TCP CONVERSATIONS ({len(tcp_convs)} shown):\n"
                        for conv in tcp_convs:
                            total_bytes = conv.get("rx_bytes", 0) + conv.get("tx_bytes", 0)
                            total_frames = conv.get("rx_frames", 0) + conv.get("tx_frames", 0)
                            src = f"{conv.get('src_addr', '?')}:{conv.get('src_port', '?')}"
                            dst = f"{conv.get('dst_addr', '?')}:{conv.get('dst_port', '?')}"
                            output += f"  {src} <-> {dst}\n"
                            output += f"    {total_frames} packets, {total_bytes} bytes\n"
                        output += "\n"

                if protocol in ["udp", "both"]:
                    udp_convs = result.get("udp_conversations", [])[:limit]
                    if udp_convs:
                        output += f"UDP CONVERSATIONS ({len(udp_convs)} shown):\n"
                        for conv in udp_convs:
                            total_bytes = conv.get("rx_bytes", 0) + conv.get("tx_bytes", 0)
                            total_frames = conv.get("rx_frames", 0) + conv.get("tx_frames", 0)
                            src = f"{conv.get('src_addr', '?')}:{conv.get('src_port', '?')}"
                            dst = f"{conv.get('dst_addr', '?')}:{conv.get('dst_port', '?')}"
                            output += f"  {src} <-> {dst}\n"
                            output += f"    {total_frames} packets, {total_bytes} bytes\n"

                if output.strip() == "NETWORK CONVERSATIONS:":
                    return "No conversations found"
                return output
            return "Error fetching conversations"

        elif name == "get_endpoints":
            result = await get_capture_stats()
            if result:
                limit = arguments.get("limit", 20)
                endpoints = result.get("endpoints", [])[:limit]

                if endpoints:
                    # Sort by total traffic
                    sorted_endpoints = sorted(
                        endpoints,
                        key=lambda e: e.get("rx_bytes", 0) + e.get("tx_bytes", 0),
                        reverse=True
                    )
                    output = f"TOP ENDPOINTS ({len(sorted_endpoints)} shown):\n\n"
                    for ep in sorted_endpoints:
                        total_bytes = ep.get("rx_bytes", 0) + ep.get("tx_bytes", 0)
                        total_frames = ep.get("rx_frames", 0) + ep.get("tx_frames", 0)
                        host = ep.get("host", "?")
                        port = ep.get("port")
                        addr = f"{host}:{port}" if port else host
                        output += f"  {addr}:\n"
                        output += f"    TX: {ep.get('tx_frames', 0)} pkts, {ep.get('tx_bytes', 0)} bytes\n"
                        output += f"    RX: {ep.get('rx_frames', 0)} pkts, {ep.get('rx_bytes', 0)} bytes\n"
                    return output
                return "No endpoints found"
            return "Error fetching endpoints"

        return _tool_error(name, "unknown_tool", f"Unknown tool: {name}")
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

        response = await _create_chat_completion_with_retry(
            client,
            kwargs,
            operation="initial completion",
        )
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
                tool_name = tool_call.function.name
                raw_arguments = tool_call.function.arguments
                log(f"Executing tool: {tool_name} with args: {raw_arguments}")
                args, parse_error = _decode_tool_arguments(tool_name, raw_arguments)
                if parse_error:
                    result = parse_error
                else:
                    result = await execute_tool(tool_name, args)
                log(f"Tool result: {result[:200] if result else 'None'}...")
                full_messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": result
                })

            # Get next response after tool execution
            log(f"Making LLM call after tool execution (iteration {iteration + 1})...")
            next_response = await _create_chat_completion_with_retry(
                client,
                {
                    "model": model,
                    "max_tokens": max_tokens,
                    "messages": full_messages,
                    "tools": TOOLS if use_tools else None,
                    "tool_choice": "auto" if use_tools else None,
                },
                operation=f"tool iteration {iteration + 1}",
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

            stream = await _create_chat_completion_with_retry(
                client,
                kwargs,
                operation=f"streaming iteration {iteration + 1}",
            )

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
                args, parse_error = _decode_tool_arguments(tc.name, tc.arguments)
                if parse_error:
                    result = parse_error
                else:
                    result = await execute_tool(tc.name, args)

                log(f"Tool result: {result[:200] if result else 'None'}...")

                full_messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": result
                })

            # Yield a marker that tools were executed (UI can show this)
            yield "\n\n"  # Small visual break before continuing

        # If we exhausted iterations, yield a helpful message
        log(f"WARNING: Exhausted {max_iterations} streaming iterations")
        yield "\n\n*I've searched extensively but couldn't find the specific information. Try rephrasing your question or being more specific about what you're looking for.*"

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

    context_str = " | ".join(context_parts) if context_parts else "No capture loaded"

    # Only include selected packet details if user explicitly selected one
    # (visible_frames removed - let agent request via tools for progressive disclosure)
    packet_context = ""
    if packet_data.get("selected_packet"):
        packet_context = f"\n\nUser-selected packet #{context.selected_packet_id} details:\n{_format_packet(packet_data['selected_packet'])}"

    # Build messages from history
    messages = []
    for msg in history[-10:]:  # Last 10 messages for context
        if msg.role in ("user", "assistant"):
            messages.append({"role": msg.role, "content": msg.content})

    # Add current query with context
    user_message = f"""Capture: {context_str}{packet_context}

Query: {query}"""

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
    # Build minimal context (same as analyze_packets)
    context_parts = []

    if context.file_name:
        context_parts.append(f"File: {context.file_name}")
    if context.total_frames:
        context_parts.append(f"Total: {context.total_frames} packets")
    if context.current_filter:
        context_parts.append(f"Filter: {context.current_filter}")
    if context.selected_packet_id:
        context_parts.append(f"Selected: #{context.selected_packet_id}")

    context_str = " | ".join(context_parts) if context_parts else "No capture loaded"

    # Only include selected packet details if user explicitly selected one
    packet_context = ""
    if packet_data.get("selected_packet"):
        packet_context = f"\n\nUser-selected packet #{context.selected_packet_id} details:\n{_format_packet(packet_data['selected_packet'])}"

    # Build messages from history
    messages = []
    for msg in history[-10:]:  # Last 10 messages for context
        if msg.role in ("user", "assistant"):
            messages.append({"role": msg.role, "content": msg.content})

    # Add current query with context
    user_message = f"""Capture: {context_str}{packet_context}

Query: {query}"""

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
