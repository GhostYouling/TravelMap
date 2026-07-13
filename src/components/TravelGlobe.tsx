import { useEffect, useMemo, useRef, useState } from "react";
import { geoDistance, geoGraticule10, geoOrthographic, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { GeometryObject, Topology } from "topojson-specification";
import landAtlas from "world-atlas/land-110m.json";
import type { Trip } from "../types";

interface Props {
  trips: Trip[];
  selectedId: string | null;
  onSelect: (trip: Trip) => void;
}

interface DragState {
  x: number;
  y: number;
  longitude: number;
  latitude: number;
}

const topology = landAtlas as unknown as Topology<{ land: GeometryObject }>;
const land = feature(topology, topology.objects.land);

export function TravelGlobe({ trips, selectedId, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [size, setSize] = useState(560);
  const [center, setCenter] = useState<[number, number]>([105, 22]);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize(Math.max(300, Math.min(entry.contentRect.width, entry.contentRect.height, 680)));
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (dragging || reduceMotion) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) setCenter(([longitude, latitude]) => [(longitude + 0.085) % 360, latitude]);
    }, 50);
    return () => window.clearInterval(timer);
  }, [dragging]);

  const projection = useMemo(
    () => geoOrthographic().translate([size / 2, size / 2]).scale(size * 0.43).rotate([-center[0], -center[1]]).clipAngle(90),
    [center, size],
  );
  const path = useMemo(() => geoPath(projection), [projection]);
  const spherePath = path({ type: "Sphere" }) || "";
  const landPath = path(land) || "";
  const gridPath = path(geoGraticule10()) || "";

  function handlePointerDown(event: React.PointerEvent<SVGSVGElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { x: event.clientX, y: event.clientY, longitude: center[0], latitude: center[1] };
    setDragging(true);
  }

  function handlePointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const longitude = drag.longitude - (event.clientX - drag.x) * 0.28;
    const latitude = Math.max(-72, Math.min(72, drag.latitude + (event.clientY - drag.y) * 0.2));
    setCenter([longitude, latitude]);
  }

  function handlePointerUp(event: React.PointerEvent<SVGSVGElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
    setDragging(false);
  }

  return (
    <div className="globe-stage" ref={containerRef} data-testid="travel-globe">
      <div className="globe-orbit globe-orbit-one" />
      <div className="globe-orbit globe-orbit-two" />
      <svg
        className={`globe-svg${dragging ? " is-dragging" : ""}`}
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label="可拖动的旅行地球，地点气泡可以点击"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <defs>
          <radialGradient id="ocean" cx="35%" cy="26%" r="72%">
            <stop offset="0%" stopColor="#2d6a61" />
            <stop offset="55%" stopColor="#174740" />
            <stop offset="100%" stopColor="#0b2826" />
          </radialGradient>
          <filter id="glow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <clipPath id="sphere-clip"><path d={spherePath} /></clipPath>
        </defs>
        <path className="globe-shadow" d={spherePath} transform="translate(0 12)" />
        <path className="globe-ocean" d={spherePath} />
        <path className="globe-grid" d={gridPath} clipPath="url(#sphere-clip)" />
        <path className="globe-land" d={landPath} />
        <path className="globe-shine" d={spherePath} />
        {trips.map((trip) => {
          const coordinates = projection([trip.longitude, trip.latitude]);
          const visible = geoDistance([trip.longitude, trip.latitude], center) < Math.PI / 2 - 0.025;
          if (!coordinates || !visible) return null;
          const [x, y] = coordinates;
          const selected = trip.id === selectedId;
          return (
            <g
              key={trip.id}
              className={`globe-marker${selected ? " is-selected" : ""}`}
              transform={`translate(${x}, ${y})`}
              role="button"
              tabIndex={0}
              aria-label={`${trip.locationName}：${trip.title}，${trip.mediaCount} 个媒体`}
              data-testid={`globe-marker-${trip.id}`}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => onSelect(trip)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(trip);
                }
              }}
            >
              <circle className="marker-pulse" r={selected ? 23 : 18} fill={trip.color} />
              <circle className="marker-core" r={selected ? 8 : 6.5} fill={trip.color} filter="url(#glow)" />
              <g className="marker-label" transform="translate(13 -17)">
                <rect x="0" y="0" rx="10" width={Math.max(82, trip.locationName.length * 12 + 26)} height="30" />
                <text x="12" y="20">{trip.locationName}</text>
              </g>
            </g>
          );
        })}
      </svg>
      <div className="globe-hint"><span />拖动地球 · 点击气泡</div>
    </div>
  );
}
