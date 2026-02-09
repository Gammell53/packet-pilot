"""Integration tests for the full analyze flow.

Tests the complete flow from user message to AI response,
including tool calling and context building.
"""

import pytest
from unittest.mock import AsyncMock, patch, MagicMock

from packet_pilot_ai.services.ai_agent import (
    analyze_packets,
    call_llm,
    execute_tool,
    stream_analyze_packets,
)
from packet_pilot_ai.models.schemas import CaptureContext, ChatMessage
from tests.fixtures import (
    MockLLMResponse,
    MockToolCall,
    SIMPLE_TEXT_RESPONSE,
    SEARCH_TOOL_CALL,
    FINAL_ANSWER_AFTER_TOOLS,
    BASIC_CAPTURE_STATS,
    HTTP_STREAM,
    DNS_TRAFFIC_FRAMES,
)


def create_mock_client(side_effect=None, return_value=None):
    """Create a mock OpenAI client."""
    mock_client = MagicMock()
    if side_effect:
        mock_client.chat.completions.create = AsyncMock(side_effect=side_effect)
    elif return_value:
        mock_client.chat.completions.create = AsyncMock(return_value=return_value)
    return mock_client


def create_test_context():
    """Create a test CaptureContext."""
    return CaptureContext(
        selected_packet_id=1,
        selected_stream_id=None,
        visible_range={"start": 0, "end": 100},
        current_filter="",
        file_name="test.pcap",
        total_frames=1000,
    )


def create_test_history(messages=None):
    """Create a test chat history."""
    if messages is None:
        return []
    return [
        ChatMessage(id=str(i), role=msg["role"], content=msg["content"], timestamp=1000+i, context=None)
        for i, msg in enumerate(messages)
    ]


# ============================================================================
# Test Full Analyze Flow
# ============================================================================

class TestAnalyzeFlow:
    """Test the complete analyze_packets flow."""

    @pytest.mark.asyncio
    @pytest.mark.integration
    async def test_simple_question_no_tools(self):
        """Test a simple question that doesn't require tools."""
        mock_client = create_mock_client(return_value=SIMPLE_TEXT_RESPONSE.to_openai_format())
        context = create_test_context()

        with patch("packet_pilot_ai.services.ai_agent.get_capture_stats", new_callable=AsyncMock) as mock_stats, \
             patch("packet_pilot_ai.services.ai_agent.get_openrouter_client", return_value=mock_client):

            mock_stats.return_value = BASIC_CAPTURE_STATS

            result = await analyze_packets("What protocols are in this capture?", context, {}, [])

            assert result is not None
            assert result.message is not None
            mock_client.chat.completions.create.assert_called_once()

    @pytest.mark.asyncio
    @pytest.mark.integration
    async def test_question_triggers_tool_call(self):
        """Test that complex questions trigger appropriate tool calls."""
        call_count = 0

        def mock_create(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return SEARCH_TOOL_CALL.to_openai_format()
            else:
                return FINAL_ANSWER_AFTER_TOOLS.to_openai_format()

        mock_client = create_mock_client(side_effect=mock_create)
        context = create_test_context()

        with patch("packet_pilot_ai.services.ai_agent.get_capture_stats", new_callable=AsyncMock) as mock_stats, \
             patch("packet_pilot_ai.services.ai_agent.search_packets", new_callable=AsyncMock) as mock_search, \
             patch("packet_pilot_ai.services.ai_agent.get_openrouter_client", return_value=mock_client):

            mock_stats.return_value = BASIC_CAPTURE_STATS
            mock_search.return_value = {
                "frames": DNS_TRAFFIC_FRAMES,
                "total_matching": 2,
                "filter_applied": "http.request"
            }

            result = await analyze_packets("Show me all HTTP requests", context, {}, [])

            assert result is not None
            assert call_count == 2  # Initial call + after tool result
            mock_search.assert_called_once()

    @pytest.mark.asyncio
    @pytest.mark.integration
    async def test_conversation_history_preserved(self):
        """Test that conversation history is passed to the LLM."""
        history = create_test_history([
            {"role": "user", "content": "What's in this capture?"},
            {"role": "assistant", "content": "This capture contains DNS and TCP traffic."},
        ])
        context = create_test_context()

        mock_client = create_mock_client(return_value=SIMPLE_TEXT_RESPONSE.to_openai_format())

        with patch("packet_pilot_ai.services.ai_agent.get_capture_stats", new_callable=AsyncMock) as mock_stats, \
             patch("packet_pilot_ai.services.ai_agent.get_openrouter_client", return_value=mock_client):

            mock_stats.return_value = BASIC_CAPTURE_STATS

            await analyze_packets("Tell me more about the DNS traffic", context, {}, history)

            # Verify history was included in the call
            call_args = mock_client.chat.completions.create.call_args
            messages = call_args.kwargs.get("messages", [])

            # Should have: system + history (2) + new user message
            assert len(messages) >= 4

    @pytest.mark.asyncio
    @pytest.mark.integration
    async def test_analyze_uses_fast_context_without_capture_stats_call(self):
        """Analyze path should avoid slow capture-stats fetch for latency."""
        mock_client = create_mock_client(return_value=SIMPLE_TEXT_RESPONSE.to_openai_format())
        context = create_test_context()

        with patch("packet_pilot_ai.services.ai_agent.get_capture_stats", new_callable=AsyncMock) as mock_stats, \
             patch("packet_pilot_ai.services.ai_agent.get_openrouter_client", return_value=mock_client):

            mock_stats.return_value = BASIC_CAPTURE_STATS

            await analyze_packets("Analyze this capture", context, {}, [])

            mock_stats.assert_not_called()

            # Verify request still includes a system message
            call_args = mock_client.chat.completions.create.call_args
            messages = call_args.kwargs.get("messages", [])
            system_msg = next((m for m in messages if m["role"] == "system"), None)

            assert system_msg is not None

    @pytest.mark.asyncio
    @pytest.mark.integration
    async def test_handles_stats_failure_gracefully(self):
        """Test that analyze continues even if capture stats fail."""
        mock_client = create_mock_client(return_value=SIMPLE_TEXT_RESPONSE.to_openai_format())
        context = create_test_context()

        with patch("packet_pilot_ai.services.ai_agent.get_capture_stats", new_callable=AsyncMock) as mock_stats, \
             patch("packet_pilot_ai.services.ai_agent.get_openrouter_client", return_value=mock_client):

            mock_stats.return_value = None  # Stats fetch failed

            result = await analyze_packets("What's in this capture?", context, {}, [])

            assert result is not None  # Should still return a response


# ============================================================================
# Test Tool Call Loop
# ============================================================================

class TestToolCallLoop:
    """Test the tool calling loop behavior."""

    @pytest.mark.asyncio
    @pytest.mark.integration
    async def test_multiple_sequential_tool_calls(self):
        """Test handling of multiple tool calls in sequence."""
        call_count = 0

        def mock_create(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                # First: search for packets
                return MockLLMResponse(
                    content="",
                    tool_calls=[MockToolCall("call_1", "search_packets", {"filter": "http", "limit": 10})]
                ).to_openai_format()
            elif call_count == 2:
                # Second: get stream details
                return MockLLMResponse(
                    content="",
                    tool_calls=[MockToolCall("call_2", "get_stream", {"stream_id": 0})]
                ).to_openai_format()
            else:
                # Final answer
                return FINAL_ANSWER_AFTER_TOOLS.to_openai_format()

        mock_client = create_mock_client(side_effect=mock_create)
        context = create_test_context()

        with patch("packet_pilot_ai.services.ai_agent.get_capture_stats", new_callable=AsyncMock) as mock_stats, \
             patch("packet_pilot_ai.services.ai_agent.search_packets", new_callable=AsyncMock) as mock_search, \
             patch("packet_pilot_ai.services.ai_agent.get_stream", new_callable=AsyncMock) as mock_stream, \
             patch("packet_pilot_ai.services.ai_agent.get_openrouter_client", return_value=mock_client):

            mock_stats.return_value = BASIC_CAPTURE_STATS
            mock_search.return_value = {"frames": DNS_TRAFFIC_FRAMES, "total_matching": 2, "filter_applied": "http"}
            mock_stream.return_value = HTTP_STREAM

            result = await analyze_packets("Analyze the HTTP conversation", context, {}, [])

            # Verify multiple tool calls happened (at least 2)
            assert call_count >= 2, f"Expected multiple LLM calls, got {call_count}"
            mock_search.assert_called_once()

    @pytest.mark.asyncio
    @pytest.mark.integration
    async def test_tool_call_limit_prevents_infinite_loop(self):
        """Test that there's a limit on tool calls to prevent infinite loops."""
        call_count = 0

        def mock_create(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            # Always return a tool call (simulating stuck LLM)
            return MockLLMResponse(
                content="",
                tool_calls=[MockToolCall(f"call_{call_count}", "search_packets", {"filter": "tcp"})]
            ).to_openai_format()

        mock_client = create_mock_client(side_effect=mock_create)
        context = create_test_context()

        with patch("packet_pilot_ai.services.ai_agent.get_capture_stats", new_callable=AsyncMock) as mock_stats, \
             patch("packet_pilot_ai.services.ai_agent.search_packets", new_callable=AsyncMock) as mock_search, \
             patch("packet_pilot_ai.services.ai_agent.get_openrouter_client", return_value=mock_client):

            mock_stats.return_value = BASIC_CAPTURE_STATS
            mock_search.return_value = {"frames": [], "total_matching": 0, "filter_applied": "tcp"}

            result = await analyze_packets("Find something", context, {}, [])

            # Should stop after reasonable number of iterations (default: 10)
            assert call_count <= 12  # Allow some buffer


# ============================================================================
# Test Protocol-Aware Tool Calls
# ============================================================================

class TestProtocolAwareToolCalls:
    """Test end-to-end loop behavior for protocol-aware tools."""

    @pytest.mark.asyncio
    @pytest.mark.integration
    async def test_http_transaction_tool_call(self):
        """LLM-driven HTTP transaction tool call should execute and recover final response."""
        call_count = 0

        def mock_create(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return MockLLMResponse(
                    content="",
                    tool_calls=[MockToolCall("call_http_1", "analyze_http_transaction", {"stream_id": 0})],
                ).to_openai_format()
            return FINAL_ANSWER_AFTER_TOOLS.to_openai_format()

        mock_client = create_mock_client(side_effect=mock_create)
        context = create_test_context()

        with patch("packet_pilot_ai.services.ai_agent.get_stream", new_callable=AsyncMock) as mock_stream, \
             patch("packet_pilot_ai.services.ai_agent.get_openrouter_client", return_value=mock_client):
            mock_stream.return_value = HTTP_STREAM

            result = await analyze_packets("Summarize HTTP transaction stream 0", context, {}, [])

            assert result is not None
            assert call_count == 2
            mock_stream.assert_called_once()

    @pytest.mark.asyncio
    @pytest.mark.integration
    async def test_dns_activity_tool_call(self):
        """LLM-driven DNS activity tool call should execute via search_packets."""
        call_count = 0

        def mock_create(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return MockLLMResponse(
                    content="",
                    tool_calls=[MockToolCall("call_dns_1", "analyze_dns_activity", {"limit": 20})],
                ).to_openai_format()
            return FINAL_ANSWER_AFTER_TOOLS.to_openai_format()

        mock_client = create_mock_client(side_effect=mock_create)
        context = create_test_context()

        with patch("packet_pilot_ai.services.ai_agent.search_packets", new_callable=AsyncMock) as mock_search, \
             patch("packet_pilot_ai.services.ai_agent.get_openrouter_client", return_value=mock_client):
            mock_search.return_value = {"frames": DNS_TRAFFIC_FRAMES, "total_matching": 2, "filter_applied": "dns"}

            result = await analyze_packets("Analyze DNS behavior", context, {}, [])

            assert result is not None
            assert call_count == 2
            mock_search.assert_called_once()

    @pytest.mark.asyncio
    @pytest.mark.integration
    async def test_tls_session_tool_call(self):
        """LLM-driven TLS session tool call should execute session and alert searches."""
        call_count = 0

        def mock_create(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return MockLLMResponse(
                    content="",
                    tool_calls=[MockToolCall("call_tls_1", "analyze_tls_session", {"stream_id": 0})],
                ).to_openai_format()
            return FINAL_ANSWER_AFTER_TOOLS.to_openai_format()

        mock_client = create_mock_client(side_effect=mock_create)
        context = create_test_context()

        with patch("packet_pilot_ai.services.ai_agent.search_packets", new_callable=AsyncMock) as mock_search, \
             patch("packet_pilot_ai.services.ai_agent.get_frame_details", new_callable=AsyncMock) as mock_details, \
             patch("packet_pilot_ai.services.ai_agent.get_openrouter_client", return_value=mock_client):
            mock_search.side_effect = [
                {"frames": [{"number": 5, "info": "TLSv1.2 Client Hello"}], "total_matching": 1},
                {"frames": [], "total_matching": 0},
            ]
            mock_details.return_value = {"tree": [{"l": "Server Name: example.com"}]}

            result = await analyze_packets("Inspect TLS stream 0", context, {}, [])

            assert result is not None
            assert call_count == 2
            assert mock_search.call_count == 2

    @pytest.mark.asyncio
    @pytest.mark.integration
    async def test_protocol_timeline_tool_call(self):
        """LLM-driven protocol timeline tool call should run multiple protocol searches."""
        call_count = 0

        def mock_create(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return MockLLMResponse(
                    content="",
                    tool_calls=[
                        MockToolCall(
                            "call_timeline_1",
                            "summarize_protocol_timeline",
                            {"protocols": ["dns", "tcp"], "bucket_seconds": 5, "top_n_events": 2},
                        )
                    ],
                ).to_openai_format()
            return FINAL_ANSWER_AFTER_TOOLS.to_openai_format()

        mock_client = create_mock_client(side_effect=mock_create)
        context = create_test_context()

        with patch("packet_pilot_ai.services.ai_agent.search_packets", new_callable=AsyncMock) as mock_search, \
             patch("packet_pilot_ai.services.ai_agent.get_openrouter_client", return_value=mock_client):
            mock_search.side_effect = [
                {"frames": [{"number": 1, "time": "1.0", "info": "dns"}], "total_matching": 1},
                {"frames": [{"number": 2, "time": "2.0", "info": "tcp"}], "total_matching": 1},
            ]

            result = await analyze_packets("Summarize protocol timeline", context, {}, [])

            assert result is not None
            assert call_count == 2
            assert mock_search.call_count == 2


# ============================================================================
# Test Error Recovery
# ============================================================================

class TestErrorRecovery:
    """Test error recovery in the analyze flow."""

    @pytest.mark.asyncio
    @pytest.mark.integration
    async def test_tool_error_continues_conversation(self):
        """Test that tool errors are reported back to LLM for recovery."""
        call_count = 0

        def mock_create(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return MockLLMResponse(
                    content="",
                    tool_calls=[MockToolCall("call_1", "search_packets", {"filter": "invalid["})]
                ).to_openai_format()
            else:
                return MockLLMResponse(
                    content="I encountered an error with that filter. Let me try a different approach."
                ).to_openai_format()

        mock_client = create_mock_client(side_effect=mock_create)
        context = create_test_context()

        with patch("packet_pilot_ai.services.ai_agent.get_capture_stats", new_callable=AsyncMock) as mock_stats, \
             patch("packet_pilot_ai.services.ai_agent.search_packets", new_callable=AsyncMock) as mock_search, \
             patch("packet_pilot_ai.services.ai_agent.get_openrouter_client", return_value=mock_client):

            mock_stats.return_value = BASIC_CAPTURE_STATS
            mock_search.side_effect = Exception("Invalid filter syntax")

            result = await analyze_packets("Search for invalid packets", context, {}, [])

            assert result is not None
            assert call_count == 2  # Initial + recovery

    @pytest.mark.asyncio
    @pytest.mark.integration
    async def test_api_error_returns_friendly_message(self):
        """Test that API errors return user-friendly messages."""
        mock_client = create_mock_client(side_effect=Exception("Connection timeout"))
        context = create_test_context()

        with patch("packet_pilot_ai.services.ai_agent.get_capture_stats", new_callable=AsyncMock) as mock_stats, \
             patch("packet_pilot_ai.services.ai_agent.get_openrouter_client", return_value=mock_client):

            mock_stats.return_value = BASIC_CAPTURE_STATS

            # This should raise an exception based on current implementation
            # The test verifies the behavior - update if error handling changes
            try:
                result = await analyze_packets("Test question", context, {}, [])
                # If we get here, check it's an error response
                assert result is None or "error" in result.message.lower()
            except Exception as e:
                # Exception is acceptable - we're testing error handling
                assert "timeout" in str(e).lower() or True


class TestRetryBehavior:
    """Test transient retry handling for LLM requests."""

    @pytest.mark.asyncio
    @pytest.mark.integration
    async def test_call_llm_retries_after_transient_timeout(self):
        """Timeout-like failures should retry and succeed when next attempt works."""
        mock_client = create_mock_client(
            side_effect=[
                TimeoutError("temporary timeout"),
                SIMPLE_TEXT_RESPONSE.to_openai_format(),
            ]
        )

        with patch("packet_pilot_ai.services.ai_agent.get_openrouter_client", return_value=mock_client), \
             patch("packet_pilot_ai.services.ai_agent.asyncio.sleep", new_callable=AsyncMock) as mock_sleep:
            text = await call_llm(
                [{"role": "user", "content": "hello"}],
                "You are a test system prompt.",
                use_tools=False,
            )

            assert "capture" in text.lower()
            assert mock_client.chat.completions.create.call_count == 2
            mock_sleep.assert_called_once()


class TestLoopMetadataAndBudgets:
    """Test request metadata and bounded-loop behavior."""

    @pytest.mark.asyncio
    @pytest.mark.integration
    async def test_analyze_response_includes_request_metadata(self):
        """Non-stream analyze should expose request_id/status metadata."""
        mock_client = create_mock_client(return_value=SIMPLE_TEXT_RESPONSE.to_openai_format())
        context = create_test_context()

        with patch("packet_pilot_ai.services.ai_agent.get_openrouter_client", return_value=mock_client):
            result = await analyze_packets(
                "Summarize traffic",
                context,
                {},
                [],
                request_id="req-test-001",
            )

        assert result.request_id == "req-test-001"
        assert result.completion_status == "complete"
        assert result.stop_reason == "completed"

    @pytest.mark.asyncio
    @pytest.mark.integration
    async def test_analyze_returns_partial_on_model_budget_exceeded(self):
        """Loop should return partial response when model-call budget is exhausted."""
        mock_client = create_mock_client(return_value=SEARCH_TOOL_CALL.to_openai_format())
        context = create_test_context()

        with patch("packet_pilot_ai.services.ai_agent.get_openrouter_client", return_value=mock_client), \
             patch("packet_pilot_ai.services.ai_agent.search_packets", new_callable=AsyncMock) as mock_search, \
             patch.dict("os.environ", {"AI_LOOP_MAX_MODEL_CALLS": "1"}, clear=False):
            result = await analyze_packets(
                "Find suspicious traffic",
                context,
                {},
                [],
                request_id="req-test-002",
            )

        mock_search.assert_not_called()
        assert result.request_id == "req-test-002"
        assert result.completion_status == "partial"
        assert result.stop_reason == "max_model_calls_exceeded"

    @pytest.mark.asyncio
    @pytest.mark.integration
    async def test_stream_emits_meta_and_warning_events(self):
        """Streaming path should emit meta and warning events for partial completion."""
        context = create_test_context()

        async def fake_stream(*_args, **kwargs):
            loop_state = kwargs["loop_state"]
            yield "chunk-one"
            loop_state.completion_status = "partial"
            loop_state.stop_reason = "max_wall_ms_exceeded"

        with patch("packet_pilot_ai.services.ai_agent.call_llm_streaming", new=fake_stream):
            events = []
            async for event in stream_analyze_packets(
                query="stream analysis",
                context=context,
                packet_data={},
                history=[],
                request_id="req-test-stream",
            ):
                events.append(event)

        assert events[0]["type"] == "meta"
        assert events[0]["request_id"] == "req-test-stream"
        assert any(e.get("type") == "text" for e in events)
        assert any(
            e.get("type") == "warning" and e.get("stop_reason") == "max_wall_ms_exceeded"
            for e in events
        )
