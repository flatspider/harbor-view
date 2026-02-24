import { useEffect, useRef } from "react";
import type { ShipData } from "../types/ais";
import { getShipCategory, NAV_STATUS } from "../types/ais";
import gsap from "gsap";

interface ShipInfoCardProps {
  ship: ShipData;
  x: number;
  y: number;
  onClose: () => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  special: "Special Craft",
  passenger: "Passenger Vessel",
  cargo: "Cargo Vessel",
  tanker: "Tanker",
  other: "Vessel",
};

const CATEGORY_COLORS: Record<string, string> = {
  special: "#e6a817",
  passenger: "#ffffff",
  cargo: "#2c5f8a",
  tanker: "#8b2d2d",
  other: "#6b7b8d",
};

export function ShipInfoCard({ ship, x, y, onClose }: ShipInfoCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const category = getShipCategory(ship.shipType);

  useEffect(() => {
    if (cardRef.current) {
      gsap.fromTo(
        cardRef.current,
        { opacity: 0, scale: 0.85, y: 10 },
        { opacity: 1, scale: 1, y: 0, duration: 0.3, ease: "back.out(1.7)" }
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

  // Position card so it stays in viewport
  const cardStyle: React.CSSProperties = {
    position: "absolute",
    left: x + 20,
    top: y - 60,
    zIndex: 100,
  };

  return (
    <div ref={cardRef} style={cardStyle} className="ship-info-card" onClick={(e) => e.stopPropagation()}>
      <div className="ship-info-header" style={{ borderLeftColor: CATEGORY_COLORS[category] }}>
        <span className="ship-category">{CATEGORY_LABELS[category]}</span>
        <button className="ship-info-close" onClick={handleClose}>
          &times;
        </button>
      </div>

      <h3 className="ship-name">{ship.name.trim() || `MMSI ${ship.mmsi}`}</h3>

      <div className="ship-info-grid">
        {ship.destination && (
          <div className="ship-info-row">
            <span className="ship-info-label">Destination</span>
            <span className="ship-info-value">{ship.destination.trim()}</span>
          </div>
        )}
        <div className="ship-info-row">
          <span className="ship-info-label">Speed</span>
          <span className="ship-info-value">{ship.sog.toFixed(1)} kn</span>
        </div>
        <div className="ship-info-row">
          <span className="ship-info-label">Course</span>
          <span className="ship-info-value">{ship.cog.toFixed(0)}&deg;</span>
        </div>
        <div className="ship-info-row">
          <span className="ship-info-label">Status</span>
          <span className="ship-info-value">{NAV_STATUS[ship.navStatus] ?? "Unknown"}</span>
        </div>
        {ship.callSign && (
          <div className="ship-info-row">
            <span className="ship-info-label">Call Sign</span>
            <span className="ship-info-value">{ship.callSign.trim()}</span>
          </div>
        )}
      </div>

      <div className="ship-mmsi">MMSI {ship.mmsi}</div>
    </div>
  );
}
