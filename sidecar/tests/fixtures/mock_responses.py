"""Mock LLM responses for testing different scenarios."""

from dataclasses import dataclass
from typing import Optional
import json


@dataclass
class MockToolCall:
    """Represents a mock tool call from the LLM."""
    id: str
    name: str
    arguments: dict

    def to_openai_format(self):
        """Convert to OpenAI tool_call format."""
        from unittest.mock import MagicMock
        tc = MagicMock()
        tc.id = self.id
        tc.function.name = self.name
        tc.function.arguments = json.dumps(self.arguments)
        return tc


@dataclass
class MockLLMResponse:
    """Represents a mock LLM response."""
    content: str
    tool_calls: Optional[list[MockToolCall]] = None
    finish_reason: str = "stop"

    def to_openai_format(self):
        """Convert to OpenAI response format."""
        from unittest.mock import MagicMock
        response = MagicMock()
        message = MagicMock()
        message.content = self.content
        message.tool_calls = [tc.to_openai_format() for tc in self.tool_calls] if self.tool_calls else None
        response.choices = [MagicMock(message=message, finish_reason=self.finish_reason)]
        return response


# ============================================================================
# Common Response Patterns
# ============================================================================

# Response that triggers a search_packets tool call
SEARCH_TOOL_CALL = MockLLMResponse(
    content="",
    tool_calls=[MockToolCall(
        id="call_search_1",
        name="search_packets",
        arguments={"filter": "http.request", "limit": 50}
    )]
)

# Response that triggers a get_stream tool call
STREAM_TOOL_CALL = MockLLMResponse(
    content="",
    tool_calls=[MockToolCall(
        id="call_stream_1",
        name="get_stream",
        arguments={"stream_id": 0, "protocol": "TCP"}
    )]
)

# Response that triggers a get_packet_details tool call
PACKET_DETAILS_TOOL_CALL = MockLLMResponse(
    content="",
    tool_calls=[MockToolCall(
        id="call_details_1",
        name="get_packet_details",
        arguments={"packet_num": 42}
    )]
)

# Response with multiple tool calls
MULTI_TOOL_CALL = MockLLMResponse(
    content="Let me check both the HTTP traffic and the first TCP stream.",
    tool_calls=[
        MockToolCall(id="call_1", name="search_packets", arguments={"filter": "http", "limit": 20}),
        MockToolCall(id="call_2", name="get_stream", arguments={"stream_id": 0, "protocol": "TCP"}),
    ]
)

# Simple text response (no tool calls)
SIMPLE_TEXT_RESPONSE = MockLLMResponse(
    content="Based on the capture context, I can see there are 1000 frames with DNS and TCP traffic. The main protocols are DNS for name resolution and TCP for data transfer."
)

# Response with a filter suggestion
FILTER_SUGGESTION_RESPONSE = MockLLMResponse(
    content="To see all HTTP requests, you can use this filter: `http.request`\n\nThis will show all HTTP request packets in the capture."
)

# Response after tool execution (final answer)
FINAL_ANSWER_AFTER_TOOLS = MockLLMResponse(
    content="Based on my search, I found 15 HTTP packets. The traffic shows requests to example.com and api.service.io. The responses indicate successful 200 OK status codes."
)

# Error-like responses
NO_PACKETS_FOUND = MockLLMResponse(
    content="I searched for the packets but found none matching your criteria. You might want to check if the filter is correct or if this type of traffic exists in the capture."
)


# ============================================================================
# Scenario Builders
# ============================================================================

def create_tool_call_sequence(tool_name: str, arguments: dict, final_response: str):
    """Create a sequence of responses for a tool call scenario."""
    return [
        MockLLMResponse(
            content="",
            tool_calls=[MockToolCall(id=f"call_{tool_name}", name=tool_name, arguments=arguments)]
        ),
        MockLLMResponse(content=final_response)
    ]


def create_multi_turn_conversation(turns: list[tuple[str, str]]):
    """Create responses for a multi-turn conversation without tool calls."""
    return [MockLLMResponse(content=response) for _, response in turns]
