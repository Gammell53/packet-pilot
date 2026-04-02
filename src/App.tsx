import { lazy, Suspense, useState, useCallback, useRef, useMemo, useEffect } from "react";

import { useSharkd, useTheme, useKeyboardShortcuts, useFrameCache, useAiRuntime, useSettings } from "./hooks";

import { Header } from "./components/Header/Header";
import { FilterBar } from "./components/FilterBar/FilterBar";
import { Footer } from "./components/Footer/Footer";
import { PacketGrid } from "./components/PacketGrid/PacketGrid";
import { PacketDetailPane } from "./components/PacketDetailPane/PacketDetailPane";
import { ContextMenu } from "./components/ui/ContextMenu";
import { GoToPacketDialog } from "./components/dialogs/GoToPacketDialog";
import { SettingsDialog } from "./components/dialogs/SettingsDialog";

import type { FrameData, PacketGridRef, ContextMenuState } from "./types";

import "./styles/variables.css";
import "./styles/global.css";
import "./App.css";
import { desktop } from "./lib/desktop";

const ChatSidebar = lazy(async () => {
  const module = await import("./components/ChatSidebar");
  return { default: module.ChatSidebar };
});

function formatDiagnosticsReport(error: string, diagnostics: unknown): string {
  return JSON.stringify(
    {
      error,
      diagnostics,
    },
    null,
    2,
  );
}

function App() {
  const { theme, toggleTheme } = useTheme();
  const {
    isReady: sharkdReady,
    isLoading,
    error,
    totalFrames,
    fileName,
    duration,
    installHealth,
    runtimeDiagnostics,
    loadFile,
    clearError,
    runInstallHealthCheck,
    retryInitialization,
  } = useSharkd();

  const { status: aiStatus, isStarting: aiIsStarting } = useAiRuntime();
  const { hasConfiguredAuth } = useSettings();

  const aiState: "running" | "starting" | "offline" | "unconfigured" =
    !hasConfiguredAuth ? "unconfigured"
    : aiStatus.is_running ? "running"
    : aiIsStarting ? "starting"
    : "offline";

  const [localTotalFrames, setLocalTotalFrames] = useState(0);
  const [hasLocalTotal, setHasLocalTotal] = useState(false);
  const [localIsLoading, setLocalIsLoading] = useState(false);
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  const [selectedFrameNumber, setSelectedFrameNumber] = useState<number | null>(null);
  const [draftFilter, setDraftFilter] = useState("");
  const [appliedFilter, setAppliedFilter] = useState("");
  const [filterError, setFilterError] = useState<string | null>(null);
  const [showDetailPane, setShowDetailPane] = useState(true);
  const [detailPaneHeight, setDetailPaneHeight] = useState(250);
  const [showGoToDialog, setShowGoToDialog] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [showChatSidebar, setShowChatSidebar] = useState(false);
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);
  const [visibleRange, setVisibleRange] = useState({ start: 1, end: 100 });
  const [loadElapsed, setLoadElapsed] = useState(0);
  const loadStartRef = useRef<number | null>(null);

  const effectiveTotalFrames = hasLocalTotal ? localTotalFrames : totalFrames;
  const effectiveIsLoading = localIsLoading || isLoading;
  const hasCaptureLoaded = Boolean(fileName) || totalFrames > 0;
  const isFilterActive = appliedFilter.length > 0;
  const gridRef = useRef<PacketGridRef | null>(null);
  const isFileLoadingRef = useRef(false);
  const startupCaptureAttemptedRef = useRef(false);

  // Tick elapsed time while a file is loading
  const isFileLoading = sharkdReady && effectiveIsLoading && effectiveTotalFrames === 0;
  useEffect(() => {
    if (!isFileLoading) {
      loadStartRef.current = null;
      return;
    }
    if (!loadStartRef.current) {
      loadStartRef.current = performance.now();
      setLoadElapsed(0);
    }
    const id = setInterval(() => {
      setLoadElapsed(Math.floor((performance.now() - loadStartRef.current!) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [isFileLoading]);

  const chunkSize = useMemo(() => {
    if (effectiveTotalFrames > 1_000_000) return 1000;
    if (effectiveTotalFrames > 100_000) return 500;
    return 200;
  }, [effectiveTotalFrames]);

  const { getFrame, ensureRange, clear: clearCache, cancelPending } = useFrameCache({
    maxSize: 50000,
    chunkSize,
    prefetchDistance: 500,
    filter: appliedFilter,
    totalFrames: effectiveTotalFrames,
  });

  const clearSelection = useCallback(() => {
    setSelectedRow(null);
    setSelectedFrameNumber(null);
  }, []);

  const selectVisibleRow = useCallback((rowNumber: number) => {
    setSelectedRow(rowNumber);
    const frame = getFrame(rowNumber);
    setSelectedFrameNumber(frame?.number ?? null);
  }, [getFrame]);

  useEffect(() => {
    if (selectedRow === null) {
      return;
    }

    const frame = getFrame(selectedRow);
    if (!frame) {
      return;
    }

    setSelectedFrameNumber((current) => (current === frame.number ? current : frame.number));
  }, [getFrame, selectedRow]);

  const loadCapturePath = useCallback(async (path: string) => {
    if (isFileLoadingRef.current) {
      return false;
    }

    try {
      const t0 = performance.now();
      isFileLoadingRef.current = true;
      setLocalIsLoading(true);
      clearCache();
      cancelPending();
      setLocalTotalFrames(0);
      setHasLocalTotal(false);
      setDraftFilter("");
      setAppliedFilter("");
      setFilterError(null);
      clearSelection();

      const success = await loadFile(path);
      const t1 = performance.now();
      console.log(`[perf] loadCapturePath: loadFile=${(t1 - t0).toFixed(0)}ms success=${success} path=${path}`);
      return success;
    } catch (error) {
      console.error("Error loading file:", error);
      return false;
    } finally {
      isFileLoadingRef.current = false;
      setLocalIsLoading(false);
    }
  }, [cancelPending, clearCache, clearSelection, loadFile]);

  const handleOpenFile = useCallback(async () => {
    if (isFileLoadingRef.current) {
      return;
    }

    try {
      const selected = await desktop.files.openCapture();
      if (!selected) {
        return;
      }

      await loadCapturePath(selected);
    } catch (error) {
      console.error("Error opening file:", error);
    }
  }, [loadCapturePath]);

  useEffect(() => {
    if (!sharkdReady || startupCaptureAttemptedRef.current || isFileLoadingRef.current) {
      return;
    }

    startupCaptureAttemptedRef.current = true;
    let cancelled = false;

    void (async () => {
      try {
        const requestedCapture = await desktop.app.getStartupCapturePath();
        if (!requestedCapture || cancelled) {
          return;
        }

        await loadCapturePath(requestedCapture);
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load startup capture:", error);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sharkdReady, loadCapturePath]);

  const applyFilterText = useCallback(async (nextFilter: string) => {
    if (isFileLoadingRef.current) {
      return false;
    }

    const normalizedFilter = nextFilter.trim();
    setDraftFilter(nextFilter);

    try {
      if (normalizedFilter && normalizedFilter !== appliedFilter) {
        const isValid = await desktop.sharkd.checkFilter(normalizedFilter);
        if (!isValid) {
          setFilterError("Invalid filter syntax");
          return false;
        }
      }

      setLocalIsLoading(true);
      clearCache();
      cancelPending();
      clearSelection();
      setFilterError(null);
      const total = await desktop.sharkd.applyFilter(normalizedFilter);
      setDraftFilter(normalizedFilter);
      setAppliedFilter(normalizedFilter);
      setLocalTotalFrames(total);
      setHasLocalTotal(true);
      return true;
    } catch (error) {
      setFilterError(`Filter error: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    } finally {
      setLocalIsLoading(false);
    }
  }, [appliedFilter, cancelPending, clearCache, clearSelection]);

  const handleApplyFilter = useCallback(() => {
    void applyFilterText(draftFilter);
  }, [applyFilterText, draftFilter]);

  const handleClearFilter = useCallback(() => {
    void applyFilterText("");
  }, [applyFilterText]);

  const handleGoToVisibleRow = useCallback((rowNumber: number) => {
    if (rowNumber < 1 || rowNumber > effectiveTotalFrames) {
      return;
    }

    selectVisibleRow(rowNumber);
    gridRef.current?.scrollToRow(rowNumber);
  }, [effectiveTotalFrames, selectVisibleRow]);

  const handleContextMenu = useCallback((event: React.MouseEvent, frame: FrameData) => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY, frame });
  }, []);

  const handleVisibleRangeChange = useCallback((start: number, end: number) => {
    setVisibleRange({ start, end });
  }, []);

  const applyPacketFilter = useCallback(
    (type: "source" | "dest" | "proto", value: string) => {
      let nextFilter = "";
      if (type === "source") nextFilter = `ip.src == ${value}`;
      if (type === "dest") nextFilter = `ip.dst == ${value}`;
      if (type === "proto") nextFilter = value.toLowerCase();

      void applyFilterText(nextFilter);
    },
    [applyFilterText],
  );

  useKeyboardShortcuts({
    selectedFrame: selectedRow,
    totalFrames: effectiveTotalFrames,
    gridRef,
    onSelectFrame: selectVisibleRow,
    onOpenFile: handleOpenFile,
    onGoToPacket: () => setShowGoToDialog(true),
    onToggleDetailPane: () => setShowDetailPane((previous) => !previous),
    onCloseDialogs: () => {
      setShowGoToDialog(false);
      setShowChatSidebar(false);
    },
    onOpenChat: () => setShowChatSidebar((prev) => !prev),
  });

  const findVisibleRowForFrame = useCallback(async (frameNumber: number): Promise<number | null> => {
    if (frameNumber < 1) {
      return null;
    }

    if (!appliedFilter) {
      return frameNumber <= effectiveTotalFrames ? frameNumber : null;
    }

    const pageSize = 200;
    for (let skip = 0; skip < effectiveTotalFrames; skip += pageSize) {
      const limit = Math.min(pageSize, effectiveTotalFrames - skip);
      const result = await desktop.sharkd.getFrames(skip, limit, appliedFilter);
      const index = result.frames.findIndex((frame) => frame.number === frameNumber);
      if (index !== -1) {
        return skip + index + 1;
      }
    }

    return null;
  }, [appliedFilter, effectiveTotalFrames]);

  const handleGoToPacket = useCallback((packetNum: number) => {
    void (async () => {
      try {
        const rowNumber = await findVisibleRowForFrame(packetNum);
        if (rowNumber === null) {
          return;
        }

        handleGoToVisibleRow(rowNumber);
      } catch (error) {
        console.error("Failed to locate packet in current result set:", error);
      }
    })();
  }, [findVisibleRowForFrame, handleGoToVisibleRow]);

  const handleDetailPaneResize = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      const startY = event.clientY;
      const startHeight = detailPaneHeight;

      const onMouseMove = (moveEvent: MouseEvent) => {
        const delta = startY - moveEvent.clientY;
        setDetailPaneHeight(Math.max(100, Math.min(500, startHeight + delta)));
      };

      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [detailPaneHeight],
  );

  const avgPacketRate =
    duration && effectiveTotalFrames > 0 ? effectiveTotalFrames / duration : undefined;

  const openTroubleshooting = useCallback(() => {
    void desktop.files.openExternal(
      "https://github.com/Gammell53/packet-pilot#windows-troubleshooting",
    );
  }, []);

  const handleCopyDiagnostics = useCallback(async () => {
    if (!error || !runtimeDiagnostics) {
      return;
    }

    try {
      await navigator.clipboard.writeText(formatDiagnosticsReport(error, runtimeDiagnostics));
    } catch (copyError) {
      console.error("Failed to copy runtime diagnostics:", copyError);
    }
  }, [error, runtimeDiagnostics]);

  return (
    <div className="app">
      <Header
        fileName={fileName}
        duration={duration}
        theme={theme}
        isReady={sharkdReady}
        isLoading={effectiveIsLoading}
        onOpenFile={handleOpenFile}
        onToggleTheme={toggleTheme}
        onOpenSettings={() => setShowSettingsDialog(true)}
        aiState={aiState}
        isChatOpen={showChatSidebar}
        onToggleChat={() => setShowChatSidebar((prev) => !prev)}
      />

      {totalFrames > 0 && (
        <FilterBar
          filter={draftFilter}
          filterError={filterError}
          onFilterChange={setDraftFilter}
          onApplyFilter={handleApplyFilter}
          onClearFilter={handleClearFilter}
          onGoToPacket={() => setShowGoToDialog(true)}
        />
      )}

      {error && (
        <div className={`error-banner ${installHealth && !installHealth.ok ? "install-health-banner" : ""}`}>
          <div className="error-content">
            <pre className="error-message">{error}</pre>
            {installHealth && !installHealth.ok && (
              <div className="error-actions">
                <button className="action-button" onClick={() => void runInstallHealthCheck()}>
                  Retry Check
                </button>
                <button className="action-button" onClick={() => void retryInitialization()}>
                  Retry Startup
                </button>
                <button className="action-button" onClick={openTroubleshooting}>
                  Troubleshooting
                </button>
              </div>
            )}
            {runtimeDiagnostics && (
              <>
                <div className="error-actions">
                  <button className="action-button" onClick={() => void handleCopyDiagnostics()}>
                    Copy Debug Info
                  </button>
                </div>
                <details className="error-diagnostics">
                  <summary>Runtime diagnostics</summary>
                  <pre className="error-message">
                    {formatDiagnosticsReport(error, {
                      latestIssue: runtimeDiagnostics.issues[0] ?? null,
                      sharkd: runtimeDiagnostics.sharkd,
                      ai: runtimeDiagnostics.ai,
                      environment: {
                        version: runtimeDiagnostics.appVersion,
                        platform: runtimeDiagnostics.platform,
                        arch: runtimeDiagnostics.arch,
                        isPackaged: runtimeDiagnostics.isPackaged,
                        resourcesPath: runtimeDiagnostics.resourcesPath,
                      },
                    })}
                  </pre>
                </details>
              </>
            )}
          </div>
          <button onClick={clearError}>×</button>
        </div>
      )}

      {!sharkdReady && !error && (
        <div className="loading-overlay">
          <div className="loading-spinner" />
          <p>Initializing sharkd...</p>
        </div>
      )}

      {isFileLoading && (
        <div className="loading-overlay">
          <div className="loading-spinner" />
          <p>Loading capture file...</p>
          <div className="loading-details">
            <div className="progress-bar-track">
              <div className="progress-bar-fill indeterminate" />
            </div>
            <span className="loading-elapsed">
              {loadElapsed > 0 ? `${loadElapsed}s elapsed` : "Starting..."}
            </span>
          </div>
        </div>
      )}

      <main className="app-main">
        <div
          className="packet-list-container"
          style={{
            flex:
              showDetailPane && selectedFrameNumber
                ? `1 1 calc(100% - ${detailPaneHeight}px)`
                : "1 1 100%",
          }}
        >
          <PacketGrid
            ref={gridRef}
            getFrame={getFrame}
            ensureRange={ensureRange}
            cancelPending={cancelPending}
            totalFrames={effectiveTotalFrames}
            hasCaptureLoaded={hasCaptureLoaded}
            isFiltered={isFilterActive}
            isLoading={effectiveIsLoading}
            selectedRow={selectedRow}
            onSelectRow={selectVisibleRow}
            onContextMenu={handleContextMenu}
            onVisibleRangeChange={handleVisibleRangeChange}
          />
        </div>

        {showDetailPane && selectedFrameNumber && (
          <div className="detail-pane-container" style={{ height: detailPaneHeight }}>
            <div className="resize-handle" onMouseDown={handleDetailPaneResize} />
            <PacketDetailPane frameNumber={selectedFrameNumber} />
          </div>
        )}
      </main>

      <Footer
        isReady={sharkdReady}
        hasCaptureLoaded={hasCaptureLoaded}
        isFiltered={isFilterActive}
        selectedRow={selectedRow}
        selectedFrameNumber={selectedFrameNumber}
        totalFrames={effectiveTotalFrames}
        avgPacketRate={avgPacketRate}
        aiState={aiState}
      />

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={[
            {
              label: `Apply as Filter: ${contextMenu.frame.protocol}`,
              onClick: () => applyPacketFilter("proto", contextMenu.frame.protocol),
            },
            {
              label: `Filter by Source: ${contextMenu.frame.source}`,
              onClick: () => applyPacketFilter("source", contextMenu.frame.source),
            },
            {
              label: `Filter by Destination: ${contextMenu.frame.destination}`,
              onClick: () => applyPacketFilter("dest", contextMenu.frame.destination),
            },
            { divider: true, label: "", onClick: () => {} },
            {
              label: "Copy Summary",
              onClick: () => {
                navigator.clipboard.writeText(
                  `${contextMenu.frame.number} ${contextMenu.frame.time} ${contextMenu.frame.source} -> ${contextMenu.frame.destination} [${contextMenu.frame.protocol}] ${contextMenu.frame.info}`,
                );
              },
            },
          ]}
        />
      )}

      {showGoToDialog && (
        <GoToPacketDialog
          totalFrames={effectiveTotalFrames}
          hasActiveFilter={isFilterActive}
          onGoTo={handleGoToVisibleRow}
          onClose={() => setShowGoToDialog(false)}
        />
      )}

      {showChatSidebar && (
        <Suspense
          fallback={
            <div className="chat-sidebar-loading">
              <div className="loading-spinner" />
              <p>Loading AI assistant…</p>
            </div>
          }
        >
          <ChatSidebar
            isOpen={showChatSidebar}
            onClose={() => setShowChatSidebar(false)}
            selectedFrame={selectedFrameNumber}
            visibleRange={visibleRange}
            currentFilter={appliedFilter}
            fileName={fileName}
            totalFrames={effectiveTotalFrames}
            onApplyFilter={(nextFilter) => void applyFilterText(nextFilter)}
            onGoToPacket={handleGoToPacket}
          />
        </Suspense>
      )}

      <SettingsDialog
        isOpen={showSettingsDialog}
        onClose={() => setShowSettingsDialog(false)}
      />
    </div>
  );
}

export default App;
