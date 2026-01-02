import { useRef, useCallback, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FrameLRUCache } from "../utils/FrameLRUCache";
import { RequestManager } from "../utils/RequestManager";
import type { FrameData, FramesResult } from "../types";

export interface FrameCacheConfig {
  /** Maximum frames to keep in memory (default: 50000) */
  maxSize?: number;
  /** Frames per request chunk (default: 500) */
  chunkSize?: number;
  /** Extra frames to prefetch beyond visible range (default: 500) */
  prefetchDistance?: number;
}

export interface FrameCacheStats {
  cacheSize: number;
  cacheHits: number;
  cacheMisses: number;
  hitRate: number;
  pendingRequests: number;
}

export interface UseFrameCacheReturn {
  /** Get a frame by number. Returns undefined if not cached. */
  getFrame: (frameNumber: number) => FrameData | undefined;
  /** Ensure a range of frames is loaded (triggers fetch if needed) */
  ensureRange: (startFrame: number, endFrame: number) => void;
  /** Clear all cached data (call on file/filter change) */
  clear: () => void;
  /** Cancel all pending requests (call during fast scroll) */
  cancelPending: () => void;
  /** Get cache statistics */
  getStats: () => FrameCacheStats;
}

/**
 * Hook for managing frame data with LRU caching and request deduplication.
 * Designed for high-performance scrolling with 10M+ packets.
 */
export function useFrameCache(config: FrameCacheConfig = {}): UseFrameCacheReturn {
  const { maxSize = 50000, chunkSize = 500, prefetchDistance = 500 } = config;

  // Persistent cache and request manager (survive re-renders)
  const cacheRef = useRef<FrameLRUCache | null>(null);
  const requestManagerRef = useRef<RequestManager | null>(null);

  // Version counter to trigger re-renders when cache updates
  const [cacheVersion, setCacheVersion] = useState(0);

  // Lazy initialization
  if (!cacheRef.current) {
    cacheRef.current = new FrameLRUCache(maxSize);
  }
  if (!requestManagerRef.current) {
    requestManagerRef.current = new RequestManager();
  }

  const cache = cacheRef.current;
  const requestManager = requestManagerRef.current;

  // Increment version to trigger re-render
  const triggerUpdate = useCallback(() => {
    setCacheVersion((v) => v + 1);
  }, []);

  /**
   * Fetch frames from backend for a specific range.
   */
  const fetchFrames = useCallback(
    async (skip: number, limit: number): Promise<FrameData[]> => {
      try {
        const result = await invoke<FramesResult>("get_frames", { skip, limit });
        return result.frames;
      } catch (e) {
        console.error("Failed to fetch frames:", e);
        return [];
      }
    },
    []
  );

  /**
   * Get a frame by number from cache.
   * Depends on cacheVersion to trigger re-renders when cache updates.
   */
  const getFrame = useCallback(
    (frameNumber: number): FrameData | undefined => {
      return cache.get(frameNumber);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cache, cacheVersion]
  );

  /**
   * Align a range to chunk boundaries for efficient caching.
   */
  const alignToChunks = useCallback(
    (start: number, end: number): Array<[number, number]> => {
      const alignedStart = Math.floor((start - 1) / chunkSize) * chunkSize;
      const alignedEnd = Math.ceil(end / chunkSize) * chunkSize;

      const chunks: Array<[number, number]> = [];
      for (let i = alignedStart; i < alignedEnd; i += chunkSize) {
        chunks.push([i, Math.min(i + chunkSize, alignedEnd)]);
      }
      return chunks;
    },
    [chunkSize]
  );

  /**
   * Ensure a range of frames is loaded.
   * Chunks the range, checks cache, and fetches missing chunks.
   */
  const ensureRange = useCallback(
    (startFrame: number, endFrame: number): void => {
      // Validate range
      if (startFrame < 1 || endFrame < startFrame) return;

      // Expand range by prefetch distance
      const expandedStart = Math.max(1, startFrame - prefetchDistance);
      const expandedEnd = endFrame + prefetchDistance;

      // Get chunk-aligned ranges
      const chunks = alignToChunks(expandedStart, expandedEnd);

      for (const [chunkStart, chunkEnd] of chunks) {
        // Skip if already fully cached
        if (cache.hasRange(chunkStart + 1, chunkEnd)) {
          continue;
        }

        // Skip if request already pending for this range
        if (requestManager.isRangePending(chunkStart, chunkEnd)) {
          continue;
        }

        // Fetch this chunk
        const skip = chunkStart;
        const limit = chunkEnd - chunkStart;

        requestManager.request(chunkStart, chunkEnd, async () => {
          // Check if request was cancelled before fetching
          if (requestManager.isCancelled(chunkStart, chunkEnd)) {
            return [];
          }

          const frames = await fetchFrames(skip, limit);

          // Check again after fetch (fast scrolling may have cancelled)
          if (requestManager.isCancelled(chunkStart, chunkEnd)) {
            return [];
          }

          // Add to cache and trigger re-render
          cache.setMany(frames);
          triggerUpdate();
          return frames;
        });
      }
    },
    [cache, requestManager, fetchFrames, alignToChunks, prefetchDistance, triggerUpdate]
  );

  /**
   * Clear all cached data and pending requests.
   */
  const clear = useCallback((): void => {
    cache.clear();
    requestManager.clear();
  }, [cache, requestManager]);

  /**
   * Cancel all pending requests (for fast scrolling).
   */
  const cancelPending = useCallback((): void => {
    requestManager.cancelAll();
  }, [requestManager]);

  /**
   * Get cache statistics.
   */
  const getStats = useCallback((): FrameCacheStats => {
    const cacheStats = cache.stats;
    return {
      cacheSize: cacheStats.size,
      cacheHits: cacheStats.hits,
      cacheMisses: cacheStats.misses,
      hitRate: cacheStats.hitRate,
      pendingRequests: requestManager.pendingCount,
    };
  }, [cache, requestManager]);

  return useMemo(
    () => ({
      getFrame,
      ensureRange,
      clear,
      cancelPending,
      getStats,
    }),
    [getFrame, ensureRange, clear, cancelPending, getStats]
  );
}
