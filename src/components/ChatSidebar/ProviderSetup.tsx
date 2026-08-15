import { useState } from "react";
import type { AppSettings } from "../../types";
import { desktop } from "../../lib/desktop";
import "./ProviderSetup.css";

interface ProviderSetupProps {
  settings: AppSettings;
  onUpdateApiKey: (apiKey: string | null) => Promise<void>;
  onAcceptDisclosure: () => Promise<void>;
}

export function ProviderSetup({
  settings,
  onUpdateApiKey,
  onAcceptDisclosure,
}: ProviderSetupProps) {
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasAcceptedDisclosure, setHasAcceptedDisclosure] = useState(false);

  const isConnected = settings.hasApiKey && !settings.apiKeyUnavailable && settings.aiDisclosureAccepted;
  const hasStoredUnacceptedKey =
    settings.hasApiKey && !settings.apiKeyUnavailable && !settings.aiDisclosureAccepted;
  const hasUsableKey =
    (settings.hasApiKey && !settings.apiKeyUnavailable) || Boolean(apiKeyInput.trim());

  const handleConnect = async () => {
    if (!hasUsableKey) {
      setError("Enter your OpenRouter API key");
      return;
    }
    if (!hasAcceptedDisclosure) {
      setError("Review and accept the AI data disclosure before connecting");
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      const replacementKey = apiKeyInput.trim();
      if (replacementKey) {
        await onUpdateApiKey(replacementKey);
      }
      await onAcceptDisclosure();
      setApiKeyInput("");
      setHasAcceptedDisclosure(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save OpenRouter settings");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDisconnect = async () => {
    setIsSaving(true);
    setError(null);
    try {
      await onUpdateApiKey(null);
      setApiKeyInput("");
      setHasAcceptedDisclosure(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove OpenRouter API key");
    } finally {
      setIsSaving(false);
    }
  };

  const openPrivacyNotice = async () => {
    try {
      await desktop.files.openExternal(
        "https://github.com/Gammell53/packet-pilot/blob/master/PRIVACY.md",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open the privacy notice");
    }
  };

  if (isConnected) {
    return (
      <div className="provider-setup connected">
        <div className="provider-header">
          <div>
            <h3>OpenRouter connected</h3>
            <p>Your API key stays in the main process and is stored with operating-system encryption.</p>
          </div>
          <span className="provider-badge">Connected</span>
        </div>

        <p className="provider-disclosure-summary">
          AI analysis sends the current question and disclosed packet context to OpenRouter and the
          selected model provider.
        </p>
        <button className="provider-privacy-link" onClick={() => void openPrivacyNotice()}>
          Read the privacy notice
        </button>

        <button
          className="disconnect-button"
          onClick={() => void handleDisconnect()}
          disabled={isSaving}
        >
          {isSaving ? "Disconnecting..." : "Disconnect OpenRouter"}
        </button>
        {error && <p className="provider-error">{error}</p>}
      </div>
    );
  }

  return (
    <div className="provider-setup">
      <div className="provider-header">
        <div>
          <h3>Connect OpenRouter</h3>
          <p>Use your own OpenRouter API key for optional AI-assisted analysis.</p>
        </div>
      </div>

      {settings.apiKeyUnavailable && (
        <div className="provider-migration-notice" role="alert">
          <p>
            A saved OpenRouter credential is locked because secure operating-system credential
            storage is unavailable. It may be an encrypted key or a legacy plaintext key from an
            earlier PacketPilot version. PacketPilot preserved the credential contents, restricts
            the settings file to your user account where supported, and will not use or overwrite
            the credential.
          </p>
          <p>Unlock credential storage and reopen PacketPilot, enter a replacement key, or disconnect it.</p>
          <button className="disconnect-button" onClick={() => void handleDisconnect()} disabled={isSaving}>
            {isSaving ? "Removing..." : "Remove locked key"}
          </button>
        </div>
      )}

      {hasStoredUnacceptedKey && (
        <p className="provider-migration-notice">
          A saved API key was found. Review and accept the current disclosure before AI can start.
          You do not need to enter the key again.
        </p>
      )}

      <label className="provider-field-label" htmlFor="openrouter-api-key">
        OpenRouter API key {hasStoredUnacceptedKey && "(optional replacement)"}
      </label>
      <input
        id="openrouter-api-key"
        className="provider-input"
        type="password"
        autoComplete="off"
        value={apiKeyInput}
        onChange={(event) => setApiKeyInput(event.target.value)}
        placeholder={hasStoredUnacceptedKey ? "Saved key available" : "sk-or-v1-..."}
      />

      <div className="provider-disclosure">
        <strong>Before you enable AI analysis</strong>
        <p>
          Opening this AI panel requests OpenRouter&apos;s public model catalog. That catalog request does
          not include your API key, prompt, capture filename, or packet data.
        </p>
        <p>
          Packet parsing stays on this Mac. When you ask the assistant a question, PacketPilot sends
          that question, prior chat messages, and selected packet-derived context to OpenRouter and the
          model provider selected there.
        </p>
        <p>
          Context can include the capture filename, active display filter, frame count, visible range,
          selected packet or stream identifiers, packet summaries, protocol details, raw packet bytes,
          endpoint and conversation metadata, and reconstructed stream text returned by analysis tools.
          This may contain sensitive network data.
        </p>
        <p>
          During an answer, the model may request additional packet numbers or stream IDs beyond your
          current selection. PacketPilot sends each requested tool result—including protocol fields,
          raw bytes, and reconstructed stream content—back to OpenRouter and the selected provider on
          later model calls in that answer.
        </p>
        <p>
          PacketPilot requests providers that advertise zero-data-retention handling, but OpenRouter and
          model-provider terms still apply. This does not mean the analysis stays on this Mac.
        </p>
        <button className="provider-privacy-link" onClick={() => void openPrivacyNotice()}>
          Read the full privacy notice
        </button>
      </div>

      <label className="provider-consent">
        <input
          type="checkbox"
          checked={hasAcceptedDisclosure}
          onChange={(event) => setHasAcceptedDisclosure(event.target.checked)}
        />
        <span>
          I understand that the listed context, additional packets or streams requested by the model,
          and each resulting tool response may be sent to OpenRouter and a third-party model provider.
        </span>
      </label>

      <div className="provider-actions">
        <button
          className="provider-connect-button"
          onClick={() => void handleConnect()}
          disabled={isSaving || !hasUsableKey || !hasAcceptedDisclosure}
        >
          {isSaving
            ? "Connecting..."
            : hasStoredUnacceptedKey && !apiKeyInput.trim()
              ? "Accept & connect saved key"
              : "Connect OpenRouter"}
        </button>
        <button
          className="provider-key-link"
          onClick={() =>
            void desktop.files.openExternal("https://openrouter.ai/settings/keys").catch((err) => {
              setError(err instanceof Error ? err.message : "Failed to open OpenRouter");
            })
          }
        >
          Create an OpenRouter key
        </button>
      </div>

      {error && <p className="provider-error">{error}</p>}
    </div>
  );
}
