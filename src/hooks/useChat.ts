import { useState, useCallback, useRef, useEffect } from "react";
import type { ChatMessage, CaptureContext } from "../types";
import { desktop } from "../lib/desktop";

const THROTTLE_MS = 50;

interface UseChatOptions {
  context: CaptureContext;
  selectedModel: string;
}

function toApiMessage(message: ChatMessage) {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    timestamp: message.timestamp,
    context: message.context,
  };
}

export function useChat({ context, selectedModel }: UseChatOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const streamBufferRef = useRef("");
  const lastUpdateRef = useRef(0);
  const requestVersionRef = useRef(0);
  const currentAssistantIdRef = useRef<string | null>(null);
  const currentStreamIdRef = useRef<string | null>(null);

  const finalizeAssistantMessage = useCallback((assistantId: string | null, content: string) => {
    if (!assistantId) {
      return;
    }

    setMessages((prev) =>
      prev.map((message) =>
        message.id === assistantId
          ? { ...message, content, isStreaming: false }
          : message,
      ),
    );
  }, []);

  const resetActiveStreamState = useCallback(() => {
    currentAssistantIdRef.current = null;
    currentStreamIdRef.current = null;
    streamBufferRef.current = "";
    lastUpdateRef.current = 0;
  }, []);

  useEffect(() => {
    const unsubscribe = desktop.ai.onStreamEvent((event) => {
      if (event.streamId !== currentStreamIdRef.current) {
        return;
      }

      if (event.type === "text") {
        streamBufferRef.current += event.text;
        const now = Date.now();
        if (now - lastUpdateRef.current >= THROTTLE_MS) {
          const assistantId = currentAssistantIdRef.current;
          if (!assistantId) return;

          setMessages((prev) =>
            prev.map((message) =>
              message.id === assistantId
                ? { ...message, content: streamBufferRef.current }
                : message,
            ),
          );
          lastUpdateRef.current = now;
        }
        return;
      }

      if (event.type === "done") {
        const assistantId = currentAssistantIdRef.current;
        const finalContent = event.result.message || streamBufferRef.current;
        finalizeAssistantMessage(assistantId, finalContent);
        setIsLoading(false);
        resetActiveStreamState();
        return;
      }

      if (event.type === "aborted") {
        finalizeAssistantMessage(currentAssistantIdRef.current, streamBufferRef.current);
        setIsLoading(false);
        resetActiveStreamState();
        return;
      }

      if (event.type === "error") {
        const assistantId = currentAssistantIdRef.current;
        setMessages((prev) => {
          const withoutStreaming = assistantId ? prev.filter((message) => message.id !== assistantId) : prev;
          return [
            ...withoutStreaming,
            {
              id: crypto.randomUUID(),
              role: "system",
              content: `Error: ${event.error}`,
              timestamp: Date.now(),
            },
          ];
        });
        setIsLoading(false);
        resetActiveStreamState();
      }
    });

    return unsubscribe;
  }, [finalizeAssistantMessage, resetActiveStreamState]);

  const sendMessage = useCallback(
    async (content: string, regenerateFromId?: string) => {
      requestVersionRef.current += 1;
      const requestVersion = requestVersionRef.current;

      const previousAssistantId = currentAssistantIdRef.current;
      const previousStreamId = currentStreamIdRef.current;
      const previousContent = streamBufferRef.current;

      if (previousAssistantId) {
        finalizeAssistantMessage(previousAssistantId, previousContent);
      }
      resetActiveStreamState();

      if (previousStreamId) {
        void desktop.ai.cancelAnalyze(previousStreamId);
      }

      let historyForApi = messages;
      let requestModel = selectedModel;
      if (regenerateFromId) {
        const messageIndex = messages.findIndex((message) => message.id === regenerateFromId);
        if (messageIndex >= 0) {
          const messageToRegenerate = messages[messageIndex];
          if (messageToRegenerate?.role === "assistant" && messageToRegenerate.model) {
            requestModel = messageToRegenerate.model;
          }
          historyForApi = messages.slice(0, messageIndex);
          setMessages(historyForApi);
        }
      } else {
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

      const assistantId = crypto.randomUUID();
      currentAssistantIdRef.current = assistantId;
      streamBufferRef.current = "";
      lastUpdateRef.current = 0;

      setMessages((prev) => [
        ...prev,
        {
          id: assistantId,
          role: "assistant",
          model: requestModel,
          content: "",
          timestamp: Date.now(),
          isStreaming: true,
        },
      ]);

      setIsLoading(true);

      try {
        const { streamId } = await desktop.ai.beginAnalyze({
          query: content,
          context,
          conversation_history: historyForApi.slice(-10).map(toApiMessage),
          model: requestModel || undefined,
        });
        if (requestVersion !== requestVersionRef.current) {
          void desktop.ai.cancelAnalyze(streamId);
          return;
        }
        currentStreamIdRef.current = streamId;
      } catch (error) {
        if (requestVersion !== requestVersionRef.current) {
          return;
        }
        setMessages((prev) => [
          ...prev.filter((message) => message.id !== assistantId),
          {
            id: crypto.randomUUID(),
            role: "system",
            content: `Error: ${error instanceof Error ? error.message : "Failed to connect to AI"}`,
            timestamp: Date.now(),
          },
        ]);
        setIsLoading(false);
        resetActiveStreamState();
      }
    },
    [context, finalizeAssistantMessage, messages, resetActiveStreamState, selectedModel],
  );

  const regenerateLastResponse = useCallback(() => {
    const lastAssistantIndex = messages.findLastIndex((message) => message.role === "assistant");
    if (lastAssistantIndex < 0) {
      return;
    }

    const userIndex = messages
      .slice(0, lastAssistantIndex)
      .findLastIndex((message) => message.role === "user");
    if (userIndex < 0) {
      return;
    }

    const userMessage = messages[userIndex];
    const assistantMessage = messages[lastAssistantIndex];
    void sendMessage(userMessage.content, assistantMessage.id);
  }, [messages, sendMessage]);

  const stopGeneration = useCallback(() => {
    requestVersionRef.current += 1;
    const activeStreamId = currentStreamIdRef.current;
    finalizeAssistantMessage(currentAssistantIdRef.current, streamBufferRef.current);
    resetActiveStreamState();
    setIsLoading(false);

    if (activeStreamId) {
      void desktop.ai.cancelAnalyze(activeStreamId);
    }
  }, [finalizeAssistantMessage, resetActiveStreamState]);

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
