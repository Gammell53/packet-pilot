import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { LoadResult, FramesResult, FrameData, FrameDetails } from "../types";

interface UseSharkdReturn {
  // State
  isReady: boolean;
  isLoading: boolean;
  error: string | null;
  frames: FrameData[];
  totalFrames: number;
  fileName: string | null;
  duration: number | null;
  
  // Actions
  loadFile: (path: string) => Promise<boolean>;
  loadFrames: (skip: number, limit: number) => Promise<void>;
  applyFilter: (filter: string) => Promise<boolean>;
  checkFilter: (filter: string) => Promise<boolean>;
  getFrameDetails: (frameNum: number) => Promise<FrameDetails | null>;
  clearError: () => void;
  reset: () => void;
}

export function useSharkd(): UseSharkdReturn {
  const [isReady, setIsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [frames, setFrames] = useState<FrameData[]>([]);
  const [totalFrames, setTotalFrames] = useState(0);
  const [fileName, setFileName] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(null);

  // Initialize sharkd on mount
  useEffect(() => {
    let cancelled = false;
    let unlistenFn: (() => void) | null = null;

    const setup = async () => {
      // Listen for sharkd errors
      try {
        const fn = await listen<string>("sharkd-error", (event) => {
          if (!cancelled) setError(`Sharkd error: ${event.payload}`);
        });
        unlistenFn = fn;
      } catch (e) {
        console.error("Failed to set up listener:", e);
      }

      // Try to connect to sharkd with retries
      for (let i = 0; i < 10; i++) {
        if (cancelled) return;

        try {
          if (typeof invoke !== "function") {
            await new Promise((resolve) => setTimeout(resolve, 300));
            continue;
          }

          await invoke("get_status");
          if (!cancelled) {
            setIsReady(true);
            setError(null);
          }
          return;
        } catch {
          try {
            await invoke("init_sharkd");
            if (!cancelled) {
              setIsReady(true);
              setError(null);
            }
            return;
          } catch (e) {
            if (i === 9 && !cancelled) {
              const errMsg = e instanceof Error ? e.message : String(e);
              if (errMsg.includes("sharkd")) {
                setError("Sharkd not found. Please install Wireshark.");
              } else {
                setError(`Failed to initialize sharkd: ${errMsg}`);
              }
            } else {
              await new Promise((resolve) => setTimeout(resolve, 500));
            }
          }
        }
      }
    };

    const timer = setTimeout(setup, 500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (unlistenFn) unlistenFn();
    };
  }, []);

  const loadFile = useCallback(async (path: string): Promise<boolean> => {
    setIsLoading(true);
    setError(null);
    setFrames([]);
    setTotalFrames(0);

    try {
      const result = await invoke<LoadResult>("load_pcap", { path });

      if (result.success) {
        setFileName(path.split(/[/\\]/).pop() || path);
        setTotalFrames(result.frame_count);
        setDuration(result.duration);
        setIsLoading(false);
        return true;
      } else {
        setError(result.error || "Failed to load file");
        setIsLoading(false);
        return false;
      }
    } catch (e) {
      setError(`Error loading file: ${e}`);
      setIsLoading(false);
      return false;
    }
  }, []);

  const loadFrames = useCallback(async (skip: number, limit: number): Promise<void> => {
    try {
      setIsLoading(true);
      const result = await invoke<FramesResult>("get_frames", { skip, limit });

      setFrames((prev) => {
        // Fast merge using sparse array approach
        const next = [...prev];
        result.frames.forEach((f) => {
          next[f.number] = f;
        });
        return next;
      });
      setTotalFrames(result.total);
      setIsLoading(false);
    } catch (e) {
      console.error("Error loading frames:", e);
      setIsLoading(false);
    }
  }, []);

  const applyFilter = useCallback(async (filter: string): Promise<boolean> => {
    try {
      setIsLoading(true);
      
      if (!filter.trim()) {
        await invoke<number>("apply_filter", { filter: "" });
        setFrames([]);
        const result = await invoke<FramesResult>("get_frames", { skip: 0, limit: 100 });
        setFrames(result.frames);
        setTotalFrames(result.total);
        setIsLoading(false);
        return true;
      }

      const newTotal = await invoke<number>("apply_filter", { filter });
      setTotalFrames(newTotal);
      setFrames([]);

      const result = await invoke<FramesResult>("get_frames", { skip: 0, limit: 100 });
      setFrames(result.frames);
      setIsLoading(false);
      return true;
    } catch (e) {
      console.error("Error applying filter:", e);
      setIsLoading(false);
      return false;
    }
  }, []);

  const checkFilter = useCallback(async (filter: string): Promise<boolean> => {
    try {
      return await invoke<boolean>("check_filter", { filter });
    } catch {
      return false;
    }
  }, []);

  const getFrameDetails = useCallback(async (frameNum: number): Promise<FrameDetails | null> => {
    try {
      return await invoke<FrameDetails>("get_frame_details", { frameNum });
    } catch (e) {
      console.error("Failed to get frame details:", e);
      return null;
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const reset = useCallback(() => {
    setFrames([]);
    setTotalFrames(0);
    setFileName(null);
    setDuration(null);
    setError(null);
  }, []);

  return {
    isReady,
    isLoading,
    error,
    frames,
    totalFrames,
    fileName,
    duration,
    loadFile,
    loadFrames,
    applyFilter,
    checkFilter,
    getFrameDetails,
    clearError,
    reset,
  };
}
