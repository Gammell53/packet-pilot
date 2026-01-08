import { useState, useCallback } from "react";
import type { ChatMessage, CaptureContext, AnalyzeResponse } from "../types";

const SIDECAR_URL = "http://127.0.0.1:8765";

interface UseChatOptions {
  context: CaptureContext;
  model?: string;
}

// Convert message to API format (snake_case, strip unnecessary fields)
function toApiMessage(msg: ChatMessage) {
  return {
    id: msg.id,
    role: msg.role,
    content: msg.content,
    timestamp: msg.timestamp,
    context: msg.context ? {
      selected_packet_id: msg.context.selectedPacketId,
      selected_stream_id: msg.context.selectedStreamId,
      visible_range: msg.context.visibleRange,
      current_filter: msg.context.currentFilter,
      file_name: msg.context.fileName,
      total_frames: msg.context.totalFrames,
    } : null,
  };
}

export function useChat({ context, model }: UseChatOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const sendMessage = useCallback(
    async (content: string) => {
      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content,
        timestamp: Date.now(),
        context,
      };

      setMessages((prev) => [...prev, userMessage]);
      setIsLoading(true);

      try {
        const response = await fetch(`${SIDECAR_URL}/analyze`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: content,
            context: {
              selected_packet_id: context.selectedPacketId,
              selected_stream_id: context.selectedStreamId,
              visible_range: context.visibleRange,
              current_filter: context.currentFilter,
              file_name: context.fileName,
              total_frames: context.totalFrames,
            },
            conversation_history: messages.slice(-10).map(toApiMessage),
            model: model || undefined,
          }),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data: AnalyzeResponse = await response.json();

        const assistantMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: data.message,
          timestamp: Date.now(),
        };

        setMessages((prev) => [...prev, assistantMessage]);
      } catch (error) {
        const errorMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: "system",
          content: `Error: ${error instanceof Error ? error.message : "Failed to connect to AI"}`,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, errorMessage]);
      } finally {
        setIsLoading(false);
      }
    },
    [context, messages, model]
  );

  const clearHistory = useCallback(() => {
    setMessages([]);
  }, []);

  return { messages, isLoading, sendMessage, clearHistory };
}
