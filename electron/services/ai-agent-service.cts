import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import OpenAI from "openai";
import type {
  AppSettings,
  AiRuntimeDiagnostics,
  AiRuntimeStatus,
  AiStreamEvent,
  AnalyzeRequest,
  AnalyzeResult,
  AiToolCallTrace,
  CaptureStatsResponse,
  CaptureContext,
  FrameData,
  FrameDetails,
  RuntimeIssue,
  StreamResponse,
} from "../../shared/electron-api";

const SYSTEM_PROMPT = `You are PacketPilot, an expert network packet analysis assistant.

Use the provided tools whenever they would improve accuracy.
Prefer citing concrete frame numbers, IPs, ports, filters, stream ids, and protocol evidence.
Do not invent packets or protocol details that were not returned by tools.
Be concise and pragmatic.
When useful, suggest a Wireshark display filter in backticks.`;
const MAX_TOOL_ITERATIONS = 8;
const MAX_SELECTED_PACKET_CONTEXT_CHARS = 12_000;
const OPENROUTER_PROVIDER_PREFERENCES = {
  zdr: true,
  data_collection: "deny" as const,
};

export interface AiAgentClient {
  chat: {
    completions: {
      create(
        params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
        options: { signal: AbortSignal },
      ): Promise<AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>>;
    };
  };
}

export interface AiAgentDependencies {
  settings: {
    getSettings(): AppSettings;
  };
  sharkd: {
    getFrameDetails(frameNum: number): Promise<FrameDetails>;
    getCaptureStats(): Promise<CaptureStatsResponse>;
    searchPackets(filter: string, limit?: number, skip?: number): Promise<{
      frames: FrameData[];
      totalMatching: number;
      filterApplied: string;
    }>;
    getStream(streamId: number, protocol?: string, format?: string): Promise<StreamResponse>;
  };
  createClient(config: {
    apiKey: string;
    baseURL: string;
    defaultHeaders: Record<string, string>;
  }): AiAgentClient;
}

const TOOL_DEFINITIONS = [
  {
    type: "function",
    name: "get_capture_overview",
    description: "Get a high-level summary of the capture including protocol hierarchy, conversations, and endpoints.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "search_packets",
    description: "Search packets using a Wireshark display filter and return matching packet summaries.",
    parameters: {
      type: "object",
      properties: {
        filter: { type: "string", description: "Wireshark display filter" },
        limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
      },
      required: ["filter"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_packet_details",
    description: "Get full protocol dissection and raw bytes for a single packet frame.",
    parameters: {
      type: "object",
      properties: {
        packet_num: { type: "integer", minimum: 1 },
      },
      required: ["packet_num"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_stream",
    description: "Follow a TCP, UDP, or HTTP stream and return reconstructed payload text.",
    parameters: {
      type: "object",
      properties: {
        stream_id: { type: "integer", minimum: 0 },
        protocol: { type: "string", enum: ["TCP", "UDP", "HTTP"], default: "TCP" },
      },
      required: ["stream_id"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_conversations",
    description: "List TCP or UDP conversations with endpoints and traffic volume.",
    parameters: {
      type: "object",
      properties: {
        protocol: { type: "string", enum: ["tcp", "udp", "both"], default: "both" },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_endpoints",
    description: "List top endpoints by traffic volume.",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
      },
      additionalProperties: false,
    },
  },
] as const;

function compactFrames(frames: FrameData[], limit = 20): Array<Record<string, unknown>> {
  return frames.slice(0, limit).map((frame) => ({
    number: frame.number,
    time: frame.time,
    source: frame.source,
    destination: frame.destination,
    protocol: frame.protocol,
    length: frame.length,
    info: frame.info,
  }));
}

function buildContextString(context: CaptureContext): string {
  const parts = [
    context.fileName ? `Capture file: ${context.fileName}` : "No capture loaded",
    context.totalFrames > 0 ? `Total frames: ${context.totalFrames}` : null,
    context.currentFilter ? `Current filter: ${context.currentFilter}` : null,
    context.selectedPacketId ? `Selected packet: #${context.selectedPacketId}` : null,
    context.selectedStreamId !== null ? `Selected stream: ${context.selectedStreamId}` : null,
    `Visible range: ${context.visibleRange.start}-${context.visibleRange.end}`,
  ].filter(Boolean);

  return parts.join(" | ");
}

function historyToChatMessages(
  history: AnalyzeRequest["conversation_history"],
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  return history
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-10)
    .map((message) => ({
      role: message.role as "user" | "assistant",
      content: message.content,
    }));
}

function stringifySelectedPacketContext(context: unknown): string {
  const serialized = JSON.stringify(context);
  if (serialized.length <= MAX_SELECTED_PACKET_CONTEXT_CHARS) {
    return serialized;
  }

  return `${serialized.slice(0, MAX_SELECTED_PACKET_CONTEXT_CHARS)}\n... [truncated]`;
}

function extractSuggestedFilter(responseText: string): Pick<AnalyzeResult, "suggested_action" | "suggested_filter"> {
  const match = /`([^`]+)`/.exec(responseText);
  if (!match) {
    return {};
  }

  const candidate = match[1];
  if (!["==", "!=", "&&", "||", ".", "contains", "matches", ">", "<"].some((token) => candidate.includes(token))) {
    return {};
  }

  return {
    suggested_action: "apply_filter",
    suggested_filter: candidate,
  };
}

function formatAiError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const status = typeof error === "object" && error !== null && "status" in error && typeof (error as { status?: unknown }).status === "number"
    ? ((error as { status: number }).status)
    : null;
  const lowerMessage = message.toLowerCase();

  if (
    status === 401 ||
    lowerMessage.includes("unauthorized") ||
    lowerMessage.includes("invalid api key") ||
    lowerMessage.includes("incorrect api key")
  ) {
    return "OpenRouter API key was rejected. Update it in AI settings and try again.";
  }

  if (
    lowerMessage.includes("zero data retention") ||
    lowerMessage.includes("zdr") ||
    lowerMessage.includes("no endpoints found") ||
    lowerMessage.includes("no endpoint found")
  ) {
    return "The selected OpenRouter model does not currently have a Zero Data Retention route. Pick another ZDR-compatible model in AI settings.";
  }

  if (
    status === 429 ||
    lowerMessage.includes("429") ||
    lowerMessage.includes("quota") ||
    lowerMessage.includes("rate limit") ||
    lowerMessage.includes("rate_limit") ||
    lowerMessage.includes("insufficient_quota")
  ) {
    return "OpenRouter rejected the request with a quota or rate-limit error. Check your OpenRouter credits and model limits, then try again.";
  }

  return message;
}

function createDefaultDependencies(): AiAgentDependencies {
  const { settingsService } = require("./settings-service.cjs") as typeof import("./settings-service.cjs");
  const { sharkdService } = require("./sharkd-service.cjs") as typeof import("./sharkd-service.cjs");

  return {
    settings: settingsService,
    sharkd: sharkdService,
    createClient: (config) => new OpenAI(config),
  };
}

export class AiAgentService extends EventEmitter {
  private activeRequests = new Map<string, AbortController>();
  private started = false;
  private lastIssue: RuntimeIssue | null = null;

  constructor(private readonly dependencies: AiAgentDependencies = createDefaultDependencies()) {
    super();
  }

  private hasAuth(settings: { apiKey: string | null }): boolean {
    return Boolean(settings.apiKey);
  }

  private getConfiguredApiKey(): string {
    const apiKey = this.dependencies.settings.getSettings().apiKey?.trim();
    if (!apiKey) {
      throw new Error("OpenRouter API key is required. Add it in AI settings.");
    }

    return apiKey;
  }

  async start(): Promise<AiRuntimeStatus> {
    const settings = this.dependencies.settings.getSettings();
    try {
      this.getConfiguredApiKey();
    } catch (error) {
      const message = formatAiError(error);
      this.recordIssue("startup", message, error);
      return {
        is_running: false,
        model: settings.model,
        error: message,
      };
    }

    this.started = true;
    this.lastIssue = null;
    return {
      is_running: true,
      model: settings.model,
    };
  }

  async stop(): Promise<void> {
    this.started = false;
    for (const controller of this.activeRequests.values()) {
      controller.abort();
    }
    this.activeRequests.clear();
  }

  async getStatus(): Promise<AiRuntimeStatus> {
    const settings = this.dependencies.settings.getSettings();
    const hasAuth = this.hasAuth(settings);
    return {
      is_running: this.started && hasAuth,
      model: settings.model,
      error: hasAuth ? this.lastIssue?.message : "OpenRouter API key is required. Add it in AI settings.",
    };
  }

  getDiagnostics(): AiRuntimeDiagnostics {
    const settings = this.dependencies.settings.getSettings();
    const hasAuth = this.hasAuth(settings);
    return {
      isRunning: this.started && hasAuth,
      configuredModel: settings.model,
      hasApiKey: hasAuth,
      activeRequestCount: this.activeRequests.size,
      lastIssue: this.lastIssue,
    };
  }

  async beginAnalyze(request: AnalyzeRequest): Promise<{ streamId: string }> {
    const status = await this.start();
    if (!status.is_running) {
      throw new Error(status.error ?? "AI runtime is not configured");
    }

    const streamId = randomUUID();
    const abortController = new AbortController();
    this.activeRequests.set(streamId, abortController);

    void this.runAnalyze(streamId, request, abortController).finally(() => {
      this.activeRequests.delete(streamId);
    });

    return { streamId };
  }

  async analyzeOnce(
    request: AnalyzeRequest,
    options: {
      signal?: AbortSignal;
      onTextDelta?: (delta: string) => void;
    } = {},
  ): Promise<AnalyzeResult> {
    const status = await this.start();
    if (!status.is_running) {
      throw new Error(status.error ?? "AI runtime is not configured");
    }

    const requestId = randomUUID();
    let emittedText = false;

    try {
      const result = await this.generateResponse(
        request,
        options.signal ?? new AbortController().signal,
        requestId,
        (delta) => {
          emittedText = true;
          options.onTextDelta?.(delta);
        },
      );

      if (!emittedText && result.message) {
        options.onTextDelta?.(result.message);
      }

      return result;
    } catch (error) {
      if (options.signal?.aborted) {
        throw error;
      }

      const message = formatAiError(error);
      this.recordIssue("runtime", message, error);
      throw new Error(message);
    }
  }

  async cancelAnalyze(streamId: string): Promise<void> {
    const controller = this.activeRequests.get(streamId);
    if (controller) {
      controller.abort();
    }
  }

  private async runAnalyze(streamId: string, request: AnalyzeRequest, abortController: AbortController): Promise<void> {
    const requestId = randomUUID();
    this.emitStream({ streamId, type: "meta", requestId });

    try {
      let emittedText = false;
      const result = await this.generateResponse(
        request,
        abortController.signal,
        requestId,
        (delta) => {
          emittedText = true;
          this.emitStream({ streamId, type: "text", text: delta });
        },
      );

      if (!emittedText && result.message) {
        this.emitStream({ streamId, type: "text", text: result.message });
      }

      this.emitStream({ streamId, type: "done", result });
    } catch (error) {
      if (abortController.signal.aborted) {
        this.emitStream({ streamId, type: "aborted" });
        return;
      }

      const message = formatAiError(error);
      this.recordIssue("runtime", message, error);
      this.emitStream({
        streamId,
        type: "error",
        error: message,
      });
    }
  }

  private async generateResponse(
    request: AnalyzeRequest,
    signal: AbortSignal,
    requestId: string,
    onTextDelta: (delta: string) => void,
  ): Promise<AnalyzeResult> {
    const apiKey = this.getConfiguredApiKey();
    const client = this.dependencies.createClient({
      apiKey,
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "HTTP-Referer": "https://packetpilot.dev",
        "X-Title": "PacketPilot",
      },
    });
    return this.runChatCompletionsLoop(client, request, signal, requestId, onTextDelta);
  }

  private async runChatCompletionsLoop(
    client: AiAgentClient,
    request: AnalyzeRequest,
    signal: AbortSignal,
    requestId: string,
    onTextDelta: (delta: string) => void,
  ): Promise<AnalyzeResult> {
    const settings = this.dependencies.settings.getSettings();

    const selectedPacketContext =
      request.context.selectedPacketId !== null
        ? await this.dependencies.sharkd.getFrameDetails(request.context.selectedPacketId)
        : null;

    const chatTools: OpenAI.Chat.Completions.ChatCompletionTool[] = TOOL_DEFINITIONS.map((t) => ({
      type: "function" as const,
      function: { name: t.name, description: t.description, parameters: t.parameters as any },
    }));

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: SYSTEM_PROMPT },
      ...historyToChatMessages(request.conversation_history),
      {
        role: "user",
        content: [
          buildContextString(request.context),
          "",
          selectedPacketContext
            ? `Selected packet details:\n${stringifySelectedPacketContext(selectedPacketContext)}`
            : null,
          `User query: ${request.query}`,
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ];

    const model = request.model || settings.model;
    const startedAt = performance.now();
    let fullText = "";
    let toolIterations = 0;
    const toolCalls: AiToolCallTrace[] = [];

    while (true) {
      const stream = await client.chat.completions.create(
        {
          model,
          messages,
          tools: chatTools,
          tool_choice: "auto",
          stream: true,
          provider: OPENROUTER_PROVIDER_PREFERENCES,
        } as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
        { signal },
      );

      let hasToolCalls = false;
      const pendingToolCalls: Array<{ id: string; name: string; arguments: string }> = [];

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          fullText += delta.content;
          onTextDelta(delta.content);
        }

        if (delta.tool_calls) {
          hasToolCalls = true;
          for (const tc of delta.tool_calls) {
            if (tc.index !== undefined) {
              while (pendingToolCalls.length <= tc.index) {
                pendingToolCalls.push({ id: "", name: "", arguments: "" });
              }
              if (tc.id) pendingToolCalls[tc.index].id = tc.id;
              if (tc.function?.name) pendingToolCalls[tc.index].name = tc.function.name;
              if (tc.function?.arguments) pendingToolCalls[tc.index].arguments += tc.function.arguments;
            }
          }
        }
      }

      if (!hasToolCalls || pendingToolCalls.length === 0) {
        break;
      }

      toolIterations += 1;
      if (toolIterations > MAX_TOOL_ITERATIONS) {
        throw new Error(`AI exceeded the maximum tool-call depth of ${MAX_TOOL_ITERATIONS}. Please try a narrower question.`);
      }

      // Add assistant message with tool calls
      messages.push({
        role: "assistant",
        content: null,
        tool_calls: pendingToolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: tc.arguments },
        })),
      });

      // Execute tools and add results
      for (const tc of pendingToolCalls) {
        const args = this.safeParseArguments(tc.arguments);
        toolCalls.push({
          id: tc.id,
          name: tc.name,
          arguments: { ...args },
        });
        const result = await this.executeTool(tc.name, args);
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify(result),
        });
      }
    }

    const message = fullText.trim() || "I couldn't generate a response. Please try again.";

    return {
      message,
      request_id: requestId,
      model,
      tool_calls: toolCalls,
      tool_count: toolCalls.length,
      latency_ms: Math.round(performance.now() - startedAt),
      ...extractSuggestedFilter(message),
    };
  }

  private safeParseArguments(raw: unknown): Record<string, unknown> {
    if (typeof raw !== "string" || raw.trim() === "") {
      return {};
    }

    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  private async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case "get_capture_overview": {
        const stats = await this.dependencies.sharkd.getCaptureStats();
        return {
          summary: stats.summary,
          top_protocols: stats.protocol_hierarchy.slice(0, 10),
          top_tcp_conversations: stats.tcp_conversations.slice(0, 10),
          top_udp_conversations: stats.udp_conversations.slice(0, 10),
          top_endpoints: stats.endpoints.slice(0, 10),
        };
      }
      case "search_packets": {
        const filter = typeof args.filter === "string" ? args.filter : "";
        const limit = typeof args.limit === "number" ? Math.min(Math.max(args.limit, 1), 200) : 50;
        const result = await this.dependencies.sharkd.searchPackets(filter, limit);
        return {
          filter: result.filterApplied,
          total_matching: result.totalMatching,
          frames: compactFrames(result.frames, limit),
        };
      }
      case "get_packet_details": {
        const packetNum = Number(args.packet_num ?? 0);
        return this.dependencies.sharkd.getFrameDetails(packetNum);
      }
      case "get_stream": {
        const streamId = Number(args.stream_id ?? 0);
        const protocol = typeof args.protocol === "string" ? args.protocol : "TCP";
        const stream = await this.dependencies.sharkd.getStream(streamId, protocol, "ascii");
        const combined = stream.combined_text ?? "";
        return {
          server: stream.server,
          client: stream.client,
          server_bytes: stream.server_bytes,
          client_bytes: stream.client_bytes,
          combined_text: combined.length > 5000 ? `${combined.slice(0, 5000)}\n... [truncated]` : combined,
        };
      }
      case "get_conversations": {
        const stats = await this.dependencies.sharkd.getCaptureStats();
        const protocol = typeof args.protocol === "string" ? args.protocol : "both";
        const limit = typeof args.limit === "number" ? Math.min(Math.max(args.limit, 1), 100) : 20;
        return {
          protocol,
          conversations: [
            ...(protocol === "udp"
              ? []
              : stats.tcp_conversations.map((item: (typeof stats.tcp_conversations)[number]) => ({
                  protocol: "tcp",
                  ...item,
                }))),
            ...(protocol === "tcp"
              ? []
              : stats.udp_conversations.map((item: (typeof stats.udp_conversations)[number]) => ({
                  protocol: "udp",
                  ...item,
                }))),
          ].slice(0, limit),
        };
      }
      case "get_endpoints": {
        const stats = await this.dependencies.sharkd.getCaptureStats();
        const limit = typeof args.limit === "number" ? Math.min(Math.max(args.limit, 1), 100) : 20;
        return {
          endpoints: stats.endpoints.slice(0, limit),
        };
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  private emitStream(event: AiStreamEvent): void {
    this.emit("stream-event", event);
  }

  private recordIssue(stage: RuntimeIssue["stage"], message: string, error?: unknown): void {
    this.lastIssue = {
      source: "ai",
      stage,
      message,
      detail: error instanceof Error ? error.stack ?? error.message : undefined,
      timestamp: new Date().toISOString(),
    };
  }
}

export const aiAgentService = new AiAgentService();
