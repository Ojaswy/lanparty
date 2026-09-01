import type { CreateRunRequest, Run, ServerInfo } from "../../shared/types";
import { MOCK } from "./router";
import { mockCreateRun, mockGetRun, mockInfo, mockListRuns } from "./mock";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 300);
    } catch {
      /* ignore */
    }
    throw new Error(`${init?.method ?? "GET"} ${path} → ${res.status} ${res.statusText}${detail ? `: ${detail}` : ""}`);
  }
  return (await res.json()) as T;
}

export async function getInfo(): Promise<ServerInfo> {
  if (MOCK) return mockInfo();
  return req<ServerInfo>("/api/info");
}

export async function listRuns(): Promise<Run[]> {
  if (MOCK) return mockListRuns();
  return req<Run[]>("/api/runs");
}

export async function getRun(id: string): Promise<Run> {
  if (MOCK) return mockGetRun(id);
  return req<Run>(`/api/runs/${encodeURIComponent(id)}`);
}

export async function createRun(body: CreateRunRequest): Promise<{ id: string }> {
  if (MOCK) return mockCreateRun(body);
  return req<{ id: string }>("/api/runs", { method: "POST", body: JSON.stringify(body) });
}

export async function cancelRun(id: string): Promise<{ ok: true }> {
  if (MOCK) return { ok: true };
  return req<{ ok: true }>(`/api/runs/${encodeURIComponent(id)}/cancel`, { method: "POST" });
}

/* ---------- small formatting helpers shared by the pages ---------- */

export function fmtMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s - m * 60)}s`;
}

export function fmtUsd(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v < 0.01 && v > 0 ? "<$0.01" : `$${v.toFixed(2)}`;
}

export function fmtWhen(ts: number): string {
  const d = Date.now() - ts;
  if (d < 60_000) return "just now";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function seatNick(index: number): string {
  return `seat${pad2(index + 1)}`;
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/* ---------- divergence token helpers ---------- */

/** "button:Submit Appeal" → "Submit Appeal" (drops the element-tag prefix). */
export function stripTag(target: string): string {
  const i = target.indexOf(":");
  return i > 0 && /^[a-z][a-z0-9-]*$/i.test(target.slice(0, i)) ? target.slice(i + 1) : target;
}

const CLICK_VERB: Record<string, string> = { left: "click", double: "double-click", triple: "triple-click", right: "right-click", middle: "middle-click" };

/**
 * Human form of a divergence token:
 *   left[button:Submit Appeal]→/x  → click "Submit Appeal" → /x
 *   left@3,5→/x                    → click grid 3,5 → /x
 *   type:foo → type "foo" · key:ctrl+s → key ctrl+s · scroll:down → scroll down
 */
export function prettyToken(token: string | undefined): string {
  if (!token) return "";
  const click = /^(left|double|triple|right|middle)(?:\[(.*)\]|@([^→]*))(?:→(.*))?$/.exec(token);
  if (click) {
    const verb = CLICK_VERB[click[1]] ?? click[1];
    const where = click[2] != null ? `"${stripTag(click[2])}"` : `grid ${click[3]}`;
    return `${verb} ${where}${click[4] ? ` → ${click[4]}` : ""}`;
  }
  if (token.startsWith("drag@")) return `drag ${token.slice(5).replace(">", " → ")}`;
  if (token.startsWith("type:")) return `type "${token.slice(5)}"`;
  if (token.startsWith("key:")) {
    const [k, nav] = token.slice(4).split("→");
    return `key ${k}${nav ? ` → ${nav}` : ""}`;
  }
  if (token.startsWith("scroll:")) return `scroll ${token.slice(7)}`;
  return token;
}

/** In-app replay page for a seat (the server's Seat.replayUrl has the same shape). */
export function replayPath(runId: string, seat: number): string {
  return `/replay/${encodeURIComponent(runId)}/${seat}`;
}

export function seatFinished(status: string): boolean {
  return status === "pass" || status === "fail" || status === "error" || status === "cancelled";
}
