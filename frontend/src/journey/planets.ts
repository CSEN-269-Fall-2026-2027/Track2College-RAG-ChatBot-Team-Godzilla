/**
 * Pixel-art campus buildings for the UC Journey Map, one per chapter. Each is hand-drawn on the
 * same 24 × 24 grid with one palette, a one-pixel ink outline, light from the top left (shade on
 * the right-hand face), and the same foundation and lawn, so the six read as one set. Pure data,
 * rendered by JourneyMap.
 */

import type { CheckpointId } from "./logic";

export const GRID = 24;

/** One run of same-coloured pixels on a row (merged so each building is a few dozen rects). */
export interface PixelRun {
  x: number;
  y: number;
  w: number;
  fill: string;
}

/** Sprite key → colour. "." is empty. Warm cream walls, muted greens, a little gold and brick. */
const PALETTE: Record<string, string> = {
  k: "#232a3a", // ink outline
  W: "#f6edd5", // wall
  w: "#e2d3ad", // wall shade
  S: "#ece0c2", // stone
  s: "#d3c296", // stone shade
  P: "#c3ad7e", // porch
  G: "#6a9470", // roof
  g: "#4f7757", // roof shade
  L: "#8db38f", // roof light
  B: "#cfe3da", // glass
  b: "#a9c8bd", // glass shade
  H: "#f4faf6", // glass glint
  D: "#8a5a3a", // door
  d: "#6e4630", // door shade
  Y: "#d4a840", // gold
  y: "#b08a2e", // gold shade
  R: "#c07d5d", // brick
  r: "#a2654a", // brick shade
  F: "#2f6b4a", // flag
  T: "#a9c29a", // lawn
  t: "#93ad85", // lawn shade
};

const SPRITES: Record<CheckpointId, string[]> = {
  // Basic info · Student Center: flat roof with an overhang, rooftop sign, glass storefront.
  profile: [
    "........................",
    "........................",
    "........................",
    "........kkkkkkkk........",
    "........kYYYYYYk........",
    "........kyyyyyyk........",
    "..kkkkkkkkkkkkkkkkkkkk..",
    "..kLLLLLLLLLLLLLLLLLLk..",
    "..kGGGGGGGGGGGGGGGGggk..",
    "..kkkkkkkkkkkkkkkkkkkk..",
    "...kWWWWWWWWWWWWWwwwk...",
    "...kWkkkkWWWWWWkkkkwk...",
    "...kWkHBkWWWWWWkHBkwk...",
    "...kWkBbkGWGWGWkBbkwk...",
    "...kWkkkkggggggkkkkwk...",
    "...kWWWWWkkkkkkWWWWwk...",
    "...kkkkkWkBbBbkWkkkkk...",
    "...kkHBkWkBbBbkWkHBkk...",
    "...kkBbkWkBbBbkWkBbkk...",
    "...kkkkkWkBbBbkWkkkkk...",
    "...kSSSSSkBbBbkSSSSsk...",
    "...kssssskSSSSksssssk...",
    "..kkkkkkkkkkkkkkkkkkkk..",
    "..TTTTTTTTTTTTTTTTTTtt..",
  ],
  // Choose UCs · College Center: green pediment, gold entablature, columns, broad steps.
  ucs: [
    "........................",
    "........................",
    "...........kk...........",
    "..........kLGk..........",
    ".........kLLGgk.........",
    "........kLLYYggk........",
    ".......kLLGGGGggk.......",
    "......kLLGGGGGGggk......",
    ".....kLLGGGGGGGGggk.....",
    "....kLLGGGGGGGGGGggk....",
    "..kkkkkkkkkkkkkkkkkkkk..",
    "..kYYYYYYYYYYYYYYYYyyk..",
    "..kkkkkkkkkkkkkkkkkkkk..",
    "...kSSSSSSSSSSSSSSSSk...",
    "...kWwPWwPkkkkPWwPWwk...",
    "...kWwPWwPkDdkPWwPWwk...",
    "...kWwPWwPkDdkPWwPWwk...",
    "...kWwPWwPkDdkPWwPWwk...",
    "...kWwPWwPkDdkPWwPWwk...",
    "...kWwPWwPkDdkPWwPWwk...",
    "..kSSSSSSSSSSSSSSSSssk..",
    "..kssssssssssssssssssk..",
    "..kkkkkkkkkkkkkkkkkkkk..",
    "..TTTTTTTTTTTTTTTTTTtt..",
  ],
  // Activities list · Activities Hall: ribbed barrel roof, brick walls, pennant, double doors.
  activities: [
    "........................",
    "........................",
    "........................",
    ".......kkkkkkkkkk.......",
    ".....kkLLLGGGGGGgkk.....",
    "....kLLLGGGGGGGGGGgk....",
    "...kLLGGGGGGGGGGGGggk...",
    "...kLGGGGGGGGGGGGGggk...",
    "..kLGGGgGGGGGGGgGGGggk..",
    "..kGGGGgGGGGGGGgGGGggk..",
    "..kkkkkkkkkkkkkkkkkkkk..",
    "...kWWWWWWWWWWWWWWwwk...",
    "...kRRRRRRRRRRRRRRrrk...",
    "...kRkkkkRkkkkRkkkkrk...",
    "...kRkHBkRkYYkRkHBkrk...",
    "...kRkBbkRkYWkRkBbkrk...",
    "...kRkkkkRkkkkRkkkkrk...",
    "...kRRRRRRRRRRRRRRrrk...",
    "...kRRRkkkkkkkkkkRrrk...",
    "...kRRRkDDDdDDDdkRrrk...",
    "...kRRRkDDDdDDDdkRrrk...",
    "...kRRRkDDDdDDDdkRrrk...",
    "..kkkkkkkkkkkkkkkkkkkk..",
    "..TTTTTTTTTTTTTTTTTTtt..",
  ],
  // Four essays · Library: dome on a drum with a gold finial, arched windows, book-spine sign.
  essays: [
    "........................",
    "...........YY...........",
    "...........kk...........",
    ".........kkkkkk.........",
    "........kLLGGGgk........",
    ".......kLLGGGGGgk.......",
    "......kLGGGGGGGggk......",
    "......kGGGGGGGGggk......",
    ".....kkkkkkkkkkkkkk.....",
    ".....kSSSSSSSSSSssk.....",
    "..kkkkkkkkkkkkkkkkkkkk..",
    "..kSSSSSSSSSSSSSSSSssk..",
    "..kkkkkkkkkkkkkkkkkkkk..",
    "...kWWkkWkkkkkkWkkWwk...",
    "...kWkHBkkYGRLkkHBkwk...",
    "...kWkBbkkkkkkkkBbkwk...",
    "...kWkBbkWkkkkWkBbkwk...",
    "...kWkBbkWkDdkWkBbkwk...",
    "...kWkkkkWkDdkWkkkkwk...",
    "...kWWWWWWkDdkWWWWwwk...",
    "...kSSSSSSkDdkSSSSssk...",
    "...kSSSSSSkDdkSSSSssk...",
    "..kkkkkkkkkkkkkkkkkkkk..",
    "..TTTTTTTTTTTTTTTTTTtt..",
  ],
  // Review & apply · Admissions Office: clock tower with spire and flag over a long hall.
  review: [
    "........................",
    "........................",
    "...........kFFF.........",
    "...........kFF..........",
    "...........kk...........",
    "..........kLgk..........",
    ".........kLLggk.........",
    "........kLLGGggk........",
    ".......kkkkkkkkkk.......",
    "........kSSSSSsk........",
    "........kSWkWSsk........",
    "........kSWkkSsk........",
    "........kSWWWSsk........",
    "..kkkkkkkkkkkkkkkkkkkk..",
    "..kLLLLLLLLLLLLLLLLggk..",
    "..kkkkkkkkkkkkkkkkkkkk..",
    "...kWkkkkWkkkkWkkkkwk...",
    "...kWkHBkWkYYkWkHBkwk...",
    "...kWkBbkWkDdkWkBbkwk...",
    "...kWkkkkWkDdkWkkkkwk...",
    "...kWWWWWWkDdkWWWWwwk...",
    "...kSSSSSSkDdkSSSSssk...",
    "..kkkkkkkkkkkkkkkkkkkk..",
    "..TTTTTTTTTTTTTTTTTTtt..",
  ],
  // Financial aid · Financial Aid Office: brick hip roof with chimney, green trim, dollar-bill sign.
  aid: [
    "........................",
    "........................",
    "........................",
    "...............kkkk.....",
    "...............kRrk.....",
    ".....kkkkkkkkkkkkkk.....",
    "....kRRRRRRRRRRRRrrk....",
    "...kRRRRRRRRRRRRRRrrk...",
    "..kRRRRRRRRRRRRRRRRrrk..",
    "..kkkkkkkkkkkkkkkkkkkk..",
    "...kGGGGGGGGGGGGGGggk...",
    "...kkkkkkkkkkkkkkkkkk...",
    "...kWWkkkkkkkkkkkkwwk...",
    "...kWWkLGLLYYLLGLkwwk...",
    "...kWWkkkkkkkkkkkkwwk...",
    "...kWWWWWWWWWWWWWWwwk...",
    "...kWkkkkWkkkkWkkkkwk...",
    "...kWkHBkWkDDkWkHBkwk...",
    "...kWkBbkWkDdkWkBbkwk...",
    "...kWkkkkWkDdkWkkkkwk...",
    "...kWWWWWWkDdkWWWWwwk...",
    "...kSSSSSSkDdkSSSSssk...",
    "..kkkkkkkkkkkkkkkkkkkk..",
    "..TTTTTTTTTTTTTTTTTTtt..",
  ],
};

/** Building names, for anything that wants to describe the art. */
export const BUILDING_NAME: Record<CheckpointId, string> = {
  profile: "Student Center",
  ucs: "College Center",
  activities: "Activities Hall",
  essays: "Library",
  review: "Admissions Office",
  aid: "Financial Aid Office",
};

type Cell = string | null;
type Grid = Cell[][];

/** The building's pixels, row by row, merged into horizontal runs. (Name kept for the map.) */
export function planetPixels(id: CheckpointId): PixelRun[] {
  const grid: Grid = SPRITES[id].map((row) => [...row].map((ch) => (ch === "." ? null : PALETTE[ch])));
  return runs(grid);
}

function runs(grid: Grid): PixelRun[] {
  const out: PixelRun[] = [];
  grid.forEach((row, y) => {
    let x = 0;
    while (x < GRID) {
      const fill = row[x];
      if (!fill) {
        x++;
        continue;
      }
      let w = 1;
      while (x + w < GRID && row[x + w] === fill) w++;
      out.push({ x, y, w, fill });
      x += w;
    }
  });
  return out;
}

type Pt = { x: number; y: number };

/**
 * One smooth path per leg (point i → i + 1) from a Catmull-Rom spline through all points, so
 * legs can be lit one at a time while the route still reads as a single line.
 */
export function routeLegs(points: Pt[]): string[] {
  const at = (i: number) => points[Math.max(0, Math.min(points.length - 1, i))];
  const r = (n: number) => Math.round(n * 10) / 10;
  const legs: string[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    legs.push(`M${r(p1.x)} ${r(p1.y)} C${r(c1.x)} ${r(c1.y)} ${r(c2.x)} ${r(c2.y)} ${r(p2.x)} ${r(p2.y)}`);
  }
  return legs;
}

/** Wide row when there's room for five labelled planets side by side; otherwise a list. */
export function mapLayout(width: number): "wide" | "tall" {
  return width >= 400 ? "wide" : "tall";
}
