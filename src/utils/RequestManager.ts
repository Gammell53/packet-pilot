import type { FrameData } from "../types";

interface PendingRequest {
  startFrame: number;
  endFrame: number;
  promise: Promise<FrameData[]>;
  timestamp: number;
}

/**
 * Manages frame data requests to prevent duplicates and enable cancellation.
 * Tracks in-flight requests and provides range overlap detection.
 */
export class RequestManager {
  private pending = new Map<string, PendingRequest>();
  private cancelled = new Set<string>();
  private requestIdCounter = 0;

  /**
   * Generate a unique key for a request range.
   */
  private rangeKey(start: number, end: number): string {
    return `${start}-${end}`;
  }

  /**
   * Check if a range is fully covered by an existing pending request.
   */
  isRangePending(start: number, end: number): boolean {
    for (const req of this.pending.values()) {
      if (req.startFrame <= start && req.endFrame >= end) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if a range overlaps with any pending request.
   */
  hasOverlappingRequest(start: number, end: number): boolean {
    for (const req of this.pending.values()) {
      // Check for any overlap
      if (req.startFrame <= end && req.endFrame >= start) {
        return true;
      }
    }
    return false;
  }

  /**
   * Find missing sub-ranges not covered by pending requests.
   */
  findUncoveredRanges(start: number, end: number): Array<[number, number]> {
    // Collect all pending ranges
    const covered: Array<[number, number]> = [];
    for (const req of this.pending.values()) {
      if (req.startFrame <= end && req.endFrame >= start) {
        covered.push([
          Math.max(start, req.startFrame),
          Math.min(end, req.endFrame),
        ]);
      }
    }

    if (covered.length === 0) {
      return [[start, end]];
    }

    // Sort by start
    covered.sort((a, b) => a[0] - b[0]);

    // Find gaps
    const uncovered: Array<[number, number]> = [];
    let cursor = start;

    for (const [covStart, covEnd] of covered) {
      if (cursor < covStart) {
        uncovered.push([cursor, covStart - 1]);
      }
      cursor = Math.max(cursor, covEnd + 1);
    }

    if (cursor <= end) {
      uncovered.push([cursor, end]);
    }

    return uncovered;
  }

  /**
   * Register a new request. Returns existing promise if range is already pending.
   */
  request(
    start: number,
    end: number,
    fetcher: (start: number, end: number) => Promise<FrameData[]>
  ): Promise<FrameData[]> {
    const key = this.rangeKey(start, end);

    // Return existing request if same range is pending
    const existing = this.pending.get(key);
    if (existing) {
      return existing.promise;
    }

    // Create new request
    ++this.requestIdCounter;
    const promise = fetcher(start, end).finally(() => {
      // Clean up after request completes
      this.pending.delete(key);
      this.cancelled.delete(key);
    });

    this.pending.set(key, {
      startFrame: start,
      endFrame: end,
      promise,
      timestamp: Date.now(),
    });

    return promise;
  }

  /**
   * Cancel all pending requests.
   * Note: This marks requests as cancelled but doesn't abort network calls.
   * Callers should check isCancelled() before processing results.
   */
  cancelAll(): void {
    for (const key of this.pending.keys()) {
      this.cancelled.add(key);
    }
  }

  /**
   * Check if a specific request was cancelled.
   */
  isCancelled(start: number, end: number): boolean {
    return this.cancelled.has(this.rangeKey(start, end));
  }

  /**
   * Get count of pending requests.
   */
  get pendingCount(): number {
    return this.pending.size;
  }

  /**
   * Get all pending request ranges (for debugging).
   */
  get pendingRanges(): Array<{ start: number; end: number }> {
    return Array.from(this.pending.values()).map((req) => ({
      start: req.startFrame,
      end: req.endFrame,
    }));
  }

  /**
   * Clear all tracking state.
   */
  clear(): void {
    this.pending.clear();
    this.cancelled.clear();
  }
}
