import { useRef, useEffect, useState, useCallback } from "react";
import { ChatMessage } from "./ChatMessage";
import { ChatInput } from "./ChatInput";
import { useChat } from "../../hooks/useChat";
import { usePythonSidecar } from "../../hooks/usePythonSidecar";
import type { CaptureContext } from "../../types";
import "./ChatSidebar.css";

function getErrorInfo(error: string): { message: string; hint: string } {
  const errorLower = error.toLowerCase();

  if (errorLower.includes("python") || errorLower.includes("not found")) {
    return {
      message: "Python environment issue",
      hint: "Ensure Python is installed and accessible",
    };
  }
  if (errorLower.includes("port") || errorLower.includes("address already in use")) {
    return {
      message: "Port conflict",
      hint: "Another process is using port 8765. Try restarting the app.",
    };
  }
  if (errorLower.includes("timeout") || errorLower.includes("timed out")) {
    return {
      message: "Startup timed out",
      hint: "The AI service took too long to start. Try again.",
    };
  }
  if (errorLower.includes("api") || errorLower.includes("key") || errorLower.includes("401") || errorLower.includes("unauthorized")) {
    return {
      message: "API key issue",
      hint: "Check your OpenRouter API key in Settings",
    };
  }
  if (errorLower.includes("network") || errorLower.includes("connection") || errorLower.includes("fetch")) {
    return {
      message: "Connection failed",
      hint: "Check your internet connection",
    };
  }

  return {
    message: "Failed to start",
    hint: error.length > 80 ? error.slice(0, 80) + "..." : error,
  };
}

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
  const [sidebarWidth, setSidebarWidth] = useState(380);

  // Resize handler for draggable left edge
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const onMouseMove = (e: MouseEvent) => {
      const delta = startX - e.clientX;
      const newWidth = Math.max(320, Math.min(800, startWidth + delta));
      setSidebarWidth(newWidth);
    };

    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [sidebarWidth]);

  // Auto-start sidecar when sidebar opens and API key exists
  useEffect(() => {
    if (isOpen && hasApiKey && !status.is_running && !isStarting) {
      startSidecar(apiKey, model);
    }
  }, [isOpen, hasApiKey, status.is_running, isStarting, apiKey, model, startSidecar]);

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

  const { messages, isLoading, sendMessage, clearHistory, regenerateLastResponse, stopGeneration } = useChat({ context, model });

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
    <div className="chat-sidebar" style={{ width: sidebarWidth }}>
      <div className="chat-resize-handle" onMouseDown={handleResizeStart} />
      <div className="chat-header">
        <div className="chat-header-title">
          <span
            className={`status-dot ${
              status.is_running
                ? "status-running"
                : isStarting
                ? "status-starting"
                : status.error
                ? "status-error"
                : "status-offline"
            }`}
            title={
              status.is_running
                ? "AI assistant is running"
                : isStarting
                ? "Starting..."
                : status.error
                ? "Error - click Settings to troubleshoot"
                : "AI assistant is offline"
            }
          />
          <h3>PacketPilot AI</h3>
        </div>
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
          {isStarting ? (
            <div className="starting-container">
              <div className="starting-spinner" />
              <p className="starting-title">Starting AI assistant</p>
              <p className="starting-hint">This may take a few seconds...</p>
            </div>
          ) : (
            <>
              <p>AI assistant is not running</p>
              <button
                className="start-sidecar-btn"
                onClick={handleStartSidecar}
              >
                Start AI Assistant
              </button>
            </>
          )}
          {status.error && (
            <div className="error-box">
              <p className="error-title">{getErrorInfo(status.error).message}</p>
              <p className="error-hint">{getErrorInfo(status.error).hint}</p>
            </div>
          )}
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
            {messages.map((msg, index) => {
              // Check if this is the last assistant message
              const isLatestAssistant =
                msg.role === "assistant" &&
                index === messages.findLastIndex((m) => m.role === "assistant");

              return (
                <ChatMessage
                  key={msg.id}
                  message={msg}
                  onAction={handleAction}
                  onRegenerate={regenerateLastResponse}
                  isLatestAssistant={isLatestAssistant}
                />
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          <ChatInput
            onSend={sendMessage}
            isLoading={isLoading}
            disabled={!status.is_running}
            onStop={stopGeneration}
          />
        </>
      )}
    </div>
  );
}
