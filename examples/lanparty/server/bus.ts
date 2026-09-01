import type { WebSocket } from "ws";
import { encode, type ServerEvent } from "../shared/protocol.js";

/** Fan-out of run events to the websocket clients watching that run. */
export class Bus {
  private readonly subs = new Map<string, Set<WebSocket>>();

  subscribe(runId: string, ws: WebSocket): () => void {
    let set = this.subs.get(runId);
    if (!set) {
      set = new Set();
      this.subs.set(runId, set);
    }
    set.add(ws);
    return () => {
      set?.delete(ws);
      if (set && set.size === 0) this.subs.delete(runId);
    };
  }

  emit(ev: ServerEvent): void {
    const runId = "runId" in ev ? ev.runId : ev.run.id;
    const set = this.subs.get(runId);
    if (!set || set.size === 0) return;
    const payload = encode(ev);
    for (const ws of set) {
      if (ws.readyState === ws.OPEN) {
        // Frames are lossy by nature: if a client is falling behind, skip
        // frames for it rather than buffering megabytes.
        if (ev.type === "seat:frame" && ws.bufferedAmount > 512 * 1024) continue;
        ws.send(payload);
      }
    }
  }

  log(runId: string, level: "info" | "warn" | "error", text: string, seat?: number): void {
    this.emit({ type: "log", runId, seat, level, text, at: Date.now() });
  }
}
