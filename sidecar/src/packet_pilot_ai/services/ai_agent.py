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
    return os.environ.get("AI_MODEL", "x-ai/grok-code-fast-1")


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

Your capabilities:
- Analyze packet captures to identify patterns, issues, and anomalies
- Explain network protocols and their behavior
- Generate Wireshark display filters from natural language descriptions
- Identify potential security issues or performance problems
- Summarize network conversations and streams
- Search for specific packets and examine their contents
- Follow and analyze TCP/UDP streams

When analyzing packets, consider:
- Protocol layers (Ethernet, IP, TCP/UDP, Application)
- Source and destination addresses/ports
- Packet timing and sequence
- Error conditions and retransmissions
- Common attack patterns

When you need specific information about the capture, USE YOUR TOOLS to search for packets or examine streams. Don't just guess - search and verify.

Always provide clear, concise explanations. When suggesting filters, use valid Wireshark display filter syntax."""


async def call_llm(
    messages: list[dict],
    system: str,
    max_tokens: int = 1024,
    use_tools: bool = False,
) -> str:
    """Call the OpenRouter API with optional tool support."""
    client = get_openrouter_client()
    model = get_model()

    # OpenRouter uses OpenAI format - system message goes in messages array
    full_messages = [{"role": "system", "content": system}] + messages

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
        message = response.choices[0].message

        # Handle tool calls if present
        if use_tools and message.tool_calls:
            # Add assistant's tool call message
            full_messages.append({
                "role": "assistant",
                "content": message.content or "",
                "tool_calls": [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {
                            "name": tc.function.name,
                            "arguments": tc.function.arguments
                        }
                    }
                    for tc in message.tool_calls
                ]
            })

            # Execute each tool and add results
            for tool_call in message.tool_calls:
                args = json.loads(tool_call.function.arguments)
                result = await execute_tool(tool_call.function.name, args)
                full_messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": result
                })

            # Get final response after tool execution
            final_response = await client.chat.completions.create(
                model=model,
                max_tokens=max_tokens,
                messages=full_messages,
            )
            return final_response.choices[0].message.content or ""

        return message.content or ""

    except AuthenticationError as e:
        raise AIServiceError(
            str(e),
            "Invalid API key. Please update your OpenRouter API key in Settings."
        )
    except APIStatusError as e:
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


async def analyze_packets(
    query: str,
    context: CaptureContext,
    packet_data: dict,
    history: list[ChatMessage],
) -> AnalyzeResponse:
    """Analyze packets based on user query and context."""
    # Build context message
    context_parts = []

    if context.file_name:
        context_parts.append(f"Current file: {context.file_name}")
    if context.total_frames:
        context_parts.append(f"Total frames: {context.total_frames}")
    if context.current_filter:
        context_parts.append(f"Active filter: {context.current_filter}")
    if context.selected_packet_id:
        context_parts.append(f"Selected packet: #{context.selected_packet_id}")

    # Fetch capture stats for richer context
    stats = await get_capture_stats()
    if stats:
        summary = stats.get("summary", {})
        if summary.get("duration"):
            context_parts.append(f"Capture duration: {summary['duration']:.2f}s")

        # Add protocol breakdown
        proto_hierarchy = stats.get("protocol_hierarchy", [])
        if proto_hierarchy:
            proto_summary = _format_protocol_hierarchy(proto_hierarchy)
            context_parts.append(f"Protocol breakdown:\n{proto_summary}")

        # Add conversation summary
        tcp_convs = stats.get("tcp_conversations", [])
        udp_convs = stats.get("udp_conversations", [])
        if tcp_convs or udp_convs:
            context_parts.append(f"Conversations: {len(tcp_convs)} TCP, {len(udp_convs)} UDP")

            # Top conversations by traffic
            all_convs = [(c, "TCP") for c in tcp_convs] + [(c, "UDP") for c in udp_convs]
            top_convs = sorted(all_convs, key=lambda x: x[0].get("tx_bytes", 0) + x[0].get("rx_bytes", 0), reverse=True)[:5]
            if top_convs:
                conv_lines = []
                for conv, proto in top_convs:
                    src = f"{conv.get('src_addr', '?')}:{conv.get('src_port', '?')}"
                    dst = f"{conv.get('dst_addr', '?')}:{conv.get('dst_port', '?')}"
                    bytes_total = conv.get('tx_bytes', 0) + conv.get('rx_bytes', 0)
                    conv_lines.append(f"  {proto}: {src} <-> {dst} ({bytes_total} bytes)")
                context_parts.append("Top conversations:\n" + "\n".join(conv_lines))

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
    response_text = await call_llm(messages, SYSTEM_PROMPT, max_tokens=1024, use_tools=True)

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
