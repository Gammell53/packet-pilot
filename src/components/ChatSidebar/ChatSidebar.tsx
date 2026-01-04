import { useRef, useEffect } from "react";
import { ChatMessage } from "./ChatMessage";
import { ChatInput } from "./ChatInput";
import { useChat } from "../../hooks/useChat";
import { usePythonSidecar } from "../../hooks/usePythonSidecar";
import type { CaptureContext } from "../../types";
import "./ChatSidebar.css";

interface ChatSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  selectedFrame: number | null;
  visibleRange: { start: number; end: number };
  currentFilter: string;
  fileName: string | null;
  totalFrames: number;
  onApplyFilter: (filter: string) => void;
  onGoToPacket: (packetNum: number) => void;
  apiKey: string | null;
  model: string;
  hasApiKey: boolean;
  onOpenSettings: () => void;
}

export function ChatSidebar({
  isOpen,
  onClose,
  selectedFrame,
  visibleRange,
  currentFilter,
  fileName,
  totalFrames,
  onApplyFilter,
  onGoToPacket,
  apiKey,
  model,
  hasApiKey,
  onOpenSettings,
}: ChatSidebarProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { status, start: startSidecar, isStarting } = usePythonSidecar();

  const handleStartSidecar = () => {
    startSidecar(apiKey, model);
  };

  const context: CaptureContext = {
    selectedPacketId: selectedFrame,
    selectedStreamId: null,
    visibleRange,
    currentFilter,
    fileName,
    totalFrames,
  };

  const { messages, isLoading, sendMessage, clearHistory } = useChat(context);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const handleAction = (action: string, payload: unknown) => {
    if (action === "apply_filter" && typeof payload === "string") {
      onApplyFilter(payload);
    } else if (action === "go_to_packet" && typeof payload === "number") {
      onGoToPacket(payload);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="chat-sidebar">
      <div className="chat-header">
        <h3>PacketPilot AI</h3>
        <div className="chat-header-actions">
          <button
            className="icon-button"
            onClick={clearHistory}
            title="Clear chat"
          >
            Clear
          </button>
          <button className="icon-button" onClick={onClose} title="Close (Esc)">
            &times;
          </button>
        </div>
      </div>

      {!hasApiKey ? (
        <div className="chat-sidecar-status">
          <p>API key required</p>
          <p className="hint">Configure your OpenRouter API key to use AI features.</p>
          <button className="start-sidecar-btn" onClick={onOpenSettings}>
            Configure API Key
          </button>
        </div>
      ) : !status.is_running ? (
        <div className="chat-sidecar-status">
          <p>AI assistant is not running</p>
          <button
            className="start-sidecar-btn"
            onClick={handleStartSidecar}
            disabled={isStarting}
          >
            {isStarting ? "Starting..." : "Start AI Assistant"}
          </button>
          {status.error && <p className="error-text">{status.error}</p>}
          <button className="settings-link" onClick={onOpenSettings}>
            Settings
          </button>
        </div>
      ) : (
        <>
          <div className="chat-context-bar">
            {selectedFrame && <span>Packet #{selectedFrame}</span>}
            {currentFilter && <span>Filter: {currentFilter}</span>}
            {!selectedFrame && !currentFilter && (
              <span>
                {fileName ? `${totalFrames} packets` : "No capture loaded"}
              </span>
            )}
          </div>

          <div className="chat-messages">
            {messages.length === 0 && (
              <div className="chat-empty">
                <p>Ask me about your packet capture!</p>
                <p className="hint">Try: "Show me all HTTP requests"</p>
                <p className="hint">Or: "What's happening in packet #42?"</p>
              </div>
            )}
            {messages.map((msg) => (
              <ChatMessage key={msg.id} message={msg} onAction={handleAction} />
            ))}
            <div ref={messagesEndRef} />
          </div>

          <ChatInput
            onSend={sendMessage}
            isLoading={isLoading}
            disabled={!status.is_running}
          />
        </>
      )}
    </div>
  );
}
