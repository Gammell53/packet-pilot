from packet_pilot_ai.services.ai_agent import get_model


def test_get_model_uses_openrouter_fallback(monkeypatch):
    monkeypatch.delenv("AI_MODEL", raising=False)

    assert get_model() == "google/gemini-3-flash-preview"


def test_get_model_uses_environment_override(monkeypatch):
    monkeypatch.setenv("AI_MODEL", "anthropic/claude-sonnet-4.6")

    assert get_model() == "anthropic/claude-sonnet-4.6"
