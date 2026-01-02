import "./Footer.css";

interface FooterProps {
  isReady: boolean;
  selectedFrame: number | null;
  totalFrames: number;
  avgPacketRate?: number;
}

export function Footer({
  isReady,
  selectedFrame,
  totalFrames,
  avgPacketRate,
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
        {selectedFrame && (
          <span className="selected-info">
            Packet {selectedFrame.toLocaleString()} of{" "}
            {totalFrames.toLocaleString()}
          </span>
        )}
      </div>
      <div className="footer-right">
        {totalFrames > 0 && (
          <span className="packet-count">
            {totalFrames.toLocaleString()} packets
          </span>
        )}
        <span className="shortcuts-hint">
          Press <kbd>?</kbd> for shortcuts
        </span>
      </div>
    </footer>
  );
}
