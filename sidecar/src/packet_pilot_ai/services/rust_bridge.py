"""HTTP client for communicating with Rust backend."""

from typing import Optional
import httpx

RUST_BRIDGE_URL = "http://127.0.0.1:8766"


async def get_frames(skip: int = 0, limit: int = 100) -> Optional[list[dict]]:
    """Fetch frames from Rust via HTTP bridge."""
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{RUST_BRIDGE_URL}/frames",
                json={"skip": skip, "limit": limit},
                timeout=30.0,
            )
            response.raise_for_status()
            data = response.json()
            return data.get("frames", [])
    except httpx.HTTPError as e:
        print(f"Error fetching frames: {e}")
        return None


async def get_frame_details(frame_num: int) -> Optional[dict]:
    """Fetch detailed frame info from Rust via HTTP bridge."""
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{RUST_BRIDGE_URL}/frame-details",
                json={"frame_num": frame_num},
                timeout=30.0,
            )
            response.raise_for_status()
            return response.json()
    except httpx.HTTPError as e:
        print(f"Error fetching frame details: {e}")
        return None


async def check_filter(filter_str: str) -> bool:
    """Validate a Wireshark display filter via Rust bridge."""
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{RUST_BRIDGE_URL}/check-filter",
                json={"filter": filter_str},
                timeout=10.0,
            )
            response.raise_for_status()
            data = response.json()
            return data.get("valid", False)
    except httpx.HTTPError as e:
        print(f"Error checking filter: {e}")
        return False


async def search_packets(
    filter_str: str,
    limit: int = 100,
    skip: int = 0,
) -> Optional[dict]:
    """Search packets matching a Wireshark display filter.

    Args:
        filter_str: Wireshark display filter expression (e.g., 'http.request', 'tcp.port == 443')
        limit: Maximum number of packets to return (default 100)
        skip: Number of matching packets to skip for pagination (default 0)

    Returns:
        Dict with 'frames', 'total_matching', and 'filter_applied', or None on error.
        - frames: List of matching packet summaries
        - total_matching: Total number of packets matching the filter
        - filter_applied: The filter that was applied
    """
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{RUST_BRIDGE_URL}/search",
                json={"filter": filter_str, "limit": limit, "skip": skip},
                timeout=30.0,
            )
            response.raise_for_status()
            return response.json()
    except httpx.HTTPError as e:
        print(f"Error searching packets: {e}")
        return None


async def get_stream(
    stream_id: int,
    protocol: str = "TCP",
    format: str = "ascii",
) -> Optional[dict]:
    """Get reconstructed stream data for a TCP, UDP, or HTTP stream.

    Args:
        stream_id: Stream index number (e.g., 0 for first TCP stream)
        protocol: Protocol type - "TCP", "UDP", or "HTTP" (default "TCP")
        format: Output format - "ascii", "hex", or "raw" (base64) (default "ascii")

    Returns:
        Dict with stream data, or None on error:
        - server: {host, port} of server endpoint
        - client: {host, port} of client endpoint
        - server_bytes: Total bytes from server
        - client_bytes: Total bytes from client
        - segments: List of {direction, size, data} for each segment
        - combined_text: Full conversation text (for ascii format)
    """
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{RUST_BRIDGE_URL}/stream",
                json={
                    "stream_id": stream_id,
                    "protocol": protocol,
                    "format": format,
                },
                timeout=60.0,  # Streams can be large
            )
            response.raise_for_status()
            return response.json()
    except httpx.HTTPError as e:
        print(f"Error fetching stream: {e}")
        return None


async def get_capture_stats() -> Optional[dict]:
    """Get capture statistics including protocol hierarchy and conversations.

    Returns:
        Dict with capture statistics, or None on error:
        - summary: {total_frames, duration, protocol_count, tcp/udp_conversation_count, endpoint_count}
        - protocol_hierarchy: Tree of protocols with frame/byte counts
        - tcp_conversations: List of TCP conversations with src/dst and traffic stats
        - udp_conversations: List of UDP conversations
        - endpoints: List of endpoints with traffic stats
    """
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{RUST_BRIDGE_URL}/capture-stats",
                timeout=30.0,
            )
            response.raise_for_status()
            return response.json()
    except httpx.HTTPError as e:
        print(f"Error fetching capture stats: {e}")
        return None
