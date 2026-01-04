import type { ChatMessage as ChatMessageType } from "../../types";

interface ChatMessageProps {
  message: ChatMessageType;
  onAction: (action: string, payload: unknown) => void;
}

export function ChatMessage({ message, onAction: _onAction }: ChatMessageProps) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  return (
    <div
      className={`chat-message ${isUser ? "user" : isSystem ? "system" : "assistant"}`}
    >
      <div className="message-content">
        {message.isStreaming && <span className="streaming-indicator" />}
        <div className="message-text">{message.content}</div>
      </div>
    </div>
  );
}
