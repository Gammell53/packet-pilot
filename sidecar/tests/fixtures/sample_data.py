"""Sample packet and capture data for testing."""


# ============================================================================
# Sample Packet Data
# ============================================================================

DNS_QUERY_FRAME = {
    "number": 1,
    "time": "0.000000",
    "source": "192.168.1.100",
    "destination": "8.8.8.8",
    "protocol": "DNS",
    "length": "74",
    "info": "Standard query 0x1234 A example.com",
}

DNS_RESPONSE_FRAME = {
    "number": 2,
    "time": "0.025000",
    "source": "8.8.8.8",
    "destination": "192.168.1.100",
    "protocol": "DNS",
    "length": "90",
    "info": "Standard query response 0x1234 A 93.184.216.34",
}

TCP_SYN_FRAME = {
    "number": 3,
    "time": "0.026000",
    "source": "192.168.1.100",
    "destination": "93.184.216.34",
    "protocol": "TCP",
    "length": "66",
    "info": "54321 → 443 [SYN] Seq=0 Win=65535 Len=0",
}

HTTP_REQUEST_FRAME = {
    "number": 10,
    "time": "0.050000",
    "source": "192.168.1.100",
    "destination": "93.184.216.34",
    "protocol": "HTTP",
    "length": "200",
    "info": "GET / HTTP/1.1",
}

HTTP_RESPONSE_FRAME = {
    "number": 15,
    "time": "0.100000",
    "source": "93.184.216.34",
    "destination": "192.168.1.100",
    "protocol": "HTTP",
    "length": "1500",
    "info": "HTTP/1.1 200 OK (text/html)",
}

TLS_HANDSHAKE_FRAME = {
    "number": 5,
    "time": "0.030000",
    "source": "192.168.1.100",
    "destination": "93.184.216.34",
    "protocol": "TLSv1.2",
    "length": "517",
    "info": "Client Hello",
}


# ============================================================================
# Sample Frame Collections
# ============================================================================

DNS_TRAFFIC_FRAMES = [DNS_QUERY_FRAME, DNS_RESPONSE_FRAME]

HTTP_SESSION_FRAMES = [
    TCP_SYN_FRAME,
    {"number": 4, "time": "0.027000", "source": "93.184.216.34", "destination": "192.168.1.100", "protocol": "TCP", "length": "66", "info": "443 → 54321 [SYN, ACK] Seq=0 Ack=1"},
    {"number": 5, "time": "0.028000", "source": "192.168.1.100", "destination": "93.184.216.34", "protocol": "TCP", "length": "54", "info": "54321 → 443 [ACK] Seq=1 Ack=1"},
    HTTP_REQUEST_FRAME,
    HTTP_RESPONSE_FRAME,
]

MIXED_TRAFFIC_FRAMES = DNS_TRAFFIC_FRAMES + HTTP_SESSION_FRAMES


# ============================================================================
# Sample Stream Data
# ============================================================================

HTTP_STREAM = {
    "server": {"host": "93.184.216.34", "port": "80"},
    "client": {"host": "192.168.1.100", "port": "54321"},
    "server_bytes": 1500,
    "client_bytes": 200,
    "segments": [
        {
            "direction": "client_to_server",
            "size": 200,
            "data": "GET / HTTP/1.1\r\nHost: example.com\r\nUser-Agent: Mozilla/5.0\r\nAccept: */*\r\n\r\n"
        },
        {
            "direction": "server_to_client",
            "size": 1500,
            "data": "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 1256\r\n\r\n<!DOCTYPE html><html><head><title>Example Domain</title></head><body><h1>Example Domain</h1></body></html>"
        },
    ],
    "combined_text": "[client_to_server]\nGET / HTTP/1.1\r\nHost: example.com\r\nUser-Agent: Mozilla/5.0\r\nAccept: */*\r\n\r\n\n\n[server_to_client]\nHTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 1256\r\n\r\n<!DOCTYPE html><html><head><title>Example Domain</title></head><body><h1>Example Domain</h1></body></html>",
}

EMPTY_STREAM = {
    "server": {"host": "", "port": ""},
    "client": {"host": "", "port": ""},
    "server_bytes": 0,
    "client_bytes": 0,
    "segments": [],
    "combined_text": None,
}


# ============================================================================
# Sample Capture Stats
# ============================================================================

BASIC_CAPTURE_STATS = {
    "summary": {
        "total_frames": 100,
        "duration": 2.5,
        "protocol_count": 5,
        "tcp_conversation_count": 3,
        "udp_conversation_count": 2,
        "endpoint_count": 10,
    },
    "protocol_hierarchy": [
        {
            "protocol": "Frame",
            "frames": 100,
            "bytes": 50000,
            "children": [
                {
                    "protocol": "Ethernet",
                    "frames": 100,
                    "bytes": 48600,
                    "children": [
                        {"protocol": "IPv4", "frames": 100, "bytes": 47200, "children": []},
                    ],
                },
            ],
        },
    ],
    "tcp_conversations": [
        {
            "src_addr": "192.168.1.100",
            "dst_addr": "93.184.216.34",
            "src_port": "54321",
            "dst_port": "80",
            "rx_frames": 25,
            "rx_bytes": 12500,
            "tx_frames": 20,
            "tx_bytes": 2500,
            "filter": "tcp.stream eq 0",
        },
    ],
    "udp_conversations": [
        {
            "src_addr": "192.168.1.100",
            "dst_addr": "8.8.8.8",
            "src_port": "12345",
            "dst_port": "53",
            "rx_frames": 5,
            "rx_bytes": 500,
            "tx_frames": 5,
            "tx_bytes": 400,
            "filter": None,
        },
    ],
    "endpoints": [
        {"host": "192.168.1.100", "port": None, "rx_frames": 50, "rx_bytes": 25000, "tx_frames": 50, "tx_bytes": 25000},
        {"host": "8.8.8.8", "port": "53", "rx_frames": 5, "rx_bytes": 500, "tx_frames": 5, "tx_bytes": 400},
    ],
}

LARGE_CAPTURE_STATS = {
    "summary": {
        "total_frames": 1000000,
        "duration": 3600.0,
        "protocol_count": 50,
        "tcp_conversation_count": 500,
        "udp_conversation_count": 200,
        "endpoint_count": 1000,
    },
    "protocol_hierarchy": [],
    "tcp_conversations": [],
    "udp_conversations": [],
    "endpoints": [],
}


# ============================================================================
# Sample Packet Details (Protocol Trees)
# ============================================================================

DNS_PACKET_DETAILS = {
    "tree": [
        {"l": "Frame 1: 74 bytes on wire (592 bits), 74 bytes captured (592 bits)"},
        {"l": "Ethernet II, Src: 00:11:22:33:44:55, Dst: 66:77:88:99:aa:bb"},
        {"l": "Internet Protocol Version 4, Src: 192.168.1.100, Dst: 8.8.8.8"},
        {"l": "User Datagram Protocol, Src Port: 12345, Dst Port: 53"},
        {"l": "Domain Name System (query)"},
        {"l": "    Transaction ID: 0x1234"},
        {"l": "    Queries: example.com: type A, class IN"},
    ],
    "bytes": "AAAAAAAAAAAAAAAA",  # Placeholder base64
}

HTTP_PACKET_DETAILS = {
    "tree": [
        {"l": "Frame 10: 200 bytes on wire (1600 bits), 200 bytes captured (1600 bits)"},
        {"l": "Ethernet II, Src: 00:11:22:33:44:55, Dst: 66:77:88:99:aa:bb"},
        {"l": "Internet Protocol Version 4, Src: 192.168.1.100, Dst: 93.184.216.34"},
        {"l": "Transmission Control Protocol, Src Port: 54321, Dst Port: 80"},
        {"l": "Hypertext Transfer Protocol"},
        {"l": "    GET / HTTP/1.1\\r\\n"},
        {"l": "    Host: example.com\\r\\n"},
        {"l": "    User-Agent: Mozilla/5.0\\r\\n"},
    ],
    "bytes": "BBBBBBBBBBBBBBBB",  # Placeholder base64
}
