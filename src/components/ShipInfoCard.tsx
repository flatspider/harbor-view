import { useEffect, useRef } from "react";
import type { ShipData } from "../types/ais";
import { getShipCategory, NAV_STATUS } from "../types/ais";
import gsap from "gsap";

interface ShipInfoCardProps {
  ship: ShipData;
  x: number;
  y: number;
  sceneWidth: number;
  sceneHeight: number;
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

const CARD_WIDTH = 320;
const CARD_HEIGHT = 220;
const CARD_PADDING = 12;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function ShipInfoCard({
  ship,
  x,
  y,
  sceneWidth,
  sceneHeight,
  onClose,
}: ShipInfoCardProps) {
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

  const cardLeft = clamp(
    x + 24,
    CARD_PADDING,
    Math.max(CARD_PADDING, sceneWidth - CARD_WIDTH - CARD_PADDING),
  );
  const cardTop = clamp(
    y - 96,
    CARD_PADDING,
    Math.max(CARD_PADDING, sceneHeight - CARD_HEIGHT - CARD_PADDING),
  );
  const cardCenterX = cardLeft + CARD_WIDTH / 2;
  const cardCenterY = cardTop + CARD_HEIGHT / 2;
  const dx = x - cardCenterX;
  const dy = y - cardCenterY;
  const connectFromCardSide = Math.abs(dx) > Math.abs(dy);
  const baseX = connectFromCardSide
    ? dx >= 0
      ? cardLeft + CARD_WIDTH - 4
      : cardLeft + 4
    : cardCenterX;
  const baseY = connectFromCardSide
    ? cardCenterY
    : dy >= 0
      ? cardTop + CARD_HEIGHT - 4
      : cardTop + 4;
  const pointerDX = x - baseX;
  const pointerDY = y - baseY;
  const pointerLength = Math.max(
    1,
    Math.hypot(pointerDX, pointerDY),
  );
  const unitX = pointerDX / pointerLength;
  const unitY = pointerDY / pointerLength;
  const perpX = -unitY;
  const perpY = unitX;
  const shaftHalf = 8;
  const arrowHalf = 16;
  const neckOffset = Math.min(Math.max(pointerLength * 0.3, 24), 52);
  const neckX = x - unitX * neckOffset;
  const neckY = y - unitY * neckOffset;
  const pointerPoints = [
    `${baseX + perpX * shaftHalf},${baseY + perpY * shaftHalf}`,
    `${neckX + perpX * shaftHalf},${neckY + perpY * shaftHalf}`,
    `${neckX + perpX * arrowHalf},${neckY + perpY * arrowHalf}`,
    `${x},${y}`,
    `${neckX - perpX * arrowHalf},${neckY - perpY * arrowHalf}`,
    `${neckX - perpX * shaftHalf},${neckY - perpY * shaftHalf}`,
    `${baseX - perpX * shaftHalf},${baseY - perpY * shaftHalf}`,
  ].join(" ");
  const cardStyle: React.CSSProperties = {
    position: "absolute",
    left: cardLeft,
    top: cardTop,
    zIndex: 2,
    pointerEvents: "auto",
  };

  return (
    <div className="ship-info-overlay" style={{ width: sceneWidth, height: sceneHeight }}>
      <svg className="ship-info-pointer" viewBox={`0 0 ${sceneWidth} ${sceneHeight}`}>
        <polygon points={pointerPoints} className="ship-info-pointer-shaft" />
      </svg>
      <div ref={cardRef} style={cardStyle} className="ship-info-card" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
        <div className="ship-info-header" style={{ borderLeftColor: CATEGORY_COLORS[category] }}>
          <span className="ship-category">{CATEGORY_LABELS[category]}</span>
          <button className="ship-info-close" onClick={handleClose}>
            &times;
          </button>
        </div>

        <h3 className="ship-name">{ship.name.trim() || `MMSI ${ship.mmsi}`}</h3>

        <div className="ship-info-grid">
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
    </div>
  );
}
