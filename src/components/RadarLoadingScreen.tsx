interface RadarLoadingScreenProps {
  dismissing: boolean;
}

export function RadarLoadingScreen({ dismissing }: RadarLoadingScreenProps) {
  return (
    <div
      className={`radar-loading-screen${dismissing ? " is-dismissing" : ""}`}
      role="status"
      aria-live="polite"
      aria-label="Initializing harbor radar display"
    >
      <div className="radar-loading-screen__scope" aria-hidden="true">
        <div className="radar-loading-screen__scan" />
        <div className="radar-loading-screen__grid" />
        <div className="radar-loading-screen__rings" />
        <div className="radar-loading-screen__center-dot" />
      </div>
      <p className="radar-loading-screen__label">Initializing Harbor Radar</p>
    </div>
  );
}
