import { useEffect, useCallback } from "react";
import type { PacketGridRef } from "../types";

interface KeyboardShortcutsConfig {
  selectedFrame: number | null;
  totalFrames: number;
  gridRef: React.RefObject<PacketGridRef | null>;
  onSelectFrame: (frame: number) => void;
  onOpenFile: () => void;
  onGoToPacket: () => void;
  onToggleDetailPane: () => void;
  onCloseDialogs: () => void;
}

export function useKeyboardShortcuts({
  selectedFrame,
  totalFrames,
  gridRef,
  onSelectFrame,
  onOpenFile,
  onGoToPacket,
  onToggleDetailPane,
  onCloseDialogs,
}: KeyboardShortcutsConfig) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Ignore if typing in input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        if (e.key === "Escape") {
          (e.target as HTMLElement).blur();
        }
        return;
      }

      // Ctrl+G or Cmd+G: Go to packet
      if ((e.ctrlKey || e.metaKey) && e.key === "g") {
        e.preventDefault();
        onGoToPacket();
        return;
      }

      // Ctrl+O or Cmd+O: Open file
      if ((e.ctrlKey || e.metaKey) && e.key === "o") {
        e.preventDefault();
        onOpenFile();
        return;
      }

      // Arrow keys for navigation
      if (selectedFrame !== null && totalFrames > 0) {
        if (e.key === "ArrowDown" || e.key === "j") {
          e.preventDefault();
          const next = Math.min(selectedFrame + 1, totalFrames);
          onSelectFrame(next);
          gridRef.current?.scrollToFrame(next);
        } else if (e.key === "ArrowUp" || e.key === "k") {
          e.preventDefault();
          const prev = Math.max(selectedFrame - 1, 1);
          onSelectFrame(prev);
          gridRef.current?.scrollToFrame(prev);
        } else if (e.key === "PageDown") {
          e.preventDefault();
          const next = Math.min(selectedFrame + 20, totalFrames);
          onSelectFrame(next);
          gridRef.current?.scrollToFrame(next);
        } else if (e.key === "PageUp") {
          e.preventDefault();
          const prev = Math.max(selectedFrame - 20, 1);
          onSelectFrame(prev);
          gridRef.current?.scrollToFrame(prev);
        } else if (e.key === "Home") {
          e.preventDefault();
          onSelectFrame(1);
          gridRef.current?.scrollToFrame(1);
        } else if (e.key === "End") {
          e.preventDefault();
          onSelectFrame(totalFrames);
          gridRef.current?.scrollToFrame(totalFrames);
        }
      } else if (totalFrames > 0 && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        // Select first packet if none selected
        onSelectFrame(1);
        gridRef.current?.scrollToFrame(1);
      }

      // Escape: Close dialogs
      if (e.key === "Escape") {
        onCloseDialogs();
      }

      // Toggle detail pane with 'd'
      if (e.key === "d") {
        onToggleDetailPane();
      }
    },
    [
      selectedFrame,
      totalFrames,
      gridRef,
      onSelectFrame,
      onOpenFile,
      onGoToPacket,
      onToggleDetailPane,
      onCloseDialogs,
    ]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);
}
