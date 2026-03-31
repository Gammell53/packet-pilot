import { useState } from "react";
import type { AppSettings } from "../../types";
import { desktop } from "../../lib/desktop";
import "./ProviderSetup.css";

interface ProviderSetupProps {
  settings: AppSettings;
  onUpdateApiKey: (apiKey: string | null) => Promise<void>;
}

export function ProviderSetup({
  settings,
  onUpdateApiKey,
}: ProviderSetupProps) {
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isConnected = Boolean(settings.apiKey);

  const handleConnect = async () => {
    const trimmed = apiKeyInput.trim();
    if (!trimmed) return;

    setIsConnecting(true);
    setError(null);
    try {
      await onUpdateApiKey(trimmed);
      setApiKeyInput("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect");
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setError(null);
    try {
      await onUpdateApiKey(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disconnect");
    }
  };

  return (
    <div className="provider-setup">
      <div className="provider-setup-welcome">
        <h4 className="provider-setup-title">Set Up AI Analysis</h4>
        <p className="provider-setup-subtitle">
          PacketPilot AI can analyze your packet captures, identify anomalies,
          suggest display filters, and explain protocols in plain English.
        </p>
      </div>

      <div className={`provider-card ${isConnected ? "connected" : ""}`}>
        <div className="provider-card-header">
          <span className="provider-card-name">OpenRouter</span>
          {isConnected && <span className="provider-card-status">Connected</span>}
        </div>

        {isConnected ? (
          <div className="provider-card-connected">
            <span className="provider-card-detail">Connected via API key · ZDR routing enabled</span>
            <button className="provider-card-disconnect" onClick={handleDisconnect}>
              Disconnect
            </button>
          </div>
        ) : (
          <div className="provider-card-body">
            <p className="provider-card-desc">
              Use your OpenRouter API key to enable AI analysis with Zero Data Retention-compatible models.
            </p>
            <p className="provider-setup-note">
              Supported chat models are Claude Sonnet 4.6, Claude Opus 4.6, Gemini 3.1 Flash Lite, Gemini 3 Flash,
              and GPT-5.4. Gemini 3.1 Pro appears automatically when OpenRouter reports a live ZDR route.
            </p>
            <div className="provider-card-key-row">
              <input
                type="password"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder="sk-or-v1-..."
                autoComplete="off"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleConnect();
                }}
              />
              <button
                className="btn-primary"
                onClick={handleConnect}
                disabled={isConnecting || !apiKeyInput.trim()}
              >
                {isConnecting ? "..." : "Connect"}
              </button>
            </div>
            <button
              className="provider-card-get-key"
              onClick={() => void desktop.files.openExternal("https://openrouter.ai/keys")}
            >
              Get an API key at openrouter.ai &rarr;
            </button>
          </div>
        )}
      </div>

      {error && <div className="provider-setup-error">{error}</div>}

      {settings.apiKey && (
        <p className="provider-setup-note">
          Model selection now lives in the chat panel and applies to the next message you send.
        </p>
      )}
    </div>
  );
}
