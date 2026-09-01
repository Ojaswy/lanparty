/**
 * All pixel art lives here as arrays of strings (one char per pixel) and is
 * rasterized once into offscreen canvases. Geometric iso pieces (floor
 * diamond, walls, table slabs) are generated into the same string-map format
 * by a tiny char-grid painter so everything goes through one rasterizer.
 */

export type PixelMap = string[];

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/* ---------- palette ---------- */

export const PALETTE: Record<string, string> = {
  k: "#111111", // ink
  K: "#2a2a2a",
  w: "#ffffff",
  l: "#c0c0c0",
  d: "#808080",
  D: "#404040",
  b: "#d9d2c0", // crt beige
  B: "#a39e8e", // crt dark
  c: "#ede8da", // crt highlight
  g: "#0b0f0a", // screen
  G: "#33ff66", // phosphor
  r: "#ff3b3b",
  R: "#a01818",
  y: "#ffd54f",
  Y: "#e0b030",
  o: "#ff8c1a",
  n: "#000080",
  t: "#008080",
  e: "#00ff55", // led green
  x: "#6b4a2b", // cardboard dark
  X: "#a07a4a", // cardboard
  z: "#2f2f2f", // chair dark
  Z: "#4f4f4f", // chair mid
  m: "#6f6f6f", // chair light
  q: "#2f6fd6", // soda blue
  Q: "#e6e6e6", // soda silver
  u: "#4a4a4a", // router body
  U: "#6a6a6a", // router top
  j: "#ececec", // table top
  J: "#b9b9b9", // table edge
  i: "#8f8f8f", // table front
  f: "#e8d9b5", // floor a
  F: "#d8c9a5", // floor b
  h: "#c9b993", // floor grout
  v: "#7aa6c2", // wall
  V: "#5f8aa8", // wall dark
  W: "#9bc0d8", // wall light
  // kid variant channels (overridden per sprite variant)
  H: "#d63030",
  I: "#9c1f1f",
  A: "#3b2a1a",
  S: "#f2c9a0",
  P: "#2b3a8f",
};

/** 8 hoodie/hair/skin/pants variants keyed by seat.sprite. */
export const KID_VARIANTS: Array<Record<string, string>> = [
  { H: "#d63030", I: "#9c1f1f", A: "#3b2a1a", S: "#f2c9a0", P: "#2b3a8f" },
  { H: "#2f6fd6", I: "#1f4a9c", A: "#111111", S: "#c68642", P: "#333333" },
  { H: "#3aa655", I: "#24733a", A: "#e8c05a", S: "#f2c9a0", P: "#2b3a8f" },
  { H: "#8a3fc4", I: "#5c2a85", A: "#b4472a", S: "#f7d9c4", P: "#222222" },
  { H: "#ff8c1a", I: "#c26410", A: "#111111", S: "#8d5524", P: "#2b3a8f" },
  { H: "#1f9c9c", I: "#146a6a", A: "#5a3b1e", S: "#f2c9a0", P: "#444444" },
  { H: "#2a2a2a", I: "#0f0f0f", A: "#d9d9d9", S: "#f2c9a0", P: "#2b3a8f" },
  { H: "#f2d23a", I: "#bfa22a", A: "#3b2a1a", S: "#c68642", P: "#2b3a8f" },
];

/* ---------- kid (back view, 12x18) ---------- */

export type KidPose = "sit" | "typeA" | "typeB" | "cheer" | "slump" | "stand";

export const KID_SIT: PixelMap = [
  "....AAAA....",
  "...AAAAAA...",
  "...AAAAAA...",
  "...SAAAAS...",
  "....SSSS....",
  "...HHHHHH...",
  "..HHHHHHHH..",
  ".HHHHIIHHHH.",
  ".HHHIIIIHHH.",
  ".HHHHIIHHHH.",
  ".HHHHHHHHHH.",
  ".SSHHHHHHSS.",
  "..HHHHHHHH..",
  "...PPPPPP...",
  "...PPPPPP...",
  "...PP..PP...",
  "...PP..PP...",
  "...kk..kk...",
];

export const KID_TYPE_A: PixelMap = [
  "....AAAA....",
  "...AAAAAA...",
  "...AAAAAA...",
  "...SAAAAS...",
  "....SSSS....",
  "...HHHHHH...",
  "..HHHHHHHH..",
  ".HHHHIIHHHH.",
  ".HHHIIIIHHH.",
  ".HHHHIIHHHH.",
  "SSHHHHHHHHH.",
  "..HHHHHHHSS.",
  "..HHHHHHHH..",
  "...PPPPPP...",
  "...PPPPPP...",
  "...PP..PP...",
  "...PP..PP...",
  "...kk..kk...",
];

export const KID_TYPE_B: PixelMap = [
  "....AAAA....",
  "...AAAAAA...",
  "...AAAAAA...",
  "...SAAAAS...",
  "....SSSS....",
  "...HHHHHH...",
  "..HHHHHHHH..",
  ".HHHHIIHHHH.",
  ".HHHIIIIHHH.",
  ".HHHHIIHHHH.",
  ".HHHHHHHHHSS",
  ".SSHHHHHHH..",
  "..HHHHHHHH..",
  "...PPPPPP...",
  "...PPPPPP...",
  "...PP..PP...",
  "...PP..PP...",
  "...kk..kk...",
];

export const KID_CHEER: PixelMap = [
  ".S........S.",
  ".H..AAAA..H.",
  ".H.AAAAAA.H.",
  ".H.AAAAAA.H.",
  ".H.SAAAAS.H.",
  ".HH.SSSS.HH.",
  ".HHHHHHHHHH.",
  "..HHHHHHHH..",
  "..HHHIIHHH..",
  "..HHIIIIHH..",
  "..HHHIIHHH..",
  "..HHHHHHHH..",
  "..HHHHHHHH..",
  "...PPPPPP...",
  "...PPPPPP...",
  "...PP..PP...",
  "...PP..PP...",
  "...kk..kk...",
];

export const KID_SLUMP: PixelMap = [
  "............",
  "............",
  "............",
  "............",
  "............",
  "....AAAA....",
  "SS.AAAAAA.SS",
  "HHHAAAAAAHHH",
  "HHHHAAAAHHHH",
  ".HHHHIIHHHH.",
  ".HHHHHHHHHH.",
  "..HHHHHHHH..",
  "..HHHHHHHH..",
  "...PPPPPP...",
  "...PPPPPP...",
  "...PP..PP...",
  "...PP..PP...",
  "...kk..kk...",
];

export const KID_STAND: PixelMap = [
  "....AAAA....",
  "...AAAAAA...",
  "...AAAAAA...",
  "...SAAAAS...",
  "....SSSS....",
  "...HHHHHH...",
  "..HHHHHHHH..",
  ".HHHHIIHHHH.",
  ".HHHIIIIHHH.",
  ".HHHHIIHHHH.",
  ".HHHHHHHHHH.",
  ".HHHHHHHHHH.",
  ".SSHHHHHHSS.",
  "...PPPPPP...",
  "...PPPPPP...",
  "...PP..PP...",
  "...PP..PP...",
  "...kk..kk...",
];

/** Headset overlay for desktop seats (drawn over the head). */
export const HEADSET: PixelMap = [
  "...kkkkkk...",
  "..k......k..",
  "..k......k..",
  ".kk......kk.",
  ".kk......kk.",
];

/** Vertical offset of the head per pose (for the headset overlay). */
export const HEAD_DY: Record<KidPose, number> = { sit: 0, typeA: 0, typeB: 0, stand: 0, cheer: 1, slump: 5 };

/* ---------- chair (back view, 14x20) ---------- */

export const CHAIR: PixelMap = [
  "...kkkkkkkk...",
  "..kZZZZZZZZk..",
  "..kZmmmmmmZk..",
  "..kZZZZZZZZk..",
  "..kzzzzzzzzk..",
  "...kkkkkkkk...",
  "......kk......",
  "......kk......",
  "......kk......",
  "......kk......",
  "......kk......",
  "......kk......",
  "......kk......",
  "......kk......",
  "..kkkkkkkkkk..",
  ".kzzzzkkzzzzk.",
  "kzz..kzzk..zzk",
  "kk...kkkk...kk",
  "kk..........kk",
  "..............",
];

/* ---------- CRT monitor (front + right side), built from row patterns ---------- */

export interface CrtSprite {
  map: PixelMap;
  /** Screen rectangle in sprite coordinates. */
  screen: Rect;
  led: { x: number; y: number };
  w: number;
  h: number;
}

export function makeCrt(sw: number, sh: number): CrtSprite {
  // front face width = sw + 6 (k b k [screen] k b k), side = 4 (BBBk)
  const front = sw + 6;
  const rows: string[] = [];
  const side = "BBBk";
  rows.push("k".repeat(front) + "....");
  rows.push("k" + "c".repeat(front - 2) + "k" + "k...");
  rows.push("kc" + "b".repeat(front - 4) + "ck" + "BBk.");
  rows.push("kb" + "k".repeat(front - 4) + "bk" + side);
  for (let i = 0; i < sh; i++) rows.push("kbk" + "g".repeat(sw) + "kbk" + side);
  rows.push("kb" + "k".repeat(front - 4) + "bk" + side);
  rows.push("kb" + "b".repeat(front - 4) + "bk" + side);
  rows.push("kb" + "b".repeat(front - 7) + "e" + "bb" + "bk" + side);
  rows.push("k" + "B".repeat(front - 2) + "k" + side);
  rows.push("k".repeat(front) + "Bk..");
  const neckW = front - 10;
  const neckPad = 5;
  rows.push(".".repeat(neckPad) + "k" + "B".repeat(neckW - 2) + "k" + ".".repeat(front + 4 - neckPad - neckW));
  const baseW = front - 6;
  const basePad = 3;
  rows.push(".".repeat(basePad + 1) + "k" + "b".repeat(baseW - 4) + "k" + ".".repeat(front + 4 - basePad - 1 - (baseW - 2)));
  rows.push(".".repeat(basePad) + "k" + "b".repeat(baseW - 2) + "k" + ".".repeat(front + 4 - basePad - baseW));
  rows.push(".".repeat(basePad) + "k" + "B".repeat(baseW - 2) + "k" + ".".repeat(front + 4 - basePad - baseW));
  rows.push(".".repeat(basePad + 1) + "k".repeat(baseW - 2) + ".".repeat(front + 4 - basePad - 1 - (baseW - 2)));
  return {
    map: rows,
    screen: { x: 3, y: 4, w: sw, h: sh },
    led: { x: front - 5, y: 4 + sh + 2 },
    w: front + 4,
    h: rows.length,
  };
}

export const CRT = makeCrt(22, 14);
export const CRT_BIG = makeCrt(28, 18);

/* ---------- props ---------- */

export const PIZZA: PixelMap = [
  ".....kkkkkkkkkkkk.",
  "....kXXXXXXXXXXXXk",
  "....kXxxxxxxxxxxXk",
  "....kXxxxxxxxxxxXk",
  "....kXxxxxxxxxxxXk",
  "....kXXXXXXXXXXXXk",
  "...kkkkkkkkkkkkkkk",
  "..kyyyyyyyyyyyyyyk",
  ".kyyryyyryyyryyyyk",
  "kyyyyyryyyyyyryyyk",
  "kXXXXXXXXXXXXXXXXk",
  "kkkkkkkkkkkkkkkkk.",
];

export const SODA: PixelMap = [
  ".kkkk.",
  "kQQQQk",
  "kqqqqk",
  "kqQqqk",
  "kqqqqk",
  "kqqqqk",
  "kqQqqk",
  "kqqqqk",
  "kQQQQk",
  ".kkkk.",
];

export const ROUTER: PixelMap = [
  "......k.......k.......",
  "......k.......k.......",
  "......k.......k.......",
  "....kkkkkkkkkkkkkkkk..",
  "...kUUUUUUUUUUUUUUUUk.",
  "..kUUUUUUUUUUUUUUUUUUk",
  ".kuuuuuuuuuuuuuuuuuuuk",
  "kuuuuuuuuuuuuuuuuuuuuk",
  "kuu.u.u.u.uuuuuuuuuuuk",
  "kuuuuuuuuuuuuuuuuuuuuk",
  "kkkkkkkkkkkkkkkkkkkkk.",
];

/** LED slots on the router, sprite coordinates. */
export const ROUTER_LEDS = [
  { x: 3, y: 8 },
  { x: 5, y: 8 },
  { x: 7, y: 8 },
  { x: 9, y: 8 },
];

export const TOWER: PixelMap = [
  ".kkkkkkkkkk.",
  "kllllllllllk",
  "klddddddddlk",
  "kllllllllllk",
  "klddddddddlk",
  "kllllllllllk",
  "klllllelllkk",
  "kllllllllllk",
  "kllllllllllk",
  "kllllllllllk",
  "kllllllllllk",
  "kllllllllllk",
  "kllllllllllk",
  "kllllllllllk",
  "kddddddddddk",
  ".kkkkkkkkkk.",
];

/* ---------- 3x5 pixel font (BIOS text, seat numbers) ---------- */

const FONT3: Record<string, string[]> = {
  A: [".#.", "#.#", "###", "#.#", "#.#"],
  B: ["##.", "#.#", "##.", "#.#", "##."],
  C: [".##", "#..", "#..", "#..", ".##"],
  D: ["##.", "#.#", "#.#", "#.#", "##."],
  E: ["###", "#..", "##.", "#..", "###"],
  F: ["###", "#..", "##.", "#..", "#.."],
  G: [".##", "#..", "#.#", "#.#", ".##"],
  H: ["#.#", "#.#", "###", "#.#", "#.#"],
  I: ["###", ".#.", ".#.", ".#.", "###"],
  J: ["..#", "..#", "..#", "#.#", ".#."],
  K: ["#.#", "#.#", "##.", "#.#", "#.#"],
  L: ["#..", "#..", "#..", "#..", "###"],
  M: ["#.#", "###", "###", "#.#", "#.#"],
  N: ["##.", "#.#", "#.#", "#.#", "#.#"],
  O: [".#.", "#.#", "#.#", "#.#", ".#."],
  P: ["##.", "#.#", "##.", "#..", "#.."],
  Q: [".#.", "#.#", "#.#", "##.", ".##"],
  R: ["##.", "#.#", "##.", "#.#", "#.#"],
  S: [".##", "#..", ".#.", "..#", "##."],
  T: ["###", ".#.", ".#.", ".#.", ".#."],
  U: ["#.#", "#.#", "#.#", "#.#", "###"],
  V: ["#.#", "#.#", "#.#", "#.#", ".#."],
  W: ["#.#", "#.#", "###", "###", "#.#"],
  X: ["#.#", "#.#", ".#.", "#.#", "#.#"],
  Y: ["#.#", "#.#", ".#.", ".#.", ".#."],
  Z: ["###", "..#", ".#.", "#..", "###"],
  "0": ["###", "#.#", "#.#", "#.#", "###"],
  "1": [".#.", "##.", ".#.", ".#.", "###"],
  "2": ["##.", "..#", ".#.", "#..", "###"],
  "3": ["##.", "..#", ".#.", "..#", "##."],
  "4": ["#.#", "#.#", "###", "..#", "..#"],
  "5": ["###", "#..", "##.", "..#", "##."],
  "6": [".##", "#..", "###", "#.#", "###"],
  "7": ["###", "..#", ".#.", ".#.", ".#."],
  "8": ["###", "#.#", "###", "#.#", "###"],
  "9": ["###", "#.#", "###", "..#", "##."],
  ".": ["...", "...", "...", "...", ".#."],
  ":": ["...", ".#.", "...", ".#.", "..."],
  "-": ["...", "...", "###", "...", "..."],
  _: ["...", "...", "...", "...", "###"],
  "/": ["..#", "..#", ".#.", "#..", "#.."],
  "!": [".#.", ".#.", ".#.", "...", ".#."],
  "?": ["##.", "..#", ".#.", "...", ".#."],
  ">": ["#..", ".#.", "..#", ".#.", "#.."],
  "<": ["..#", ".#.", "#..", ".#.", "..#"],
  "#": ["#.#", "###", "#.#", "###", "#.#"],
  "*": ["#.#", ".#.", "###", ".#.", "#.#"],
  "(": [".#.", "#..", "#..", "#..", ".#."],
  ")": [".#.", "..#", "..#", "..#", ".#."],
  ",": ["...", "...", "...", ".#.", "#.."],
  "=": ["...", "###", "...", "###", "..."],
  "%": ["#.#", "..#", ".#.", "#..", "#.#"],
  " ": ["...", "...", "...", "...", "..."],
};

/** Draw text with the 3x5 font at art coordinates (x, y), scale S, device offset (ox, oy). */
export function drawTiny(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  S: number,
  color: string,
  ox = 0,
  oy = 0,
): number {
  ctx.fillStyle = color;
  let cx = x;
  for (const ch of text.toUpperCase()) {
    const g = FONT3[ch] ?? FONT3["?"];
    for (let r = 0; r < 5; r++) {
      const row = g[r];
      for (let c = 0; c < 3; c++) {
        if (row[c] === "#") ctx.fillRect(ox + (cx + c) * S, oy + (y + r) * S, S, S);
      }
    }
    cx += 4;
  }
  return cx - x;
}

export function tinyWidth(text: string): number {
  return text.length * 4 - 1;
}

/* ---------- char-grid painter for generated iso geometry ---------- */

export class Grid {
  rows: string[][];
  constructor(
    public w: number,
    public h: number,
  ) {
    this.rows = Array.from({ length: h }, () => Array.from({ length: w }, () => "."));
  }
  set(x: number, y: number, ch: string): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.rows[y][x] = ch;
  }
  line(x0: number, y0: number, x1: number, y1: number, ch: string): void {
    let dx = Math.abs(x1 - x0);
    let dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, ch);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
    void dx;
    void dy;
    dx = 0;
    dy = 0;
  }
  /** Fill polygon: a pixel is set when its centre is inside. */
  fillPoly(pts: Array<[number, number]>, ch: string): void {
    const n = pts.length;
    for (let y = 0; y < this.h; y++) {
      const cy = y + 0.5;
      const xs: number[] = [];
      for (let i = 0; i < n; i++) {
        const [x0, y0] = pts[i];
        const [x1, y1] = pts[(i + 1) % n];
        if (y0 === y1) continue;
        if (cy < Math.min(y0, y1) || cy >= Math.max(y0, y1)) continue;
        xs.push(x0 + ((cy - y0) * (x1 - x0)) / (y1 - y0));
      }
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const a = Math.ceil(xs[i] - 0.5);
        const b = Math.floor(xs[i + 1] - 0.5);
        for (let x = a; x <= b; x++) this.set(x, y, ch);
      }
    }
  }
  rect(x: number, y: number, w: number, h: number, ch: string): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, ch);
  }
  toMap(): PixelMap {
    return this.rows.map((r) => r.join(""));
  }
}

/** Floor diamond TWxTH (40x20), parity picks the colour; bottom-right edges get grout. */
export function makeFloorTile(parity: 0 | 1): PixelMap {
  const g = new Grid(40, 20);
  const ch = parity ? "F" : "f";
  for (let r = 0; r < 20; r++) {
    const hw = (r < 10 ? r + 1 : 20 - r) * 2;
    for (let x = 20 - hw; x < 20 + hw; x++) g.set(x, r, ch);
  }
  // grout on the near edges
  for (let r = 10; r < 20; r++) {
    const hw = (20 - r) * 2;
    g.set(20 - hw, r, "h");
    g.set(20 - hw + 1, r, "h");
    g.set(20 + hw - 1, r, "h");
    g.set(20 + hw - 2, r, "h");
  }
  return g.toMap();
}

export const WALL_H = 46;

/** One tile of the back-left wall: base runs (0,H)->(20,H+10). Size 20 x (H+10). */
export function makeWallLeft(): PixelMap {
  const g = new Grid(20, WALL_H + 10);
  g.fillPoly(
    [
      [0, 0],
      [20, 10],
      [20, WALL_H + 10],
      [0, WALL_H],
    ],
    "v",
  );
  // baseboard + top trim
  for (let x = 0; x < 20; x++) {
    const base = WALL_H + Math.floor(x / 2);
    g.set(x, base - 1, "V");
    g.set(x, base - 2, "V");
    g.set(x, base - 3, "W");
    g.set(x, Math.floor(x / 2), "W");
    g.set(x, Math.floor(x / 2) + 1, "W");
  }
  return g.toMap();
}

/** One tile of the back-right wall: base runs (20,H)->(0,H+10). Size 20 x (H+10). */
export function makeWallRight(): PixelMap {
  const g = new Grid(20, WALL_H + 10);
  g.fillPoly(
    [
      [20, 0],
      [0, 10],
      [0, WALL_H + 10],
      [20, WALL_H],
    ],
    "V",
  );
  for (let x = 0; x < 20; x++) {
    const top = Math.floor((19 - x) / 2);
    g.set(x, WALL_H + top - 1, "v");
    g.set(x, WALL_H + top - 2, "v");
    g.set(x, WALL_H + top - 3, "W");
    g.set(x, top, "W");
    g.set(x, top + 1, "W");
  }
  return g.toMap();
}

export const TABLE_H = 14; // table top height above the floor (art px)
export const TABLE_T = 4; // slab thickness

/**
 * Folding-table slab for `len` tiles along x, 1 tile deep, top raised TABLE_H
 * above the floor. Origin: the floor point of world (0,0) of the table is at
 * local (20, TABLE_H) [x shifted by +20 so nothing goes negative].
 */
export function makeTable(len: number): { map: PixelMap; origin: { x: number; y: number } } {
  const W = 20 * len + 20 + 2;
  const H = 10 * len + 10 + TABLE_H + TABLE_T + 2;
  const g = new Grid(W, H);
  const ox = 20;
  const oy = 0;
  // iso corners at top height (already raised: floor y - TABLE_H, so subtract nothing extra: we place top at y=0..)
  const A: [number, number] = [ox + 0, oy + 0];
  const B: [number, number] = [ox + 20 * len, oy + 10 * len];
  const C: [number, number] = [ox + 20 * len - 20, oy + 10 * len + 10];
  const Dp: [number, number] = [ox - 20, oy + 10];
  // front (near-left) face: edge Dp->C extruded down by T
  g.fillPoly([Dp, C, [C[0], C[1] + TABLE_T], [Dp[0], Dp[1] + TABLE_T]], "i");
  // right end face: edge B->C extruded
  g.fillPoly([B, C, [C[0], C[1] + TABLE_T], [B[0], B[1] + TABLE_T]], "J");
  // top
  g.fillPoly([A, B, C, Dp], "j");
  // edge lines
  g.line(Dp[0], Dp[1], C[0], C[1], "J");
  g.line(A[0], A[1], Dp[0], Dp[1], "J");
  g.line(A[0], A[1], B[0], B[1], "J");
  g.line(B[0], B[1], C[0], C[1], "J");
  // legs (folding table: pair at each end)
  const legs: Array<[number, number]> = [
    [Dp[0] + 3, Dp[1] + TABLE_T],
    [C[0] - 3, C[1] + TABLE_T],
    [A[0] + 3, A[1] + TABLE_T + 1],
    [B[0] - 3, B[1] + TABLE_T + 1],
  ];
  for (const [lx, ly] of legs) {
    g.rect(lx, ly, 2, TABLE_H - TABLE_T, "D");
  }
  // outline the front bottom edge
  g.line(Dp[0], Dp[1] + TABLE_T, C[0], C[1] + TABLE_T, "D");
  g.line(B[0], B[1] + TABLE_T, C[0], C[1] + TABLE_T, "D");
  return { map: g.toMap(), origin: { x: ox, y: oy } };
}

/* ---------- rasterizer + cache ---------- */

const cache = new Map<string, HTMLCanvasElement>();

export function rasterize(map: PixelMap, key: string, overrides?: Record<string, string>): HTMLCanvasElement {
  const hit = cache.get(key);
  if (hit) return hit;
  const w = Math.max(...map.map((r) => r.length));
  const h = map.length;
  const c = document.createElement("canvas");
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  const ctx = c.getContext("2d");
  if (ctx) {
    const pal = overrides ? { ...PALETTE, ...overrides } : PALETTE;
    for (let y = 0; y < h; y++) {
      const row = map[y];
      for (let x = 0; x < row.length; x++) {
        const ch = row[x];
        if (ch === "." || ch === " ") continue;
        const col = pal[ch];
        if (!col) continue;
        ctx.fillStyle = col;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  cache.set(key, c);
  return c;
}

export function kidSprite(pose: KidPose, variant: number): HTMLCanvasElement {
  const v = KID_VARIANTS[((variant % KID_VARIANTS.length) + KID_VARIANTS.length) % KID_VARIANTS.length];
  const map = pose === "sit" ? KID_SIT : pose === "typeA" ? KID_TYPE_A : pose === "typeB" ? KID_TYPE_B : pose === "cheer" ? KID_CHEER : pose === "slump" ? KID_SLUMP : KID_STAND;
  return rasterize(map, `kid:${pose}:${variant % KID_VARIANTS.length}`, v);
}

export const sprites = {
  crt: () => rasterize(CRT.map, "crt"),
  crtBig: () => rasterize(CRT_BIG.map, "crtBig"),
  chair: () => rasterize(CHAIR, "chair"),
  headset: () => rasterize(HEADSET, "headset"),
  pizza: () => rasterize(PIZZA, "pizza"),
  soda: () => rasterize(SODA, "soda"),
  router: () => rasterize(ROUTER, "router"),
  tower: () => rasterize(TOWER, "tower"),
  floor: (parity: 0 | 1) => rasterize(makeFloorTile(parity), `floor:${parity}`),
  wallLeft: () => rasterize(makeWallLeft(), "wallL"),
  wallRight: () => rasterize(makeWallRight(), "wallR"),
  table: (len: number) => {
    const key = `table:${len}`;
    const hit = cache.get(key);
    if (hit) return hit;
    return rasterize(makeTable(len).map, key);
  },
};

/** 16x16 task icons for the lobby cards. */
export const ICONS: Record<string, PixelMap> = {
  form: [
    "..kkkkkkkkkk....",
    "..kwwwwwwwwkk...",
    "..kwwwwwwwwkwk..",
    "..kwwwwwwwwkkkk.",
    "..kwnnnnnwwwwwk.",
    "..kwwwwwwwwwwwk.",
    "..kwddddddddwwk.",
    "..kwwwwwwwwwwwk.",
    "..kwddddddwwwwk.",
    "..kwwwwwwwwwwwk.",
    "..kwddddddddwwk.",
    "..kwwwwwwwwwwwk.",
    "..kwwwwwwrrrwwk.",
    "..kwwwwwwrrrwwk.",
    "..kwwwwwwwwwwwk.",
    "..kkkkkkkkkkkkk.",
  ],
  cart: [
    "................",
    "kk..............",
    ".kk.............",
    "..kkkkkkkkkkkk..",
    "..kyyyyyyyyyyk..",
    "..kyyyyyyyyyyk..",
    "...kyyyyyyyyk...",
    "...kyyyyyyyyk...",
    "....kyyyyyyk....",
    "....kkkkkkkk....",
    "....k......k....",
    "....kkkkkkkkk...",
    "................",
    ".....kk...kk....",
    ".....kk...kk....",
    "................",
  ],
  globe: [
    ".....kkkkkk.....",
    "...kkqqqqqqkk...",
    "..kqqqeeqqqqqk..",
    ".kqqeeeeeqqqqqk.",
    ".kqqeeeeeeqqqqk.",
    "kqqqqeeeeqqqqqqk",
    "kqqqqqeeqqqeeqqk",
    "kqqqqqqqqqeeeeqk",
    "kqqqqqqqqeeeeeqk",
    "kqqeeqqqqeeeeqqk",
    ".kqeeeqqqqeeqqk.",
    ".kqqeeqqqqqqqqk.",
    "..kqqqqqqqqqqk..",
    "...kkqqqqqqkk...",
    ".....kkkkkk.....",
    "................",
  ],
  check: [
    "kkkkkkkkkkkkkkkk",
    "kwwwwwwwwwwwwwwk",
    "kwkkkwwwwwwwwwwk",
    "kwkekwddddddddwk",
    "kwkkkwwwwwwwwwwk",
    "kwwwwwwwwwwwwwwk",
    "kwkkkwwwwwwwwwwk",
    "kwkwkwddddddwwwk",
    "kwkkkwwwwwwwwwwk",
    "kwwwwwwwwwwwwwwk",
    "kwkkkwwwwwwwwwwk",
    "kwkwkwddddddddwk",
    "kwkkkwwwwwwwwwwk",
    "kwwwwwwwwwwwwwwk",
    "kkkkkkkkkkkkkkkk",
    "................",
  ],
  desktop: [
    "kkkkkkkkkkkkkkk.",
    "kbbbbbbbbbbbbbk.",
    "kbkkkkkkkkkkkbk.",
    "kbkqqqqqqqqqkbk.",
    "kbkqwwwwwwqqkbk.",
    "kbkqwddwwwqqkbk.",
    "kbkqwwwwwwqqkbk.",
    "kbkqwddddwqqkbk.",
    "kbkqqqqqqqqqkbk.",
    "kbkkkkkkkkkkkbk.",
    "kbbbbbbbbbebbbk.",
    "kkkkkkkkkkkkkkk.",
    ".....kBBBk......",
    "....kbbbbbk.....",
    "...kbbbbbbbk....",
    "...kkkkkkkkk....",
  ],
  floppy: [
    "kkkkkkkkkkkkkkk.",
    "knnkwwwwwwwknnk.",
    "knnkwwwwwwwknnk.",
    "knnkwwwwwwwknnk.",
    "knnkwwwwwwwknnk.",
    "knnkkkkkkkkknnk.",
    "knnnnnnnnnnnnnk.",
    "knnnnnnnnnnnnnk.",
    "knnkkkkkkkkknnk.",
    "knnklllllllknnk.",
    "knnklkklllkknnk.",
    "knnklkklllkknnk.",
    "knnklllllllknnk.",
    "knnklllllllknnk.",
    ".kkkkkkkkkkkkk..",
    "................",
  ],
};
