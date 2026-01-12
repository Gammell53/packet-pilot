import { useState, useRef, useEffect } from "react";

interface ChatInputProps {
  onSend: (message: string) => void;
  isLoading: boolean;
  disabled?: boolean;
  onStop?: () => void;
}

export function ChatInput({ onSend, isLoading, disabled, onStop }: ChatInputProps) {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Focus textarea when component mounts
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading || disabled) return;

    onSend(input.trim());
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <form className="chat-input-container" onSubmit={handleSubmit}>
      <textarea
        ref={textareaRef}
        className="chat-input"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={disabled ? "Start sidecar first..." : "Ask about your packets..."}
        disabled={isLoading || disabled}
        rows={1}
      />
      {isLoading && onStop ? (
        <button
          type="button"
          className="stop-button"
          onClick={onStop}
          title="Stop generation"
        >
          Stop
        </button>
      ) : (
        <button
          type="submit"
          className="send-button"
          disabled={!input.trim() || isLoading || disabled}
        >
          Send
        </button>
      )}
    </form>
  );
}
