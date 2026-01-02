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
