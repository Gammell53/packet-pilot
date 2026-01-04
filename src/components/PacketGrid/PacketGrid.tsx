import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle, useState } from "react";
import type { FrameData, PacketGridRef } from "../../types";
import "./PacketGrid.css";

interface PacketGridProps {
  /** Get a frame by number from cache */
  getFrame: (frameNumber: number) => FrameData | undefined;
  /** Ensure a range of frames is loaded */
  ensureRange: (startFrame: number, endFrame: number) => void;
  /** Cancel pending requests (for fast scrolling) */
  cancelPending: () => void;
  totalFrames: number;
  isLoading: boolean;
  selectedFrame: number | null;
  onSelectFrame: (frameNumber: number) => void;
  onContextMenu?: (e: React.MouseEvent, frame: FrameData) => void;
  /** Called when the visible range changes */
  onVisibleRangeChange?: (start: number, end: number) => void;
}

const ROW_HEIGHT = 28;
const OVERSCAN = 30;
// Maximum safe scroll height in browsers (Chrome/Chromium limit is ~33.5M, we use 10M to be safe)
const MAX_SCROLL_HEIGHT = 10_000_000;
// Scroll velocity threshold for cancelling pending requests (pixels per ms)
const FAST_SCROLL_THRESHOLD = 5;
// Debounce delay for frame loading (ms)
const LOAD_DEBOUNCE_MS = 50;

export const PacketGrid = forwardRef<PacketGridRef, PacketGridProps>(({
  getFrame,
  ensureRange,
  cancelPending,
  totalFrames,
  isLoading: _isLoading, // Reserved for future loading indicator
  selectedFrame,
  onSelectFrame,
  onContextMenu,
  onVisibleRangeChange,
}, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);

  // Scroll throttling refs
  const scrollThrottleRef = useRef(false);
  const lastScrollTopRef = useRef(0);
  const lastScrollTimeRef = useRef(0);

  const [columnWidths, setColumnWidths] = useState({
    no: 80,
    time: 120,
    source: 160,
    dest: 160,
    proto: 80,
    len: 70,
    info: 400,
  });

  // Calculate scaling factor for large datasets
  const naturalHeight = totalFrames * ROW_HEIGHT;
  const needsScaling = naturalHeight > MAX_SCROLL_HEIGHT;
  const virtualHeight = needsScaling ? MAX_SCROLL_HEIGHT : naturalHeight;
  const scaleFactor = needsScaling ? totalFrames / (MAX_SCROLL_HEIGHT / ROW_HEIGHT) : 1;

  // Convert scroll position to row index
  const scrollToRowIndex = (scrollPos: number): number => {
    if (needsScaling) {
      const ratio = scrollPos / virtualHeight;
      return Math.floor(ratio * totalFrames);
    }
    return Math.floor(scrollPos / ROW_HEIGHT);
  };

  // Convert row index to scroll position
  const rowIndexToScroll = (rowIndex: number): number => {
    if (needsScaling) {
      const ratio = rowIndex / totalFrames;
      return ratio * virtualHeight;
    }
    return rowIndex * ROW_HEIGHT;
  };

  // Calculate visible rows based on scroll position
  const visibleRowCount = Math.ceil(containerHeight / ROW_HEIGHT) + OVERSCAN * 2;
  const startIndex = Math.max(0, scrollToRowIndex(scrollTop) - OVERSCAN);
  const endIndex = Math.min(totalFrames - 1, startIndex + visibleRowCount);

  // Generate visible row indices
  const visibleRows: number[] = [];
  for (let i = startIndex; i <= endIndex; i++) {
    visibleRows.push(i);
  }

  const handleResize = (column: keyof typeof columnWidths, startX: number, startWidth: number) => {
    const onMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - startX;
      setColumnWidths(prev => ({
        ...prev,
        [column]: Math.max(40, startWidth + delta)
      }));
    };

    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  };

  // Expose scrollToFrame method via ref
  useImperativeHandle(ref, () => ({
    scrollToFrame: (frameNumber: number) => {
      const index = frameNumber - 1;
      if (index >= 0 && index < totalFrames && containerRef.current) {
        const targetScroll = rowIndexToScroll(index) - containerHeight / 2 + ROW_HEIGHT / 2;
        containerRef.current.scrollTop = Math.max(0, Math.min(virtualHeight - containerHeight, targetScroll));
      }
    }
  }), [totalFrames, containerHeight, virtualHeight]);

  // Handle scroll events with throttling and velocity detection
  const handleScroll = useCallback(() => {
    // Throttle scroll updates to ~60fps using requestAnimationFrame
    if (scrollThrottleRef.current) return;
    scrollThrottleRef.current = true;

    requestAnimationFrame(() => {
      if (containerRef.current) {
        const newScrollTop = containerRef.current.scrollTop;
        const now = performance.now();

        // Calculate scroll velocity
        const timeDelta = now - lastScrollTimeRef.current;
        if (timeDelta > 0) {
          const scrollDelta = Math.abs(newScrollTop - lastScrollTopRef.current);
          const velocity = scrollDelta / timeDelta;

          // Cancel pending requests if scrolling very fast
          if (velocity > FAST_SCROLL_THRESHOLD) {
            cancelPending();
          }
        }

        // Update refs for velocity calculation
        lastScrollTopRef.current = newScrollTop;
        lastScrollTimeRef.current = now;

        setScrollTop(newScrollTop);
      }
      scrollThrottleRef.current = false;
    });
  }, [cancelPending]);

  // Load frames with debouncing to prevent request flooding
  useEffect(() => {
    if (totalFrames === 0) return;

    const timeoutId = setTimeout(() => {
      // Calculate frame range to ensure is loaded (1-indexed frame numbers)
      const startFrame = startIndex + 1;
      const endFrame = endIndex + 1;
      ensureRange(startFrame, endFrame);
    }, LOAD_DEBOUNCE_MS);

    return () => clearTimeout(timeoutId);
  }, [startIndex, endIndex, totalFrames, ensureRange]);

  // Notify parent of visible range changes
  useEffect(() => {
    if (totalFrames === 0) return;
    // Convert to 1-indexed frame numbers
    onVisibleRangeChange?.(startIndex + 1, endIndex + 1);
  }, [startIndex, endIndex, totalFrames, onVisibleRangeChange]);

  // Measure container height
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height);
      }
    });

    observer.observe(container);
    setContainerHeight(container.clientHeight);

    return () => observer.disconnect();
  }, []);

  // Initial load is now handled by the debounced effect above

  if (totalFrames === 0) {
    return (
      <div className="packet-grid-empty">
        <div className="empty-state">
          <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
            <line x1="10" y1="9" x2="8" y2="9"/>
          </svg>
          <h3>No capture loaded</h3>
          <p>Open a PCAP file to start analyzing packets</p>
          <p className="shortcut-hint">Press <kbd>Ctrl</kbd>+<kbd>O</kbd> to open a file</p>
        </div>
      </div>
    );
  }

  return (
    <div className="packet-grid-wrapper">
      <div className="packet-grid-header">
        <div className="col-no" style={{ width: columnWidths.no }}>
          No.
          <div className="resizer" onMouseDown={(e) => handleResize("no", e.clientX, columnWidths.no)} />
        </div>
        <div className="col-time" style={{ width: columnWidths.time }}>
          Time
          <div className="resizer" onMouseDown={(e) => handleResize("time", e.clientX, columnWidths.time)} />
        </div>
        <div className="col-source" style={{ width: columnWidths.source }}>
          Source
          <div className="resizer" onMouseDown={(e) => handleResize("source", e.clientX, columnWidths.source)} />
        </div>
        <div className="col-dest" style={{ width: columnWidths.dest }}>
          Destination
          <div className="resizer" onMouseDown={(e) => handleResize("dest", e.clientX, columnWidths.dest)} />
        </div>
        <div className="col-proto" style={{ width: columnWidths.proto }}>
          Protocol
          <div className="resizer" onMouseDown={(e) => handleResize("proto", e.clientX, columnWidths.proto)} />
        </div>
        <div className="col-len" style={{ width: columnWidths.len }}>
          Length
          <div className="resizer" onMouseDown={(e) => handleResize("len", e.clientX, columnWidths.len)} />
        </div>
        <div className="col-info" style={{ flex: 1, minWidth: columnWidths.info }}>
          Info
        </div>
      </div>
      
      <div 
        className="packet-grid-container" 
        ref={containerRef}
        onScroll={handleScroll}
      >
        {/* Virtual scroll spacer */}
        <div style={{ height: virtualHeight, width: '100%', position: 'relative' }}>
          {visibleRows.map((rowIndex) => {
            const frameNumber = rowIndex + 1;
            const frame = getFrame(frameNumber);
            const isSelected = selectedFrame === frameNumber;

            // Calculate position
            let rowTop: number;
            if (needsScaling) {
              // When scaling: we need to position rows relative to where they APPEAR in the scaled view
              // The first visible row should appear at approximately scrollTop position
              // Subsequent rows are spaced ROW_HEIGHT apart
              const firstVisibleRow = startIndex;
              const firstRowScaledPos = rowIndexToScroll(firstVisibleRow);
              const rowOffset = rowIndex - firstVisibleRow;
              rowTop = firstRowScaledPos + (rowOffset * ROW_HEIGHT);
            } else {
              rowTop = rowIndex * ROW_HEIGHT;
            }
            
            // Convert hex color to CSS
            const bgColor = frame?.background ? `#${frame.background}` : undefined;
            const fgColor = frame?.foreground ? `#${frame.foreground}` : undefined;
            
            return (
              <div
                key={rowIndex}
                className={`packet-row ${isSelected ? "selected" : ""} ${!frame ? "loading" : ""}`}
                style={{
                  height: ROW_HEIGHT,
                  transform: `translateY(${rowTop}px)`,
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  backgroundColor: isSelected ? undefined : bgColor,
                  color: isSelected ? undefined : fgColor,
                }}
                onClick={() => onSelectFrame(frameNumber)}
                onContextMenu={(e) => {
                  if (frame) {
                    onSelectFrame(frameNumber);
                    onContextMenu?.(e, frame);
                  }
                }}
                onDoubleClick={() => {
                  onSelectFrame(frameNumber);
                }}
              >
                <div className="col-no" style={{ width: columnWidths.no }}>{frameNumber.toLocaleString()}</div>
                <div className="col-time" style={{ width: columnWidths.time }}>{frame?.time || "..."}</div>
                <div className="col-source" style={{ width: columnWidths.source }}>{frame?.source || "..."}</div>
                <div className="col-dest" style={{ width: columnWidths.dest }}>{frame?.destination || "..."}</div>
                <div className="col-proto" style={{ width: columnWidths.proto }}>
                  {frame ? <span className="protocol-badge">{frame.protocol}</span> : "..."}
                </div>
                <div className="col-len" style={{ width: columnWidths.len }}>{frame?.length || "..."}</div>
                <div className="col-info" style={{ flex: 1, minWidth: columnWidths.info }}>{frame?.info || "Loading..."}</div>
              </div>
            );
          })}
        </div>
      </div>
      
      {/* Scaling indicator */}
      {needsScaling && (
        <div className="scale-indicator">
          Scale: 1:{Math.round(scaleFactor)}
        </div>
      )}
    </div>
  );
});

PacketGrid.displayName = "PacketGrid";
