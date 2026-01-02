import type { FrameData } from "../types";

/**
 * LRU (Least Recently Used) cache for frame data.
 * Uses Map's insertion order to track access recency.
 * When capacity is exceeded, evicts the oldest entries.
 */
export class FrameLRUCache {
  private cache = new Map<number, FrameData>();
  private maxSize: number;

  // Stats for debugging/monitoring
  private _hits = 0;
  private _misses = 0;

  constructor(maxSize: number = 50000) {
    this.maxSize = maxSize;
  }

  /**
   * Get a frame by number. Returns undefined if not cached.
   * Moves accessed frame to end of map (most recently used).
   */
  get(frameNumber: number): FrameData | undefined {
    const frame = this.cache.get(frameNumber);
    if (frame) {
      // Move to end (most recently used)
      this.cache.delete(frameNumber);
      this.cache.set(frameNumber, frame);
      this._hits++;
      return frame;
    }
    this._misses++;
    return undefined;
  }

  /**
   * Check if frame is in cache without updating LRU order.
   */
  has(frameNumber: number): boolean {
    return this.cache.has(frameNumber);
  }

  /**
   * Add a frame to cache. Evicts oldest if over capacity.
   */
  set(frameNumber: number, frame: FrameData): void {
    // If already exists, delete first to update position
    if (this.cache.has(frameNumber)) {
      this.cache.delete(frameNumber);
    }

    this.cache.set(frameNumber, frame);

    // Evict oldest entries if over capacity
    this.evictIfNeeded();
  }

  /**
   * Add multiple frames to cache efficiently.
   */
  setMany(frames: FrameData[]): void {
    for (const frame of frames) {
      if (this.cache.has(frame.number)) {
        this.cache.delete(frame.number);
      }
      this.cache.set(frame.number, frame);
    }

    // Evict after batch insert
    this.evictIfNeeded();
  }

  /**
   * Check which frame numbers in a range are missing from cache.
   */
  getMissingInRange(startFrame: number, endFrame: number): number[] {
    const missing: number[] = [];
    for (let i = startFrame; i <= endFrame; i++) {
      if (!this.cache.has(i)) {
        missing.push(i);
      }
    }
    return missing;
  }

  /**
   * Check if a range of frames is fully cached.
   */
  hasRange(startFrame: number, endFrame: number): boolean {
    for (let i = startFrame; i <= endFrame; i++) {
      if (!this.cache.has(i)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Clear all cached frames.
   */
  clear(): void {
    this.cache.clear();
    this._hits = 0;
    this._misses = 0;
  }

  /**
   * Current number of cached frames.
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Cache statistics for monitoring.
   */
  get stats(): { size: number; hits: number; misses: number; hitRate: number } {
    const total = this._hits + this._misses;
    return {
      size: this.cache.size,
      hits: this._hits,
      misses: this._misses,
      hitRate: total > 0 ? this._hits / total : 0,
    };
  }

  /**
   * Evict oldest entries if over capacity.
   */
  private evictIfNeeded(): void {
    while (this.cache.size > this.maxSize) {
      // Map.keys().next() returns the oldest key (first inserted)
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) {
        this.cache.delete(oldest);
      } else {
        break;
      }
    }
  }
}
