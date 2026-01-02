import React, { useEffect, useRef } from "react";
import "./ContextMenu.css";

interface ContextMenuItem {
  label: string;
  onClick: () => void;
  icon?: React.ReactNode;
  divider?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  // Adjust position if menu goes off screen
  const adjustedX = Math.min(x, window.innerWidth - 200);
  const adjustedY = Math.min(y, window.innerHeight - items.length * 30 + 20);

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{ top: adjustedY, left: adjustedX }}
    >
      {items.map((item, index) => (
        <React.Fragment key={index}>
          <div
            className="context-menu-item"
            onClick={() => {
              item.onClick();
              onClose();
            }}
          >
            {item.icon && (
              <span className="context-menu-icon">{item.icon}</span>
            )}
            <span className="context-menu-label">{item.label}</span>
          </div>
          {item.divider && <div className="context-menu-divider" />}
        </React.Fragment>
      ))}
    </div>
  );
}
