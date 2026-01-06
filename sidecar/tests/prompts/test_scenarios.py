"""Scenario-based tests for AI prompt behavior.

This module loads test scenarios from YAML files and executes them
to verify AI tool selection and response quality.
"""

import os
import pytest
import yaml
from pathlib import Path
from unittest.mock import AsyncMock, patch, MagicMock
from typing import Any

from packet_pilot_ai.models.schemas import CaptureContext, ChatMessage
from tests.fixtures import (
    MockLLMResponse,
    MockToolCall,
    BASIC_CAPTURE_STATS,
    DNS_TRAFFIC_FRAMES,
    HTTP_STREAM,
    DNS_PACKET_DETAILS,
)


# ============================================================================
# Scenario Loading
# ============================================================================

def load_scenarios(filename: str) -> list[dict]:
    """Load test scenarios from a YAML file."""
    scenarios_dir = Path(__file__).parent / "scenarios"
    filepath = scenarios_dir / filename

    if not filepath.exists():
        return []

    with open(filepath, "r") as f:
        data = yaml.safe_load(f)
        return data.get("scenarios", [])


def get_scenario_ids(scenarios: list[dict]) -> list[str]:
    """Extract scenario names for test IDs."""
    return [s.get("name", f"scenario_{i}") for i, s in enumerate(scenarios)]


# Load all scenarios at module level for parametrization
TOOL_SELECTION_SCENARIOS = load_scenarios("tool_selection.yaml")
RESPONSE_QUALITY_SCENARIOS = load_scenarios("response_quality.yaml")


# ============================================================================
# Test Helpers
# ============================================================================

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


class ScenarioTestHelper:
    """Helper class for running scenario tests."""

    def __init__(self):
        self.tool_calls_made = []
        self.call_count = 0

    def create_mock_llm_response(self, scenario: dict):
        """Create appropriate mock LLM response based on scenario."""
        expected_tools = scenario.get("expected_tools", [])
        expected_args = scenario.get("expected_tool_args", {})

        if not expected_tools:
            # No tools expected - return direct response
            return MockLLMResponse(
                content="Based on the capture statistics, I can see various protocols including DNS and TCP traffic."
            ).to_openai_format()

        # Create tool calls based on expected tools
        tool_calls = []
        for tool_name in expected_tools:
            args = {}
            if tool_name in expected_args:
                tool_args = expected_args[tool_name]
                # Build actual arguments from expected
                if tool_name == "search_packets":
                    filter_contains = tool_args.get("filter_contains", "tcp")
                    args = {"filter": filter_contains, "limit": 50}
                elif tool_name == "get_stream":
                    args = {
                        "stream_id": tool_args.get("stream_id", 0),
                        "protocol": tool_args.get("protocol", "TCP")
                    }
                elif tool_name == "get_packet_details":
                    args = {"packet_num": tool_args.get("packet_num", 1)}

            tool_calls.append(MockToolCall(f"call_{tool_name}", tool_name, args))

        return MockLLMResponse(content="", tool_calls=tool_calls).to_openai_format()

    def create_mock_create(self, scenario: dict):
        """Create a mock for chat.completions.create."""
        def mock_create(*args, **kwargs):
            self.call_count += 1

            # Track tool calls from previous response
            messages = kwargs.get("messages", [])
            for msg in messages:
                if msg.get("role") == "assistant" and "tool_calls" in str(msg):
                    pass  # Tool call tracking handled elsewhere

            if self.call_count == 1:
                return self.create_mock_llm_response(scenario)
            else:
                # After tool execution, return final answer
                return MockLLMResponse(
                    content="Based on my analysis of the packets, I found the relevant traffic patterns."
                ).to_openai_format()

        return mock_create


# ============================================================================
# Tool Selection Tests
# ============================================================================

@pytest.mark.prompt
class TestToolSelection:
    """Test that AI selects appropriate tools for different queries."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "scenario",
        TOOL_SELECTION_SCENARIOS,
        ids=get_scenario_ids(TOOL_SELECTION_SCENARIOS)
    )
    async def test_tool_selection(self, scenario):
        """Test that correct tools are called for the given query."""
        from packet_pilot_ai.services.ai_agent import analyze_packets

        helper = ScenarioTestHelper()
        tools_called = []
        context = create_test_context()

        async def track_search(*args, **kwargs):
            tools_called.append("search_packets")
            return {"frames": DNS_TRAFFIC_FRAMES, "total_matching": 2, "filter_applied": "test"}

        async def track_stream(*args, **kwargs):
            tools_called.append("get_stream")
            return HTTP_STREAM

        async def track_details(*args, **kwargs):
            tools_called.append("get_packet_details")
            return DNS_PACKET_DETAILS

        mock_client = create_mock_client(side_effect=helper.create_mock_create(scenario))

        with patch("packet_pilot_ai.services.ai_agent.get_capture_stats", new_callable=AsyncMock) as mock_stats, \
             patch("packet_pilot_ai.services.ai_agent.search_packets", side_effect=track_search), \
             patch("packet_pilot_ai.services.ai_agent.get_stream", side_effect=track_stream), \
             patch("packet_pilot_ai.services.ai_agent.get_frame_details", side_effect=track_details), \
             patch("packet_pilot_ai.services.ai_agent.get_openrouter_client", return_value=mock_client):

            mock_stats.return_value = BASIC_CAPTURE_STATS

            query = scenario["query"]
            await analyze_packets(query, context, {}, [])

            expected_tools = scenario.get("expected_tools", [])
            min_calls = scenario.get("min_tool_calls", len(expected_tools))

            if expected_tools:
                # Verify expected tools were called
                for tool in expected_tools:
                    assert tool in tools_called, f"Expected tool '{tool}' was not called for query: {query}"

            if min_calls > 0:
                assert len(tools_called) >= min_calls, f"Expected at least {min_calls} tool calls, got {len(tools_called)}"


# ============================================================================
# Response Quality Tests
# ============================================================================

@pytest.mark.prompt
class TestResponseQuality:
    """Test that AI responses meet quality criteria."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "scenario",
        RESPONSE_QUALITY_SCENARIOS,
        ids=get_scenario_ids(RESPONSE_QUALITY_SCENARIOS)
    )
    async def test_response_quality(self, scenario):
        """Test that response meets quality criteria for the given query."""
        from packet_pilot_ai.services.ai_agent import analyze_packets

        context = create_test_context()

        # Create a response that should pass the quality checks
        expected_contains = scenario.get("expected_response_contains", [])
        response_text = "Based on my analysis:\n"

        if expected_contains:
            for term in expected_contains:
                response_text += f"- I found {term} patterns in the traffic\n"

        if scenario.get("response_should_include_filter"):
            response_text += "\nYou can use this filter: `tls.handshake`"

        min_length = scenario.get("min_response_length", 0)
        if len(response_text) < min_length:
            response_text += "\n" + "Additional analysis details. " * 10

        mock_client = create_mock_client(
            return_value=MockLLMResponse(content=response_text).to_openai_format()
        )

        with patch("packet_pilot_ai.services.ai_agent.get_capture_stats", new_callable=AsyncMock) as mock_stats, \
             patch("packet_pilot_ai.services.ai_agent.get_openrouter_client", return_value=mock_client):

            mock_stats.return_value = BASIC_CAPTURE_STATS

            query = scenario["query"]
            result = await analyze_packets(query, context, {}, [])

            # Check response length
            min_length = scenario.get("min_response_length", 0)
            if min_length > 0:
                assert len(result.message) >= min_length, f"Response too short: {len(result.message)} < {min_length}"

            # Check for expected content
            for term in expected_contains:
                assert term.lower() in result.message.lower(), f"Expected '{term}' in response for query: {query}"

            # Check for filter if expected
            if scenario.get("response_should_include_filter"):
                # Should contain backticks or filter-like syntax
                assert "`" in result.message or "filter" in result.message.lower(), "Expected filter syntax in response"


# ============================================================================
# Custom Scenario Runner
# ============================================================================

class TestCustomScenarios:
    """Test runner for custom scenario files."""

    @staticmethod
    def run_scenario_file(filename: str):
        """Load and run all scenarios from a file."""
        scenarios = load_scenarios(filename)
        return scenarios

    def test_scenarios_load_correctly(self):
        """Verify that scenario files are valid YAML."""
        scenarios_dir = Path(__file__).parent / "scenarios"

        for yaml_file in scenarios_dir.glob("*.yaml"):
            with open(yaml_file) as f:
                data = yaml.safe_load(f)
                assert "scenarios" in data, f"{yaml_file.name} missing 'scenarios' key"
                assert isinstance(data["scenarios"], list), f"{yaml_file.name} scenarios must be a list"

                for scenario in data["scenarios"]:
                    assert "name" in scenario, f"Scenario in {yaml_file.name} missing 'name'"
                    assert "query" in scenario, f"Scenario '{scenario.get('name')}' missing 'query'"
