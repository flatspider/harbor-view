import { useState, useCallback } from "react";
import type { ShipData } from "../types/ais";
import { getShipCategory } from "../types/ais";
import { latLonToPixel } from "../utils/coordinates";
import { ShipInfoCard } from "./ShipInfoCard";

interface HarborSceneProps {
  ships: Map<number, ShipData>;
}

const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 800;

const CATEGORY_COLORS: Record<string, string> = {
  special: "#e6a817",
  passenger: "#ffffff",
  cargo: "#4a8cbf",
  tanker: "#c44d4d",
  other: "#8b9daa",
};

const CATEGORY_SIZES: Record<string, number> = {
  special: 5,
  passenger: 7,
  cargo: 8,
  tanker: 8,
  other: 6,
};

export function HarborScene({ ships }: HarborSceneProps) {
  const [selectedShip, setSelectedShip] = useState<{
    ship: ShipData;
    x: number;
    y: number;
  } | null>(null);

  const handleShipClick = useCallback(
    (ship: ShipData, x: number, y: number) => {
      setSelectedShip({ ship, x, y });
    },
    []
  );

  const handleClose = useCallback(() => {
    setSelectedShip(null);
  }, []);

  return (
    <div className="harbor-scene" onClick={handleClose}>
      {/* Layer 1: Background gradient (placeholder until painted background) */}
      <div className="harbor-background" />

      {/* Layer 2: SVG wave overlays */}
      <div className="wave-container">
        <svg
          className="wave wave-1"
          viewBox="0 0 1200 60"
          preserveAspectRatio="none"
        >
          <path d="M0,30 C200,10 400,50 600,30 C800,10 1000,50 1200,30 L1200,60 L0,60 Z" />
        </svg>
        <svg
          className="wave wave-2"
          viewBox="0 0 1200 60"
          preserveAspectRatio="none"
        >
          <path d="M0,35 C150,15 350,55 550,30 C750,5 950,50 1200,25 L1200,60 L0,60 Z" />
        </svg>
        <svg
          className="wave wave-3"
          viewBox="0 0 1200 60"
          preserveAspectRatio="none"
        >
          <path d="M0,25 C180,45 380,15 580,35 C780,55 980,20 1200,35 L1200,60 L0,60 Z" />
        </svg>
      </div>

      {/* Layer 3: Ship markers (SVG overlay) */}
      <svg
        className="ship-layer"
        viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
      >
        {Array.from(ships.values()).map((ship) => {
          const { x, y } = latLonToPixel(
            ship.lat,
            ship.lon,
            CANVAS_WIDTH,
            CANVAS_HEIGHT
          );
          const category = getShipCategory(ship.shipType);
          const color = CATEGORY_COLORS[category];
          const size = CATEGORY_SIZES[category];

          // Skip ships with no valid position
          if (ship.lat === 0 && ship.lon === 0) return null;

          return (
            <g
              key={ship.mmsi}
              transform={`translate(${x}, ${y})`}
              className="ship-marker"
              onClick={(e) => {
                e.stopPropagation();
                handleShipClick(ship, e.clientX, e.clientY);
              }}
              style={{ cursor: "pointer" }}
            >
              {/* Ship heading indicator */}
              <line
                x1={0}
                y1={0}
                x2={Math.sin((ship.heading * Math.PI) / 180) * size * 2}
                y2={-Math.cos((ship.heading * Math.PI) / 180) * size * 2}
                stroke={color}
                strokeWidth={1.5}
                opacity={0.6}
              />
              {/* Ship dot */}
              <circle r={size} fill={color} opacity={0.9} />
              <circle r={size * 0.4} fill="white" opacity={0.6} />
            </g>
          );
        })}
      </svg>

      {/* Layer 4: Ship info card */}
      {selectedShip && (
        <ShipInfoCard
          ship={selectedShip.ship}
          x={selectedShip.x}
          y={selectedShip.y}
          onClose={handleClose}
        />
      )}
    </div>
  );
}
