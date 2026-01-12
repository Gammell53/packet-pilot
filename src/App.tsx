import { useState, useCallback, useRef, useMemo } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";

// Hooks
import { useSharkd, useTheme, useKeyboardShortcuts, useFrameCache } from "./hooks";
import { useSettings } from "./hooks/useSettings";

// Components
import { Header } from "./components/Header/Header";
import { FilterBar } from "./components/FilterBar/FilterBar";
import { Footer } from "./components/Footer/Footer";
import { PacketGrid } from "./components/PacketGrid/PacketGrid";
import { PacketDetailPane } from "./components/PacketDetailPane/PacketDetailPane";
import { ContextMenu } from "./components/ui/ContextMenu";
import { GoToPacketDialog } from "./components/dialogs/GoToPacketDialog";
import { SettingsDialog } from "./components/dialogs/SettingsDialog";
import { ChatSidebar } from "./components/ChatSidebar";

// Types
import type { FrameData, PacketGridRef, ContextMenuState } from "./types";

// Styles
import "./styles/variables.css";
import "./styles/global.css";
import "./App.css";

function App() {
  // Custom hooks
  const { theme, toggleTheme } = useTheme();
  const { settings, hasApiKey, updateApiKey, updateModel } = useSettings();
  const {
    isReady: sharkdReady,
    isLoading,
    error,
    totalFrames,
    fileName,
    duration,
    loadFile,
    clearError,
  } = useSharkd();

  // UI State
  const [localTotalFrames, setLocalTotalFrames] = useState(0);
  const [localIsLoading, setLocalIsLoading] = useState(false);

  // Derived - effective total for adaptive chunk sizing
  const effectiveTotalFrames = localTotalFrames || totalFrames;

  // Frame cache with adaptive chunk size based on capture size
  const chunkSize = useMemo(() => {
    if (effectiveTotalFrames > 1_000_000) return 1000;
    if (effectiveTotalFrames > 100_000) return 500;
    return 200;
  }, [effectiveTotalFrames]);

  const { getFrame, ensureRange, clear: clearCache, cancelPending } = useFrameCache({
    maxSize: 50000,
    chunkSize,
    prefetchDistance: 500,
  });
  const [selectedFrame, setSelectedFrame] = useState<number | null>(null);
  const [filter, setFilter] = useState("");
  const [filterError, setFilterError] = useState<string | null>(null);
  const [showDetailPane, setShowDetailPane] = useState(true);
  const [detailPaneHeight, setDetailPaneHeight] = useState(250);
  const [showGoToDialog, setShowGoToDialog] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [showChatSidebar, setShowChatSidebar] = useState(false);
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);
  const [visibleRange, setVisibleRange] = useState({ start: 1, end: 100 });

  // Refs
  const gridRef = useRef<PacketGridRef | null>(null);
  const isFileLoadingRef = useRef(false);

  // Derived state
  const effectiveIsLoading = localIsLoading || isLoading;

  // File handling with loading lock to prevent rapid file switching
  const handleOpenFile = useCallback(async () => {
    // Prevent opening another file while one is loading
    if (isFileLoadingRef.current) {
      console.warn("File load already in progress, please wait...");
      return;
    }

    try {
      const selected = await open({
        multiple: false,
        filters: [
          {
            name: "Capture Files",
            extensions: ["pcap", "pcapng", "cap", "pcap.gz"],
          },
          { name: "All Files", extensions: ["*"] },
        ],
      });

      if (selected && typeof selected === "string") {
        // Set loading lock
        isFileLoadingRef.current = true;
        setLocalIsLoading(true);

        // Clear cache and reset state
        clearCache();
        cancelPending();
        setLocalTotalFrames(0);
        setFilter("");
        setFilterError(null);
        setSelectedFrame(null);

        await loadFile(selected);
        // Frame loading is now handled by useFrameCache when PacketGrid renders
      }
    } catch (e) {
      console.error("Error opening file:", e);
    } finally {
      // Release loading lock
      isFileLoadingRef.current = false;
      setLocalIsLoading(false);
    }
  }, [loadFile, clearCache, cancelPending]);

  // Filter handling
  const handleApplyFilter = useCallback(async () => {
    // Prevent filter changes while file is loading
    if (isFileLoadingRef.current) {
      return;
    }

    if (!filter.trim()) {
      try {
        setFilterError(null);
        clearCache();
        cancelPending();
        await invoke<number>("apply_filter", { filter: "" });
        // Get new total after clearing filter
        const newTotal = await invoke<number>("apply_filter", { filter: "" });
        setLocalTotalFrames(newTotal);
      } catch (e) {
        console.error("Error clearing filter:", e);
      }
      return;
    }

    try {
      const isValid = await invoke<boolean>("check_filter", { filter });
      if (!isValid) {
        setFilterError("Invalid filter syntax");
        return;
      }

      setFilterError(null);
      setLocalIsLoading(true);

      // Clear cache before applying new filter
      clearCache();
      cancelPending();

      const newTotal = await invoke<number>("apply_filter", { filter });
      setLocalTotalFrames(newTotal);
      // Frame loading is now handled by useFrameCache when PacketGrid renders
    } catch (e) {
      setFilterError(`Filter error: ${e}`);
    } finally {
      setLocalIsLoading(false);
    }
  }, [filter, clearCache, cancelPending]);

  const handleClearFilter = useCallback(() => {
    setFilter("");
    handleApplyFilter();
  }, [handleApplyFilter]);

  // Navigation
  const handleGoToPacket = useCallback(
    (packetNum: number) => {
      if (packetNum >= 1 && packetNum <= effectiveTotalFrames) {
        setSelectedFrame(packetNum);
        gridRef.current?.scrollToFrame(packetNum);
      }
    },
    [effectiveTotalFrames]
  );

  // Context menu
  const handleContextMenu = useCallback((e: React.MouseEvent, frame: FrameData) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, frame });
  }, []);

  // Visible range tracking for AI context
  const handleVisibleRangeChange = useCallback((start: number, end: number) => {
    setVisibleRange({ start, end });
  }, []);

  const applyPacketFilter = useCallback(
    (type: "source" | "dest" | "proto", value: string) => {
      let newFilter = "";
      if (type === "source") newFilter = `ip.src == ${value}`;
      if (type === "dest") newFilter = `ip.dst == ${value}`;
      if (type === "proto") newFilter = `${value.toLowerCase()}`;

      setFilter(newFilter);
      setTimeout(() => handleApplyFilter(), 0);
    },
    [handleApplyFilter]
  );

  // Keyboard shortcuts
  useKeyboardShortcuts({
    selectedFrame,
    totalFrames: effectiveTotalFrames,
    gridRef,
    onSelectFrame: setSelectedFrame,
    onOpenFile: handleOpenFile,
    onGoToPacket: () => setShowGoToDialog(true),
    onToggleDetailPane: () => setShowDetailPane((prev) => !prev),
    onCloseDialogs: () => {
      setShowGoToDialog(false);
      setShowChatSidebar(false);
    },
    onOpenChat: () => setShowChatSidebar(true),
  });

  // Resize handler for detail pane
  const handleDetailPaneResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = detailPaneHeight;

    const onMouseMove = (e: MouseEvent) => {
      const delta = startY - e.clientY;
      setDetailPaneHeight(Math.max(100, Math.min(500, startHeight + delta)));
    };

    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [detailPaneHeight]);

  // Calculate capture info for footer
  const avgPacketRate =
    duration && effectiveTotalFrames > 0 ? effectiveTotalFrames / duration : undefined;

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
      />

      {effectiveTotalFrames > 0 && (
        <FilterBar
          filter={filter}
          filterError={filterError}
          onFilterChange={setFilter}
          onApplyFilter={handleApplyFilter}
          onClearFilter={handleClearFilter}
          onGoToPacket={() => setShowGoToDialog(true)}
        />
      )}

      {error && (
        <div className="error-banner">
          <pre className="error-message">{error}</pre>
          <button onClick={clearError}>×</button>
        </div>
      )}

      {!sharkdReady && !error && (
        <div className="loading-overlay">
          <div className="loading-spinner" />
          <p>Initializing sharkd...</p>
        </div>
      )}

      <main className="app-main">
        <div
          className="packet-list-container"
          style={{
            flex:
              showDetailPane && selectedFrame
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
            isLoading={effectiveIsLoading}
            selectedFrame={selectedFrame}
            onSelectFrame={setSelectedFrame}
            onContextMenu={handleContextMenu}
            onVisibleRangeChange={handleVisibleRangeChange}
          />
        </div>

        {showDetailPane && selectedFrame && (
          <div className="detail-pane-container" style={{ height: detailPaneHeight }}>
            <div className="resize-handle" onMouseDown={handleDetailPaneResize} />
            <PacketDetailPane frameNumber={selectedFrame} />
          </div>
        )}
      </main>

      <Footer
        isReady={sharkdReady}
        selectedFrame={selectedFrame}
        totalFrames={effectiveTotalFrames}
        avgPacketRate={avgPacketRate}
      />

      {/* Context Menu */}
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
                  `${contextMenu.frame.number} ${contextMenu.frame.time} ${contextMenu.frame.source} -> ${contextMenu.frame.destination} [${contextMenu.frame.protocol}] ${contextMenu.frame.info}`
                );
              },
            },
          ]}
        />
      )}

      {/* Go to Packet Dialog */}
      {showGoToDialog && (
        <GoToPacketDialog
          totalFrames={effectiveTotalFrames}
          onGoTo={handleGoToPacket}
          onClose={() => setShowGoToDialog(false)}
        />
      )}

      {/* AI Chat Sidebar */}
      <ChatSidebar
        isOpen={showChatSidebar}
        onClose={() => setShowChatSidebar(false)}
        selectedFrame={selectedFrame}
        visibleRange={visibleRange}
        currentFilter={filter}
        fileName={fileName}
        totalFrames={effectiveTotalFrames}
        onApplyFilter={(newFilter) => {
          setFilter(newFilter);
          setTimeout(handleApplyFilter, 0);
        }}
        onGoToPacket={handleGoToPacket}
        apiKey={settings.apiKey}
        model={settings.model}
        hasApiKey={hasApiKey}
        onOpenSettings={() => setShowSettingsDialog(true)}
      />

      {/* Settings Dialog */}
      <SettingsDialog
        isOpen={showSettingsDialog}
        onClose={() => setShowSettingsDialog(false)}
        currentApiKey={settings.apiKey}
        currentModel={settings.model}
        onSaveApiKey={updateApiKey}
        onSaveModel={updateModel}
      />
    </div>
  );
}

export default App;
