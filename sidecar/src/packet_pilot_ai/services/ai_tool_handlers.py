"""Tool execution handlers for PacketPilot AI agent."""

import json
import re
from collections import Counter, defaultdict
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


def _format_with_json_tail(text: str, payload: dict[str, Any]) -> str:
    return f"{text}\n\n[TOOL_JSON]\n{json.dumps(payload, ensure_ascii=True)}"


def _safe_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _extract_domain_from_dns_info(info: str) -> str | None:
    patterns = [
        r"\b(?:A|AAAA|CNAME|MX|TXT|NS|PTR|SRV)\s+([a-zA-Z0-9._-]+\.[a-zA-Z]{2,})\b",
        r"\bquery(?:\s+response)?\s+[^\s]+\s+[A-Z]+\s+([a-zA-Z0-9._-]+\.[a-zA-Z]{2,})\b",
    ]
    for pattern in patterns:
        match = re.search(pattern, info, re.IGNORECASE)
        if match:
            return match.group(1).lower()
    return None


def _extract_stream_id_from_tree(tree: list[dict[str, Any]]) -> int | None:
    for node in tree:
        label = str(node.get("l", ""))
        for pattern in (
            r"\btcp\.stream(?:\s*[:=]\s*|\s+)(\d+)\b",
            r"\bstream(?:\s+index)?\s*[:=]\s*(\d+)\b",
        ):
            match = re.search(pattern, label, re.IGNORECASE)
            if match:
                return int(match.group(1))
    return None


def _extract_http_headers(text: str) -> dict[str, str]:
    headers: dict[str, str] = {}
    if not text:
        return headers
    for line in text.splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        key = key.strip()
        if key and key.lower() in {"host", "user-agent", "content-type", "server"}:
            headers[key.lower()] = value.strip()
    return headers


def _extract_http_body_preview(text: str, limit: int = 280) -> str:
    if not text:
        return ""
    for sep in ("\r\n\r\n", "\n\n"):
        if sep in text:
            body = text.split(sep, 1)[1].strip()
            if body:
                return body[:limit]
    return ""


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


async def _execute_analyze_http_transaction_tool(arguments: dict[str, Any], runtime: ToolRuntime) -> str:
    stream_id = arguments.get("stream_id")
    request_frame = arguments.get("request_frame")
    include_body_preview = arguments.get("include_body_preview", False)
    resolved_from_frame = False

    if stream_id is None:
        frame_details = await runtime.get_frame_details(request_frame)
        if not frame_details:
            return f"Error resolving stream from request frame #{request_frame}"
        stream_id = _extract_stream_id_from_tree(frame_details.get("tree", []))
        if stream_id is None:
            return f"Could not determine tcp.stream from frame #{request_frame}"
        resolved_from_frame = True

    stream_result = await runtime.get_stream(stream_id=stream_id, protocol="HTTP", format="ascii")
    protocol_used = "HTTP"
    if not stream_result or not stream_result.get("combined_text"):
        stream_result = await runtime.get_stream(stream_id=stream_id, protocol="TCP", format="ascii")
        protocol_used = "TCP"
    if not stream_result:
        return f"Error fetching stream {stream_id}"

    combined_text = stream_result.get("combined_text", "") or ""
    request_match = re.search(
        r"^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|TRACE|CONNECT)\s+(\S+)\s+(HTTP/\d(?:\.\d)?)",
        combined_text,
        re.MULTILINE,
    )
    response_match = re.search(
        r"^(HTTP/\d(?:\.\d)?)\s+(\d{3})(?:\s+([^\r\n]+))?",
        combined_text,
        re.MULTILINE,
    )
    headers = _extract_http_headers(combined_text)
    body_preview = _extract_http_body_preview(combined_text) if include_body_preview else ""

    method = request_match.group(1) if request_match else "unknown"
    path = request_match.group(2) if request_match else "unknown"
    status_code = int(response_match.group(2)) if response_match else None
    status_text = response_match.group(3).strip() if response_match and response_match.group(3) else ""

    findings = [
        f"HTTP transaction for stream {stream_id} (stream decode via {protocol_used})",
        f"Request: {method} {path}",
        (
            f"Response: {status_code} {status_text}".strip()
            if status_code is not None
            else "Response: not identified in stream payload"
        ),
        f"Host: {headers.get('host', 'unknown')}",
    ]
    if "content-type" in headers:
        findings.append(f"Content-Type: {headers['content-type']}")
    if "server" in headers:
        findings.append(f"Server: {headers['server']}")
    if include_body_preview:
        findings.append(f"Body preview: {body_preview[:120] if body_preview else 'none'}")

    output = "HTTP TRANSACTION ANALYSIS:\n"
    for finding in findings:
        output += f"- {finding}\n"

    payload = {
        "tool": "analyze_http_transaction",
        "ok": True,
        "summary": {
            "stream_id": stream_id,
            "request_frame": request_frame,
            "resolved_from_frame": resolved_from_frame,
            "protocol_used": protocol_used,
            "method": method,
            "path": path,
            "status_code": status_code,
            "status_text": status_text,
            "host": headers.get("host"),
            "user_agent": headers.get("user-agent"),
            "content_type": headers.get("content-type"),
            "server": headers.get("server"),
            "body_preview": body_preview if include_body_preview else "",
        },
        "evidence": {
            "filters": [f"tcp.stream == {stream_id} && http"],
            "sample_frames": [request_frame] if request_frame else [],
        },
    }
    return _format_with_json_tail(output.rstrip(), payload)


async def _execute_analyze_dns_activity_tool(arguments: dict[str, Any], runtime: ToolRuntime) -> str:
    query_contains = arguments.get("query_contains")
    rr_type = arguments.get("rr_type")
    rcode_only = arguments.get("rcode_only", False)
    limit = arguments.get("limit", 50)

    filter_parts = ["dns"]
    if query_contains:
        escaped = query_contains.replace('"', '\\"')
        filter_parts.append(f'dns.qry.name contains "{escaped}"')
    if rr_type:
        filter_parts.append(f"dns.qry.type == {rr_type}")
    if rcode_only:
        filter_parts.append("dns.flags.rcode != 0")
    filter_str = " && ".join(filter_parts)

    result = await runtime.search_packets(filter_str=filter_str, limit=limit)
    if not result:
        return "Error executing DNS analysis"

    frames = result.get("frames", [])
    total_matching = result.get("total_matching", len(frames))
    domain_counts: Counter[str] = Counter()
    source_counts: Counter[str] = Counter()
    destination_counts: Counter[str] = Counter()
    nxdomain_count = 0
    servfail_count = 0

    for frame in frames:
        info = str(frame.get("info", ""))
        domain = _extract_domain_from_dns_info(info)
        if domain:
            domain_counts[domain] += 1
        source = str(frame.get("source", "?"))
        destination = str(frame.get("destination", "?"))
        source_counts[source] += 1
        destination_counts[destination] += 1

        info_lower = info.lower()
        if "nxdomain" in info_lower or "no such name" in info_lower:
            nxdomain_count += 1
        if "servfail" in info_lower:
            servfail_count += 1

    sample_size = max(1, len(frames))
    suspicious: list[str] = []
    if nxdomain_count / sample_size > 0.2:
        suspicious.append("Elevated NXDOMAIN rate in sampled DNS packets")
    if servfail_count > 0:
        suspicious.append("SERVFAIL responses observed")

    output = "DNS ACTIVITY ANALYSIS:\n"
    output += f"- Filter used: {filter_str}\n"
    output += f"- Matched packets: {total_matching}\n"
    output += f"- Top queried domains: {', '.join(d for d, _ in domain_counts.most_common(5)) or 'none'}\n"
    output += f"- Top clients: {', '.join(f'{host} ({count})' for host, count in source_counts.most_common(3)) or 'none'}\n"
    output += f"- Top resolvers: {', '.join(f'{host} ({count})' for host, count in destination_counts.most_common(3)) or 'none'}\n"
    output += f"- NXDOMAIN count (sample): {nxdomain_count}\n"
    output += f"- SERVFAIL count (sample): {servfail_count}\n"
    output += f"- Suspicious patterns: {', '.join(suspicious) if suspicious else 'none'}"

    payload = {
        "tool": "analyze_dns_activity",
        "ok": True,
        "summary": {
            "filter": filter_str,
            "matched_packets": total_matching,
            "top_domains": [{"domain": d, "count": c} for d, c in domain_counts.most_common(5)],
            "top_clients": [{"host": h, "count": c} for h, c in source_counts.most_common(3)],
            "top_resolvers": [{"host": h, "count": c} for h, c in destination_counts.most_common(3)],
            "nxdomain_count_sample": nxdomain_count,
            "servfail_count_sample": servfail_count,
            "suspicious_patterns": suspicious,
        },
        "evidence": {
            "filters": [filter_str],
            "sample_frames": [frame.get("number") for frame in frames[:10]],
        },
    }
    return _format_with_json_tail(output, payload)


async def _execute_analyze_tls_session_tool(arguments: dict[str, Any], runtime: ToolRuntime) -> str:
    stream_id = arguments["stream_id"]
    include_cert_subjects = arguments.get("include_cert_subjects", True)

    session_filter = f"tcp.stream == {stream_id} && tls"
    alert_filter = f"tcp.stream == {stream_id} && tls.alert_message"
    session_result = await runtime.search_packets(filter_str=session_filter, limit=100)
    if not session_result:
        return f"Error analyzing TLS session for stream {stream_id}"

    alert_result = await runtime.search_packets(filter_str=alert_filter, limit=20)
    session_frames = session_result.get("frames", [])
    alert_frames = (alert_result or {}).get("frames", [])
    alert_count = (alert_result or {}).get("total_matching", len(alert_frames))

    tls_version = "unknown"
    cipher = "unknown"
    sni = "unknown"
    cert_subjects: list[str] = []

    if session_frames:
        info_value = str(session_frames[0].get("info", ""))
        version_match = re.search(r"(TLSv?\d(?:\.\d)?)", info_value, re.IGNORECASE)
        if version_match:
            tls_version = version_match.group(1)

        first_frame_num = session_frames[0].get("number")
        if first_frame_num:
            details = await runtime.get_frame_details(first_frame_num)
            for node in (details or {}).get("tree", []):
                label = str(node.get("l", ""))
                lower = label.lower()
                if "server name" in lower and sni == "unknown":
                    sni = label.split(":", 1)[-1].strip()
                if "cipher suite" in lower and cipher == "unknown":
                    cipher = label.split(":", 1)[-1].strip()
                if "tlsv" in lower and tls_version == "unknown":
                    tls_version = label.strip()
                if include_cert_subjects and "subject" in lower and "certificate" in lower:
                    cert_subjects.append(label.split(":", 1)[-1].strip())

    output = "TLS SESSION ANALYSIS:\n"
    output += f"- Stream: {stream_id}\n"
    output += f"- TLS packets (sampled): {len(session_frames)} of {session_result.get('total_matching', len(session_frames))}\n"
    output += f"- TLS alerts: {alert_count}\n"
    output += f"- TLS version hint: {tls_version}\n"
    output += f"- Cipher hint: {cipher}\n"
    output += f"- SNI hint: {sni}\n"
    if include_cert_subjects:
        output += f"- Certificate subjects: {', '.join(cert_subjects[:3]) if cert_subjects else 'none'}\n"
    if alert_frames:
        output += "- Alert samples:\n"
        for frame in alert_frames[:3]:
            output += f"  - #{frame.get('number', '?')}: {frame.get('info', '')}\n"

    payload = {
        "tool": "analyze_tls_session",
        "ok": True,
        "summary": {
            "stream_id": stream_id,
            "tls_packet_count_sample": len(session_frames),
            "tls_packet_total": session_result.get("total_matching", len(session_frames)),
            "alert_count": alert_count,
            "tls_version": tls_version,
            "cipher": cipher,
            "sni": sni,
            "cert_subjects": cert_subjects[:5] if include_cert_subjects else [],
        },
        "evidence": {
            "filters": [session_filter, alert_filter],
            "sample_frames": [frame.get("number") for frame in session_frames[:10]],
        },
    }
    return _format_with_json_tail(output.rstrip(), payload)


async def _execute_summarize_protocol_timeline_tool(arguments: dict[str, Any], runtime: ToolRuntime) -> str:
    protocols = arguments.get("protocols") or ["dns", "tcp", "tls", "http"]
    bucket_seconds = arguments.get("bucket_seconds", 5)
    top_n_events = arguments.get("top_n_events", 5)

    bucket_protocol_counts: dict[int, Counter[str]] = defaultdict(Counter)
    protocol_totals: Counter[str] = Counter()
    filter_list: list[str] = []

    for protocol in protocols:
        filter_str = str(protocol).strip().lower()
        if not filter_str:
            continue
        filter_list.append(filter_str)
        result = await runtime.search_packets(filter_str=filter_str, limit=200)
        frames = (result or {}).get("frames", [])
        protocol_totals[filter_str] += (result or {}).get("total_matching", len(frames))
        for frame in frames:
            timestamp = _safe_float(frame.get("time"))
            if timestamp is None:
                continue
            bucket = int(timestamp // bucket_seconds)
            bucket_protocol_counts[bucket][filter_str] += 1

    if not protocol_totals:
        return _format_with_json_tail(
            "PROTOCOL TIMELINE SUMMARY:\n- No protocol data available",
            {
                "tool": "summarize_protocol_timeline",
                "ok": True,
                "summary": {"bucket_seconds": bucket_seconds, "protocol_totals": {}, "spikes": []},
                "evidence": {"filters": filter_list, "sample_frames": []},
            },
        )

    bucket_totals = {bucket: sum(counter.values()) for bucket, counter in bucket_protocol_counts.items()}
    top_buckets = sorted(bucket_totals.items(), key=lambda item: (-item[1], item[0]))[:top_n_events]

    output = "PROTOCOL TIMELINE SUMMARY:\n"
    output += f"- Bucket size: {bucket_seconds}s\n"
    output += f"- Protocol totals: {', '.join(f'{proto}={count}' for proto, count in protocol_totals.items())}\n"
    if top_buckets:
        output += "- Peak windows:\n"
        for bucket, count in top_buckets:
            start = bucket * bucket_seconds
            end = start + bucket_seconds
            mix = bucket_protocol_counts[bucket]
            mix_text = ", ".join(f"{proto}:{mix[proto]}" for proto in sorted(mix))
            output += f"  - {start:.0f}s-{end:.0f}s: {count} packets ({mix_text})\n"
    else:
        output += "- Peak windows: none\n"

    spikes = []
    for bucket, count in top_buckets:
        start = bucket * bucket_seconds
        end = start + bucket_seconds
        mix = bucket_protocol_counts[bucket]
        spikes.append(
            {
                "window_start_s": start,
                "window_end_s": end,
                "packet_count": count,
                "protocol_mix": dict(mix),
            }
        )

    payload = {
        "tool": "summarize_protocol_timeline",
        "ok": True,
        "summary": {
            "bucket_seconds": bucket_seconds,
            "protocol_totals": dict(protocol_totals),
            "spikes": spikes,
        },
        "evidence": {
            "filters": filter_list,
            "sample_frames": [],
        },
    }
    return _format_with_json_tail(output.rstrip(), payload)


def build_tool_executors(runtime: ToolRuntime) -> dict[str, ToolExecutor]:
    """Build tool dispatch map for the current runtime dependencies."""

    return {
        "search_packets": lambda arguments: _execute_search_packets_tool(arguments, runtime),
        "get_stream": lambda arguments: _execute_get_stream_tool(arguments, runtime),
        "get_packet_details": lambda arguments: _execute_get_packet_details_tool(arguments, runtime),
        "analyze_http_transaction": lambda arguments: _execute_analyze_http_transaction_tool(arguments, runtime),
        "analyze_dns_activity": lambda arguments: _execute_analyze_dns_activity_tool(arguments, runtime),
        "analyze_tls_session": lambda arguments: _execute_analyze_tls_session_tool(arguments, runtime),
        "summarize_protocol_timeline": lambda arguments: _execute_summarize_protocol_timeline_tool(arguments, runtime),
        "find_anomalies": lambda arguments: _execute_find_anomalies_tool(arguments, runtime),
        "get_packet_context": lambda arguments: _execute_get_packet_context_tool(arguments, runtime),
        "compare_packets": lambda arguments: _execute_compare_packets_tool(arguments, runtime),
        "get_capture_overview": lambda arguments: _execute_get_capture_overview_tool(arguments, runtime),
        "get_conversations": lambda arguments: _execute_get_conversations_tool(arguments, runtime),
        "get_endpoints": lambda arguments: _execute_get_endpoints_tool(arguments, runtime),
    }
