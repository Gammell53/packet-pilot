import { useRef, useCallback, useMemo, useState } from "react";
import { FrameLRUCache } from "../utils/FrameLRUCache";
import { RequestManager } from "../utils/RequestManager";
import type { FrameData } from "../types";
import { desktop } from "../lib/desktop";

export interface FrameCacheConfig {
  maxSize?: number;
  chunkSize?: number;
  prefetchDistance?: number;
  filter?: string;
}

export interface FrameCacheStats {
  cacheSize: number;
  cacheHits: number;
  cacheMisses: number;
  hitRate: number;
  pendingRequests: number;
}

export interface UseFrameCacheReturn {
  getFrame: (frameNumber: number) => FrameData | undefined;
  ensureRange: (startFrame: number, endFrame: number) => void;
  clear: () => void;
  cancelPending: () => void;
  getStats: () => FrameCacheStats;
}

export function useFrameCache(config: FrameCacheConfig = {}): UseFrameCacheReturn {
  const {
    maxSize = 50000,
    chunkSize = 500,
    prefetchDistance = 500,
    filter = "",
  } = config;

  const cacheRef = useRef<FrameLRUCache | null>(null);
  const requestManagerRef = useRef<RequestManager | null>(null);
  const [cacheVersion, setCacheVersion] = useState(0);

  if (!cacheRef.current) {
    cacheRef.current = new FrameLRUCache(maxSize);
  }
  if (!requestManagerRef.current) {
    requestManagerRef.current = new RequestManager();
  }

  const cache = cacheRef.current;
  const requestManager = requestManagerRef.current;

  const triggerUpdate = useCallback(() => {
    setCacheVersion((version) => version + 1);
  }, []);

  const fetchFrames = useCallback(
    async (skip: number, limit: number): Promise<FrameData[]> => {
      try {
        const result = await desktop.sharkd.getFrames(skip, limit, filter);
        return result.frames;
      } catch (error) {
        console.error("Failed to fetch frames:", error);
        return [];
      }
    },
    [filter],
  );

  const getFrame = useCallback(
    (frameNumber: number): FrameData | undefined => cache.get(frameNumber),
    [cache, cacheVersion],
  );

  const alignToChunks = useCallback(
    (start: number, end: number): Array<[number, number]> => {
      const alignedStart = Math.floor((start - 1) / chunkSize) * chunkSize;
      const alignedEnd = Math.ceil(end / chunkSize) * chunkSize;
      const chunks: Array<[number, number]> = [];

      for (let value = alignedStart; value < alignedEnd; value += chunkSize) {
        chunks.push([value, Math.min(value + chunkSize, alignedEnd)]);
      }

      return chunks;
    },
    [chunkSize],
  );

  const ensureRange = useCallback(
    (startFrame: number, endFrame: number): void => {
      if (startFrame < 1 || endFrame < startFrame) {
        return;
      }

      const expandedStart = Math.max(1, startFrame - prefetchDistance);
      const expandedEnd = endFrame + prefetchDistance;
      const chunks = alignToChunks(expandedStart, expandedEnd);

      for (const [chunkStart, chunkEnd] of chunks) {
        if (cache.hasRange(chunkStart + 1, chunkEnd)) {
          continue;
        }

        if (requestManager.isRangePending(chunkStart, chunkEnd)) {
          continue;
        }

        const skip = chunkStart;
        const limit = chunkEnd - chunkStart;

        requestManager.request(chunkStart, chunkEnd, async () => {
          if (requestManager.isCancelled(chunkStart, chunkEnd)) {
            return [];
          }

          const frames = await fetchFrames(skip, limit);
          if (requestManager.isCancelled(chunkStart, chunkEnd)) {
            return [];
          }

          cache.setMany(frames);
          triggerUpdate();
          return frames;
        });
      }
    },
    [alignToChunks, cache, fetchFrames, prefetchDistance, requestManager, triggerUpdate],
  );

  const clear = useCallback(() => {
    cache.clear();
    requestManager.clear();
  }, [cache, requestManager]);

  const cancelPending = useCallback(() => {
    requestManager.cancelAll();
  }, [requestManager]);

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
    [cancelPending, clear, ensureRange, getFrame, getStats],
  );
}
