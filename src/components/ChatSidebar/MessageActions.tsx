import { useState, useCallback } from "react";

interface MessageActionsProps {
  content: string;
  role: "user" | "assistant" | "system";
  onRegenerate?: () => void;
  onFeedback?: (type: "up" | "down") => void;
}

// Simple inline SVG icons (no external dependencies)
const CopyIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
  </svg>
);

const CheckIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="20,6 9,17 4,12" />
  </svg>
);

const RefreshIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M23 4v6h-6" />
    <path d="M1 20v-6h6" />
    <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
  </svg>
);

const ThumbsUpIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M14 9V5a3 3 0 00-3-3l-4 9v11h11.28a2 2 0 002-1.7l1.38-9a2 2 0 00-2-2.3zM7 22H4a2 2 0 01-2-2v-7a2 2 0 012-2h3" />
  </svg>
);

const ThumbsDownIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M10 15v4a3 3 0 003 3l4-9V2H5.72a2 2 0 00-2 1.7l-1.38 9a2 2 0 002 2.3zm7-13h2.67A2.31 2.31 0 0122 4v7a2.31 2.31 0 01-2.33 2H17" />
  </svg>
);

export function MessageActions({
  content,
  role,
  onRegenerate,
  onFeedback,
}: MessageActionsProps) {
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<"up" | "down" | null>(null);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [content]);

  const handleFeedback = useCallback(
    (type: "up" | "down") => {
      setFeedback(type);
      onFeedback?.(type);
    },
    [onFeedback]
  );

  // Only show actions for assistant messages
  if (role !== "assistant") return null;

  return (
    <div className="message-actions">
      <button
        className={`action-button ${copied ? "active" : ""}`}
        onClick={handleCopy}
        title="Copy message"
        aria-label="Copy message"
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </button>

      {onRegenerate && (
        <button
          className="action-button"
          onClick={onRegenerate}
          title="Regenerate response"
          aria-label="Regenerate response"
        >
          <RefreshIcon />
        </button>
      )}

      {onFeedback && (
        <>
          <button
            className={`action-button ${feedback === "up" ? "active" : ""}`}
            onClick={() => handleFeedback("up")}
            title="Good response"
            aria-label="Good response"
          >
            <ThumbsUpIcon />
          </button>
          <button
            className={`action-button ${feedback === "down" ? "active negative" : ""}`}
            onClick={() => handleFeedback("down")}
            title="Poor response"
            aria-label="Poor response"
          >
            <ThumbsDownIcon />
          </button>
        </>
      )}
    </div>
  );
}
