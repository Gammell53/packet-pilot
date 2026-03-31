import { useState } from "react";
import { desktop } from "../../lib/desktop";
import "./SettingsDialog.css";

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsDialog({ isOpen, onClose }: SettingsDialogProps) {
  const [copiedDiagnostics, setCopiedDiagnostics] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCopyDiagnostics = async () => {
    try {
      const diagnostics = await desktop.app.getRuntimeDiagnostics();
      await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2));
      setCopiedDiagnostics(true);
      setTimeout(() => setCopiedDiagnostics(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to copy runtime diagnostics");
    }
  };

  if (!isOpen) return null;

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="settings-header">
          <h2>Settings</h2>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>

        <div className="settings-content">
          <section className="settings-section">
            <h3>Diagnostics</h3>
            <p className="settings-description">
              Copy runtime diagnostics for troubleshooting.
            </p>
            <button className="btn-secondary" onClick={() => void handleCopyDiagnostics()}>
              {copiedDiagnostics ? "Diagnostics Copied" : "Copy Diagnostics"}
            </button>
          </section>

          <section className="settings-section">
            <p className="settings-description">
              AI provider and model settings are configured in the chat sidebar.
            </p>
          </section>

          {error && <div className="settings-error">{error}</div>}
        </div>

        <div className="settings-footer">
          <div />
          <button className="btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
