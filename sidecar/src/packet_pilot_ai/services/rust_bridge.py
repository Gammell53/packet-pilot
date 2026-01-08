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


# Anomaly detection filters
ANOMALY_FILTERS = {
    "retransmission": {
        "filter": "tcp.analysis.retransmission",
        "description": "TCP retransmissions (packets sent again due to loss or timeout)",
        "severity": "warning",
    },
    "fast_retransmission": {
        "filter": "tcp.analysis.fast_retransmission",
        "description": "Fast retransmissions (triggered by duplicate ACKs)",
        "severity": "warning",
    },
    "duplicate_ack": {
        "filter": "tcp.analysis.duplicate_ack",
        "description": "Duplicate ACKs (may indicate packet loss)",
        "severity": "info",
    },
    "reset": {
        "filter": "tcp.flags.reset == 1",
        "description": "TCP resets (connection forcibly closed)",
        "severity": "warning",
    },
    "zero_window": {
        "filter": "tcp.analysis.zero_window",
        "description": "Zero window (receiver buffer full, flow control)",
        "severity": "warning",
    },
    "window_full": {
        "filter": "tcp.analysis.window_full",
        "description": "Window full (sender limited by receiver window)",
        "severity": "info",
    },
    "malformed": {
        "filter": "_ws.malformed",
        "description": "Malformed packets (parsing errors)",
        "severity": "error",
    },
    "icmp_unreachable": {
        "filter": "icmp.type == 3",
        "description": "ICMP destination unreachable",
        "severity": "warning",
    },
    "dns_error": {
        "filter": "dns.flags.rcode != 0",
        "description": "DNS errors (NXDOMAIN, SERVFAIL, etc.)",
        "severity": "warning",
    },
    "http_error": {
        "filter": "http.response.code >= 400",
        "description": "HTTP errors (4xx/5xx responses)",
        "severity": "warning",
    },
    "tls_alert": {
        "filter": "tls.alert_message",
        "description": "TLS/SSL alerts (handshake failures, etc.)",
        "severity": "warning",
    },
}


async def find_anomalies(
    types: list[str] | None = None,
    limit_per_type: int = 10,
) -> dict:
    """Find network anomalies in the capture.

    Args:
        types: List of anomaly types to search for. If None, searches all types.
                Valid types: retransmission, fast_retransmission, duplicate_ack,
                reset, zero_window, window_full, malformed, icmp_unreachable,
                dns_error, http_error, tls_alert
        limit_per_type: Max packets to return per anomaly type (default 10)

    Returns:
        Dict with:
        - summary: {total_anomalies, by_severity: {error, warning, info}}
        - anomalies: List of {type, description, severity, count, sample_packets}
    """
    # Use all types if none specified
    if types is None:
        types = list(ANOMALY_FILTERS.keys())

    results = []
    total = 0
    by_severity = {"error": 0, "warning": 0, "info": 0}

    for anomaly_type in types:
        if anomaly_type not in ANOMALY_FILTERS:
            continue

        config = ANOMALY_FILTERS[anomaly_type]
        search_result = await search_packets(
            filter_str=config["filter"],
            limit=limit_per_type,
        )

        if search_result:
            count = search_result.get("total_matching", 0)
            if count > 0:
                total += count
                by_severity[config["severity"]] += count

                # Format sample packets
                sample_packets = []
                for frame in search_result.get("frames", [])[:limit_per_type]:
                    sample_packets.append({
                        "number": frame.get("number"),
                        "time": frame.get("time"),
                        "source": frame.get("source"),
                        "destination": frame.get("destination"),
                        "info": frame.get("info", "")[:80],
                    })

                results.append({
                    "type": anomaly_type,
                    "description": config["description"],
                    "severity": config["severity"],
                    "count": count,
                    "sample_packets": sample_packets,
                })

    # Sort by severity (error > warning > info) then by count
    severity_order = {"error": 0, "warning": 1, "info": 2}
    results.sort(key=lambda x: (severity_order[x["severity"]], -x["count"]))

    return {
        "summary": {
            "total_anomalies": total,
            "by_severity": by_severity,
        },
        "anomalies": results,
    }


async def get_packet_context(
    packet_num: int,
    before: int = 5,
    after: int = 5,
) -> Optional[dict]:
    """Get a packet with surrounding context (parent-child retrieval pattern).

    Args:
        packet_num: Central packet of interest
        before: Number of packets before to include (default 5)
        after: Number of packets after to include (default 5)

    Returns:
        Dict with:
        - target: Full details of the target packet
        - before: List of packet summaries before the target
        - after: List of packet summaries after the target
    """
    # Calculate range
    start = max(1, packet_num - before)
    end = packet_num + after

    # Get the surrounding frames
    frames_result = await get_frames(skip=start - 1, limit=end - start + 1)
    if not frames_result:
        return None

    # Get detailed info for the target packet
    target_details = await get_frame_details(packet_num)

    # Split into before, target, and after
    before_packets = []
    after_packets = []
    target_summary = None

    for frame in frames_result:
        frame_num = frame.get("number", 0)
        summary = {
            "number": frame_num,
            "time": frame.get("time"),
            "source": frame.get("source"),
            "destination": frame.get("destination"),
            "protocol": frame.get("protocol"),
            "length": frame.get("length"),
            "info": frame.get("info", "")[:100],
        }

        if frame_num < packet_num:
            before_packets.append(summary)
        elif frame_num > packet_num:
            after_packets.append(summary)
        else:
            target_summary = summary

    return {
        "target": {
            "summary": target_summary,
            "details": target_details,
        },
        "before": before_packets,
        "after": after_packets,
    }


async def compare_packets(
    packet_a: int,
    packet_b: int,
) -> Optional[dict]:
    """Compare two packets field by field.

    Args:
        packet_a: First packet frame number
        packet_b: Second packet frame number

    Returns:
        Dict with:
        - packet_a: Summary of first packet
        - packet_b: Summary of second packet
        - common: Fields that are the same
        - differences: Fields that differ with values from each packet
    """
    # Get details for both packets
    details_a = await get_frame_details(packet_a)
    details_b = await get_frame_details(packet_b)

    if not details_a or not details_b:
        return None

    # Extract field values from the protocol tree
    def extract_fields(details: dict) -> dict:
        """Extract key fields from packet details."""
        fields = {}
        tree = details.get("tree", [])

        for node in tree:
            label = node.get("l", "")
            if label:
                # Parse common patterns like "Field: Value"
                if ": " in label:
                    key, value = label.split(": ", 1)
                    fields[key.strip()] = value.strip()
                else:
                    # Use the label as both key and value for flags/markers
                    fields[label] = True

            # Recursively process children
            for child in node.get("n", []):
                child_label = child.get("l", "")
                if child_label and ": " in child_label:
                    key, value = child_label.split(": ", 1)
                    fields[key.strip()] = value.strip()

        return fields

    fields_a = extract_fields(details_a)
    fields_b = extract_fields(details_b)

    # Find common and different fields
    all_keys = set(fields_a.keys()) | set(fields_b.keys())
    common = {}
    differences = {}

    for key in all_keys:
        val_a = fields_a.get(key)
        val_b = fields_b.get(key)

        if val_a == val_b and val_a is not None:
            common[key] = val_a
        else:
            differences[key] = {
                "packet_a": val_a,
                "packet_b": val_b,
            }

    # Get basic summaries
    async def get_summary(num: int) -> dict:
        frames = await get_frames(skip=num - 1, limit=1)
        if frames and len(frames) > 0:
            f = frames[0]
            return {
                "number": f.get("number"),
                "time": f.get("time"),
                "source": f.get("source"),
                "destination": f.get("destination"),
                "protocol": f.get("protocol"),
                "info": f.get("info", "")[:100],
            }
        return {"number": num}

    summary_a = await get_summary(packet_a)
    summary_b = await get_summary(packet_b)

    return {
        "packet_a": summary_a,
        "packet_b": summary_b,
        "common_fields": len(common),
        "different_fields": len(differences),
        "common": common,
        "differences": differences,
    }
