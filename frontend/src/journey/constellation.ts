/**
 * Geometry for the UC Journey Map: five small planet-like stops joined by a gently flowing
 * trail. Coordinates are in a fixed design space that the map scales to fit its box.
 */

export type Layout = "wide" | "tall";

export interface Constellation {
  w: number;
  h: number;
  /** Stop centres, in journey order (profile → review). */
  stops: { x: number; y: number }[];
}

export const CONSTELLATIONS: Record<Layout, Constellation> = {
  // A loose rising arc: the stops drift up and to the right with uneven spacing.
  wide: {
    w: 320,
    h: 168,
    stops: [
      { x: 44, y: 120 },
      { x: 104, y: 78 },
      { x: 166, y: 108 },
      { x: 226, y: 56 },
      { x: 282, y: 84 },
    ],
  },
  // Narrow boxes: the same idea running top to bottom.
  tall: {
    w: 180,
    h: 320,
    stops: [
      { x: 58, y: 44 },
      { x: 120, y: 98 },
      { x: 66, y: 160 },
      { x: 124, y: 216 },
      { x: 78, y: 276 },
    ],
  },
};

type Pt = { x: number; y: number };

/**
 * One smooth curve per leg (stop i → stop i + 1), from a Catmull-Rom spline through all
 * stops, so legs can be lit one at a time while the whole trail still reads as one curve.
 */
export function trailLegs({ stops }: Constellation): string[] {
  const at = (i: number) => stops[Math.max(0, Math.min(stops.length - 1, i))];
  const legs: string[] = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    // Tension 0.5 Catmull-Rom → cubic Bézier control points.
    const c1: Pt = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2: Pt = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    legs.push(`M${r(p1.x)} ${r(p1.y)} C${r(c1.x)} ${r(c1.y)} ${r(c2.x)} ${r(c2.y)} ${r(p2.x)} ${r(p2.y)}`);
  }
  return legs;
}

const r = (n: number) => Math.round(n * 10) / 10;

/**
 * Which arrangement suits a box, and how much to scale it. `height` 0 means "fit the width
 * only" (the full-page map scrolls); Story mode passes its pane's height too.
 */
export function fitConstellation(width: number, height: number): { layout: Layout; scale: number } {
  const layout: Layout = width > 0 && width < 380 && (height === 0 || height > width) ? "tall" : "wide";
  const { w, h } = CONSTELLATIONS[layout];
  if (width <= 0) return { layout, scale: 1 };
  const byWidth = width / w;
  // Never blow the design up past 1.6× (planets stay small) or below a legible 0.5×.
  const scale = height > 0 ? Math.min(byWidth, height / h) : byWidth;
  return { layout, scale: Math.max(0.5, Math.min(1.6, scale)) };
}
