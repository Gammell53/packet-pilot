"""AI agent for packet analysis using OpenRouter."""

import os
from typing import Optional
from openai import AsyncOpenAI

from ..models.schemas import (
    AnalyzeResponse,
    FilterResponse,
    CaptureContext,
    ChatMessage,
)
from .rust_bridge import check_filter as validate_filter

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

Your capabilities:
- Analyze packet captures to identify patterns, issues, and anomalies
- Explain network protocols and their behavior
- Generate Wireshark display filters from natural language descriptions
- Identify potential security issues or performance problems
- Summarize network conversations and streams

When analyzing packets, consider:
- Protocol layers (Ethernet, IP, TCP/UDP, Application)
- Source and destination addresses/ports
- Packet timing and sequence
- Error conditions and retransmissions
- Common attack patterns

Always provide clear, concise explanations. When suggesting filters, use valid Wireshark display filter syntax."""


async def call_llm(
    messages: list[dict],
    system: str,
    max_tokens: int = 1024,
) -> str:
    """Call the OpenRouter API."""
    client = get_openrouter_client()
    model = get_model()

    # OpenRouter uses OpenAI format - system message goes in messages array
    full_messages = [{"role": "system", "content": system}] + messages

    response = await client.chat.completions.create(
        model=model,
        max_tokens=max_tokens,
        messages=full_messages,
    )
    return response.choices[0].message.content


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
    user_message = f"""Context:
{context_str}
{packet_context}

User query: {query}"""

    messages.append({"role": "user", "content": user_message})

    # Call LLM
    response_text = await call_llm(messages, SYSTEM_PROMPT, max_tokens=1024)

    # Check if response suggests a filter
    suggested_filter = None
    suggested_action = None

    # Simple heuristic to detect filter suggestions
    if "filter:" in response_text.lower() or "```" in response_text:
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
        message=response_text,
        suggested_filter=suggested_filter,
        suggested_action=suggested_action,
    )


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
