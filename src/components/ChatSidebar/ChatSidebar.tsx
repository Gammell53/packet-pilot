import { useRef, useEffect, useState, useCallback } from "react";
import { ChatMessage } from "./ChatMessage";
import { ChatInput } from "./ChatInput";
import { ProviderSetup } from "./ProviderSetup";
import { useChat } from "../../hooks/useChat";
import { useAiRuntime } from "../../hooks/useAiRuntime";
import { useSettings } from "../../hooks/useSettings";
import type { CaptureContext } from "../../types";
import { getDefaultModel } from "../../constants/models";
import "./ChatSidebar.css";

function getErrorInfo(error: string): { message: string; hint: string } {
  const value = error.toLowerCase();

  if (value.includes("429") || value.includes("quota") || value.includes("rate limit") || value.includes("rate-limit")) {
    return {
      message: "OpenRouter quota exceeded",
      hint: "Check your OpenRouter credits and model limits, then try again.",
    };
  }

  if (value.includes("api") || value.includes("key") || value.includes("401") || value.includes("unauthorized")) {
    return {
      message: "OpenRouter key issue",
      hint: "Check your OpenRouter API key in settings.",
    };
  }

  if (value.includes("network") || value.includes("fetch") || value.includes("timeout")) {
    return {
      message: "Request failed",
      hint: "Check network connectivity and try again.",
    };
  }

  return {
    message: "Failed to start AI runtime",
    hint: error.length > 96 ? `${error.slice(0, 96)}...` : error,
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
}: ChatSidebarProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { status, runtimeDiagnostics, start, isStarting, refreshRuntimeDiagnostics } = useAiRuntime();
  const { settings, availableModels, hasConfiguredAuth, updateApiKey, updateModel } = useSettings();
  const [sidebarWidth, setSidebarWidth] = useState(380);
  const [showSetup, setShowSetup] = useState(false);
  const [selectedModel, setSelectedModel] = useState(settings.model);

  const handleResizeStart = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = startX - moveEvent.clientX;
      const nextWidth = Math.max(320, Math.min(800, startWidth + delta));
      setSidebarWidth(nextWidth);
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

  useEffect(() => {
    if (isOpen && hasConfiguredAuth && !status.is_running && !isStarting) {
      setShowSetup(false);
      void start();
    }
  }, [hasConfiguredAuth, isOpen, isStarting, start, status.is_running]);

  useEffect(() => {
    setSelectedModel((currentModel) => {
      if (availableModels.some((model) => model.id === currentModel)) {
        return currentModel;
      }

      if (availableModels.some((model) => model.id === settings.model)) {
        return settings.model;
      }

      return availableModels[0]?.id ?? getDefaultModel();
    });
  }, [availableModels, settings.model]);

  const context: CaptureContext = {
    selectedPacketId: selectedFrame,
    selectedStreamId: null,
    visibleRange,
    currentFilter,
    fileName,
    totalFrames,
  };

  const { messages, isLoading, sendMessage, clearHistory, regenerateLastResponse, stopGeneration } =
    useChat({ context, selectedModel });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && isOpen) {
        if (showSetup) {
          setShowSetup(false);
        } else {
          onClose();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, showSetup]);

  const handleAction = (action: string, payload: unknown) => {
    if (action === "apply_filter" && typeof payload === "string") {
      onApplyFilter(payload);
    } else if (action === "go_to_packet" && typeof payload === "number") {
      onGoToPacket(payload);
    }
  };

  const handleCopyDiagnostics = useCallback(async () => {
    try {
      const diagnostics = runtimeDiagnostics ?? (await refreshRuntimeDiagnostics());
      if (!diagnostics) {
        return;
      }

      await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2));
    } catch (error) {
      console.error("Failed to copy runtime diagnostics:", error);
    }
  }, [refreshRuntimeDiagnostics, runtimeDiagnostics]);

  const aiIssue = runtimeDiagnostics?.ai.lastIssue;

  const handleModelChange = useCallback((nextModel: string) => {
    setSelectedModel(nextModel);
    void updateModel(nextModel).catch((error) => {
      console.error("Failed to persist selected chat model:", error);
    });
  }, [updateModel]);

  if (!isOpen) return null;

  const showProviderSetup = !hasConfiguredAuth || showSetup;

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
                ? "Error"
                : "AI assistant is offline"
            }
          />
          <h3>PacketPilot AI</h3>
        </div>
        <div className="chat-header-actions">
          {hasConfiguredAuth && (
            <button
              className="icon-button"
              onClick={() => setShowSetup((v) => !v)}
              title={showSetup ? "Back to chat" : "AI settings"}
            >
              {showSetup ? "Chat" : "Settings"}
            </button>
          )}
          <button className="icon-button" onClick={clearHistory} title="Clear chat">
            Clear
          </button>
          <button className="icon-button" onClick={onClose} title="Close (Esc)">
            &times;
          </button>
        </div>
      </div>

      {showProviderSetup ? (
        <ProviderSetup
          settings={settings}
          onUpdateApiKey={updateApiKey}
        />
      ) : !status.is_running ? (
        <div className="chat-runtime-status">
          {isStarting ? (
            <div className="starting-container">
              <div className="starting-spinner" />
              <p className="starting-title">Starting AI assistant</p>
              <p className="starting-hint">Loading AI runtime...</p>
            </div>
          ) : (
            <>
              <p>AI assistant is not running</p>
              <button className="runtime-action-button" onClick={() => void start()}>
                Start AI Assistant
              </button>
            </>
          )}

          {status.error && (
            <div className="error-box">
              <p className="error-title">{getErrorInfo(status.error).message}</p>
              <p className="error-hint">{getErrorInfo(status.error).hint}</p>
              {aiIssue && (
                <details className="runtime-details">
                  <summary>Runtime diagnostics</summary>
                  <pre className="runtime-details-body">
                    {JSON.stringify(
                      {
                        issue: aiIssue,
                        ai: runtimeDiagnostics?.ai,
                      },
                      null,
                      2,
                    )}
                  </pre>
                </details>
              )}
              <button className="settings-link diagnostics-link" onClick={() => void handleCopyDiagnostics()}>
                Copy diagnostics
              </button>
            </div>
          )}

          <button className="settings-link" onClick={() => setShowSetup(true)}>
            OpenRouter settings
          </button>
        </div>
      ) : (
        <>
          <div className="chat-context-bar">
            {selectedFrame && <span>Packet #{selectedFrame}</span>}
            {currentFilter && <span>Filter: {currentFilter}</span>}
            {!selectedFrame && !currentFilter && (
              <span>{fileName ? `${totalFrames} packets` : "No capture loaded"}</span>
            )}
          </div>

          <div className="chat-messages">
            {messages.length === 0 && (
              <div className="chat-empty">
                <p>Ask me about your packet capture.</p>
                <p className="hint">Try: "Show me all HTTP requests"</p>
                <p className="hint">Or: "What stands out in this capture?"</p>
              </div>
            )}

            {messages.map((message, index) => {
              const isLatestAssistant =
                message.role === "assistant" &&
                index === messages.findLastIndex((entry) => entry.role === "assistant");

              return (
                <ChatMessage
                  key={message.id}
                  message={message}
                  onAction={handleAction}
                  onRegenerate={regenerateLastResponse}
                  isLatestAssistant={isLatestAssistant}
                />
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          <div className="chat-model-toolbar">
            <div className="chat-model-toolbar-copy">
              <span className="chat-model-toolbar-label">Chat model</span>
              <span className="chat-model-toolbar-hint">Changes apply to the next message</span>
            </div>
            <div className="chat-model-toolbar-control">
              <select
                value={selectedModel}
                onChange={(event) => handleModelChange(event.target.value)}
              >
                {availableModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))}
              </select>
            </div>
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
