/**
 * Pixel-art office entrances for the Apply hub. All three share one building (same size,
 * outline, windows, door, and awning) so they read as a set; each office has its own colours,
 * sign emblem, and one small detail out front. Pure data, rendered as crisp SVG rects.
 */

export type Office = "counselor" | "application" | "aid";

/** The building is drawn on a 40-wide plot; the ground runs on past it to the art's edges. */
const PLOT_W = 40;
const MARGIN = 6;
export const ENTRANCE_W = PLOT_W + MARGIN * 2;
export const ENTRANCE_H = 30;

export interface PixelRun {
  x: number;
  y: number;
  w: number;
  fill: string;
}

const INK = "#232a3a";
const GLASS = "#cfe3da";
const GLASS_LIGHT = "#eef6f1";
const SIGN = "#fbf6e8";
const GROUND = "#e2d3ad";
const GROUND_EDGE = "#cdb98b";
const STEP = "#d9ccb0";

interface Palette {
  wall: string;
  wallShade: string;
  roof: string;
  roofShade: string;
  awning: string;
  door: string;
  emblem: string;
}

const PALETTES: Record<Office, Palette> = {
  counselor: { wall: "#f3e7cc", wallShade: "#e3d3b0", roof: "#2f6b4a", roofShade: "#24563b", awning: "#8fb48f", door: "#8a5a3c", emblem: "#5f8f6a" },
  application: { wall: "#f1e4c6", wallShade: "#e0cfa8", roof: "#c9a23f", roofShade: "#a8862f", awning: "#e3c46f", door: "#2f6b4a", emblem: "#2f6b4a" },
  aid: { wall: "#e6ecd9", wallShade: "#d3dcc2", roof: "#b9714f", roofShade: "#9a5b3e", awning: "#d99c7c", door: "#2f6b4a", emblem: "#d9b65e" },
};

/** Sign emblems: "#" ink, "o" emblem colour, "w" sign cream. */
const EMBLEMS: Record<Office, string[]> = {
  // A speech bubble.
  counselor: [" ####### ", "#ooooooo#", "#o#o#o#o#", "#ooooooo#", " #o##### ", " ##      "],
  // A page with lines of writing.
  application: ["#######", "#wwwww#", "#ooooo#", "#wwwww#", "#ooow##", "#######"],
  // A gold coin with a shine.
  aid: [" #### ", "#owwo#", "#owoo#", "#oooo#", "#oooo#", " #### "],
};

type Grid = (string | null)[][];

export function entrancePixels(office: Office): PixelRun[] {
  const p = PALETTES[office];
  const g: Grid = Array.from({ length: ENTRANCE_H }, () => Array<string | null>(PLOT_W).fill(null));
  const rect = (x: number, y: number, w: number, h: number, fill: string) => {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (g[j]?.[i] !== undefined) g[j][i] = fill;
  };
  /** A filled box with a one-pixel ink outline. */
  const box = (x: number, y: number, w: number, h: number, fill: string) => {
    rect(x, y, w, h, INK);
    rect(x + 1, y + 1, w - 2, h - 2, fill);
  };
  const sprite = (rows: string[], x: number, y: number, colours: Record<string, string>) =>
    rows.forEach((row, j) => [...row].forEach((ch, i) => colours[ch] && (g[y + j][x + i] = colours[ch])));

  // Ground and path.
  rect(0, 27, ENTRANCE_W, 3, GROUND);
  rect(0, 27, ENTRANCE_W, 1, GROUND_EDGE);

  // Walls, with a shaded band along the base.
  box(4, 9, 32, 19, p.wall);
  rect(5, 24, 30, 3, p.wallShade);

  // Roof: a deep cornice overhanging the walls.
  box(2, 4, 36, 6, p.roof);
  rect(3, 8, 34, 1, p.roofShade);

  // Sign board on the cornice, with the office's emblem.
  box(13, 2, 14, 9, SIGN);
  const emblem = EMBLEMS[office];
  sprite(emblem, 20 - Math.ceil(emblem[0].length / 2), 3 + Math.floor((7 - emblem.length) / 2), { "#": INK, o: p.emblem, w: SIGN });

  // Two windows with mullions and a glint.
  for (const x of [7, 27]) {
    box(x, 13, 6, 7, GLASS);
    rect(x + 1, 16, 4, 1, INK);
    rect(x + 3, 14, 1, 5, INK);
    rect(x + 1, 14, 1, 1, GLASS_LIGHT);
  }

  // Door under a striped awning, on a step.
  box(16, 17, 8, 11, p.door);
  rect(17, 18, 6, 3, GLASS);
  rect(20, 18, 1, 3, INK);
  rect(22, 23, 1, 1, SIGN);
  box(14, 14, 12, 3, p.awning);
  for (let x = 15; x < 25; x += 2) rect(x, 15, 1, 1, SIGN);
  rect(15, 27, 10, 1, STEP);

  // One detail out front per office.
  if (office === "counselor") {
    // Potted plants either side of the door.
    for (const x of [12, 26]) {
      sprite(["o.o", "ooo", ".o.", "###", "#c#", "###"], x, 21, { o: "#4f8a5b", "#": INK, c: "#b8643a" });
    }
  } else if (office === "application") {
    // A mailbox by the path.
    sprite(["####", "#oo#", "#ow#", "####", ".#..", ".#..", ".#.."], 34, 21, { "#": INK, o: p.emblem, w: SIGN });
  } else {
    // Columns framing the door.
    for (const x of [13, 25]) {
      rect(x, 17, 2, 10, INK);
      rect(x, 17, 1, 10, "#f6f1e4");
    }
  }

  // Widen the plot: empty sky either side, with the ground carried to the edges.
  const pad = (row: (string | null)[], y: number) => {
    const edge = y >= 27 ? (y === 27 ? GROUND_EDGE : GROUND) : null;
    const side = Array<string | null>(MARGIN).fill(edge);
    return [...side, ...row, ...side];
  };
  return runs(g.map(pad));
}

function runs(g: Grid): PixelRun[] {
  const out: PixelRun[] = [];
  g.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const fill = row[x];
      if (!fill) {
        x++;
        continue;
      }
      let w = 1;
      while (x + w < row.length && row[x + w] === fill) w++;
      out.push({ x, y, w, fill });
      x += w;
    }
  });
  return out;
}
