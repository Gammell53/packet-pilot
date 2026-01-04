import { useState, useEffect } from "react";
import "./SettingsDialog.css";

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  currentApiKey: string | null;
  currentModel: string;
  onSaveApiKey: (key: string | null) => Promise<void>;
  onSaveModel: (model: string) => Promise<void>;
}

// Top models from OpenRouter rankings by usage
const OPENROUTER_MODELS = [
  // Free tier
  { id: "xiaomi/mimo-v2-flash:free", name: "MiMo-V2-Flash (free)", provider: "Free" },
  { id: "google/gemini-2.0-flash-001:free", name: "Gemini 2.0 Flash (free)", provider: "Free" },
  // Google
  { id: "google/gemini-2.5-flash-preview", name: "Gemini 2.5 Flash", provider: "Google" },
  { id: "google/gemini-2.0-flash-001", name: "Gemini 2.0 Flash", provider: "Google" },
  // xAI
  { id: "x-ai/grok-3-fast", name: "Grok 3 Fast", provider: "xAI" },
  // DeepSeek
  { id: "deepseek/deepseek-chat-v3-0324", name: "DeepSeek V3", provider: "DeepSeek" },
  // Anthropic
  { id: "anthropic/claude-sonnet-4", name: "Claude Sonnet 4", provider: "Anthropic" },
  { id: "anthropic/claude-opus-4", name: "Claude Opus 4", provider: "Anthropic" },
];

export function SettingsDialog({
  isOpen,
  onClose,
  currentApiKey,
  currentModel,
  onSaveApiKey,
  onSaveModel,
}: SettingsDialogProps) {
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(currentModel);
  const [showApiKey, setShowApiKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Reset form when dialog opens
  useEffect(() => {
    if (isOpen) {
      setApiKey(currentApiKey ?? "");
      setModel(currentModel);
      setShowApiKey(false);
      setError(null);
      setSaved(false);
    }
  }, [isOpen, currentApiKey, currentModel]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    setSaved(false);

    try {
      // Validate API key format
      if (apiKey && !apiKey.startsWith("sk-or-")) {
        setError("OpenRouter API key should start with 'sk-or-'");
        setIsSaving(false);
        return;
      }

      await onSaveApiKey(apiKey || null);
      await onSaveModel(model);
      setSaved(true);

      // Auto-close after successful save
      setTimeout(() => {
        onClose();
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>Settings</h2>
          <button className="close-btn" onClick={onClose}>
            &times;
          </button>
        </div>

        <div className="settings-content">
          <section className="settings-section">
            <h3>OpenRouter API Key</h3>
            <p className="settings-description">
              OpenRouter gives you access to 100+ AI models with a single API key.
            </p>

            <div className="form-group">
              <label htmlFor="api-key">API Key</label>
              <div className="input-with-button">
                <input
                  id="api-key"
                  type={showApiKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-or-v1-..."
                  autoComplete="off"
                />
                <button
                  type="button"
                  className="toggle-visibility"
                  onClick={() => setShowApiKey(!showApiKey)}
                >
                  {showApiKey ? "Hide" : "Show"}
                </button>
              </div>
              <p className="form-hint">
                Get your key from{" "}
                <a
                  href="https://openrouter.ai/keys"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  openrouter.ai/keys
                </a>
              </p>
            </div>
          </section>

          <section className="settings-section">
            <h3>Model</h3>
            <div className="form-group">
              <label htmlFor="model">AI Model</label>
              <select
                id="model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              >
                {["Free", "Google", "xAI", "DeepSeek", "Anthropic"].map((providerName) => {
                  const providerModels = OPENROUTER_MODELS.filter(m => m.provider === providerName);
                  if (providerModels.length === 0) return null;
                  return (
                    <optgroup key={providerName} label={providerName}>
                      {providerModels.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </optgroup>
                  );
                })}
              </select>
              <p className="form-hint">
                Browse all models at{" "}
                <a
                  href="https://openrouter.ai/models"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  openrouter.ai/models
                </a>
              </p>
            </div>
          </section>

          {error && <div className="settings-error">{error}</div>}
          {saved && <div className="settings-success">Settings saved!</div>}
        </div>

        <div className="settings-footer">
          <div className="footer-right">
            <button className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              className="btn-primary"
              onClick={handleSave}
              disabled={isSaving}
            >
              {isSaving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
