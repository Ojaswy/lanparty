/** 2:1 dimetric ("isometric") projection helpers. One floor tile is TW x TH art pixels. */

export const TW = 40;
export const TH = 20;

export interface Pt {
  x: number;
  y: number;
}

/** World tile coords (x along the back-left wall, y towards the camera-left) -> screen art px. */
export function isoToScreen(x: number, y: number): Pt {
  return { x: (x - y) * (TW / 2), y: (x + y) * (TH / 2) };
}

export function screenToIso(sx: number, sy: number): Pt {
  const x = sx / TW + sy / TH;
  const y = sy / TH - sx / TW;
  return { x, y };
}

/** Painter's order: larger = nearer the camera = drawn later. */
export function depth(x: number, y: number): number {
  return x + y;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function inRect(r: Rect, px: number, py: number): boolean {
  return px >= r.x && py >= r.y && px < r.x + r.w && py < r.y + r.h;
}

export function unionRect(a: Rect | null, b: Rect): Rect {
  if (!a) return { ...b };
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const x2 = Math.max(a.x + a.w, b.x + b.w);
  const y2 = Math.max(a.y + a.h, b.y + b.h);
  return { x, y, w: x2 - x, h: y2 - y };
}
