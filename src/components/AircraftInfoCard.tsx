import { useEffect, useRef } from "react";
import gsap from "gsap";
import type { AircraftData } from "../types/aircraft";

interface AircraftInfoCardProps {
  aircraft: AircraftData;
  x: number;
  y: number;
  sceneWidth: number;
  sceneHeight: number;
  onClose: () => void;
}

const CARD_WIDTH = 320;
const CARD_HEIGHT = 236;
const CARD_PADDING = 12;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function formatFeet(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "Unknown";
  return `${Math.round(value).toLocaleString()} ft`;
}

export function AircraftInfoCard({
  aircraft,
  x,
  y,
  sceneWidth,
  sceneHeight,
  onClose,
}: AircraftInfoCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (cardRef.current) {
      gsap.fromTo(
        cardRef.current,
        { opacity: 0, scale: 0.85, y: 10 },
        { opacity: 1, scale: 1, y: 0, duration: 0.3, ease: "back.out(1.7)" },
      );
    }
  }, []);

  const handleClose = () => {
    if (cardRef.current) {
      gsap.to(cardRef.current, {
        opacity: 0,
        scale: 0.9,
        duration: 0.2,
        ease: "power2.in",
        onComplete: onClose,
      });
    } else {
      onClose();
    }
  };

  const cardStyle: React.CSSProperties = {
    position: "absolute",
    left: clamp(
      x + 20,
      CARD_PADDING,
      Math.max(CARD_PADDING, sceneWidth - CARD_WIDTH - CARD_PADDING),
    ),
    top: clamp(
      y - 60,
      CARD_PADDING,
      Math.max(CARD_PADDING, sceneHeight - CARD_HEIGHT - CARD_PADDING),
    ),
    zIndex: 100,
  };

  const callsign = aircraft.flight.trim() || `ICAO ${aircraft.hex.toUpperCase()}`;

  return (
    <div
      ref={cardRef}
      style={cardStyle}
      className="ship-info-card"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="ship-info-header" style={{ borderLeftColor: "#f5b66b" }}>
        <span className="ship-category">Aircraft</span>
        <button className="ship-info-close" onClick={handleClose}>
          &times;
        </button>
      </div>

      <h3 className="ship-name">{callsign}</h3>

      <div className="ship-info-grid">
        <div className="ship-info-row">
          <span className="ship-info-label">Speed</span>
          <span className="ship-info-value">{aircraft.gs.toFixed(0)} kn</span>
        </div>
        <div className="ship-info-row">
          <span className="ship-info-label">Track</span>
          <span className="ship-info-value">{aircraft.track.toFixed(0)}&deg;</span>
        </div>
        <div className="ship-info-row">
          <span className="ship-info-label">Altitude</span>
          <span className="ship-info-value">{formatFeet(aircraft.alt_baro)}</span>
        </div>
        <div className="ship-info-row">
          <span className="ship-info-label">Squawk</span>
          <span className="ship-info-value">
            {aircraft.squawk.trim() || "Unknown"}
          </span>
        </div>
      </div>

      <div className="ship-mmsi">HEX {aircraft.hex.toUpperCase()}</div>
    </div>
  );
}
