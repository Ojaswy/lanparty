import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RunStatus, SeatKind, SeatStatus } from "../../../shared/types";
import { TH, TW, isoToScreen, inRect, unionRect, type Rect } from "./iso";
import { getFrame, frameVersion, subscribeFrames, type FrameEntry } from "./frames";
import { CRT, CRT_BIG, HEAD_DY, ROUTER_LEDS, TABLE_H, WALL_H, drawTiny, kidSprite, sprites, tinyWidth, type KidPose } from "./sprites";
import { pad2 } from "../api";

/* ---------- public state types ---------- */

export interface SeatView {
  index: number;
  kind: SeatKind;
  status: SeatStatus;
  sprite: number;
  model: string;
  steps: number;
  bubble?: string;
  /** Client clock (ms) when the bubble last changed. */
  bubbleAt?: number;
  /** Client clock (ms) when the status last changed. */
  statusAt?: number;
  sessionId?: string;
}

export interface SeatLayout {
  index: number;
  kind: SeatKind;
  row: number;
  col: number;
  /** World tile coords of the floor point under the chair. */
  cx: number;
  cy: number;
  /** Screen (art px) of that floor point. */
  P: { x: number; y: number };
  /** Art-px rects relative to the room origin. */
  crt: Rect;
  screen: Rect;
  kid: { x: number; y: number };
  chair: { x: number; y: number };
  hit: Rect;
  big: boolean;
}

export interface RoomLayout {
  seats: SeatLayout[];
  rows: number;
  cols: number;
  /** Seats per row (index = row). */
  rowLens: number[];
  /** World tile extents of the floor (half-open). */
  floor: { x0: number; y0: number; x1: number; y1: number };
  /** Art-px bounding box of everything drawn (relative to the iso origin). */
  bounds: Rect;
  router: { x: number; y: number };
  tower: { x: number; y: number };
  pizzas: Array<{ x: number; y: number }>;
  sodas: Array<{ x: number; y: number }>;
  banner: Rect;
}

export interface View {
  S: number;
  ox: number;
  oy: number;
  cw: number;
  ch: number;
}

export interface DrawState {
  layout: RoomLayout;
  view: View;
  seats: SeatView[];
  hover: number | null;
  runStatus: RunStatus;
  demo: boolean;
  frames: (seat: number) => FrameEntry | undefined;
  fontsReady: boolean;
  mouse: { x: number; y: number } | null;
  /** Whether time-based animations (bob, typing, LEDs) should play. */
  live: boolean;
}

const SEATS_PER_ROW = 5;
const ROW_PITCH = 3; // tiles between rows
const BUBBLE_MS = 3800; // speech bubble lifetime (fades over the last second)
const MAX_BUBBLES = 5; // newest bubbles drawn at once

/* ---------- layout (pure) ---------- */

export function layoutSeats(k: number, kinds: SeatKind[]): RoomLayout {
  const n = Math.max(0, k);
  const rows = Math.max(1, Math.ceil(n / SEATS_PER_ROW));
  const cols = Math.min(n, SEATS_PER_ROW) || 1;
  const rowLens: number[] = [];
  for (let r = 0; r < rows; r++) rowLens.push(Math.min(SEATS_PER_ROW, n - r * SEATS_PER_ROW));

  const floor = { x0: -1, y0: -1, x1: cols * 2 + 1, y1: (rows - 1) * ROW_PITCH + 3 };

  const seats: SeatLayout[] = [];
  let bounds: Rect | null = null;
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / SEATS_PER_ROW);
    const col = i % SEATS_PER_ROW;
    const kind = kinds[i] ?? "browser";
    const big = kind === "desktop";
    const yT = row * ROW_PITCH; // table far edge
    const cx = col * 2 + 1;
    const cy = yT + 1.6;
    const P = isoToScreen(cx, cy);
    P.x = Math.round(P.x);
    P.y = Math.round(P.y);
    const crtSpec = big ? CRT_BIG : CRT;
    const crtFloor = isoToScreen(cx, yT + 0.5);
    const crtX = Math.round(crtFloor.x - crtSpec.w / 2);
    const crtY = Math.round(crtFloor.y - TABLE_H - crtSpec.h + 1);
    const crt: Rect = { x: crtX, y: crtY, w: crtSpec.w, h: crtSpec.h };
    const screen: Rect = { x: crtX + crtSpec.screen.x, y: crtY + crtSpec.screen.y, w: crtSpec.screen.w, h: crtSpec.screen.h };
    const kid = { x: P.x - 6, y: P.y - 32 };
    const chair = { x: P.x - 7, y: P.y - 21 };
    const hit = unionRect(crt, { x: chair.x, y: kid.y, w: 14, h: 32 });
    const s: SeatLayout = { index: i, kind, row, col, cx, cy, P, crt, screen, kid, chair, hit, big };
    seats.push(s);
    bounds = unionRect(bounds, hit);
  }

  // floor + walls into bounds
  const corners = [isoToScreen(floor.x0, floor.y0), isoToScreen(floor.x1, floor.y0), isoToScreen(floor.x1, floor.y1), isoToScreen(floor.x0, floor.y1)];
  const minX = Math.min(...corners.map((c) => c.x));
  const maxX = Math.max(...corners.map((c) => c.x));
  const minY = Math.min(...corners.map((c) => c.y)) - WALL_H;
  const maxY = Math.max(...corners.map((c) => c.y));
  bounds = unionRect(bounds, { x: minX, y: minY, w: maxX - minX, h: maxY - minY });

  // props: router + tower against the back-right wall, pizza on the first table, sodas on a couple of desks
  const routerP = isoToScreen(floor.x1 - 0.6, floor.y0 + 0.9);
  const router = { x: Math.round(routerP.x - 11), y: Math.round(routerP.y - 10) };
  const towerP = isoToScreen(floor.x1 - 0.6, floor.y0 + 2.2);
  const tower = { x: Math.round(towerP.x - 6), y: Math.round(towerP.y - 16) };
  const pizzas: Array<{ x: number; y: number }> = [];
  const sodas: Array<{ x: number; y: number }> = [];
  for (let r = 0; r < rows; r++) {
    const len = rowLens[r];
    if (len >= 2 && r % 2 === 0) {
      const p = isoToScreen(len * 2 - 0.3, r * ROW_PITCH + 0.35);
      pizzas.push({ x: Math.round(p.x - 9), y: Math.round(p.y - TABLE_H - 10) });
    }
    if (len >= 1 && r % 2 === 1) {
      const p = isoToScreen(0.35, r * ROW_PITCH + 0.5);
      sodas.push({ x: Math.round(p.x - 3), y: Math.round(p.y - TABLE_H - 9) });
    }
  }
  for (const s of seats) {
    if (s.index % 3 === 1) {
      const p = isoToScreen(s.cx + 0.75, s.row * ROW_PITCH + 0.85);
      sodas.push({ x: Math.round(p.x - 3), y: Math.round(p.y - TABLE_H - 9) });
    }
  }

  const bannerW = Math.min(Math.max(200, bounds.w - 40), 232);
  const banner: Rect = { x: Math.round(bounds.x + bounds.w / 2 - bannerW / 2), y: minY - 4, w: bannerW, h: 22 };
  bounds = unionRect(bounds, { x: banner.x, y: banner.y - 8, w: banner.w, h: banner.h + 8 });

  return { seats, rows, cols, rowLens, floor, bounds: bounds ?? { x: 0, y: 0, w: 1, h: 1 }, router, tower, pizzas, sodas, banner };
}

export function fitView(layout: RoomLayout, cw: number, ch: number, padRight = 0, padTop = 0): View {
  const b = layout.bounds;
  const pad = 8;
  const availW = Math.max(100, cw - padRight - pad * 2);
  const availH = Math.max(100, ch - padTop - pad * 2);
  // Integer scale for crisp pixels. When floating windows reserve the right
  // edge, tolerate a few % of overflow under them rather than dropping a whole
  // scale step (the overflow is the back-right wall, never a seat).
  const tol = padRight > 0 ? 1.07 : 1;
  let S = Math.floor(Math.min((availW / b.w) * tol, availH / b.h));
  S = Math.max(1, Math.min(6, S));
  const slackW = availW - b.w * S;
  const ox = Math.round(pad + (slackW > 0 ? slackW / 2 : 0) - b.x * S);
  const oy = Math.round(padTop + pad + (availH - b.h * S) / 2 - b.y * S);
  return { S, ox, oy, cw, ch };
}

/* ---------- drawing ---------- */

function blit(ctx: CanvasRenderingContext2D, v: View, img: HTMLCanvasElement, x: number, y: number): void {
  ctx.drawImage(img, v.ox + x * v.S, v.oy + y * v.S, img.width * v.S, img.height * v.S);
}

function px(ctx: CanvasRenderingContext2D, v: View, x: number, y: number, w: number, h: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(v.ox + x * v.S, v.oy + y * v.S, w * v.S, h * v.S);
}

function pixLine(ctx: CanvasRenderingContext2D, v: View, x0: number, y0: number, x1: number, y1: number, color: string, thick = 1): void {
  ctx.fillStyle = color;
  let dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (let guard = 0; guard < 4000; guard++) {
    ctx.fillRect(v.ox + x0 * v.S, v.oy + y0 * v.S, thick * v.S, thick * v.S);
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
  dx = 0;
}

function poseFor(status: SeatStatus, t: number, i: number): KidPose {
  switch (status) {
    case "queued":
      return "stand";
    case "booting":
    case "grading":
      return "sit";
    case "running":
      return Math.floor(t / 250 + i) % 2 === 0 ? "typeA" : "typeB";
    case "pass":
      return "cheer";
    case "fail":
      return "slump";
    case "error":
      return "sit";
    case "cancelled":
      return "sit";
    default:
      return "sit";
  }
}

function hash(n: number): number {
  let x = (n + 1) * 2654435761;
  x = (x ^ (x >>> 13)) * 1274126177;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

function drawBiosScreen(ctx: CanvasRenderingContext2D, v: View, r: Rect, seat: number, t: number, flicker: boolean): void {
  px(ctx, v, r.x, r.y, r.w, r.h, flicker && Math.floor(t / 90) % 5 === 0 ? "#142014" : "#0b0f0a");
  const lines = ["SOLARI BIOS V0.1", `BOOT SEAT ${pad2(seat + 1)}`, "MEM 64MB OK", "NET DHCP..."];
  const maxChars = Math.max(1, Math.floor(r.w / 4));
  let y = r.y + 1;
  for (let i = 0; i < lines.length && y + 5 <= r.y + r.h; i++) {
    drawTiny(ctx, lines[i].slice(0, maxChars), r.x + 1, y, v.S, i === 0 ? "#ffffff" : "#33ff66", v.ox, v.oy);
    y += 6;
  }
  if (Math.floor(t / 400) % 2 === 0 && y + 5 <= r.y + r.h) px(ctx, v, r.x + 1, y, 3, 5, "#33ff66");
}

function drawBsod(ctx: CanvasRenderingContext2D, v: View, r: Rect): void {
  px(ctx, v, r.x, r.y, r.w, r.h, "#0000aa");
  const cw = Math.max(1, Math.floor(r.w / 4));
  drawTiny(ctx, " SEAT ".slice(0, cw), r.x + Math.max(0, Math.floor((r.w - tinyWidth(" SEAT ")) / 2)), r.y + 1, v.S, "#0000aa", v.ox, v.oy);
  px(ctx, v, r.x + Math.max(0, Math.floor((r.w - 22) / 2)), r.y + 1, Math.min(22, r.w), 6, "#aaaaaa");
  drawTiny(ctx, "FAIL", r.x + Math.max(0, Math.floor((r.w - tinyWidth("FAIL")) / 2)), r.y + 2, v.S, "#0000aa", v.ox, v.oy);
  let y = r.y + 8;
  const widths = [0.9, 0.7, 0.8, 0.5, 0.85];
  for (let i = 0; i < widths.length && y + 1 < r.y + r.h - 1; i++) {
    px(ctx, v, r.x + 1, y, Math.max(1, Math.floor((r.w - 2) * widths[i])), 1, "#dddddd");
    y += 2;
  }
}

function drawStatic(ctx: CanvasRenderingContext2D, v: View, r: Rect, t: number): void {
  const seed = Math.floor(t / 80);
  for (let y = 0; y < r.h; y += 1) {
    for (let x = 0; x < r.w; x += 2) {
      const n = hash(seed * 7919 + y * 131 + x);
      const g = n > 0.5 ? 200 : n > 0.25 ? 110 : 30;
      ctx.fillStyle = `rgb(${g},${g},${g})`;
      ctx.fillRect(v.ox + (r.x + x) * v.S, v.oy + (r.y + y) * v.S, 2 * v.S, v.S);
    }
  }
}

function drawFrameInto(ctx: CanvasRenderingContext2D, v: View, r: Rect, f: FrameEntry): void {
  const dx = v.ox + r.x * v.S;
  const dy = v.oy + r.y * v.S;
  const dw = r.w * v.S;
  const dh = r.h * v.S;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "medium";
  ctx.drawImage(f.bitmap, 0, 0, f.bitmap.width, f.bitmap.height, dx, dy, dw, dh);
  ctx.imageSmoothingEnabled = false;
  // subtle scanlines: one dark device-px line every 2 art px
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  for (let y = 0; y < r.h; y += 2) ctx.fillRect(dx, dy + y * v.S + v.S - 1, dw, 1);
}

function drawScreen(ctx: CanvasRenderingContext2D, v: View, L: SeatLayout, s: SeatView, f: FrameEntry | undefined, t: number): void {
  const r = L.screen;
  switch (s.status) {
    case "queued":
    case "cancelled":
      px(ctx, v, r.x, r.y, r.w, r.h, "#1a1d18");
      if (s.status === "cancelled") {
        px(ctx, v, r.x, r.y, r.w, r.h, "#0b0f0a");
        drawTiny(ctx, "OFF", r.x + Math.max(0, Math.floor((r.w - tinyWidth("OFF")) / 2)), r.y + Math.floor(r.h / 2) - 2, v.S, "#2a3a2a", v.ox, v.oy);
      }
      return;
    case "booting": {
      const since = s.statusAt ? t - s.statusAt : 9999;
      if (since < 350 && Math.floor(t / 60) % 2 === 0) {
        px(ctx, v, r.x, r.y, r.w, r.h, "#dfe8df");
        return;
      }
      if (f) {
        drawFrameInto(ctx, v, r, f);
        return;
      }
      drawBiosScreen(ctx, v, r, s.index, t, true);
      return;
    }
    case "error":
      if (f && Math.floor(t / 500) % 3 !== 0) drawFrameInto(ctx, v, r, f);
      else drawStatic(ctx, v, r, t);
      return;
    case "fail":
      drawBsod(ctx, v, r);
      return;
    case "pass":
      if (f) drawFrameInto(ctx, v, r, f);
      else px(ctx, v, r.x, r.y, r.w, r.h, "#0b1f0b");
      ctx.fillStyle = "rgba(51,255,102,0.22)";
      ctx.fillRect(v.ox + r.x * v.S, v.oy + r.y * v.S, r.w * v.S, r.h * v.S);
      return;
    default:
      if (f) drawFrameInto(ctx, v, r, f);
      else drawBiosScreen(ctx, v, r, s.index, t, false);
  }
}

function wrapBubble(text: string, maxLine = 22, maxLines = 2): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > maxLine) {
      if (cur) lines.push(cur);
      cur = w.length > maxLine ? w.slice(0, maxLine - 1) + "…" : w;
      if (lines.length === maxLines) break;
    } else cur = (cur + " " + w).trim();
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) {
    lines[maxLines - 1] = lines[maxLines - 1].slice(0, maxLine - 1) + "…";
  }
  return lines;
}

function drawTooltip(ctx: CanvasRenderingContext2D, v: View, x: number, y: number, lines: string[], fontPx: number, alpha = 1, anchorDown = true): Rect {
  ctx.font = `${fontPx * v.S}px "VT323", monospace`;
  ctx.textBaseline = "top";
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) / v.S + 6;
  const h = lines.length * fontPx * 0.95 + 4;
  const rx = Math.round(x - w / 2);
  const ry = Math.round(y - h);
  ctx.globalAlpha = alpha;
  px(ctx, v, rx - 1, ry - 1, w + 2, h + 2, "#000000");
  px(ctx, v, rx, ry, w, h, "#ffffe1");
  if (anchorDown) {
    px(ctx, v, Math.round(x) - 1, ry + h, 3, 1, "#000000");
    px(ctx, v, Math.round(x), ry + h + 1, 1, 1, "#000000");
  }
  ctx.fillStyle = "#000";
  lines.forEach((l, i) => {
    ctx.fillText(l, v.ox + (rx + 3) * v.S, v.oy + (ry + 2 + i * fontPx * 0.95) * v.S);
  });
  ctx.globalAlpha = 1;
  return { x: rx, y: ry, w, h };
}

function drawGlyphBubble(ctx: CanvasRenderingContext2D, v: View, x: number, y: number, text: string, color: string, bg = "#ffffff"): void {
  const w = tinyWidth(text) + 4;
  const h = 9;
  const rx = Math.round(x - w / 2);
  const ry = Math.round(y - h);
  px(ctx, v, rx - 1, ry - 1, w + 2, h + 2, "#000000");
  px(ctx, v, rx, ry, w, h, bg);
  px(ctx, v, Math.round(x) - 1, ry + h + 1, 2, 1, "#000000");
  drawTiny(ctx, text, rx + 2, ry + 2, v.S, color, v.ox, v.oy);
}

function drawConfetti(ctx: CanvasRenderingContext2D, v: View, L: SeatLayout, age: number, seed: number): void {
  const colors = ["#ff3b3b", "#ffd54f", "#33ff66", "#2f6fd6", "#ff8c1a", "#ffffff"];
  const dur = 1600;
  if (age < 0 || age > dur) return;
  const k = age / dur;
  for (let i = 0; i < 14; i++) {
    const a = hash(seed * 31 + i);
    const b = hash(seed * 17 + i * 3);
    const vx = (a - 0.5) * 36;
    const vy = -18 - b * 22;
    const x = L.kid.x + 6 + vx * k;
    const y = L.kid.y - 4 + vy * k + 40 * k * k;
    ctx.globalAlpha = 1 - k * 0.7;
    px(ctx, v, Math.round(x), Math.round(y), 1, 1, colors[i % colors.length]);
  }
  ctx.globalAlpha = 1;
}

function drawBanner(ctx: CanvasRenderingContext2D, v: View, b: Rect, fontsReady: boolean): void {
  // rope
  pixLine(ctx, v, b.x - 26, b.y - 8, b.x, b.y, "#5a3a1a");
  pixLine(ctx, v, b.x + b.w, b.y, b.x + b.w + 26, b.y - 8, "#5a3a1a");
  // cloth
  px(ctx, v, b.x - 1, b.y - 1, b.w + 2, b.h + 2, "#111");
  px(ctx, v, b.x, b.y, b.w, b.h, "#f4efe0");
  px(ctx, v, b.x, b.y, b.w, 2, "#c8102e");
  px(ctx, v, b.x, b.y + b.h - 2, b.w, 2, "#c8102e");
  // scallops
  for (let x = b.x + 2; x < b.x + b.w; x += 6) px(ctx, v, x, b.y + b.h, 3, 2, "#c8102e");
  const text = "WELCOME TO LANPARTY 2001";
  if (fontsReady) {
    const size = 8 * v.S;
    ctx.font = `${size}px "Press Start 2P", monospace`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    const cx = v.ox + (b.x + b.w / 2) * v.S;
    const cy = v.oy + (b.y + b.h / 2) * v.S + v.S;
    // WordArt-ish: hard shadow, then a two-tone gradient fill
    ctx.fillStyle = "#111";
    ctx.fillText(text, cx + v.S, cy + v.S);
    const g = ctx.createLinearGradient(0, cy - size / 2, 0, cy + size / 2);
    g.addColorStop(0, "#ffd54f");
    g.addColorStop(0.5, "#ff8c1a");
    g.addColorStop(0.51, "#c8102e");
    g.addColorStop(1, "#000080");
    ctx.fillStyle = g;
    ctx.fillText(text, cx, cy);
    ctx.textAlign = "left";
  } else {
    drawTiny(ctx, text, b.x + Math.floor((b.w - tinyWidth(text)) / 2), b.y + 8, v.S, "#c8102e", v.ox, v.oy);
  }
}

export function drawRoom(ctx: CanvasRenderingContext2D, st: DrawState, t: number): void {
  const { layout: L, view: v } = st;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#16202c";
  ctx.fillRect(0, 0, v.cw, v.ch);

  // ---- walls
  const wl = sprites.wallLeft();
  const wr = sprites.wallRight();
  for (let x = L.floor.x0; x < L.floor.x1; x++) {
    const p = isoToScreen(x, L.floor.y0);
    blit(ctx, v, wl, p.x, p.y - WALL_H);
  }
  for (let y = L.floor.y0; y < L.floor.y1; y++) {
    const p = isoToScreen(L.floor.x1, y);
    blit(ctx, v, wr, p.x - 20, p.y - WALL_H);
  }
  // corner post
  {
    const p = isoToScreen(L.floor.x1, L.floor.y0);
    px(ctx, v, p.x - 1, p.y - WALL_H, 2, WALL_H, "#4c7390");
  }
  // wall decor: a poster and a clock on the left wall
  {
    const p = isoToScreen(L.floor.x0 + 1.2, L.floor.y0);
    px(ctx, v, p.x, p.y - WALL_H + 12, 14, 18, "#111");
    px(ctx, v, p.x + 1, p.y - WALL_H + 13, 12, 16, "#2b2b2b");
    px(ctx, v, p.x + 3, p.y - WALL_H + 16, 8, 3, "#ff3b3b");
    px(ctx, v, p.x + 3, p.y - WALL_H + 21, 8, 1, "#ffd54f");
    px(ctx, v, p.x + 3, p.y - WALL_H + 23, 6, 1, "#ffd54f");
    px(ctx, v, p.x + 3, p.y - WALL_H + 25, 8, 1, "#ffd54f");
  }

  // ---- floor
  const f0 = sprites.floor(0);
  const f1 = sprites.floor(1);
  for (let y = L.floor.y0; y < L.floor.y1; y++) {
    for (let x = L.floor.x0; x < L.floor.x1; x++) {
      const p = isoToScreen(x, y);
      blit(ctx, v, ((x + y) & 1) === 0 ? f0 : f1, p.x - TW / 2, p.y);
    }
  }

  // ---- cables: from the router along the back wall, then down each row's aisle
  {
    const r = isoToScreen(L.floor.x1 - 0.6, L.floor.y0 + 1.1);
    const along = isoToScreen(L.floor.x1 - 0.6, L.floor.y1 - 0.6);
    pixLine(ctx, v, Math.round(r.x), Math.round(r.y), Math.round(along.x), Math.round(along.y), "#2b2b2b", 1);
    for (let row = 0; row < L.rows; row++) {
      const a = isoToScreen(L.floor.x1 - 0.6, row * ROW_PITCH + 2.2);
      const b = isoToScreen(0.2, row * ROW_PITCH + 2.2);
      pixLine(ctx, v, Math.round(a.x), Math.round(a.y), Math.round(b.x), Math.round(b.y), "#2b2b2b", 1);
    }
  }

  // ---- hover highlight on the floor
  if (st.hover != null) {
    const s = L.seats[st.hover];
    if (s) {
      const p = isoToScreen(Math.floor(s.cx), Math.floor(s.cy));
      ctx.fillStyle = "rgba(255,213,79,0.55)";
      ctx.beginPath();
      ctx.moveTo(v.ox + p.x * v.S, v.oy + p.y * v.S);
      ctx.lineTo(v.ox + (p.x + TW / 2) * v.S, v.oy + (p.y + TH / 2) * v.S);
      ctx.lineTo(v.ox + p.x * v.S, v.oy + (p.y + TH) * v.S);
      ctx.lineTo(v.ox + (p.x - TW / 2) * v.S, v.oy + (p.y + TH / 2) * v.S);
      ctx.closePath();
      ctx.fill();
    }
  }

  // ---- router + tower
  {
    const rt = sprites.router();
    blit(ctx, v, rt, L.router.x, L.router.y);
    ROUTER_LEDS.forEach((led, i) => {
      const on = st.live ? Math.floor(t / (120 + i * 70) + i) % 3 !== 0 : i % 2 === 0;
      px(ctx, v, L.router.x + led.x, L.router.y + led.y, 1, 1, on ? (i === 3 ? "#ffd54f" : "#00ff55") : "#1c1c1c");
    });
    const tw = sprites.tower();
    blit(ctx, v, tw, L.tower.x, L.tower.y);
    if (st.live && Math.floor(t / 300) % 2 === 0) px(ctx, v, L.tower.x + 6, L.tower.y + 6, 1, 1, "#00ff55");
  }

  // ---- banner
  drawBanner(ctx, v, L.banner, st.fontsReady);

  // ---- tables (back to front)
  for (let row = 0; row < L.rows; row++) {
    const len = L.rowLens[row] * 2;
    const img = sprites.table(len);
    const p = isoToScreen(0, row * ROW_PITCH);
    blit(ctx, v, img, p.x - 20, p.y - TABLE_H);
  }
  for (const pz of L.pizzas) blit(ctx, v, sprites.pizza(), pz.x, pz.y);

  // ---- seats
  const seatViews = new Map<number, SeatView>();
  for (const s of st.seats) seatViews.set(s.index, s);
  const bubbles: Array<{ L: SeatLayout; s: SeatView }> = [];

  for (const Ls of L.seats) {
    const s = seatViews.get(Ls.index) ?? { index: Ls.index, kind: Ls.kind, status: "queued" as SeatStatus, sprite: Ls.index, model: "", steps: 0 };
    const crtImg = Ls.big ? sprites.crtBig() : sprites.crt();
    const crtSpec = Ls.big ? CRT_BIG : CRT;

    // CRT + screen
    blit(ctx, v, crtImg, Ls.crt.x, Ls.crt.y);
    const on = s.status !== "queued" && s.status !== "cancelled";
    px(ctx, v, Ls.crt.x + crtSpec.led.x, Ls.crt.y + crtSpec.led.y, 1, 1, on ? (s.status === "fail" ? "#ff3b3b" : "#00ff55") : "#333");
    drawScreen(ctx, v, Ls, s, st.frames(Ls.index), t);
    if (s.status === "pass") {
      // phosphor glow ring
      ctx.fillStyle = "rgba(51,255,102,0.55)";
      const r = Ls.screen;
      ctx.fillRect(v.ox + (r.x - 1) * v.S, v.oy + (r.y - 1) * v.S, (r.w + 2) * v.S, v.S);
      ctx.fillRect(v.ox + (r.x - 1) * v.S, v.oy + (r.y + r.h) * v.S, (r.w + 2) * v.S, v.S);
      ctx.fillRect(v.ox + (r.x - 1) * v.S, v.oy + r.y * v.S, v.S, r.h * v.S);
      ctx.fillRect(v.ox + (r.x + r.w) * v.S, v.oy + r.y * v.S, v.S, r.h * v.S);
    }
    if (s.status === "fail") {
      const r = Ls.screen;
      pixLine(ctx, v, r.x, r.y, r.x + r.w - 1, r.y + r.h - 1, "#ff3b3b", 2);
      pixLine(ctx, v, r.x + r.w - 1, r.y, r.x, r.y + r.h - 1, "#ff3b3b", 2);
    }
    // seat number on the CRT base
    drawTiny(ctx, pad2(Ls.index + 1), Ls.crt.x + Math.floor(crtSpec.w / 2) - 4, Ls.crt.y + crtSpec.h - 4, v.S, "#5a5448", v.ox, v.oy);

    // kid + chair
    const pose = poseFor(s.status, st.live ? t : 0, Ls.index);
    const bob = st.live && (s.status === "running" || s.status === "booting" || s.status === "grading") ? (Math.floor(t / 600 + Ls.index) % 2 === 0 ? 0 : -1) : 0;
    const cheerBob = st.live && s.status === "pass" ? (Math.floor(t / 300 + Ls.index) % 2 === 0 ? 0 : -1) : 0;
    const kidImg = kidSprite(pose, s.sprite);
    if (pose === "stand") {
      // standing next to the chair (to the left), on the floor
      const kx = Ls.chair.x - 14;
      const ky = Ls.P.y - 18 + bob;
      blit(ctx, v, sprites.chair(), Ls.chair.x, Ls.chair.y);
      blit(ctx, v, kidImg, kx, ky);
      if (Ls.kind === "desktop") blit(ctx, v, sprites.headset(), kx, ky);
    } else {
      const ky = Ls.kid.y + bob + cheerBob;
      blit(ctx, v, kidImg, Ls.kid.x, ky);
      if (Ls.kind === "desktop") blit(ctx, v, sprites.headset(), Ls.kid.x, ky + HEAD_DY[pose]);
      blit(ctx, v, sprites.chair(), Ls.chair.x, Ls.chair.y);
    }

    // glyph bubbles by status
    const headX = Ls.kid.x + 6;
    const headY = Ls.kid.y - 3 + bob;
    if (s.status === "grading") drawGlyphBubble(ctx, v, headX, headY, "?", "#000080");
    else if (s.status === "pass") drawGlyphBubble(ctx, v, headX, headY - 2, "GG", "#00843a", "#e6ffe6");
    else if (s.status === "error") drawGlyphBubble(ctx, v, headX, headY, "!!", "#a01818", "#fff0f0");

    if (s.status === "pass" && s.statusAt && st.live) drawConfetti(ctx, v, Ls, t - s.statusAt, Ls.index + 1);

    if (s.bubble && s.bubbleAt && t - s.bubbleAt < BUBBLE_MS && (s.status === "running" || s.status === "booting" || s.status === "grading")) {
      bubbles.push({ L: Ls, s });
    }
  }

  for (const sd of L.sodas) blit(ctx, v, sprites.soda(), sd.x, sd.y);

  // ---- speech bubbles: one short line, parked above the seat's OWN monitor so
  // they never cover their own screen; only the newest few are shown so the
  // room stays readable at k=20 (drawn last so they float over props)
  bubbles.sort((a, b) => (b.s.bubbleAt ?? 0) - (a.s.bubbleAt ?? 0));
  for (const { L: Ls, s } of bubbles.slice(0, MAX_BUBBLES)) {
    const age = t - (s.bubbleAt ?? t);
    const alpha = (age < BUBBLE_MS - 1000 ? 1 : Math.max(0, (BUBBLE_MS - age) / 1000)) * 0.96;
    const lines = wrapBubble(s.bubble ?? "", 22, 1);
    drawTooltip(ctx, v, Ls.crt.x + Ls.crt.w / 2, Ls.crt.y - 3, lines, 7, alpha, true);
  }

  // ---- hover name tag
  if (st.hover != null) {
    const Ls = L.seats[st.hover];
    const s = seatViews.get(st.hover);
    if (Ls && s) {
      const label = `seat ${pad2(Ls.index + 1)} · ${s.model || "?"} · ${s.steps} steps${Ls.kind === "desktop" ? " · desktop" : ""}`;
      const status = s.status.toUpperCase();
      drawTooltip(ctx, v, Ls.crt.x + Ls.crt.w / 2, Ls.crt.y - 3, [label, status], 9, 1, true);
    }
  }

  // ---- demo stamp
  if (st.demo) {
    ctx.save();
    ctx.translate(v.cw / 2, v.ch / 2);
    ctx.rotate(-0.28);
    ctx.font = `${Math.max(22, 14 * v.S)}px "Press Start 2P", monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(255,40,40,0.22)";
    ctx.fillText("DEMO REPLAY", 0, 0);
    ctx.restore();
  }
}

/* ---------- React component ---------- */

export interface RoomCanvasProps {
  seats: SeatView[];
  runStatus: RunStatus;
  demo?: boolean;
  /** Animate continuously (running room) vs. only redraw on change (result page). */
  live: boolean;
  onSeatClick?: (index: number) => void;
  /** Device-independent px reserved on the right for floating windows. */
  padRight?: number;
  className?: string;
}

export function RoomCanvas({ seats, runStatus, demo = false, live, onSeatClick, padRight = 0, className }: RoomCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const hoverRef = useRef<number | null>(null);
  const dirty = useRef(true);
  const fontsReady = useRef(false);
  const stateRef = useRef<{ seats: SeatView[]; runStatus: RunStatus; demo: boolean; live: boolean }>({ seats, runStatus, demo, live });
  stateRef.current = { seats, runStatus, demo, live };
  dirty.current = true;

  const kinds = useMemo(() => seats.map((s) => s.kind), [seats]);
  const layout = useMemo(() => layoutSeats(seats.length, kinds), [seats.length, kinds.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  const viewRef = useRef<View | null>(null);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const padRightRef = useRef(padRight);
  padRightRef.current = padRight;

  // fonts
  useEffect(() => {
    let alive = true;
    const fs = document.fonts;
    if (!fs) {
      fontsReady.current = true;
      return;
    }
    Promise.all([fs.load('8px "Press Start 2P"'), fs.load('9px "VT323"')])
      .then(() => {
        if (!alive) return;
        fontsReady.current = true;
        dirty.current = true;
      })
      .catch(() => {
        fontsReady.current = true;
      });
    return () => {
      alive = false;
    };
  }, []);

  // resize
  const resize = useCallback(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = Math.max(1, Math.floor(host.clientWidth * dpr));
    const ch = Math.max(1, Math.floor(host.clientHeight * dpr));
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    viewRef.current = fitView(layoutRef.current, cw, ch, padRightRef.current * dpr, 0);
    dirty.current = true;
  }, []);

  useEffect(() => {
    resize();
    const ro = new ResizeObserver(() => resize());
    if (hostRef.current) ro.observe(hostRef.current);
    window.addEventListener("resize", resize);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, [resize, layout]);

  // frames arriving -> dirty
  useEffect(() => subscribeFrames(() => (dirty.current = true)), []);

  // render loop (~24fps cap, dirty flag when not live)
  useEffect(() => {
    let raf = 0;
    let last = 0;
    let lastVersion = -1;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < 41) return;
      const canvas = canvasRef.current;
      const view = viewRef.current;
      if (!canvas || !view) return;
      const st = stateRef.current;
      const anim = st.live;
      const fv = frameVersion();
      if (!anim && !dirty.current && fv === lastVersion) return;
      lastVersion = fv;
      last = now;
      dirty.current = false;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      drawRoom(
        ctx,
        {
          layout: layoutRef.current,
          view,
          seats: st.seats,
          hover: hoverRef.current,
          runStatus: st.runStatus,
          demo: st.demo,
          frames: getFrame,
          fontsReady: fontsReady.current,
          mouse: null,
          live: st.live,
        },
        st.live ? now : 0,
      );
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const hitTest = (e: React.MouseEvent<HTMLCanvasElement>): number | null => {
    const canvas = canvasRef.current;
    const view = viewRef.current;
    if (!canvas || !view) return null;
    const rect = canvas.getBoundingClientRect();
    const sx = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const sy = ((e.clientY - rect.top) / rect.height) * canvas.height;
    const ax = (sx - view.ox) / view.S;
    const ay = (sy - view.oy) / view.S;
    // nearest-to-camera wins: iterate from the end
    const seatsL = layoutRef.current.seats;
    for (let i = seatsL.length - 1; i >= 0; i--) {
      if (inRect(seatsL[i].hit, ax, ay)) return seatsL[i].index;
    }
    return null;
  };

  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const h = hitTest(e);
    if (h !== hoverRef.current) {
      hoverRef.current = h;
      setHover(h);
      dirty.current = true;
    }
  };
  const onLeave = () => {
    hoverRef.current = null;
    setHover(null);
    dirty.current = true;
  };
  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const h = hitTest(e);
    if (h != null) onSeatClick?.(h);
  };

  return (
    <div ref={hostRef} className={`room-canvas-host ${className ?? ""}`}>
      <canvas
        ref={canvasRef}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
        onClick={onClick}
        style={{ cursor: hover != null ? "pointer" : "default" }}
        aria-label="Isometric LAN party room"
        role="img"
      />
    </div>
  );
}
