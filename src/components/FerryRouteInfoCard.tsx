import { useEffect, useRef, useState } from "react";
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
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startLeft: number;
    startTop: number;
  } | null>(null);
  const [dragPosition, setDragPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);

  useEffect(() => {
    if (cardRef.current) {
      gsap.fromTo(
        cardRef.current,
        { opacity: 0, scale: 0.85, y: 10 },
        { opacity: 1, scale: 1, y: 0, duration: 0.3, ease: "back.out(1.7)" },
      );
    }
  }, []);

  useEffect(() => {
    setDragPosition(null);
  }, [route.routeId]);

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

  const autoLeft = clamp(
    x + 20,
    CARD_PADDING,
    Math.max(CARD_PADDING, sceneWidth - CARD_WIDTH - CARD_PADDING),
  );
  const autoTop = clamp(
    y - 60,
    CARD_PADDING,
    Math.max(CARD_PADDING, sceneHeight - CARD_HEIGHT - CARD_PADDING),
  );
  const cardStyle: React.CSSProperties = {
    position: "absolute",
    left: dragPosition?.left ?? autoLeft,
    top: dragPosition?.top ?? autoTop,
    zIndex: 100,
  };

  const isNoDragTarget = (target: EventTarget | null): boolean =>
    target instanceof HTMLElement &&
    Boolean(target.closest("button, a, input, select, textarea"));

  const handleCardPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (isNoDragTarget(event.target)) return;
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: dragPosition?.left ?? autoLeft,
      startTop: dragPosition?.top ?? autoTop,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleCardPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const nextLeft = clamp(
      dragState.startLeft + (event.clientX - dragState.startX),
      CARD_PADDING,
      Math.max(CARD_PADDING, sceneWidth - CARD_WIDTH - CARD_PADDING),
    );
    const nextTop = clamp(
      dragState.startTop + (event.clientY - dragState.startY),
      CARD_PADDING,
      Math.max(CARD_PADDING, sceneHeight - CARD_HEIGHT - CARD_PADDING),
    );
    setDragPosition({ left: nextLeft, top: nextTop });
  };

  const handleCardPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    dragStateRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div
      ref={cardRef}
      style={cardStyle}
      className="ship-info-card ship-info-draggable"
      onPointerDown={handleCardPointerDown}
      onPointerMove={handleCardPointerMove}
      onPointerUp={handleCardPointerUp}
      onPointerCancel={handleCardPointerUp}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="ship-info-header"
        style={{ borderLeftColor: route.routeColor }}
      >
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
