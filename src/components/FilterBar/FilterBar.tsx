import "./FilterBar.css";

interface FilterBarProps {
  filter: string;
  filterError: string | null;
  onFilterChange: (value: string) => void;
  onApplyFilter: () => void;
  onClearFilter: () => void;
  onGoToPacket: () => void;
}

export function FilterBar({
  filter,
  filterError,
  onFilterChange,
  onApplyFilter,
  onClearFilter,
  onGoToPacket,
}: FilterBarProps) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      onApplyFilter();
    }
  };

  return (
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
          onChange={(e) => onFilterChange(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        {filter && (
          <button className="filter-clear" onClick={onClearFilter}>
            ×
          </button>
        )}
      </div>
      <button className="filter-apply" onClick={onApplyFilter}>
        Apply
      </button>
      <button
        className="icon-button small"
        onClick={onGoToPacket}
        title="Go to packet (Ctrl+G)"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      </button>
      {filterError && <span className="filter-error">{filterError}</span>}
    </div>
  );
}
