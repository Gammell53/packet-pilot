import { useEffect, useRef, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

export interface FrameData {
  number: number;
  time: string;
  source: string;
  destination: string;
  protocol: string;
  length: string;
  info: string;
  background?: string;
  foreground?: string;
}

interface PacketGridProps {
  frames: FrameData[];
  totalFrames: number;
  onLoadMore: (startIndex: number, count: number) => void;
  isLoading: boolean;
  selectedFrame: number | null;
  onSelectFrame: (frameNumber: number) => void;
}

const ROW_HEIGHT = 28;
const OVERSCAN = 20;
const PAGE_SIZE = 100;

export function PacketGrid({
  frames,
  totalFrames,
  onLoadMore,
  isLoading,
  selectedFrame,
  onSelectFrame,
}: PacketGridProps) {
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const loadedRangeRef = useRef<{ start: number; end: number }>({
    start: 0,
    end: 0,
  });

  const virtualizer = useVirtualizer({
    count: totalFrames,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
  });

  const virtualRows = virtualizer.getVirtualItems();

  const handleRangeChange = useCallback(() => {
    if (totalFrames === 0 || isLoading) return;

    const range = virtualizer.range;
    if (!range) return;

    const start = Math.max(0, range.startIndex - OVERSCAN);
    const end = Math.min(totalFrames, range.endIndex + OVERSCAN);

    if (start < loadedRangeRef.current.start || end > loadedRangeRef.current.end) {
      const loadStart = Math.max(0, start - PAGE_SIZE);
      const loadCount = Math.min(totalFrames - loadStart, (end - start) + PAGE_SIZE * 2);

      loadedRangeRef.current = { start: loadStart, end: loadStart + loadCount };
      onLoadMore(loadStart, loadCount);
    }
  }, [totalFrames, isLoading, onLoadMore, virtualizer]);

  useEffect(() => {
    const container = tableContainerRef.current;
    if (!container) return;
    const handleScroll = () => handleRangeChange();
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [handleRangeChange]);

  useEffect(() => {
    if (totalFrames > 0 && frames.length === 0) {
      onLoadMore(0, PAGE_SIZE);
    }
  }, [totalFrames, frames.length, onLoadMore]);

  if (totalFrames === 0) {
    return (
      <div className="packet-grid-empty">
        <div className="empty-state">
          <h3>No capture loaded</h3>
          <p>Open a PCAP file to start analyzing packets</p>
        </div>
      </div>
    );
  }

  return (
    <div className="packet-grid-wrapper">
      <div className="packet-grid-header">
        <div className="col-no">No.</div>
        <div className="col-time">Time</div>
        <div className="col-source">Source</div>
        <div className="col-dest">Destination</div>
        <div className="col-proto">Protocol</div>
        <div className="col-len">Length</div>
        <div className="col-info">Info</div>
      </div>
      <div className="packet-grid-container" ref={tableContainerRef}>
        <div style={{ height: `${virtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
          {virtualRows.map((virtualRow) => {
            const frameNumber = virtualRow.index + 1;
            const frame = frames.find(f => f.number === frameNumber);
            const isSelected = selectedFrame === frameNumber;
            
            return (
              <div
                key={virtualRow.key}
                className={`packet-row ${isSelected ? "selected" : ""} ${!frame ? "loading" : ""}`}
                style={{
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  backgroundColor: frame?.background,
                  color: frame?.foreground,
                }}
                onClick={() => frame && onSelectFrame(frame.number)}
              >
                <div className="col-no">{frameNumber}</div>
                <div className="col-time">{frame?.time || "..."}</div>
                <div className="col-source">{frame?.source || "..."}</div>
                <div className="col-dest">{frame?.destination || "..."}</div>
                <div className="col-proto">
                  {frame ? <span className="protocol-badge">{frame.protocol}</span> : "..."}
                </div>
                <div className="col-len">{frame?.length || "..."}</div>
                <div className="col-info">{frame?.info || "Loading..."}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
