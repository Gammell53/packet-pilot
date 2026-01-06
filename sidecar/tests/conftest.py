"""Shared test fixtures for PacketPilot AI tests."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from typing import Any
import json

# Import the modules we'll be testing
import sys
from pathlib import Path

# Add src to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))


# ============================================================================
# Mock Data Fixtures
# ============================================================================

@pytest.fixture
def sample_frames():
    """Sample frame data as returned by Rust bridge."""
    return [
        {
            "number": 1,
            "time": "0.000000",
            "source": "192.168.1.100",
            "destination": "8.8.8.8",
            "protocol": "DNS",
            "length": "74",
            "info": "Standard query 0x1234 A example.com",
        },
        {
            "number": 2,
            "time": "0.001234",
            "source": "8.8.8.8",
            "destination": "192.168.1.100",
            "protocol": "DNS",
            "length": "90",
            "info": "Standard query response 0x1234 A 93.184.216.34",
        },
        {
            "number": 3,
            "time": "0.002000",
            "source": "192.168.1.100",
            "destination": "93.184.216.34",
            "protocol": "TCP",
            "length": "66",
            "info": "54321 → 443 [SYN] Seq=0 Win=65535 Len=0",
        },
    ]


@pytest.fixture
def sample_stream_data():
    """Sample stream data as returned by Rust bridge."""
    return {
        "server": {"host": "93.184.216.34", "port": "443"},
        "client": {"host": "192.168.1.100", "port": "54321"},
        "server_bytes": 1234,
        "client_bytes": 567,
        "segments": [
            {"direction": "client_to_server", "size": 200, "data": "GET / HTTP/1.1\r\nHost: example.com\r\n\r\n"},
            {"direction": "server_to_client", "size": 500, "data": "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n<html>...</html>"},
        ],
        "combined_text": "[client_to_server]\nGET / HTTP/1.1\r\nHost: example.com\r\n\r\n\n\n[server_to_client]\nHTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n<html>...</html>",
    }


@pytest.fixture
def sample_capture_stats():
    """Sample capture stats as returned by Rust bridge."""
    return {
        "summary": {
            "total_frames": 1000,
            "duration": 5.5,
            "protocol_count": 15,
            "tcp_conversation_count": 10,
            "udp_conversation_count": 5,
            "endpoint_count": 20,
        },
        "protocol_hierarchy": [
            {
                "protocol": "Frame",
                "frames": 1000,
                "bytes": 500000,
                "children": [
                    {"protocol": "Ethernet", "frames": 1000, "bytes": 486000, "children": []},
                ],
            },
        ],
        "tcp_conversations": [
            {
                "src_addr": "192.168.1.100",
                "dst_addr": "93.184.216.34",
                "src_port": "54321",
                "dst_port": "443",
                "rx_frames": 50,
                "rx_bytes": 25000,
                "tx_frames": 45,
                "tx_bytes": 5000,
                "filter": "tcp.stream eq 0",
            },
        ],
        "udp_conversations": [
            {
                "src_addr": "192.168.1.100",
                "dst_addr": "8.8.8.8",
                "src_port": "12345",
                "dst_port": "53",
                "rx_frames": 10,
                "rx_bytes": 1000,
                "tx_frames": 10,
                "tx_bytes": 800,
                "filter": None,
            },
        ],
        "endpoints": [
            {"host": "192.168.1.100", "port": None, "rx_frames": 500, "rx_bytes": 250000, "tx_frames": 500, "tx_bytes": 250000},
        ],
    }


@pytest.fixture
def sample_packet_details():
    """Sample packet details as returned by Rust bridge."""
    return {
        "tree": [
            {"l": "Frame 1: 74 bytes on wire (592 bits), 74 bytes captured (592 bits)"},
            {"l": "Ethernet II, Src: 00:11:22:33:44:55, Dst: 66:77:88:99:aa:bb"},
            {"l": "Internet Protocol Version 4, Src: 192.168.1.100, Dst: 8.8.8.8"},
            {"l": "User Datagram Protocol, Src Port: 12345, Dst Port: 53"},
            {"l": "Domain Name System (query)"},
        ],
        "bytes": "base64encodeddata...",
    }


# ============================================================================
# Mock Service Fixtures
# ============================================================================

@pytest.fixture
def mock_rust_bridge(sample_frames, sample_stream_data, sample_capture_stats, sample_packet_details):
    """Mock all rust_bridge functions."""
    with patch.multiple(
        "packet_pilot_ai.services.rust_bridge",
        get_frames=AsyncMock(return_value=sample_frames),
        get_frame_details=AsyncMock(return_value=sample_packet_details),
        check_filter=AsyncMock(return_value=True),
        search_packets=AsyncMock(return_value={"frames": sample_frames, "total_matching": 3, "filter_applied": "dns"}),
        get_stream=AsyncMock(return_value=sample_stream_data),
        get_capture_stats=AsyncMock(return_value=sample_capture_stats),
    ) as mocks:
        yield mocks


@pytest.fixture
def mock_openai_client():
    """Mock OpenAI client for testing LLM calls."""
    mock_client = MagicMock()
    mock_response = MagicMock()
    mock_message = MagicMock()
    mock_message.content = "This is a test response from the AI."
    mock_message.tool_calls = None
    mock_response.choices = [MagicMock(message=mock_message)]
    mock_client.chat.completions.create = AsyncMock(return_value=mock_response)
    return mock_client


@pytest.fixture
def mock_openai_with_tool_call():
    """Mock OpenAI client that returns a tool call."""
    mock_client = MagicMock()

    # First response with tool call
    tool_call = MagicMock()
    tool_call.id = "call_123"
    tool_call.function.name = "search_packets"
    tool_call.function.arguments = json.dumps({"filter": "http", "limit": 50})

    first_message = MagicMock()
    first_message.content = ""
    first_message.tool_calls = [tool_call]
    first_response = MagicMock()
    first_response.choices = [MagicMock(message=first_message)]

    # Second response after tool execution
    final_message = MagicMock()
    final_message.content = "I found 3 HTTP packets. Here's what I see..."
    final_message.tool_calls = None
    final_response = MagicMock()
    final_response.choices = [MagicMock(message=final_message)]

    mock_client.chat.completions.create = AsyncMock(side_effect=[first_response, final_response])
    return mock_client


# ============================================================================
# Context Fixtures
# ============================================================================

@pytest.fixture
def sample_context():
    """Sample CaptureContext for testing."""
    from packet_pilot_ai.models.schemas import CaptureContext
    return CaptureContext(
        selected_packet_id=1,
        selected_stream_id=None,
        visible_range={"start": 0, "end": 100},
        current_filter="",
        file_name="test.pcap",
        total_frames=1000,
    )


@pytest.fixture
def sample_history():
    """Sample chat history for testing."""
    from packet_pilot_ai.models.schemas import ChatMessage
    return [
        ChatMessage(id="1", role="user", content="What protocols are in this capture?", timestamp=1000, context=None),
        ChatMessage(id="2", role="assistant", content="The capture contains DNS and TCP traffic.", timestamp=1001, context=None),
    ]
