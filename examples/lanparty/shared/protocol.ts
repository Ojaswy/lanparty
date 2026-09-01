import type { Run, Seat, SeatStatus, Step } from "./types.js";

/**
 * WebSocket protocol. The client connects to `/ws?run=<id>` and receives a
 * `run:snapshot` first, then incremental events. Frames are sent as JSON with a
 * base64 JPEG so a single socket carries everything.
 */
export type ServerEvent =
  | { type: "run:snapshot"; run: Run }
  | { type: "run:status"; runId: string; status: Run["status"]; summary?: Run["summary"]; divergence?: Run["divergence"]; portalUrl?: string }
  | { type: "seat:status"; runId: string; seat: number; status: SeatStatus; sessionId?: string; streamUrl?: string; replayUrl?: string; replayNdjsonUrl?: string; recordingUrl?: string; verdict?: string; error?: string; startedAt?: number; finishedAt?: number }
  | { type: "seat:frame"; runId: string; seat: number; jpeg: string; w: number; h: number; at: number }
  | { type: "seat:step"; runId: string; seat: number; step: Step; usage: Seat["usage"] }
  | { type: "seat:bubble"; runId: string; seat: number; text: string }
  | { type: "log"; runId: string; seat?: number; level: "info" | "warn" | "error"; text: string; at: number };

export type ClientEvent =
  | { type: "subscribe"; runId: string }
  | { type: "cancel"; runId: string };

export function encode(ev: ServerEvent | ClientEvent): string {
  return JSON.stringify(ev);
}

export function decode<T = ServerEvent | ClientEvent>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
