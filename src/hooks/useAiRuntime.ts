import { useState, useEffect, useCallback } from "react";
import type { AiRuntimeStatus, RuntimeDiagnostics } from "../types";
import { desktop } from "../lib/desktop";

export function useAiRuntime() {
  const [status, setStatus] = useState<AiRuntimeStatus>({
    is_running: false,
  });
  const [isStarting, setIsStarting] = useState(false);
  const [runtimeDiagnostics, setRuntimeDiagnostics] = useState<RuntimeDiagnostics | null>(null);

  const refreshRuntimeDiagnostics = useCallback(async (): Promise<RuntimeDiagnostics | null> => {
    try {
      const diagnostics = await desktop.app.getRuntimeDiagnostics();
      setRuntimeDiagnostics(diagnostics);
      return diagnostics;
    } catch (error) {
      console.error("Failed to fetch runtime diagnostics:", error);
      return null;
    }
  }, []);

  const checkStatus = useCallback(async () => {
    try {
      setStatus(await desktop.ai.getStatus());
      void refreshRuntimeDiagnostics();
    } catch (error) {
      setStatus({
        is_running: false,
        error: error instanceof Error ? error.message : String(error),
      });
      void refreshRuntimeDiagnostics();
    }
  }, [refreshRuntimeDiagnostics]);

  const start = useCallback(async () => {
    setIsStarting(true);
    try {
      setStatus(await desktop.ai.start());
      void refreshRuntimeDiagnostics();
    } finally {
      setIsStarting(false);
    }
  }, [refreshRuntimeDiagnostics]);

  const stop = useCallback(async () => {
    try {
      await desktop.ai.stop();
      setStatus({ is_running: false });
      void refreshRuntimeDiagnostics();
    } catch (error) {
      console.error("Failed to stop AI runtime:", error);
    }
  }, [refreshRuntimeDiagnostics]);

  useEffect(() => {
    void checkStatus();
    const interval = setInterval(() => {
      void checkStatus();
    }, 5000);
    return () => clearInterval(interval);
  }, [checkStatus]);

  return { status, isStarting, runtimeDiagnostics, start, stop, checkStatus, refreshRuntimeDiagnostics };
}
