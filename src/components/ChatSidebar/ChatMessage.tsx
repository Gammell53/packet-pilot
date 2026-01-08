import { useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import type { ChatMessage as ChatMessageType } from "../../types";

interface ChatMessageProps {
  message: ChatMessageType;
  onAction: (action: string, payload: unknown) => void;
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

export function ChatMessage({ message, onAction: _onAction }: ChatMessageProps) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  return (
    <div
      className={`chat-message ${isUser ? "user" : isSystem ? "system" : "assistant"}`}
    >
      <div className="message-content">
        {message.isStreaming && <span className="streaming-indicator" />}
        <div className="message-text">
          {isUser || isSystem ? (
            message.content
          ) : (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                code: CodeBlock,
              }}
            >
              {message.content}
            </ReactMarkdown>
          )}
        </div>
      </div>
    </div>
  );
}
