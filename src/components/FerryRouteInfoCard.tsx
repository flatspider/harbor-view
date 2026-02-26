import { useEffect, useRef } from "react";
import gsap from "gsap";
import type { FerryRouteInfo } from "../scene/ferryRoutes";

interface FerryRouteInfoCardProps {
  route: FerryRouteInfo;
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

export function FerryRouteInfoCard({
  route,
  x,
  y,
  sceneWidth,
  sceneHeight,
  onClose,
}: FerryRouteInfoCardProps) {
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

  return (
    <div ref={cardRef} style={cardStyle} className="ship-info-card" onClick={(e) => e.stopPropagation()}>
      <div className="ship-info-header" style={{ borderLeftColor: route.routeColor }}>
        <span className="ship-category">Ferry Route</span>
        <button className="ship-info-close" onClick={handleClose}>
          &times;
        </button>
      </div>

      <h3 className="ship-name">{route.routeName}</h3>

      <div className="ship-info-grid">
        <div className="ship-info-row">
          <span className="ship-info-label">Origin</span>
          <span className="ship-info-value">{route.origin}</span>
        </div>
        <div className="ship-info-row">
          <span className="ship-info-label">Destination</span>
          <span className="ship-info-value">{route.destination}</span>
        </div>
        <div className="ship-info-row">
          <span className="ship-info-label">Next Departure</span>
          <span className="ship-info-value">{route.nextDeparture}</span>
        </div>
      </div>

      <div className="ship-mmsi">Route {route.routeId}</div>
    </div>
  );
}
