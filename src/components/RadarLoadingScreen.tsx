import type { CSSProperties } from "react";

interface RadarContact {
  x: number;
  y: number;
  size: number;
}

interface RadarLoadingScreenProps {
  dismissing: boolean;
}

const RADAR_SWEEP_DURATION_MS = 3600;

const RADAR_CONTACTS: RadarContact[] = [
  { x: 67, y: 15, size: 11 },
  { x: 80, y: 17, size: 10 },
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

            // 0° at top, increasing clockwise
            const angleFromTopClockwise =
              ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;

            // MUST match your CSS sweep setup
            const RADAR_CONIC_FROM_DEG = 180; // conic-gradient(from 180deg, ...)
            const RADAR_WEDGE_DEG = 78; // your sweep wedge width
            const RADAR_LEAD_DEG = 1.2; // --lead: 1.2deg (bright line thickness)

            // Optional: compensate for blur/glow making the perceived hit slightly early
            const EYE_BIAS_DEG = 0.6; // try 0 → 1.0

            // Aim at the CENTER of the bright line (not the wedge edge)
            const leadCenterPhaseDeg =
              (RADAR_CONIC_FROM_DEG +
                RADAR_WEDGE_DEG -
                RADAR_LEAD_DEG / 2 -
                EYE_BIAS_DEG +
                360) %
              360;

            const rotationNeededDeg =
              (angleFromTopClockwise - leadCenterPhaseDeg + 360) % 360;

            const D = RADAR_SWEEP_DURATION_MS;

            // Small cheat (optional). Keep this small; use EYE_BIAS_DEG first.
            const CONTACT_LEAD_MS = 0; // later try 30–80

            // Convert degrees → ms within the sweep cycle
            const phaseMs = (rotationNeededDeg / 360) * D;

            // Apply lead and WRAP into [0, D) so negative delays behave consistently
            const phaseWithLeadMs = (phaseMs - CONTACT_LEAD_MS + D) % D;

            // Negative delay starts the animation mid-cycle
            const delayMs = -phaseWithLeadMs;

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
