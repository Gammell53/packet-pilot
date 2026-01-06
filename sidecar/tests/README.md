# PacketPilot AI Test Suite

This directory contains the test suite for PacketPilot's AI components, including tool execution, LLM integration, and prompt behavior testing.

## Directory Structure

```
tests/
├── README.md              # This file
├── conftest.py            # Shared pytest fixtures
├── fixtures/              # Test data and mock helpers
│   ├── __init__.py
│   ├── mock_responses.py  # MockLLMResponse, MockToolCall classes
│   └── sample_data.py     # Sample packets, streams, capture stats
├── unit/                  # Unit tests (fast, isolated)
│   ├── __init__.py
│   └── test_tool_execution.py
├── integration/           # Integration tests (test full flows)
│   ├── __init__.py
│   └── test_analyze_flow.py
└── prompts/               # Prompt behavior tests (YAML-driven)
    ├── __init__.py
    ├── test_scenarios.py  # Scenario runner
    └── scenarios/         # YAML test definitions
        ├── tool_selection.yaml
        └── response_quality.yaml
```

## Running Tests

### Prerequisites

Install dev dependencies:
```bash
cd sidecar
source .venv/bin/activate
pip install -e ".[dev]"
```

### Run All Tests
```bash
pytest tests/ -v
```

### Run by Category
```bash
# Unit tests only (fast)
pytest tests/unit/ -v

# Integration tests only
pytest tests/integration/ -v

# Prompt behavior tests only
pytest tests/prompts/ -v
```

### Run by Marker
```bash
# Only unit tests
pytest -m unit

# Only integration tests
pytest -m integration

# Only prompt tests
pytest -m prompt
```

### Run a Specific Test
```bash
# Single test file
pytest tests/unit/test_tool_execution.py -v

# Single test class
pytest tests/unit/test_tool_execution.py::TestSearchPacketsTool -v

# Single test method
pytest tests/unit/test_tool_execution.py::TestSearchPacketsTool::test_search_packets_success -v
```

### Useful Options
```bash
# Show print statements
pytest -v -s

# Stop on first failure
pytest -v -x

# Run last failed tests
pytest --lf

# Show slowest tests
pytest --durations=10
```

## Test Categories

### Unit Tests (`tests/unit/`)

Fast, isolated tests that mock all external dependencies. Test individual functions and classes.

**What to test:**
- Tool definitions (structure, required fields)
- `execute_tool()` function behavior
- Error handling for each tool
- Edge cases (empty results, large data, missing args)

**Example:**
```python
@pytest.mark.asyncio
async def test_search_packets_success(self, sample_frames):
    with patch("packet_pilot_ai.services.ai_agent.search_packets", new_callable=AsyncMock) as mock:
        mock.return_value = {"frames": sample_frames, "total_matching": 3, "filter_applied": "dns"}

        result = await execute_tool("search_packets", {"filter": "dns", "limit": 50})

        assert "Found 3 packets" in result
```

### Integration Tests (`tests/integration/`)

Test complete flows through the system with mocked external services (LLM API, Rust bridge).

**What to test:**
- Full `analyze_packets()` flow
- Tool call loops (LLM calls tool, gets result, responds)
- Conversation history handling
- Error recovery scenarios

**Example:**
```python
@pytest.mark.asyncio
@pytest.mark.integration
async def test_question_triggers_tool_call(self):
    mock_client = create_mock_client(side_effect=mock_create)
    context = create_test_context()

    with patch("...get_openrouter_client", return_value=mock_client):
        result = await analyze_packets("Show me HTTP requests", context, {}, [])

        assert result is not None
        mock_search.assert_called_once()
```

### Prompt Tests (`tests/prompts/`)

YAML-driven tests that verify AI behavior for specific queries. These test that the right tools are called and responses meet quality criteria.

**What to test:**
- Tool selection for different query types
- Response quality (length, content, filter syntax)
- Edge cases in natural language understanding

## Adding New Tests

### Adding a Unit Test

1. Open `tests/unit/test_tool_execution.py` (or create a new file)
2. Add a test class or method:

```python
class TestMyNewTool:
    """Test the my_new_tool execution."""

    @pytest.mark.asyncio
    async def test_my_new_tool_success(self):
        """Test successful execution."""
        with patch("packet_pilot_ai.services.ai_agent.my_new_function", new_callable=AsyncMock) as mock:
            mock.return_value = {"result": "data"}

            result = await execute_tool("my_new_tool", {"arg": "value"})

            assert "expected content" in result
            mock.assert_called_once_with(arg="value")

    @pytest.mark.asyncio
    async def test_my_new_tool_error(self):
        """Test error handling."""
        with patch("packet_pilot_ai.services.ai_agent.my_new_function", new_callable=AsyncMock) as mock:
            mock.return_value = None

            result = await execute_tool("my_new_tool", {"arg": "value"})

            assert "Error" in result
```

### Adding an Integration Test

1. Open `tests/integration/test_analyze_flow.py`
2. Add a test method to an existing class or create a new class:

```python
@pytest.mark.asyncio
@pytest.mark.integration
async def test_my_new_scenario(self):
    """Test description."""
    mock_client = create_mock_client(return_value=SIMPLE_TEXT_RESPONSE.to_openai_format())
    context = create_test_context()

    with patch("packet_pilot_ai.services.ai_agent.get_capture_stats", new_callable=AsyncMock) as mock_stats, \
         patch("packet_pilot_ai.services.ai_agent.get_openrouter_client", return_value=mock_client):

        mock_stats.return_value = BASIC_CAPTURE_STATS

        result = await analyze_packets("My query", context, {}, [])

        assert result is not None
        # Add your assertions
```

### Adding a Prompt Scenario (Recommended for AI Behavior)

This is the easiest way to add new AI behavior tests.

1. Open the appropriate YAML file in `tests/prompts/scenarios/`:
   - `tool_selection.yaml` - For testing which tools are called
   - `response_quality.yaml` - For testing response content

2. Add a new scenario:

**Tool Selection Scenario:**
```yaml
- name: my_new_scenario
  query: "User's natural language query"
  expected_tools:
    - search_packets      # Tools that should be called
    - get_stream
  expected_tool_args:
    search_packets:
      filter_contains: "http"  # Expected filter content
    get_stream:
      stream_id: 0
      protocol: "TCP"
  min_tool_calls: 1  # Optional: minimum number of tool calls
```

**Response Quality Scenario:**
```yaml
- name: my_quality_test
  query: "User's question"
  expected_response_contains:
    - "keyword1"          # Words that must appear in response
    - "keyword2"
  min_response_length: 100  # Optional: minimum character count
  response_should_include_filter: true  # Optional: expect filter syntax
```

3. Run the test:
```bash
pytest tests/prompts/test_scenarios.py -v -k my_new_scenario
```

## Fixtures Reference

### conftest.py Fixtures

| Fixture | Description |
|---------|-------------|
| `sample_frames` | List of sample packet frame dicts |
| `sample_stream_data` | Sample TCP stream with segments |
| `sample_capture_stats` | Capture statistics with protocol hierarchy |
| `sample_packet_details` | Protocol tree for a single packet |
| `sample_context` | `CaptureContext` object for testing |
| `sample_history` | Sample `ChatMessage` list |
| `mock_rust_bridge` | Patches all rust_bridge functions |
| `mock_openai_client` | Basic mock OpenAI client |
| `mock_openai_with_tool_call` | Mock client that returns tool calls |

### fixtures/mock_responses.py

```python
# Create a mock LLM response
response = MockLLMResponse(
    content="AI response text",
    tool_calls=[MockToolCall("call_id", "tool_name", {"arg": "value"})],
    finish_reason="stop"
)

# Convert to OpenAI format for mocking
mock_response = response.to_openai_format()
```

### fixtures/sample_data.py

Pre-built sample data for common scenarios:
- `DNS_QUERY_FRAME`, `DNS_RESPONSE_FRAME` - DNS packet samples
- `HTTP_REQUEST_FRAME`, `HTTP_RESPONSE_FRAME` - HTTP packet samples
- `HTTP_STREAM` - Complete HTTP stream data
- `BASIC_CAPTURE_STATS` - Typical capture statistics
- `DNS_PACKET_DETAILS` - Protocol tree example

## Mocking Patterns

### Mock the OpenRouter Client

```python
def create_mock_client(side_effect=None, return_value=None):
    mock_client = MagicMock()
    if side_effect:
        mock_client.chat.completions.create = AsyncMock(side_effect=side_effect)
    elif return_value:
        mock_client.chat.completions.create = AsyncMock(return_value=return_value)
    return mock_client

# Usage
mock_client = create_mock_client(return_value=SIMPLE_TEXT_RESPONSE.to_openai_format())

with patch("packet_pilot_ai.services.ai_agent.get_openrouter_client", return_value=mock_client):
    # Your test code
```

### Mock Multiple LLM Calls (Tool Loop)

```python
call_count = 0

def mock_create(*args, **kwargs):
    nonlocal call_count
    call_count += 1
    if call_count == 1:
        # First call: return tool call
        return MockLLMResponse(
            content="",
            tool_calls=[MockToolCall("call_1", "search_packets", {"filter": "http"})]
        ).to_openai_format()
    else:
        # Second call: return final answer
        return MockLLMResponse(content="Final answer").to_openai_format()

mock_client = create_mock_client(side_effect=mock_create)
```

### Mock Rust Bridge Functions

```python
with patch("packet_pilot_ai.services.ai_agent.search_packets", new_callable=AsyncMock) as mock:
    mock.return_value = {
        "frames": [...],
        "total_matching": 10,
        "filter_applied": "http"
    }
    # Your test code
```

## Best Practices

1. **Use YAML scenarios for AI behavior tests** - Easier to maintain and review
2. **Mock at the right level** - Mock `get_openrouter_client`, not internal functions
3. **Test error cases** - Include tests for None returns, exceptions, invalid input
4. **Use descriptive test names** - `test_search_packets_with_invalid_filter_returns_error`
5. **Keep unit tests fast** - All mocked, no I/O
6. **Use markers** - Add `@pytest.mark.integration` or `@pytest.mark.prompt` as appropriate

## Troubleshooting

### Import Errors
```bash
# Make sure package is installed in dev mode
pip install -e ".[dev]"
```

### Async Test Issues
```bash
# Ensure pytest-asyncio is installed and configured
# Check pyproject.toml has: asyncio_mode = "auto"
```

### Test Not Found
```bash
# Check test file starts with test_
# Check test function starts with test_
# Check class starts with Test
```
