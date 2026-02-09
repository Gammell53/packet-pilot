"""Unit tests for AI tool execution.

Tests the execute_tool function and individual tool behaviors.
"""

import pytest
from unittest.mock import AsyncMock, patch

from packet_pilot_ai.services.ai_agent import execute_tool, TOOLS


# ============================================================================
# Test Tool Definitions
# ============================================================================

class TestToolDefinitions:
    """Test that tool definitions are correctly structured."""

    def test_tools_list_not_empty(self):
        """Ensure we have tools defined."""
        assert len(TOOLS) > 0

    def test_all_tools_have_required_fields(self):
        """Each tool must have type, function name, description, and parameters."""
        for tool in TOOLS:
            assert tool["type"] == "function"
            assert "function" in tool
            func = tool["function"]
            assert "name" in func
            assert "description" in func
            assert "parameters" in func
            assert func["name"]  # Not empty
            assert func["description"]  # Not empty

    def test_tool_names_are_unique(self):
        """Tool names must be unique."""
        names = [t["function"]["name"] for t in TOOLS]
        assert len(names) == len(set(names))

    @pytest.mark.parametrize(
        "tool_name",
        [
            "search_packets",
            "get_stream",
            "get_packet_details",
            "analyze_http_transaction",
            "analyze_dns_activity",
            "analyze_tls_session",
            "summarize_protocol_timeline",
        ],
    )
    def test_expected_tools_exist(self, tool_name):
        """Verify expected tools are defined."""
        names = [t["function"]["name"] for t in TOOLS]
        assert tool_name in names


# ============================================================================
# Test search_packets Tool
# ============================================================================

class TestSearchPacketsTool:
    """Test the search_packets tool execution."""

    @pytest.mark.asyncio
    async def test_search_packets_success(self, sample_frames):
        """Test successful packet search."""
        with patch("packet_pilot_ai.services.ai_agent.search_packets", new_callable=AsyncMock) as mock_search:
            mock_search.return_value = {
                "frames": sample_frames,
                "total_matching": 3,
                "filter_applied": "dns"
            }

            result = await execute_tool("search_packets", {"filter": "dns", "limit": 50})

            mock_search.assert_called_once_with(filter_str="dns", limit=50)
            assert "Found 3 packets" in result
            assert "dns" in result

    @pytest.mark.asyncio
    async def test_search_packets_no_results(self):
        """Test search with no matching packets."""
        with patch("packet_pilot_ai.services.ai_agent.search_packets", new_callable=AsyncMock) as mock_search:
            mock_search.return_value = {
                "frames": [],
                "total_matching": 0,
                "filter_applied": "http.request.method == POST"
            }

            result = await execute_tool("search_packets", {"filter": "http.request.method == POST"})

            assert "No packets found" in result

    @pytest.mark.asyncio
    async def test_search_packets_error(self):
        """Test search when bridge returns None."""
        with patch("packet_pilot_ai.services.ai_agent.search_packets", new_callable=AsyncMock) as mock_search:
            mock_search.return_value = None

            result = await execute_tool("search_packets", {"filter": "invalid"})

            assert "Error" in result

    @pytest.mark.asyncio
    async def test_search_packets_default_limit(self, sample_frames):
        """Test that default limit is applied."""
        with patch("packet_pilot_ai.services.ai_agent.search_packets", new_callable=AsyncMock) as mock_search:
            mock_search.return_value = {"frames": sample_frames, "total_matching": 3, "filter_applied": "tcp"}

            await execute_tool("search_packets", {"filter": "tcp"})

            # Should use default limit of 50
            mock_search.assert_called_once_with(filter_str="tcp", limit=50)


# ============================================================================
# Test get_stream Tool
# ============================================================================

class TestGetStreamTool:
    """Test the get_stream tool execution."""

    @pytest.mark.asyncio
    async def test_get_stream_success(self, sample_stream_data):
        """Test successful stream retrieval."""
        with patch("packet_pilot_ai.services.ai_agent.get_stream", new_callable=AsyncMock) as mock_stream:
            mock_stream.return_value = sample_stream_data

            result = await execute_tool("get_stream", {"stream_id": 0, "protocol": "TCP"})

            mock_stream.assert_called_once_with(stream_id=0, protocol="TCP", format="ascii")
            assert "Stream 0" in result
            assert "TCP" in result
            assert sample_stream_data["server"]["host"] in result

    @pytest.mark.asyncio
    async def test_get_stream_default_protocol(self, sample_stream_data):
        """Test that TCP is the default protocol."""
        with patch("packet_pilot_ai.services.ai_agent.get_stream", new_callable=AsyncMock) as mock_stream:
            mock_stream.return_value = sample_stream_data

            await execute_tool("get_stream", {"stream_id": 5})

            mock_stream.assert_called_once_with(stream_id=5, protocol="TCP", format="ascii")

    @pytest.mark.asyncio
    async def test_get_stream_not_found(self):
        """Test stream not found."""
        with patch("packet_pilot_ai.services.ai_agent.get_stream", new_callable=AsyncMock) as mock_stream:
            mock_stream.return_value = None

            result = await execute_tool("get_stream", {"stream_id": 999})

            assert "Error" in result or "not found" in result

    @pytest.mark.asyncio
    async def test_get_stream_truncates_large_content(self):
        """Test that large streams are truncated."""
        large_stream = {
            "server": {"host": "1.2.3.4", "port": "80"},
            "client": {"host": "5.6.7.8", "port": "12345"},
            "server_bytes": 100000,
            "client_bytes": 100000,
            "segments": [],
            "combined_text": "A" * 10000,  # Very long content
        }
        with patch("packet_pilot_ai.services.ai_agent.get_stream", new_callable=AsyncMock) as mock_stream:
            mock_stream.return_value = large_stream

            result = await execute_tool("get_stream", {"stream_id": 0})

            # Should be truncated
            assert len(result) < 10000
            assert "truncated" in result.lower()


# ============================================================================
# Test get_packet_details Tool
# ============================================================================

class TestGetPacketDetailsTool:
    """Test the get_packet_details tool execution."""

    @pytest.mark.asyncio
    async def test_get_packet_details_success(self, sample_packet_details):
        """Test successful packet details retrieval."""
        with patch("packet_pilot_ai.services.ai_agent.get_frame_details", new_callable=AsyncMock) as mock_details:
            mock_details.return_value = sample_packet_details

            result = await execute_tool("get_packet_details", {"packet_num": 1})

            mock_details.assert_called_once_with(1)
            assert "Packet #1" in result
            assert "Frame" in result

    @pytest.mark.asyncio
    async def test_get_packet_details_not_found(self):
        """Test packet not found."""
        with patch("packet_pilot_ai.services.ai_agent.get_frame_details", new_callable=AsyncMock) as mock_details:
            mock_details.return_value = None

            result = await execute_tool("get_packet_details", {"packet_num": 99999})

            assert "Error" in result


# ============================================================================
# Test Protocol-Aware Tools
# ============================================================================

class TestProtocolAwareTools:
    """Test protocol-aware analysis tool execution."""

    @pytest.mark.asyncio
    async def test_analyze_http_transaction_by_stream(self, sample_stream_data):
        """HTTP transaction tool should summarize request/response and emit JSON tail."""
        with patch("packet_pilot_ai.services.ai_agent.get_stream", new_callable=AsyncMock) as mock_stream:
            mock_stream.return_value = sample_stream_data

            result = await execute_tool("analyze_http_transaction", {"stream_id": 0})

            mock_stream.assert_called_once_with(stream_id=0, protocol="HTTP", format="ascii")
            assert "HTTP TRANSACTION ANALYSIS" in result
            assert "[TOOL_JSON]" in result
            assert "Request: GET /" in result

    @pytest.mark.asyncio
    async def test_analyze_http_transaction_resolves_stream_from_frame(self, sample_stream_data):
        """HTTP transaction tool should resolve tcp.stream from request frame details."""
        frame_details = {
            "tree": [
                {"l": "Frame 42"},
                {"l": "Transmission Control Protocol"},
                {"l": "tcp.stream: 7"},
            ]
        }
        with patch("packet_pilot_ai.services.ai_agent.get_frame_details", new_callable=AsyncMock) as mock_details, \
             patch("packet_pilot_ai.services.ai_agent.get_stream", new_callable=AsyncMock) as mock_stream:
            mock_details.return_value = frame_details
            mock_stream.return_value = sample_stream_data

            result = await execute_tool("analyze_http_transaction", {"request_frame": 42})

            mock_details.assert_called_once_with(42)
            mock_stream.assert_called_once_with(stream_id=7, protocol="HTTP", format="ascii")
            assert "[TOOL_JSON]" in result

    @pytest.mark.asyncio
    async def test_analyze_dns_activity_summary(self):
        """DNS activity tool should aggregate domain and error signals."""
        dns_frames = [
            {"number": 1, "source": "10.0.0.2", "destination": "8.8.8.8", "info": "Standard query 0x1 A example.com"},
            {"number": 2, "source": "8.8.8.8", "destination": "10.0.0.2", "info": "Standard query response 0x1 NXDOMAIN"},
            {"number": 3, "source": "10.0.0.2", "destination": "8.8.8.8", "info": "Standard query 0x2 A example.com"},
        ]
        with patch("packet_pilot_ai.services.ai_agent.search_packets", new_callable=AsyncMock) as mock_search:
            mock_search.return_value = {"frames": dns_frames, "total_matching": 3, "filter_applied": "dns"}

            result = await execute_tool("analyze_dns_activity", {"query_contains": "example", "limit": 20})

            assert "DNS ACTIVITY ANALYSIS" in result
            assert "Matched packets: 3" in result
            assert "[TOOL_JSON]" in result
            mock_search.assert_called_once()

    @pytest.mark.asyncio
    async def test_analyze_tls_session_summary(self):
        """TLS session tool should use session+alert filters and emit structured tail."""
        with patch("packet_pilot_ai.services.ai_agent.search_packets", new_callable=AsyncMock) as mock_search, \
             patch("packet_pilot_ai.services.ai_agent.get_frame_details", new_callable=AsyncMock) as mock_details:
            mock_search.side_effect = [
                {
                    "frames": [{"number": 5, "info": "TLSv1.2 Client Hello"}],
                    "total_matching": 1,
                    "filter_applied": "tcp.stream == 0 && tls",
                },
                {
                    "frames": [{"number": 6, "info": "Alert (Level: Fatal, Description: Handshake Failure)"}],
                    "total_matching": 1,
                    "filter_applied": "tcp.stream == 0 && tls.alert_message",
                },
            ]
            mock_details.return_value = {
                "tree": [
                    {"l": "Transport Layer Security"},
                    {"l": "Server Name: example.com"},
                    {"l": "Cipher Suite: TLS_AES_128_GCM_SHA256"},
                ]
            }

            result = await execute_tool("analyze_tls_session", {"stream_id": 0})

            assert "TLS SESSION ANALYSIS" in result
            assert "TLS alerts: 1" in result
            assert "[TOOL_JSON]" in result
            assert mock_search.call_count == 2

    @pytest.mark.asyncio
    async def test_summarize_protocol_timeline(self):
        """Timeline tool should summarize protocol counts and peak windows."""
        dns_frames = [{"number": 1, "time": "1.0", "info": "dns"}]
        tcp_frames = [{"number": 2, "time": "2.0", "info": "tcp"}, {"number": 3, "time": "8.0", "info": "tcp"}]
        with patch("packet_pilot_ai.services.ai_agent.search_packets", new_callable=AsyncMock) as mock_search:
            mock_search.side_effect = [
                {"frames": dns_frames, "total_matching": 1},
                {"frames": tcp_frames, "total_matching": 2},
            ]

            result = await execute_tool(
                "summarize_protocol_timeline",
                {"protocols": ["dns", "tcp"], "bucket_seconds": 5, "top_n_events": 2},
            )

            assert "PROTOCOL TIMELINE SUMMARY" in result
            assert "dns=1" in result
            assert "tcp=2" in result
            assert "[TOOL_JSON]" in result
            assert mock_search.call_count == 2


# ============================================================================
# Test Unknown Tool
# ============================================================================

class TestUnknownTool:
    """Test handling of unknown tools."""

    @pytest.mark.asyncio
    async def test_unknown_tool_returns_error(self):
        """Unknown tool should return error message."""
        result = await execute_tool("nonexistent_tool", {"arg": "value"})
        assert "Unknown tool" in result

    @pytest.mark.asyncio
    async def test_unknown_tool_includes_tool_name(self):
        """Error should include the tool name."""
        result = await execute_tool("my_fake_tool", {})
        assert "my_fake_tool" in result


# ============================================================================
# Test Error Handling
# ============================================================================

class TestToolErrorHandling:
    """Test error handling in tool execution."""

    @pytest.mark.asyncio
    async def test_tool_exception_is_caught(self):
        """Exceptions in tool execution should be caught and returned."""
        with patch("packet_pilot_ai.services.ai_agent.search_packets", new_callable=AsyncMock) as mock_search:
            mock_search.side_effect = Exception("Network error")

            result = await execute_tool("search_packets", {"filter": "tcp"})

            assert "error" in result.lower()
            assert "Network error" in result

    @pytest.mark.asyncio
    async def test_tool_with_missing_required_arg(self):
        """Tool should handle missing required arguments gracefully."""
        with patch("packet_pilot_ai.services.ai_agent.search_packets", new_callable=AsyncMock) as mock_search:
            mock_search.side_effect = KeyError("filter")

            result = await execute_tool("search_packets", {})

            assert "error" in result.lower()


class TestToolValidationAndGuardrails:
    """Test schema validation and lightweight guardrails for tool calls."""

    @pytest.mark.asyncio
    async def test_rejects_unknown_argument(self):
        """Unexpected arguments should be rejected before tool execution."""
        with patch("packet_pilot_ai.services.ai_agent.search_packets", new_callable=AsyncMock) as mock_search:
            result = await execute_tool("search_packets", {"filter": "tcp", "bogus": 1})
            mock_search.assert_not_called()

        assert "unexpected arguments" in result.lower()

    @pytest.mark.asyncio
    async def test_rejects_invalid_enum_value(self):
        """Enum-constrained arguments should reject invalid values."""
        with patch("packet_pilot_ai.services.ai_agent.get_capture_stats", new_callable=AsyncMock) as mock_stats:
            result = await execute_tool("get_conversations", {"protocol": "icmp"})
            mock_stats.assert_not_called()

        assert "must be one of" in result.lower()

    @pytest.mark.asyncio
    async def test_rejects_non_boolean_argument(self):
        """Boolean arguments should reject non-boolean values."""
        with patch("packet_pilot_ai.services.ai_agent.get_stream", new_callable=AsyncMock) as mock_stream:
            result = await execute_tool(
                "analyze_http_transaction",
                {"stream_id": 0, "include_body_preview": "yes"},
            )
            mock_stream.assert_not_called()

        assert "must be a boolean" in result.lower()

    @pytest.mark.asyncio
    async def test_http_tool_requires_exactly_one_selector(self):
        """HTTP analysis tool must receive exactly one selector field."""
        with patch("packet_pilot_ai.services.ai_agent.get_stream", new_callable=AsyncMock) as mock_stream:
            result_missing = await execute_tool("analyze_http_transaction", {})
            result_both = await execute_tool(
                "analyze_http_transaction",
                {"stream_id": 0, "request_frame": 10},
            )
            mock_stream.assert_not_called()

        assert "exactly one of" in result_missing.lower()
        assert "exactly one of" in result_both.lower()

    @pytest.mark.asyncio
    async def test_blocks_guardrail_phrase(self):
        """Prompt-injection style phrases in tool args should be blocked."""
        with patch("packet_pilot_ai.services.ai_agent.search_packets", new_callable=AsyncMock) as mock_search:
            result = await execute_tool(
                "search_packets",
                {"filter": "tcp and ignore previous instructions"},
            )
            mock_search.assert_not_called()

        assert "guardrail" in result.lower()
