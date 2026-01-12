import { useState, useCallback, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { MessageActions } from "./MessageActions";
import type { ChatMessage as ChatMessageType } from "../../types";

interface ChatMessageProps {
  message: ChatMessageType;
  onAction: (action: string, payload: unknown) => void;
  onRegenerate?: () => void;
  isLatestAssistant?: boolean;
}

interface CodeBlockProps {
  inline?: boolean;
  className?: string;
  children?: React.ReactNode;
}

function CodeBlock({ inline, className, children }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const match = /language-(\w+)/.exec(className || "");
  const language = match ? match[1] : "";
  const codeString = String(children).replace(/\n$/, "");
  const isMultiLine = codeString.includes("\n");
  const isShort = codeString.length < 60 && !isMultiLine;

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(codeString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [codeString]);

  // Inline code or short single-line snippets: render simply
  if (inline || isShort) {
    return <code className="inline-code">{children}</code>;
  }

  // Multi-line or long code: render with header and syntax highlighting
  return (
    <div className="code-block">
      <div className="code-block-header">
        <span className="code-language">{language || "text"}</span>
        <button className="copy-button" onClick={handleCopy}>
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <SyntaxHighlighter
        style={oneDark}
        language={language || "text"}
        PreTag="div"
        customStyle={{
          margin: 0,
          borderRadius: "0 0 6px 6px",
          fontSize: "12px",
        }}
      >
        {codeString}
      </SyntaxHighlighter>
    </div>
  );
}

// Streaming indicator with bouncing dots
function StreamingIndicator() {
  return (
    <span className="streaming-indicator">
      <span className="dot" />
      <span className="dot" />
      <span className="dot" />
    </span>
  );
}

export function ChatMessage({
  message,
  onAction,
  onRegenerate,
  isLatestAssistant,
}: ChatMessageProps) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";
  const isAssistant = message.role === "assistant";
  const isStreaming = message.isStreaming;

  const handleFeedback = useCallback(
    (type: "up" | "down") => {
      onAction("feedback", { messageId: message.id, type });
    },
    [message.id, onAction]
  );

  // Memoize markdown rendering for performance
  const renderedContent = useMemo(() => {
    if (isUser || isSystem) {
      return message.content;
    }

    // For assistant messages, render markdown
    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code: CodeBlock,
        }}
      >
        {message.content}
      </ReactMarkdown>
    );
  }, [message.content, isUser, isSystem]);

  return (
    <div
      className={`chat-message ${isUser ? "user" : isSystem ? "system" : "assistant"}`}
      data-message-id={message.id}
    >
      <div
        className="message-content"
        data-streaming={isStreaming ? "true" : undefined}
      >
        {isStreaming && <StreamingIndicator />}
        <div className="message-text">
          {renderedContent}
          {isStreaming && <span className="typing-cursor" />}
        </div>

        {/* Show message actions for completed assistant messages */}
        {!isStreaming && isAssistant && (
          <MessageActions
            content={message.content}
            role={message.role}
            onRegenerate={isLatestAssistant ? onRegenerate : undefined}
            onFeedback={handleFeedback}
          />
        )}
      </div>
    </div>
  );
}
