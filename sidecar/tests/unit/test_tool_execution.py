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

    @pytest.mark.parametrize("tool_name", ["search_packets", "get_stream", "get_packet_details"])
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
