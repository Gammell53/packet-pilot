import { useState } from "react";
import "./GoToPacketDialog.css";

interface GoToPacketDialogProps {
  totalFrames: number;
  onGoTo: (packetNum: number) => void;
  onClose: () => void;
}

export function GoToPacketDialog({
  totalFrames,
  onGoTo,
  onClose,
}: GoToPacketDialogProps) {
  const [packetNum, setPacketNum] = useState("");

  const handleGo = () => {
    const num = parseInt(packetNum, 10);
    if (!isNaN(num) && num >= 1 && num <= totalFrames) {
      onGoTo(num);
      onClose();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleGo();
    if (e.key === "Escape") onClose();
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>Go to Packet</h3>
        <input
          type="number"
          className="dialog-input"
          placeholder={`Enter packet number (1-${totalFrames.toLocaleString()})`}
          value={packetNum}
          onChange={(e) => setPacketNum(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
          min={1}
          max={totalFrames}
        />
        <div className="dialog-buttons">
          <button className="dialog-button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="dialog-button primary" onClick={handleGo}>
            Go
          </button>
        </div>
      </div>
    </div>
  );
}
