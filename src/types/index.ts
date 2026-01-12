// ============================================
// Packet & Frame Types
// ============================================

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
  l: string; // label
  t?: string; // type
  s?: string; // severity
  e?: number; // expert info flag
  n?: ProtoNode[]; // children nodes (nested)
  h?: [number, number]; // highlight bytes [offset, length]
  f?: string; // field name
  v?: string; // value
}

export interface FrameDetails {
  tree?: ProtoNode[];
  bytes?: string;
  fol?: number[][]; // follow data
}

// ============================================
// API Response Types
// ============================================

export interface LoadResult {
  success: boolean;
  frame_count: number;
  duration: number | null;
  error: string | null;
}

export interface FramesResult {
  frames: FrameData[];
  total: number;
}

export interface SharkdStatus {
  frames?: number;
  duration?: number;
  filename?: string;
}

// ============================================
// UI State Types
// ============================================

export interface CaptureInfo {
  fileName: string | null;
  duration: number | null;
  totalFrames: number;
  fileSize?: string;
  firstPacketTime?: string;
  lastPacketTime?: string;
  avgPacketRate?: number;
}

export interface ContextMenuState {
  x: number;
  y: number;
  frame: FrameData;
}

export interface ColumnWidths {
  no: number;
  time: number;
  source: number;
  dest: number;
  proto: number;
  len: number;
  info: number;
}

// ============================================
// Component Props Types
// ============================================

export interface PacketGridRef {
  scrollToFrame: (frameNumber: number) => void;
}

export type Theme = "dark" | "light";

// ============================================
// Frame Cache Types
// ============================================

export interface FrameCacheConfig {
  /** Maximum frames to keep in memory */
  maxSize: number;
  /** Frames per request chunk */
  chunkSize: number;
  /** Extra frames to prefetch beyond visible range */
  prefetchDistance: number;
}

// ============================================
// Chat & AI Types
// ============================================

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
  context: {
    selected_packet_id: number | null;
    selected_stream_id: number | null;
    visible_range: { start: number; end: number };
    current_filter: string;
    file_name: string | null;
    total_frames: number;
  };
  conversation_history: ChatMessage[];
}

export interface AnalyzeResponse {
  message: string;
  suggested_filter?: string;
  suggested_action?: "apply_filter" | "go_to_packet" | "follow_stream";
  action_payload?: unknown;
}

export interface FilterRequest {
  query: string;
  context: CaptureContext;
}

export interface FilterResponse {
  filter: string;
  is_valid: boolean;
  explanation: string;
}

export interface SidecarStatus {
  is_running: boolean;
  port: number;
  version?: string;
  error?: string;
}
