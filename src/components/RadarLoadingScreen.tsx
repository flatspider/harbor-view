import type { CSSProperties } from "react";

interface RadarContact {
  x: number;
  y: number;
  size: number;
}

interface RadarLoadingScreenProps {
  dismissing: boolean;
}

const RADAR_SWEEP_DURATION_MS = 3400;

const RADAR_CONTACTS: RadarContact[] = [
  { x: 67, y: 22, size: 11 },
  { x: 80, y: 40, size: 10 },
  { x: 43, y: 81, size: 12 },
];

export function RadarLoadingScreen({ dismissing }: RadarLoadingScreenProps) {
  return (
    <div
      className={`radar-loading-screen${dismissing ? " is-dismissing" : ""}`}
      role="status"
      aria-live="polite"
      aria-label="Initializing harbor radar display"
    >
      <div
        className="radar-loading-screen__scope"
        aria-hidden="true"
        style={{
          ["--radar-sweep-ms" as string]: `${RADAR_SWEEP_DURATION_MS}ms`,
        }}
      >
        <div className="radar-loading-screen__scan" />
        <div className="radar-loading-screen__grid" />
        <div className="radar-loading-screen__rings" />
        <div className="radar-loading-screen__contacts">
          {RADAR_CONTACTS.map((contact) => {
            const dx = contact.x - 50;
            const dy = contact.y - 50;
            const angleFromTopClockwise =
              ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
            const delayMs = -(
              (angleFromTopClockwise / 360) *
              RADAR_SWEEP_DURATION_MS
            );
            return (
              <span
                key={`${contact.x}-${contact.y}`}
                className="radar-loading-screen__contact"
                style={
                  {
                    ["--contact-x" as string]: `${contact.x}%`,
                    ["--contact-y" as string]: `${contact.y}%`,
                    ["--contact-size" as string]: `${contact.size}px`,
                    ["--contact-delay" as string]: `${delayMs}ms`,
                  } as CSSProperties
                }
              />
            );
          })}
        </div>
        <div className="radar-loading-screen__center-dot" />
      </div>
      <p className="radar-loading-screen__label">Initializing...</p>
    </div>
  );
}
