import { useState, useCallback, useRef } from "react";
import type { ChatMessage, CaptureContext } from "../types";

const SIDECAR_URL = "http://127.0.0.1:8765";
const THROTTLE_MS = 50; // Update UI every 50ms for smooth rendering

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
    context: msg.context
      ? {
          selected_packet_id: msg.context.selectedPacketId,
          selected_stream_id: msg.context.selectedStreamId,
          visible_range: msg.context.visibleRange,
          current_filter: msg.context.currentFilter,
          file_name: msg.context.fileName,
          total_frames: msg.context.totalFrames,
        }
      : null,
  };
}

export function useChat({ context, model }: UseChatOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Refs for throttled streaming updates
  const streamBufferRef = useRef<string>("");
  const lastUpdateRef = useRef<number>(0);
  const currentAssistantIdRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(
    async (content: string, regenerateFromId?: string) => {
      // Cancel any existing stream
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();

      // If regenerating, remove the message being regenerated
      let historyForApi = messages;
      if (regenerateFromId) {
        const msgIndex = messages.findIndex((m) => m.id === regenerateFromId);
        if (msgIndex >= 0) {
          // Remove the assistant message and use content from the user message before it
          historyForApi = messages.slice(0, msgIndex);
          setMessages(historyForApi);
        }
      } else {
        // Add user message for new messages
        const userMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: "user",
          content,
          timestamp: Date.now(),
          context,
        };
        setMessages((prev) => [...prev, userMessage]);
        historyForApi = [...messages, userMessage];
      }

      // Create placeholder assistant message
      const assistantId = crypto.randomUUID();
      currentAssistantIdRef.current = assistantId;

      setMessages((prev) => [
        ...prev,
        {
          id: assistantId,
          role: "assistant",
          content: "",
          timestamp: Date.now(),
          isStreaming: true,
        },
      ]);

      setIsLoading(true);
      streamBufferRef.current = "";
      lastUpdateRef.current = 0;

      try {
        const response = await fetch(`${SIDECAR_URL}/analyze/stream`, {
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
            conversation_history: historyForApi.slice(-10).map(toApiMessage),
            model: model || undefined,
          }),
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();

        if (!reader) {
          throw new Error("No response body");
        }

        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Process complete SSE lines
          const lines = buffer.split("\n");
          buffer = lines.pop() || ""; // Keep incomplete line in buffer

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;

            const data = line.slice(6);

            // Handle completion
            if (data === "[DONE]") {
              continue;
            }

            try {
              const parsed = JSON.parse(data);

              // Handle error from backend
              if (parsed.error) {
                throw new Error(parsed.error);
              }

              // Handle text chunk
              if (parsed.text) {
                streamBufferRef.current += parsed.text;

                // Throttled update
                const now = Date.now();
                if (now - lastUpdateRef.current >= THROTTLE_MS) {
                  const currentContent = streamBufferRef.current;
                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === assistantId
                        ? { ...msg, content: currentContent }
                        : msg
                    )
                  );
                  lastUpdateRef.current = now;
                }
              }
            } catch (e) {
              // JSON parse error - might be incomplete, ignore
              if (e instanceof SyntaxError) continue;
              throw e;
            }
          }
        }

        // Final update with complete content
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantId
              ? { ...msg, content: streamBufferRef.current, isStreaming: false }
              : msg
          )
        );
      } catch (error) {
        // Don't show error if we aborted
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }

        // Remove the streaming placeholder and add error message
        setMessages((prev) => {
          const withoutStreaming = prev.filter((m) => m.id !== assistantId);
          return [
            ...withoutStreaming,
            {
              id: crypto.randomUUID(),
              role: "system",
              content: `Error: ${error instanceof Error ? error.message : "Failed to connect to AI"}`,
              timestamp: Date.now(),
            },
          ];
        });
      } finally {
        setIsLoading(false);
        currentAssistantIdRef.current = null;
        abortControllerRef.current = null;
      }
    },
    [context, messages, model]
  );

  const regenerateLastResponse = useCallback(() => {
    // Find the last assistant message
    const lastAssistantIndex = messages.findLastIndex(
      (m) => m.role === "assistant"
    );
    if (lastAssistantIndex < 0) return;

    // Find the user message before it
    const userMessageIndex = messages
      .slice(0, lastAssistantIndex)
      .findLastIndex((m) => m.role === "user");
    if (userMessageIndex < 0) return;

    const userMessage = messages[userMessageIndex];
    const assistantMessage = messages[lastAssistantIndex];

    // Regenerate from that assistant message
    sendMessage(userMessage.content, assistantMessage.id);
  }, [messages, sendMessage]);

  const stopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, []);

  const clearHistory = useCallback(() => {
    stopGeneration();
    setMessages([]);
  }, [stopGeneration]);

  return {
    messages,
    isLoading,
    sendMessage,
    clearHistory,
    regenerateLastResponse,
    stopGeneration,
  };
}
