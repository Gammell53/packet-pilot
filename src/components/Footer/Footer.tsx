import "./Footer.css";

interface FooterProps {
  isReady: boolean;
  hasCaptureLoaded: boolean;
  isFiltered: boolean;
  selectedRow: number | null;
  selectedFrameNumber: number | null;
  totalFrames: number;
  avgPacketRate?: number;
  aiState?: "running" | "starting" | "offline" | "unconfigured";
}

export function Footer({
  isReady,
  hasCaptureLoaded,
  isFiltered,
  selectedRow,
  selectedFrameNumber,
  totalFrames,
  avgPacketRate,
  aiState,
}: FooterProps) {
  return (
    <footer className="app-footer">
      <div className="footer-left">
        <span className="status-indicator">
          <span className={`status-dot ${isReady ? "ready" : ""}`} />
          {isReady ? "Ready" : "Initializing..."}
        </span>
        {avgPacketRate && (
          <span className="capture-stat">
            {avgPacketRate.toFixed(0)} pkt/s
          </span>
        )}
      </div>
      <div className="footer-center">
        {selectedFrameNumber !== null && (
          <span className="selected-info">
            Packet {selectedFrameNumber.toLocaleString()}
            {isFiltered && selectedRow !== null
              ? ` (match ${selectedRow.toLocaleString()} of ${totalFrames.toLocaleString()})`
              : ` of ${totalFrames.toLocaleString()}`}
          </span>
        )}
      </div>
      <div className="footer-right">
        {aiState && aiState !== "unconfigured" && (
          <span className="ai-footer-status">
            <span className={`status-dot ai-footer-${aiState}`} />
            {aiState === "running" ? "AI Ready" : aiState === "starting" ? "AI Starting..." : "AI Offline"}
          </span>
        )}
        {hasCaptureLoaded && (
          <span className="packet-count">
            {totalFrames.toLocaleString()} {isFiltered ? "matching packets" : "packets"}
          </span>
        )}
        <span className="shortcuts-hint">
          <kbd>Ctrl+K</kbd> AI Chat
        </span>
      </div>
    </footer>
  );
}
