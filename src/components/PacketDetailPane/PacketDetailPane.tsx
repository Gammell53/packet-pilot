import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ProtoNode, FrameDetails } from "../../types";
import "./PacketDetailPane.css";

interface PacketDetailPaneProps {
  frameNumber: number | null;
}

export function PacketDetailPane({ frameNumber }: PacketDetailPaneProps) {
  const [details, setDetails] = useState<FrameDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<"tree" | "hex">("tree");

  useEffect(() => {
    if (frameNumber === null) {
      setDetails(null);
      return;
    }

    const fetchDetails = async () => {
      setLoading(true);
      try {
        const result = await invoke<FrameDetails>("get_frame_details", {
          frameNum: frameNumber,
        });
        setDetails(result);
        // Auto-expand first level
        if (result.tree) {
          const initialExpanded = new Set<string>();
          result.tree.forEach((_, i) => initialExpanded.add(String(i)));
          setExpandedNodes(initialExpanded);
        }
      } catch (e) {
        console.error("Failed to get frame details:", e);
        setDetails(null);
      }
      setLoading(false);
    };

    fetchDetails();
  }, [frameNumber]);

  const toggleNode = (path: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const renderProtoNode = (
    node: ProtoNode,
    path: string,
    depth: number = 0
  ): React.ReactNode => {
    const hasChildren = node.n && node.n.length > 0;
    const isExpanded = expandedNodes.has(path);
    const indent = depth * 16;

    return (
      <div key={path} className="proto-node">
        <div
          className={`proto-node-label ${hasChildren ? "expandable" : ""} ${node.e ? "expert" : ""}`}
          style={{ paddingLeft: `${indent + 4}px` }}
          onClick={() => hasChildren && toggleNode(path)}
        >
          {hasChildren && (
            <span className={`expand-icon ${isExpanded ? "expanded" : ""}`}>
              ▶
            </span>
          )}
          <span className="proto-label">{node.l}</span>
          {node.v && <span className="proto-value">: {node.v}</span>}
        </div>
        {hasChildren && isExpanded && (
          <div className="proto-children">
            {node.n!.map((child, i) =>
              renderProtoNode(child, `${path}-${i}`, depth + 1)
            )}
          </div>
        )}
      </div>
    );
  };

  const renderHexDump = (bytes: string) => {
    // bytes is base64 encoded
    try {
      const decoded = atob(bytes);
      const lines: string[] = [];

      for (let i = 0; i < decoded.length; i += 16) {
        const offset = i.toString(16).padStart(8, "0");
        const hexParts: string[] = [];
        const asciiParts: string[] = [];

        for (let j = 0; j < 16; j++) {
          if (i + j < decoded.length) {
            const byte = decoded.charCodeAt(i + j);
            hexParts.push(byte.toString(16).padStart(2, "0"));
            asciiParts.push(
              byte >= 32 && byte < 127 ? String.fromCharCode(byte) : "."
            );
          } else {
            hexParts.push("  ");
            asciiParts.push(" ");
          }
        }

        const hex =
          hexParts.slice(0, 8).join(" ") + "  " + hexParts.slice(8).join(" ");
        const ascii = asciiParts.join("");
        lines.push(`${offset}  ${hex}  ${ascii}`);
      }

      return lines.join("\n");
    } catch {
      return "Unable to decode bytes";
    }
  };

  if (frameNumber === null) {
    return (
      <div className="packet-detail-pane empty">
        <p>Select a packet to view details</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="packet-detail-pane loading">
        <div className="loading-spinner small" />
        <p>Loading frame {frameNumber}...</p>
      </div>
    );
  }

  if (!details) {
    return (
      <div className="packet-detail-pane empty">
        <p>No details available</p>
      </div>
    );
  }

  return (
    <div className="packet-detail-pane">
      <div className="detail-tabs">
        <button
          className={`detail-tab ${activeTab === "tree" ? "active" : ""}`}
          onClick={() => setActiveTab("tree")}
        >
          Protocol Tree
        </button>
        <button
          className={`detail-tab ${activeTab === "hex" ? "active" : ""}`}
          onClick={() => setActiveTab("hex")}
        >
          Hex Dump
        </button>
        <div className="detail-tab-info">Frame {frameNumber}</div>
      </div>

      <div className="detail-content">
        {activeTab === "tree" && details.tree && (
          <div className="proto-tree">
            {details.tree.map((node, i) => renderProtoNode(node, String(i), 0))}
          </div>
        )}

        {activeTab === "hex" && details.bytes && (
          <pre className="hex-dump">{renderHexDump(details.bytes)}</pre>
        )}
      </div>
    </div>
  );
}
