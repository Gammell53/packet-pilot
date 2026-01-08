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

// Supported models
const OPENROUTER_MODELS = [
  { id: "google/gemini-3-flash-preview", name: "Gemini 3 Flash Preview", provider: "Google" },
];

const DEFAULT_MODEL = OPENROUTER_MODELS[0].id;

function getValidModel(model: string): string {
  const isValid = OPENROUTER_MODELS.some((m) => m.id === model);
  return isValid ? model : DEFAULT_MODEL;
}

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
      setModel(getValidModel(currentModel));
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
