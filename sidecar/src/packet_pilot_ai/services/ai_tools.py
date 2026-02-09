"""Tool schemas and constraints for AI function-calling."""

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
    # === PROTOCOL-AWARE TOOLS ===
    {
        "type": "function",
        "function": {
            "name": "analyze_http_transaction",
            "description": """Analyze an HTTP request/response transaction with key metadata.

RETURNS: Request line, response status, key headers, payload preview (optional), and quick findings.

WHEN TO USE:
- "Summarize this HTTP exchange"
- "What happened in this request?"
- "Analyze HTTP transaction in stream X"

NOTE: Provide exactly one selector: stream_id or request_frame.""",
            "parameters": {
                "type": "object",
                "properties": {
                    "stream_id": {
                        "type": "integer",
                        "description": "TCP stream id containing HTTP traffic"
                    },
                    "request_frame": {
                        "type": "integer",
                        "description": "Request frame number used to resolve tcp.stream"
                    },
                    "include_body_preview": {
                        "type": "boolean",
                        "description": "Whether to include short payload preview",
                        "default": False
                    }
                },
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "analyze_dns_activity",
            "description": """Analyze DNS behavior including query patterns and error rates.

RETURNS: Top queried domains, responder/requester pairs, and DNS error indicators.

WHEN TO USE:
- "Any DNS issues?"
- "What domains were queried?"
- "Look for NXDOMAIN spikes"
""",
            "parameters": {
                "type": "object",
                "properties": {
                    "query_contains": {
                        "type": "string",
                        "description": "Substring to match in queried domain name"
                    },
                    "rr_type": {
                        "type": "string",
                        "enum": ["A", "AAAA", "CNAME", "MX", "TXT", "NS", "PTR", "SRV"],
                        "description": "Restrict to a DNS record type"
                    },
                    "rcode_only": {
                        "type": "boolean",
                        "description": "If true, only include DNS packets with non-zero RCODE",
                        "default": False
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Max DNS packets to inspect (default 50)",
                        "default": 50
                    }
                },
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "analyze_tls_session",
            "description": """Analyze a TLS session for version, alerts, and certificate/SNI hints.

RETURNS: TLS session summary including possible alerts or handshake issues.

WHEN TO USE:
- "Inspect TLS handshake"
- "Any TLS alerts in stream X?"
- "What cert/SNI was used?"
""",
            "parameters": {
                "type": "object",
                "properties": {
                    "stream_id": {
                        "type": "integer",
                        "description": "TCP stream id to inspect"
                    },
                    "include_cert_subjects": {
                        "type": "boolean",
                        "description": "Include certificate subject details when available",
                        "default": True
                    }
                },
                "required": ["stream_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "summarize_protocol_timeline",
            "description": """Summarize protocol activity over time to find bursts and shifts.

RETURNS: Time-bucketed counts by protocol and top spike windows.

WHEN TO USE:
- "What changed over time?"
- "When did DNS/TLS spike?"
- "Give me a traffic timeline"
""",
            "parameters": {
                "type": "object",
                "properties": {
                    "protocols": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Protocol filters to include (default dns,tcp,tls,http)"
                    },
                    "bucket_seconds": {
                        "type": "integer",
                        "description": "Time bucket size in seconds (default 5)",
                        "default": 5
                    },
                    "top_n_events": {
                        "type": "integer",
                        "description": "Number of busiest time windows to report (default 5)",
                        "default": 5
                    }
                },
                "required": []
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
    "analyze_http_transaction": {
        "stream_id": (0, 1000000),
        "request_frame": (1, 100000000),
    },
    "analyze_dns_activity": {"limit": (1, 200)},
    "analyze_tls_session": {"stream_id": (0, 1000000)},
    "summarize_protocol_timeline": {
        "bucket_seconds": (1, 300),
        "top_n_events": (1, 20),
    },
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

TOOL_EXACTLY_ONE_OF: dict[str, tuple[str, ...]] = {
    "analyze_http_transaction": ("stream_id", "request_frame"),
}
