import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { SidecarStatus } from "../types";

interface TauriSidecarStatus {
  is_running: boolean;
  port: number;
  version?: string;
  error?: string;
}

export function usePythonSidecar() {
  const [status, setStatus] = useState<SidecarStatus>({
    is_running: false,
    port: 8765,
  });
  const [isStarting, setIsStarting] = useState(false);

  const checkStatus = useCallback(async () => {
    try {
      const result = await invoke<TauriSidecarStatus>("get_ai_sidecar_status");
      setStatus({
        is_running: result.is_running,
        port: result.port,
        version: result.version,
        error: result.error,
      });
    } catch (e) {
      setStatus({
        is_running: false,
        port: 8765,
        error: String(e),
      });
    }
  }, []);

  const start = useCallback(async (
    apiKey?: string | null,
    model?: string
  ) => {
    setIsStarting(true);
    try {
      const result = await invoke<TauriSidecarStatus>("start_ai_sidecar", {
        apiKey: apiKey ?? null,
        model: model ?? "google/gemini-3-flash-preview",
      });
      setStatus({
        is_running: result.is_running,
        port: result.port,
        version: result.version,
        error: result.error,
      });

      // If not immediately running, poll a few times
      if (!result.is_running) {
        let attempts = 0;
        const pollInterval = setInterval(async () => {
          attempts++;
          await checkStatus();
          if (attempts >= 10) {
            clearInterval(pollInterval);
            setIsStarting(false);
          }
        }, 500);

        // Clean up after success or max attempts
        const cleanup = () => {
          clearInterval(pollInterval);
          setIsStarting(false);
        };

        // Check status updates
        const checkLoop = setInterval(() => {
          if (status.is_running || attempts >= 10) {
            cleanup();
            clearInterval(checkLoop);
          }
        }, 100);
      } else {
        setIsStarting(false);
      }
    } catch (e) {
      setStatus({
        is_running: false,
        port: 8765,
        error: String(e),
      });
      setIsStarting(false);
    }
  }, [checkStatus, status.is_running]);

  const stop = useCallback(async () => {
    try {
      await invoke("stop_ai_sidecar");
      setStatus({ is_running: false, port: 8765 });
    } catch (e) {
      console.error("Failed to stop sidecar:", e);
    }
  }, []);

  // Check status on mount and periodically
  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 5000);
    return () => clearInterval(interval);
  }, [checkStatus]);

  return { status, isStarting, start, stop, checkStatus };
}
