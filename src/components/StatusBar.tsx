interface StatusBarProps {
  shipCount: number;
  connectionStatus: "connecting" | "connected" | "disconnected" | "error";
}

const STATUS_INDICATOR: Record<string, { color: string; label: string }> = {
  connecting: { color: "#e6a817", label: "Connecting..." },
  connected: { color: "#2ea043", label: "Live" },
  disconnected: { color: "#8b949e", label: "Disconnected" },
  error: { color: "#da3633", label: "Error" },
};

export function StatusBar({ shipCount, connectionStatus }: StatusBarProps) {
  const status = STATUS_INDICATOR[connectionStatus];

  return (
    <div className="status-bar">
      <div className="status-title">
        <h1>Harbor Watch</h1>
        <span className="status-subtitle">New York Harbor — Live</span>
      </div>
      <div className="status-info">
        <div className="status-indicator">
          <span className="status-dot" style={{ backgroundColor: status.color }} />
          <span>{status.label}</span>
        </div>
        <div className="status-ship-count">
          <span className="ship-count-number">{shipCount}</span>
          <span>vessels</span>
        </div>
      </div>
    </div>
  );
}
