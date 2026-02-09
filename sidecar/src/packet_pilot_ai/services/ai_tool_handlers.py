"""Tool execution handlers for PacketPilot AI agent."""

from dataclasses import dataclass
from typing import Any, Awaitable, Callable

ToolExecutor = Callable[[dict[str, Any]], Awaitable[str]]
BridgeMethod = Callable[..., Awaitable[Any]]


@dataclass(frozen=True)
class ToolRuntime:
    """Runtime dependencies used by tool handlers."""

    search_packets: BridgeMethod
    get_stream: BridgeMethod
    get_capture_stats: BridgeMethod
    get_frame_details: BridgeMethod
    find_anomalies: BridgeMethod
    get_packet_context: BridgeMethod
    compare_packets: BridgeMethod


async def _execute_search_packets_tool(arguments: dict[str, Any], runtime: ToolRuntime) -> str:
    result = await runtime.search_packets(
        filter_str=arguments["filter"],
        limit=arguments.get("limit", 50),
    )
    if result:
        frames = result.get("frames", [])
        total = result.get("total_matching", 0)
        if frames:
            summary = f"Found {total} packets matching '{arguments['filter']}'. Showing first {len(frames)}:\n"
            for frame in frames[:20]:
                summary += (
                    f"  #{frame.get('number', '?')}: {frame.get('protocol', '?')} "
                    f"{frame.get('source', '?')} -> {frame.get('destination', '?')} "
                    f"| {frame.get('info', '')[:80]}\n"
                )
            return summary
        return f"No packets found matching '{arguments['filter']}'"
    return "Error executing search"


async def _execute_get_stream_tool(arguments: dict[str, Any], runtime: ToolRuntime) -> str:
    result = await runtime.get_stream(
        stream_id=arguments["stream_id"],
        protocol=arguments.get("protocol", "TCP"),
        format="ascii",
    )
    if result:
        server = result.get("server", {})
        client = result.get("client", {})
        combined = result.get("combined_text", "")
        if len(combined) > 4000:
            combined = combined[:4000] + "\n... [truncated]"
        return (
            f"Stream {arguments['stream_id']} ({arguments.get('protocol', 'TCP')}):\n"
            f"Server: {server.get('host', '?')}:{server.get('port', '?')}\n"
            f"Client: {client.get('host', '?')}:{client.get('port', '?')}\n\n"
            f"{combined}"
        )
    return "Error fetching stream or stream not found"


async def _execute_get_packet_details_tool(arguments: dict[str, Any], runtime: ToolRuntime) -> str:
    result = await runtime.get_frame_details(arguments["packet_num"])
    if result:
        tree = result.get("tree", [])
        output = f"Packet #{arguments['packet_num']} details:\n"
        for node in tree[:10]:
            label = node.get("l", "")
            if label:
                output += f"  - {label}\n"
        return output
    return "Error fetching packet details"


async def _execute_find_anomalies_tool(arguments: dict[str, Any], runtime: ToolRuntime) -> str:
    result = await runtime.find_anomalies(
        types=arguments.get("types"),
        limit_per_type=10,
    )
    summary = result.get("summary", {})
    anomalies = result.get("anomalies", [])

    if summary.get("total_anomalies", 0) == 0:
        return "No anomalies detected in the capture. The network traffic appears healthy."

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
            for packet in anomaly["sample_packets"][:3]:
                output += (
                    f"     #{packet['number']}: {packet['source']} -> {packet['destination']} "
                    f"| {packet['info']}\n"
                )
        output += "\n"

    return output


async def _execute_get_packet_context_tool(arguments: dict[str, Any], runtime: ToolRuntime) -> str:
    result = await runtime.get_packet_context(
        packet_num=arguments["packet_num"],
        before=arguments.get("before", 5),
        after=arguments.get("after", 5),
    )
    if not result:
        return f"Error fetching context for packet #{arguments['packet_num']}"

    output = f"Context around packet #{arguments['packet_num']}:\n\n"

    before_packets = result.get("before", [])
    if before_packets:
        output += "BEFORE:\n"
        for packet in before_packets:
            output += (
                f"  #{packet['number']}: {packet['protocol']} {packet['source']} -> "
                f"{packet['destination']} | {packet['info']}\n"
            )
        output += "\n"

    target = result.get("target", {})
    target_summary = target.get("summary", {})
    output += f">>> TARGET #{target_summary.get('number', '?')}:\n"
    output += (
        f"    {target_summary.get('protocol', '?')} {target_summary.get('source', '?')} -> "
        f"{target_summary.get('destination', '?')}\n"
    )
    output += f"    {target_summary.get('info', '')}\n"

    details = target.get("details", {})
    tree = details.get("tree", [])
    if tree:
        output += "    Details:\n"
        for node in tree[:6]:
            label = node.get("l", "")
            if label:
                output += f"      - {label}\n"
    output += "\n"

    after_packets = result.get("after", [])
    if after_packets:
        output += "AFTER:\n"
        for packet in after_packets:
            output += (
                f"  #{packet['number']}: {packet['protocol']} {packet['source']} -> "
                f"{packet['destination']} | {packet['info']}\n"
            )

    return output


async def _execute_compare_packets_tool(arguments: dict[str, Any], runtime: ToolRuntime) -> str:
    result = await runtime.compare_packets(
        packet_a=arguments["packet_a"],
        packet_b=arguments["packet_b"],
    )
    if not result:
        return f"Error comparing packets #{arguments['packet_a']} and #{arguments['packet_b']}"

    packet_a = result.get("packet_a", {})
    packet_b = result.get("packet_b", {})

    output = f"Comparison of packet #{arguments['packet_a']} vs #{arguments['packet_b']}:\n\n"

    output += f"Packet A (#{packet_a.get('number', '?')}):\n"
    output += f"  {packet_a.get('protocol', '?')} {packet_a.get('source', '?')} -> {packet_a.get('destination', '?')}\n"
    output += f"  {packet_a.get('info', '')}\n\n"

    output += f"Packet B (#{packet_b.get('number', '?')}):\n"
    output += f"  {packet_b.get('protocol', '?')} {packet_b.get('source', '?')} -> {packet_b.get('destination', '?')}\n"
    output += f"  {packet_b.get('info', '')}\n\n"

    output += f"Common fields: {result.get('common_fields', 0)}\n"
    output += f"Different fields: {result.get('different_fields', 0)}\n\n"

    differences = result.get("differences", {})
    if differences:
        output += "KEY DIFFERENCES:\n"
        important_keys = ["Sequence Number", "Acknowledgment Number", "Time", "Length", "Flags"]
        shown = 0
        for key in important_keys:
            if key in differences and shown < 10:
                diff = differences[key]
                output += f"  {key}:\n"
                output += f"    A: {diff.get('packet_a', 'N/A')}\n"
                output += f"    B: {diff.get('packet_b', 'N/A')}\n"
                shown += 1

        for key, diff in list(differences.items())[:15 - shown]:
            if key not in important_keys:
                output += f"  {key}:\n"
                output += f"    A: {diff.get('packet_a', 'N/A')}\n"
                output += f"    B: {diff.get('packet_b', 'N/A')}\n"

    return output


async def _execute_get_capture_overview_tool(_arguments: dict[str, Any], runtime: ToolRuntime) -> str:
    result = await runtime.get_capture_stats()
    if result:
        summary = result.get("summary", {})
        hierarchy = result.get("protocol_hierarchy", [])

        output = "CAPTURE OVERVIEW:\n"
        output += f"  Total frames: {summary.get('total_frames', 0)}\n"
        if summary.get("duration"):
            output += f"  Duration: {summary.get('duration'):.2f} seconds\n"
        output += f"  TCP conversations: {summary.get('tcp_conversation_count', 0)}\n"
        output += f"  UDP conversations: {summary.get('udp_conversation_count', 0)}\n"
        output += f"  Endpoints: {summary.get('endpoint_count', 0)}\n\n"

        output += "PROTOCOL HIERARCHY:\n"
        for proto in hierarchy[:10]:
            frames = proto.get("frames", 0)
            bytes_count = proto.get("bytes", 0)
            output += f"  - {proto.get('protocol', '?')}: {frames} packets, {bytes_count} bytes\n"
            for child in proto.get("children", [])[:3]:
                output += f"    - {child.get('protocol', '?')}: {child.get('frames', 0)} packets\n"

        return output
    return "Error fetching capture overview"


async def _execute_get_conversations_tool(arguments: dict[str, Any], runtime: ToolRuntime) -> str:
    result = await runtime.get_capture_stats()
    if result:
        protocol = arguments.get("protocol", "both")
        limit = arguments.get("limit", 20)

        output = "NETWORK CONVERSATIONS:\n\n"

        if protocol in ["tcp", "both"]:
            tcp_conversations = result.get("tcp_conversations", [])[:limit]
            if tcp_conversations:
                output += f"TCP CONVERSATIONS ({len(tcp_conversations)} shown):\n"
                for conversation in tcp_conversations:
                    total_bytes = conversation.get("rx_bytes", 0) + conversation.get("tx_bytes", 0)
                    total_frames = conversation.get("rx_frames", 0) + conversation.get("tx_frames", 0)
                    src = f"{conversation.get('src_addr', '?')}:{conversation.get('src_port', '?')}"
                    dst = f"{conversation.get('dst_addr', '?')}:{conversation.get('dst_port', '?')}"
                    output += f"  {src} <-> {dst}\n"
                    output += f"    {total_frames} packets, {total_bytes} bytes\n"
                output += "\n"

        if protocol in ["udp", "both"]:
            udp_conversations = result.get("udp_conversations", [])[:limit]
            if udp_conversations:
                output += f"UDP CONVERSATIONS ({len(udp_conversations)} shown):\n"
                for conversation in udp_conversations:
                    total_bytes = conversation.get("rx_bytes", 0) + conversation.get("tx_bytes", 0)
                    total_frames = conversation.get("rx_frames", 0) + conversation.get("tx_frames", 0)
                    src = f"{conversation.get('src_addr', '?')}:{conversation.get('src_port', '?')}"
                    dst = f"{conversation.get('dst_addr', '?')}:{conversation.get('dst_port', '?')}"
                    output += f"  {src} <-> {dst}\n"
                    output += f"    {total_frames} packets, {total_bytes} bytes\n"

        if output.strip() == "NETWORK CONVERSATIONS:":
            return "No conversations found"
        return output
    return "Error fetching conversations"


async def _execute_get_endpoints_tool(arguments: dict[str, Any], runtime: ToolRuntime) -> str:
    result = await runtime.get_capture_stats()
    if result:
        limit = arguments.get("limit", 20)
        endpoints = result.get("endpoints", [])[:limit]

        if endpoints:
            sorted_endpoints = sorted(
                endpoints,
                key=lambda endpoint: endpoint.get("rx_bytes", 0) + endpoint.get("tx_bytes", 0),
                reverse=True,
            )
            output = f"TOP ENDPOINTS ({len(sorted_endpoints)} shown):\n\n"
            for endpoint in sorted_endpoints:
                host = endpoint.get("host", "?")
                port = endpoint.get("port")
                addr = f"{host}:{port}" if port else host
                output += f"  {addr}:\n"
                output += f"    TX: {endpoint.get('tx_frames', 0)} pkts, {endpoint.get('tx_bytes', 0)} bytes\n"
                output += f"    RX: {endpoint.get('rx_frames', 0)} pkts, {endpoint.get('rx_bytes', 0)} bytes\n"
            return output
        return "No endpoints found"
    return "Error fetching endpoints"


def build_tool_executors(runtime: ToolRuntime) -> dict[str, ToolExecutor]:
    """Build tool dispatch map for the current runtime dependencies."""

    return {
        "search_packets": lambda arguments: _execute_search_packets_tool(arguments, runtime),
        "get_stream": lambda arguments: _execute_get_stream_tool(arguments, runtime),
        "get_packet_details": lambda arguments: _execute_get_packet_details_tool(arguments, runtime),
        "find_anomalies": lambda arguments: _execute_find_anomalies_tool(arguments, runtime),
        "get_packet_context": lambda arguments: _execute_get_packet_context_tool(arguments, runtime),
        "compare_packets": lambda arguments: _execute_compare_packets_tool(arguments, runtime),
        "get_capture_overview": lambda arguments: _execute_get_capture_overview_tool(arguments, runtime),
        "get_conversations": lambda arguments: _execute_get_conversations_tool(arguments, runtime),
        "get_endpoints": lambda arguments: _execute_get_endpoints_tool(arguments, runtime),
    }
