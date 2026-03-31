export type Theme = "dark" | "light";

export interface FrameData {
  number: number;
  time: string;
  source: string;
  destination: string;
  protocol: string;
  length: string;
  info: string;
  background?: string;
  foreground?: string;
}

export interface ProtoNode {
  l: string;
  t?: string;
  s?: string;
  e?: number;
  n?: ProtoNode[];
  h?: [number, number];
  f?: string;
  v?: string;
}

export interface FrameDetails {
  tree?: ProtoNode[];
  bytes?: string;
  fol?: number[][];
}

export interface FramesResult {
  frames: FrameData[];
  total: number;
}

export interface LoadResult {
  success: boolean;
  frame_count: number;
  duration: number | null;
  error: string | null;
}

export interface SharkdStatus {
  frames?: number;
  duration?: number;
  filename?: string;
}

export interface EndpointInfo {
  host: string;
  port: string;
}

export interface StreamSegment {
  direction: string;
  size: number;
  data: string;
}

export interface StreamResponse {
  server: EndpointInfo;
  client: EndpointInfo;
  server_bytes: number;
  client_bytes: number;
  segments: StreamSegment[];
  combined_text: string | null;
}

export interface InstallIssue {
  code: string;
  message: string;
  path?: string;
}

export interface InstallHealthStatus {
  ok: boolean;
  issues: InstallIssue[];
  checked_paths: string[];
  recommended_action: string;
}

export interface RuntimeIssue {
  source: "sharkd" | "ai";
  stage: "startup" | "runtime";
  message: string;
  detail?: string;
  timestamp: string;
}

export interface SharkdRuntimeDiagnostics {
  isRunning: boolean;
  activeFilter: string;
  resolvedPath: string | null;
  bundledCandidates: string[];
  systemCandidates: string[];
  lastKnownStatus: SharkdStatus | null;
  installHealth: InstallHealthStatus;
  lastIssue: RuntimeIssue | null;
}

export interface AiRuntimeDiagnostics {
  isRunning: boolean;
  configuredModel: string;
  hasApiKey: boolean;
  activeRequestCount: number;
  lastIssue: RuntimeIssue | null;
}

export interface RuntimeDiagnostics {
  appVersion: string;
  platform: string;
  arch: string;
  isPackaged: boolean;
  appPath: string;
  resourcesPath: string;
  userDataPath: string;
  issues: RuntimeIssue[];
  sharkd: SharkdRuntimeDiagnostics;
  ai: AiRuntimeDiagnostics;
}

export interface ProtocolNodeResponse {
  protocol: string;
  frames: number;
  bytes: number;
  children: ProtocolNodeResponse[];
}

export interface ConversationResponse {
  src_addr: string;
  dst_addr: string;
  src_port?: string | null;
  dst_port?: string | null;
  rx_frames: number;
  rx_bytes: number;
  tx_frames: number;
  tx_bytes: number;
  filter?: string | null;
}

export interface EndpointResponse {
  host: string;
  port?: string | null;
  rx_frames: number;
  rx_bytes: number;
  tx_frames: number;
  tx_bytes: number;
}

export interface CaptureStatsResponse {
  summary: {
    total_frames: number;
    duration: number | null;
    protocol_count: number;
    tcp_conversation_count: number;
    udp_conversation_count: number;
    endpoint_count: number;
  };
  protocol_hierarchy: ProtocolNodeResponse[];
  tcp_conversations: ConversationResponse[];
  udp_conversations: ConversationResponse[];
  endpoints: EndpointResponse[];
}

export interface CaptureContext {
  selectedPacketId: number | null;
  selectedStreamId: number | null;
  visibleRange: { start: number; end: number };
  currentFilter: string;
  fileName: string | null;
  totalFrames: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  context?: CaptureContext;
  isStreaming?: boolean;
  feedback?: "up" | "down";
}

export interface AnalyzeRequest {
  query: string;
  context: CaptureContext;
  conversation_history: ChatMessage[];
  model?: string;
}

export interface AnalyzeResult {
  message: string;
  suggested_filter?: string;
  suggested_action?: "apply_filter" | "go_to_packet" | "follow_stream";
  action_payload?: unknown;
  request_id?: string;
  model?: string;
  tool_calls?: AiToolCallTrace[];
  tool_count?: number;
  latency_ms?: number;
}

export interface AiModelOption {
  id: string;
  name: string;
  description: string;
}

export interface AiToolCallTrace {
  id?: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type AiStreamEvent =
  | { streamId: string; type: "meta"; requestId: string }
  | { streamId: string; type: "text"; text: string }
  | { streamId: string; type: "done"; result: AnalyzeResult }
  | { streamId: string; type: "aborted" }
  | { streamId: string; type: "error"; error: string };

export interface AppSettings {
  model: string;
  apiKey: string | null;
}

export interface AiRuntimeStatus {
  is_running: boolean;
  model?: string;
  error?: string;
}

export interface PacketPilotApi {
  app: {
    getRuntimeDiagnostics(): Promise<RuntimeDiagnostics>;
    getStartupCapturePath(): Promise<string | null>;
  };
  files: {
    openCapture(): Promise<string | null>;
    openExternal(url: string): Promise<void>;
  };
  sharkd: {
    init(): Promise<string>;
    loadPcap(path: string): Promise<LoadResult>;
    getFrames(skip: number, limit: number, filter?: string): Promise<FramesResult>;
    getStatus(): Promise<SharkdStatus>;
    checkFilter(filter: string): Promise<boolean>;
    applyFilter(filter: string): Promise<number>;
    getFrameDetails(frameNum: number): Promise<FrameDetails>;
    getStream(streamId: number, protocol?: string, format?: string): Promise<StreamResponse>;
    getCaptureStats(): Promise<CaptureStatsResponse>;
    getInstallHealth(): Promise<InstallHealthStatus>;
    onError(callback: (message: string) => void): () => void;
  };
  ai: {
    start(): Promise<AiRuntimeStatus>;
    stop(): Promise<void>;
    getStatus(): Promise<AiRuntimeStatus>;
    beginAnalyze(request: AnalyzeRequest): Promise<{ streamId: string }>;
    cancelAnalyze(streamId: string): Promise<void>;
    onStreamEvent(callback: (event: AiStreamEvent) => void): () => void;
  };
  settings: {
    get(): Promise<AppSettings>;
    getAvailableModels(): Promise<AiModelOption[]>;
    setApiKey(apiKey: string | null): Promise<AppSettings>;
    setModel(model: string): Promise<AppSettings>;
  };
}
