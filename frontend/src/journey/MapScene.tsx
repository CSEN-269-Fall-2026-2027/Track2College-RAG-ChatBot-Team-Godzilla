import { memo } from "react";
import type { CheckpointId } from "./logic";

/**
 * Pixel-art landscape for the UC Journey Map. Everything sits on an integer grid
 * with crispEdges so it scales up as clean pixels. Two layouts: a wide winding
 * route for desktop and a tall one for phones.
 */

export type Layout = "wide" | "tall";
type Pt = [number, number];

export const LAYOUTS: Record<Layout, { w: number; h: number; start: Pt; nodes: Pt[]; finish: Pt }> = {
  wide: { w: 200, h: 112, start: [6, 96], nodes: [[26, 80], [62, 44], [100, 76], [140, 38], [174, 70]], finish: [188, 98] },
  tall: { w: 96, h: 236, start: [12, 6], nodes: [[24, 30], [70, 72], [26, 114], [70, 156], [46, 198]], finish: [46, 228] },
};

const C = {
  grass: "#aabf8f",
  grassDark: "#98ae7e",
  tuft: "#869d6c",
  canopy: "#6f8f5a",
  canopyDark: "#58764a",
  trunk: "#7a5a3c",
  path: "#e6d6b0",
  pathEdge: "#c8b184",
  water: "#6f87a3",
  waterLight: "#8ea3bb",
  wall: "#f3ead3",
  wallShade: "#ddd0b0",
  roof: "#4f6280",
  roofDark: "#3f5068",
  gold: "#c9a23f",
  ink: "#2f3a33",
  stone: "#b9b2a1",
  stoneDark: "#9a937f",
  rock: "#8d97a3",
  red: "#b5523b",
};

/** Orthogonal route through all points so the path reads as pixel tiles. */
export function routePoints(layout: Layout): Pt[] {
  const { start, nodes, finish } = LAYOUTS[layout];
  const stops = [start, ...nodes, finish];
  const pts: Pt[] = [stops[0]];
  for (let i = 1; i < stops.length; i++) {
    const [x1, y1] = stops[i - 1];
    const [x2, y2] = stops[i];
    if (layout === "wide") {
      const mx = Math.round((x1 + x2) / 2);
      pts.push([mx, y1], [mx, y2], [x2, y2]);
    } else {
      const my = Math.round((y1 + y2) / 2);
      pts.push([x1, my], [x2, my], [x2, y2]);
    }
  }
  return pts;
}

function distToSegment([px, py]: Pt, [ax, ay]: Pt, [bx, by]: Pt) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = dx || dy ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Deterministic pseudo-random scatter that keeps clear of the path and landmarks. */
function scatter(layout: Layout, route: Pt[], step: number, clearPath: number, clearNode: number, salt: number): Pt[] {
  const { w, h, nodes, finish, start } = LAYOUTS[layout];
  const out: Pt[] = [];
  for (let y = 6; y < h - 4; y += step) {
    for (let x = 4; x < w - 4; x += step) {
      const n = Math.sin(x * 12.9898 + y * 78.233 + salt) * 43758.5453;
      const r = n - Math.floor(n);
      if (r > 0.42) continue;
      const p: Pt = [x + Math.round(r * step * 1.6) - 2, y + Math.round(((r * 7) % 1) * step) - 2];
      if (route.some((a, i) => i > 0 && distToSegment(p, route[i - 1], a) < clearPath)) continue;
      if ([...nodes, finish, [start[0] + 3, start[1]] as Pt].some(([nx, ny]) => Math.hypot(nx - p[0], ny - 8 - p[1]) < clearNode)) continue;
      out.push(p);
    }
  }
  return out;
}

const R = ({ x, y, w, h, f }: { x: number; y: number; w: number; h: number; f: string }) => <rect x={x} y={y} width={w} height={h} fill={f} />;

function Tree({ x, y, big }: { x: number; y: number; big: boolean }) {
  return big ? (
    <g>
      <R x={x + 2} y={y + 6} w={2} h={3} f={C.trunk} />
      <R x={x} y={y + 2} w={6} h={4} f={C.canopyDark} />
      <R x={x + 1} y={y} w={4} h={5} f={C.canopy} />
      <R x={x + 2} y={y + 1} w={1} h={1} f={C.grass} />
    </g>
  ) : (
    <g>
      <R x={x + 1} y={y + 4} w={1} h={2} f={C.trunk} />
      <R x={x} y={y + 1} w={3} h={3} f={C.canopyDark} />
      <R x={x + 1} y={y} w={1} h={1} f={C.canopy} />
    </g>
  );
}

/** One small building per checkpoint, drawn above its node. */
function Landmark({ id, x, y, lit }: { id: CheckpointId; x: number; y: number; lit: boolean }) {
  const top = y - 6;
  const window = lit ? C.gold : C.roofDark;
  switch (id) {
    case "profile": // cottage
      return (
        <g>
          <R x={x - 6} y={top - 7} w={12} h={7} f={C.wall} />
          <R x={x - 6} y={top - 2} w={12} h={2} f={C.wallShade} />
          <R x={x - 8} y={top - 9} w={16} h={2} f={C.roof} />
          <R x={x - 6} y={top - 11} w={12} h={2} f={C.roof} />
          <R x={x - 4} y={top - 13} w={8} h={2} f={C.roofDark} />
          <R x={x + 3} y={top - 15} w={2} h={4} f={C.stoneDark} />
          <R x={x - 1} y={top - 5} w={3} h={5} f={C.trunk} />
          <R x={x - 5} y={top - 6} w={2} h={2} f={window} />
          <R x={x + 3} y={top - 6} w={2} h={2} f={window} />
        </g>
      );
    case "ucs": // campus hall with dome
      return (
        <g>
          <R x={x - 10} y={top - 8} w={20} h={8} f={C.wall} />
          <R x={x - 11} y={top - 10} w={22} h={2} f={C.stone} />
          {[-8, -4, 2, 6].map((dx) => (
            <R key={dx} x={x + dx} y={top - 8} w={2} h={7} f={C.wallShade} />
          ))}
          <R x={x - 4} y={top - 13} w={8} h={3} f={C.gold} />
          <R x={x - 2} y={top - 15} w={4} h={2} f={C.gold} />
          <R x={x} y={top - 18} w={1} h={3} f={C.ink} />
          <R x={x + 1} y={top - 18} w={3} h={2} f={C.roof} />
          <R x={x - 1} y={top - 4} w={2} h={4} f={C.roofDark} />
        </g>
      );
    case "activities": // tents + signpost
      return (
        <g>
          <R x={x - 9} y={top - 2} w={8} h={2} f={C.canopyDark} />
          <R x={x - 8} y={top - 4} w={6} h={2} f={C.canopyDark} />
          <R x={x - 7} y={top - 6} w={4} h={2} f={C.canopy} />
          <R x={x - 6} y={top - 8} w={2} h={2} f={C.canopy} />
          <R x={x - 6} y={top - 3} w={2} h={3} f={C.ink} />
          <R x={x + 1} y={top - 3} w={8} h={3} f={C.roof} />
          <R x={x + 2} y={top - 5} w={6} h={2} f={C.roof} />
          <R x={x + 3} y={top - 7} w={4} h={2} f={C.roofDark} />
          <R x={x + 4} y={top - 2} w={2} h={2} f={C.ink} />
          <R x={x + 9} y={top - 10} w={1} h={10} f={C.trunk} />
          <R x={x + 7} y={top - 10} w={6} h={3} f={C.wall} />
          <R x={x + 8} y={top - 9} w={4} h={1} f={C.trunk} />
        </g>
      );
    case "essays": // library tower: one window per PIQ
      return (
        <g>
          <R x={x - 5} y={top - 18} w={10} h={18} f={C.stone} />
          <R x={x + 3} y={top - 18} w={2} h={18} f={C.stoneDark} />
          <R x={x - 6} y={top - 20} w={12} h={2} f={C.roof} />
          <R x={x - 4} y={top - 22} w={8} h={2} f={C.roof} />
          <R x={x - 2} y={top - 24} w={4} h={2} f={C.roofDark} />
          <R x={x - 3} y={top - 15} w={2} h={3} f={window} />
          <R x={x + 1} y={top - 15} w={2} h={3} f={window} />
          <R x={x - 3} y={top - 10} w={2} h={3} f={window} />
          <R x={x + 1} y={top - 10} w={2} h={3} f={window} />
          <R x={x - 1} y={top - 4} w={2} h={4} f={C.trunk} />
        </g>
      );
    case "review": // gatehouse
      return (
        <g>
          <R x={x - 11} y={top - 12} w={6} h={12} f={C.stone} />
          <R x={x + 5} y={top - 12} w={6} h={12} f={C.stone} />
          {[-11, -8, 5, 8].map((dx) => (
            <R key={dx} x={x + dx} y={top - 14} w={2} h={2} f={C.stone} />
          ))}
          <R x={x - 5} y={top - 9} w={10} h={9} f={C.stoneDark} />
          <R x={x - 3} y={top - 6} w={6} h={6} f={C.ink} />
          <R x={x - 5} y={top - 11} w={10} h={2} f={C.roof} />
          <R x={x - 9} y={top - 9} w={2} h={2} f={window} />
          <R x={x + 7} y={top - 9} w={2} h={2} f={window} />
          <R x={x} y={top - 20} w={1} h={9} f={C.ink} />
          <R x={x + 1} y={top - 20} w={4} h={3} f={C.gold} />
        </g>
      );
  }
}

function Finish({ x, y }: { x: number; y: number }) {
  // Checkered finish banner on two posts.
  const cells = [];
  for (let i = 0; i < 6; i++) for (let j = 0; j < 2; j++) cells.push(<R key={`${i}-${j}`} x={x - 6 + i * 2} y={y - 13 + j * 2} w={2} h={2} f={(i + j) % 2 ? C.ink : C.wall} />);
  return (
    <g>
      <R x={x - 7} y={y - 14} w={1} h={14} f={C.trunk} />
      <R x={x + 6} y={y - 14} w={1} h={14} f={C.trunk} />
      {cells}
      <text x={x} y={y - 15.5} textAnchor="middle" className="jm-pixel-text" fill={C.ink}>
        FINISH
      </text>
    </g>
  );
}

export const MapScene = memo(function MapScene({ layout, ids, lit }: { layout: Layout; ids: CheckpointId[]; lit: boolean[] }) {
  const { w, h, start, nodes, finish } = LAYOUTS[layout];
  const route = routePoints(layout);
  const trees = scatter(layout, route, 9, 6, 15, 1);
  const tufts = scatter(layout, route, 7, 4, 10, 7);
  const line = route.map((p) => p.join(",")).join(" ");
  // A slate-blue pond tucked away from the route.
  const pond = layout === "wide" ? { x: 116, y: 92, w: 22, h: 10 } : { x: 6, y: 66, w: 14, h: 20 };

  return (
    <svg className={`jm-scene jm-scene-${layout}`} viewBox={`0 0 ${w} ${h}`} shapeRendering="crispEdges" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <rect width={w} height={h} fill={C.grass} />
      {tufts.map(([x, y], i) => (
        <rect key={i} x={x} y={y} width={i % 3 ? 2 : 3} height={1} fill={i % 2 ? C.tuft : C.grassDark} />
      ))}
      {layout === "wide" && (
        <g>
          {/* distant hills along the top edge */}
          {[0, 26, 52, 90, 128, 160].map((x, i) => (
            <g key={x}>
              <R x={x} y={8} w={30} h={4} f={C.grassDark} />
              <R x={x + 5} y={5} w={20} h={3} f={C.grassDark} />
              <R x={x + 10 + (i % 2) * 2} y={3} w={8} h={2} f={C.tuft} />
            </g>
          ))}
        </g>
      )}
      <g>
        <R x={pond.x} y={pond.y} w={pond.w} h={pond.h} f={C.water} />
        <R x={pond.x - 2} y={pond.y + 2} w={pond.w + 4} h={pond.h - 4} f={C.water} />
        <R x={pond.x + 3} y={pond.y + 2} w={5} h={1} f={C.waterLight} />
        <R x={pond.x + pond.w - 9} y={pond.y + pond.h - 3} w={4} h={1} f={C.waterLight} />
      </g>
      <polyline points={line} fill="none" stroke={C.pathEdge} strokeWidth={7} strokeLinejoin="miter" strokeLinecap="square" />
      <polyline points={line} fill="none" stroke={C.path} strokeWidth={5} strokeLinejoin="miter" strokeLinecap="square" />
      {trees.map(([x, y], i) => (
        <Tree key={i} x={x} y={y} big={i % 3 !== 0} />
      ))}
      {/* start signpost */}
      <g>
        <R x={start[0] + 2} y={start[1] - 9} w={1} h={8} f={C.trunk} />
        <R x={start[0] - 1} y={start[1] - 11} w={9} h={4} f={C.wall} />
        <text x={start[0] + 3.5} y={start[1] - 8} textAnchor="middle" className="jm-pixel-text" fill={C.ink}>
          START
        </text>
      </g>
      {nodes.map(([x, y], i) => (
        <g key={ids[i]}>
          <Landmark id={ids[i]} x={x} y={y} lit={lit[i]} />
          <R x={x - 4} y={y - 2} w={8} h={4} f={C.stoneDark} />
          <R x={x - 3} y={y - 3} w={6} h={6} f={lit[i] ? C.gold : C.stone} />
        </g>
      ))}
      <Finish x={finish[0]} y={finish[1]} />
    </svg>
  );
});
