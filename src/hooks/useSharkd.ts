import { useState, useCallback, useEffect } from "react";
import type {
  FramesResult,
  FrameData,
  FrameDetails,
  InstallHealthStatus,
  RuntimeDiagnostics,
} from "../types";
import { desktop } from "../lib/desktop";

interface UseSharkdReturn {
  isReady: boolean;
  isLoading: boolean;
  error: string | null;
  frames: FrameData[];
  totalFrames: number;
  fileName: string | null;
  duration: number | null;
  installHealth: InstallHealthStatus | null;
  runtimeDiagnostics: RuntimeDiagnostics | null;
  loadFile: (path: string) => Promise<boolean>;
  loadFrames: (skip: number, limit: number) => Promise<void>;
  applyFilter: (filter: string) => Promise<boolean>;
  checkFilter: (filter: string) => Promise<boolean>;
  getFrameDetails: (frameNum: number) => Promise<FrameDetails | null>;
  runInstallHealthCheck: () => Promise<InstallHealthStatus | null>;
  refreshRuntimeDiagnostics: () => Promise<RuntimeDiagnostics | null>;
  retryInitialization: () => Promise<boolean>;
  clearError: () => void;
  reset: () => void;
}

function formatInstallHealthError(health: InstallHealthStatus): string {
  if (health.ok) return "";

  const issueLines = health.issues.slice(0, 5).map((issue) => {
    const pathSuffix = issue.path ? ` (${issue.path})` : "";
    return `- ${issue.message}${pathSuffix}`;
  });

  return [
    "PacketPilot installation needs repair.",
    "",
    ...issueLines,
    "",
    "Use the repair instructions or reinstall using the latest Windows installer.",
  ].join("\n");
}

export function useSharkd(): UseSharkdReturn {
  const [isReady, setIsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [frames, setFrames] = useState<FrameData[]>([]);
  const [totalFrames, setTotalFrames] = useState(0);
  const [fileName, setFileName] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [installHealth, setInstallHealth] = useState<InstallHealthStatus | null>(null);
  const [runtimeDiagnostics, setRuntimeDiagnostics] = useState<RuntimeDiagnostics | null>(null);

  const refreshRuntimeDiagnostics = useCallback(async (): Promise<RuntimeDiagnostics | null> => {
    try {
      const diagnostics = await desktop.app.getRuntimeDiagnostics();
      setRuntimeDiagnostics(diagnostics);
      return diagnostics;
    } catch (err) {
      console.error("Failed to fetch runtime diagnostics:", err);
      return null;
    }
  }, []);

  const runInstallHealthCheck = useCallback(async (): Promise<InstallHealthStatus | null> => {
    try {
      const health = await desktop.sharkd.getInstallHealth();
      setInstallHealth(health);
      void refreshRuntimeDiagnostics();

      if (!health.ok) {
        setIsReady(false);
        setError(formatInstallHealthError(health));
      } else {
        setError((prev) =>
          prev?.startsWith("PacketPilot installation needs repair.") ? null : prev,
        );
      }

      return health;
    } catch (err) {
      console.error("Failed to run install health check:", err);
      return null;
    }
  }, [refreshRuntimeDiagnostics]);

  const initializeSharkd = useCallback(async (): Promise<boolean> => {
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        await desktop.sharkd.getStatus();
        setIsReady(true);
        setError(null);
        void refreshRuntimeDiagnostics();
        return true;
      } catch {
        try {
          await desktop.sharkd.init();
          setIsReady(true);
          setError(null);
          void refreshRuntimeDiagnostics();
          return true;
        } catch (err) {
          if (attempt === 9) {
            const message = err instanceof Error ? err.message : String(err);
            setError(`Failed to initialize sharkd: ${message}`);
            void refreshRuntimeDiagnostics();
          } else {
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
        }
      }
    }

    return false;
  }, [refreshRuntimeDiagnostics]);

  const retryInitialization = useCallback(async (): Promise<boolean> => {
    setError(null);
    setIsReady(false);

    const health = await runInstallHealthCheck();
    if (health && !health.ok) {
      return false;
    }

    return initializeSharkd();
  }, [initializeSharkd, runInstallHealthCheck]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    const setup = async () => {
      unlisten = desktop.sharkd.onError((message) => {
        if (!cancelled) {
          setError(`Sharkd error: ${message}`);
          void refreshRuntimeDiagnostics();
        }
      });

      if (cancelled) return;
      const health = await runInstallHealthCheck();
      if (cancelled || (health && !health.ok)) {
        return;
      }

      await initializeSharkd();
    };

    const timer = setTimeout(() => {
      void setup();
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      unlisten?.();
    };
  }, [initializeSharkd, runInstallHealthCheck]);

  const loadFile = useCallback(async (path: string): Promise<boolean> => {
    setIsLoading(true);
    setError(null);
    setFrames([]);
    setTotalFrames(0);

    try {
      const result = await desktop.sharkd.loadPcap(path);
      if (!result.success) {
        setError(result.error || "Failed to load file");
        return false;
      }

      setFileName(path.split(/[/\\]/).pop() || path);
      setTotalFrames(result.frame_count);
      setDuration(result.duration);
      return true;
    } catch (err) {
      setError(`Error loading file: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadFrames = useCallback(async (skip: number, limit: number): Promise<void> => {
    try {
      setIsLoading(true);
      const result: FramesResult = await desktop.sharkd.getFrames(skip, limit);
      setFrames((prev) => {
        const next = [...prev];
        result.frames.forEach((frame) => {
          next[frame.number] = frame;
        });
        return next;
      });
      setTotalFrames(result.total);
    } catch (err) {
      console.error("Error loading frames:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const applyFilter = useCallback(async (filter: string): Promise<boolean> => {
    try {
      setIsLoading(true);
      const total = await desktop.sharkd.applyFilter(filter);
      setFrames([]);
      setTotalFrames(total);
      return true;
    } catch (err) {
      console.error("Error applying filter:", err);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const checkFilter = useCallback(async (filter: string): Promise<boolean> => {
    try {
      return await desktop.sharkd.checkFilter(filter);
    } catch {
      return false;
    }
  }, []);

  const getFrameDetails = useCallback(async (frameNum: number): Promise<FrameDetails | null> => {
    try {
      return await desktop.sharkd.getFrameDetails(frameNum);
    } catch (err) {
      console.error("Failed to get frame details:", err);
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
    setRuntimeDiagnostics(null);
  }, []);

  return {
    isReady,
    isLoading,
    error,
    frames,
    totalFrames,
    fileName,
    duration,
    installHealth,
    runtimeDiagnostics,
    loadFile,
    loadFrames,
    applyFilter,
    checkFilter,
    getFrameDetails,
    runInstallHealthCheck,
    refreshRuntimeDiagnostics,
    retryInitialization,
    clearError,
    reset,
  };
}
