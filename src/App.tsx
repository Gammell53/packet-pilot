import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { PacketGrid, FrameData } from "./components/PacketGrid";
import "./App.css";

interface LoadResult {
  success: boolean;
  frame_count: number;
  duration: number | null;
  error: string | null;
}

interface FramesResult {
  frames: FrameData[];
  total: number;
}

function App() {
  const [frames, setFrames] = useState<FrameData[]>([]);
  const [totalFrames, setTotalFrames] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedFrame, setSelectedFrame] = useState<number | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sharkdReady, setSharkdReady] = useState(false);
  const [filter, setFilter] = useState("");
  const [filterError, setFilterError] = useState<string | null>(null);

  // Listen for sharkd initialization errors
  useEffect(() => {
    let cancelled = false;
    let unlistenFn: (() => void) | null = null;

    const setup = async () => {
      // Set up event listener
      try {
        const fn = await listen<string>("sharkd-error", (event) => {
          if (!cancelled) setError(`Sharkd error: ${event.payload}`);
        });
        unlistenFn = fn;
      } catch (e) {
        console.error("Failed to set up listener:", e);
      }

      // Check if sharkd is ready with retry
      for (let i = 0; i < 10; i++) {
        if (cancelled) return;
        
        try {
          // Check if invoke is available
          if (typeof invoke !== 'function') {
            await new Promise(resolve => setTimeout(resolve, 300));
            continue;
          }

          await invoke("get_status");
          if (!cancelled) {
            setSharkdReady(true);
            setError(null);
          }
          return;
        } catch {
          // Sharkd not ready yet, try to init
          try {
            await invoke("init_sharkd");
            if (!cancelled) {
              setSharkdReady(true);
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
              // Wait before retrying
              await new Promise(resolve => setTimeout(resolve, 500));
            }
          }
        }
      }
    };

    // Delay to ensure Tauri APIs are ready
    const timer = setTimeout(setup, 500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (unlistenFn) unlistenFn();
    };
  }, []);

  const handleOpenFile = useCallback(async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [
          {
            name: "Capture Files",
            extensions: ["pcap", "pcapng", "cap", "pcap.gz"],
          },
          {
            name: "All Files",
            extensions: ["*"],
          },
        ],
      });

      if (selected && typeof selected === "string") {
        setIsLoading(true);
        setError(null);
        setFrames([]);
        setTotalFrames(0);
        setFilter("");
        setFilterError(null);

        const result = await invoke<LoadResult>("load_pcap", { path: selected });
        
        if (result.success) {
          setFileName(selected.split(/[/\\]/).pop() || selected);
          setTotalFrames(result.frame_count);
          setDuration(result.duration);
          // Pre-load the first chunk of data
          handleLoadMore(0, 100);
        } else {
          setError(result.error || "Failed to load file");
        }

        setIsLoading(false);
      }
    } catch (e) {
      setError(`Error opening file: ${e}`);
      setIsLoading(false);
    }
  }, []);

  const handleLoadMore = useCallback(async (skip: number, limit: number) => {
    try {
      setIsLoading(true);
      const result = await invoke<FramesResult>("get_frames", { skip, limit });

      setFrames((prev) => {
        const frameMap = new Map(prev.map((f) => [f.number, f]));
        result.frames.forEach((f) => frameMap.set(f.number, f));
        return Array.from(frameMap.values()).sort((a, b) => a.number - b.number);
      });
      setTotalFrames(result.total);
      setIsLoading(false);
    } catch (e) {
      console.error("Error loading frames:", e);
      setIsLoading(false);
    }
  }, []);

  const handleApplyFilter = useCallback(async () => {
    if (!filter.trim()) {
      // Clear filter
      try {
        await invoke<number>("apply_filter", { filter: "" });
        setFilterError(null);
        setFrames([]);
        const result = await invoke<FramesResult>("get_frames", { skip: 0, limit: 100 });
        setFrames(result.frames);
        setTotalFrames(result.total);
      } catch (e) {
        console.error("Error clearing filter:", e);
      }
      return;
    }

    try {
      // First validate the filter
      const isValid = await invoke<boolean>("check_filter", { filter });
      if (!isValid) {
        setFilterError("Invalid filter syntax");
        return;
      }

      setFilterError(null);
      setIsLoading(true);

      const newTotal = await invoke<number>("apply_filter", { filter });
      setTotalFrames(newTotal);
      setFrames([]);

      // Load first batch of filtered frames
      const result = await invoke<FramesResult>("get_frames", { skip: 0, limit: 100 });
      setFrames(result.frames);
      setIsLoading(false);
    } catch (e) {
      setFilterError(`Filter error: ${e}`);
      setIsLoading(false);
    }
  }, [filter]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        handleApplyFilter();
      }
    },
    [handleApplyFilter]
  );

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          <h1 className="app-title">
            <span className="title-icon">◈</span>
            PacketPilot
          </h1>
          {fileName && (
            <div className="file-info">
              <span className="file-name">{fileName}</span>
              {duration && (
                <span className="file-duration">{duration.toFixed(3)}s</span>
              )}
            </div>
          )}
        </div>
        <div className="header-right">
          <button
            className="open-button"
            onClick={handleOpenFile}
            disabled={!sharkdReady || isLoading}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              <line x1="12" x2="12" y1="11" y2="17" />
              <line x1="9" x2="15" y1="14" y2="14" />
            </svg>
            Open Capture
          </button>
        </div>
      </header>

      {totalFrames > 0 && (
        <div className="filter-bar">
          <div className={`filter-input-wrapper ${filterError ? "error" : ""}`}>
            <svg
              className="filter-icon"
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
            <input
              type="text"
              className="filter-input"
              placeholder="Display filter (e.g., tcp.port == 80)"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            {filter && (
              <button
                className="filter-clear"
                onClick={() => {
                  setFilter("");
                  handleApplyFilter();
                }}
              >
                ×
              </button>
            )}
          </div>
          <button className="filter-apply" onClick={handleApplyFilter}>
            Apply
          </button>
          {filterError && <span className="filter-error">{filterError}</span>}
        </div>
      )}

      {error && (
        <div className="error-banner">
          <span>{error}</span>
          <button onClick={() => setError(null)}>×</button>
        </div>
      )}

      {!sharkdReady && !error && (
        <div className="loading-overlay">
          <div className="loading-spinner" />
          <p>Initializing sharkd...</p>
        </div>
      )}

      <main className="app-main">
        <PacketGrid
          frames={frames}
          totalFrames={totalFrames}
          onLoadMore={handleLoadMore}
          isLoading={isLoading}
          selectedFrame={selectedFrame}
          onSelectFrame={setSelectedFrame}
        />
      </main>

      <footer className="app-footer">
        <span className="status-text">
          {sharkdReady ? "Ready" : "Initializing..."}
        </span>
        {totalFrames > 0 && (
          <span className="packet-count">
            {totalFrames.toLocaleString()} packets
          </span>
        )}
      </footer>
    </div>
  );
}

export default App;
