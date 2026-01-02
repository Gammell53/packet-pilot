import type { Theme } from "../../types";
import "./Header.css";

interface HeaderProps {
  fileName: string | null;
  duration: number | null;
  theme: Theme;
  isReady: boolean;
  isLoading: boolean;
  onOpenFile: () => void;
  onToggleTheme: () => void;
}

export function Header({
  fileName,
  duration,
  theme,
  isReady,
  isLoading,
  onOpenFile,
  onToggleTheme,
}: HeaderProps) {
  return (
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
          className="icon-button"
          onClick={onToggleTheme}
          title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        >
          {theme === "dark" ? (
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="5"/>
              <line x1="12" y1="1" x2="12" y2="3"/>
              <line x1="12" y1="21" x2="12" y2="23"/>
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
              <line x1="1" y1="12" x2="3" y2="12"/>
              <line x1="21" y1="12" x2="23" y2="12"/>
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
            </svg>
          )}
        </button>
        <button
          className="open-button"
          onClick={onOpenFile}
          disabled={!isReady || isLoading}
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
  );
}
