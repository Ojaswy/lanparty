import { useEffect, useReducer, useRef } from "react";
import type { Run, Seat, SeatStatus, Step } from "../../shared/types";
import type { ServerEvent } from "../../shared/protocol";
import { decode } from "../../shared/protocol";
import { MOCK } from "./router";
import { openMockStream } from "./mock";
import { bindRun, pushFrame, pushThumbIfEmpty } from "./room/frames";
import { fmtMs, getRun, prettyToken, seatNick } from "./api";
import { sound } from "./sound";

export interface ChatLine {
  id: number;
  at: number;
  kind: "msg" | "sys" | "warn" | "error" | "info";
  seat?: number;
  text: string;
}

export interface RunState {
  run: Run | null;
  chat: ChatLine[];
  /** Client clock when a seat's bubble last changed (for fade-out). */
  bubbleAt: Record<number, number>;
  /** Client clock when a seat's status last changed (for boot flicker / confetti). */
  statusAt: Record<number, number>;
  connected: boolean;
  error: string | null;
  reconnects: number;
}

type Action =
  | { type: "event"; ev: ServerEvent; now: number }
  | { type: "connected"; value: boolean }
  | { type: "error"; text: string | null }
  | { type: "reset" };

const MAX_CHAT = 400;
let chatId = 1;

function line(at: number, kind: ChatLine["kind"], text: string, seat?: number): ChatLine {
  return { id: chatId++, at, kind, text, seat };
}

function describeStep(step: Step): string {
  const a = step.action;
  const inp = a.input ?? {};
  const xy = (v: unknown) => (Array.isArray(v) && v.length === 2 ? `${Math.round(Number(v[0]))},${Math.round(Number(v[1]))}` : "");
  switch (a.name) {
    case "left_click":
    case "right_click":
    case "double_click":
    case "triple_click":
    case "middle_click":
      return `${a.name} @ ${xy(inp.coordinate)}`;
    case "left_click_drag":
      return `drag ${xy(inp.start_coordinate)} → ${xy(inp.coordinate)}`;
    case "type": {
      const t = String(inp.text ?? "");
      return `type "${t.length > 40 ? t.slice(0, 40) + "…" : t}"`;
    }
    case "key":
      return `key ${String(inp.text ?? "")}`;
    case "scroll":
      return `scroll ${String(inp.scroll_direction ?? "down")} @ ${xy(inp.coordinate)}`;
    default:
      return a.name;
  }
}

function pushChat(chat: ChatLine[], l: ChatLine): ChatLine[] {
  const next = chat.length >= MAX_CHAT ? chat.slice(chat.length - MAX_CHAT + 1) : chat.slice();
  next.push(l);
  return next;
}

function patchSeat(run: Run, index: number, fn: (s: Seat) => Seat): Run {
  const seats = run.seats.map((s) => (s.index === index ? fn(s) : s));
  return { ...run, seats };
}

function statusLine(seat: Seat, status: SeatStatus, at: number): ChatLine | null {
  const nick = seatNick(seat.index);
  const dur = seat.startedAt && seat.finishedAt ? ` in ${fmtMs(seat.finishedAt - seat.startedAt)}` : "";
  switch (status) {
    case "booting":
      return line(at, "sys", `* ${nick} is booting (${seat.kind})`);
    case "running":
      return line(at, "sys", `* ${nick} has joined #lanparty`);
    case "grading":
      return line(at, "sys", `* ${nick} is being graded...`);
    case "pass":
      return line(at, "sys", `* ${nick} PASSED${dur}${seat.steps.length ? ` (${seat.steps.length} steps)` : ""}`);
    case "fail":
      return line(at, "warn", `* ${nick} FAILED${dur}${seat.verdict ? ` — ${seat.verdict}` : ""}`);
    case "error":
      return line(at, "error", `* ${nick} ERROR${seat.error ? ` — ${seat.error}` : ""}`);
    case "cancelled":
      return line(at, "sys", `* ${nick} was kicked (cancelled)`);
    default:
      return null;
  }
}

function reduce(state: RunState, action: Action): RunState {
  switch (action.type) {
    case "reset":
      return initial();
    case "connected":
      return { ...state, connected: action.value, reconnects: action.value ? state.reconnects : state.reconnects + 1 };
    case "error":
      return { ...state, error: action.text };
    case "event": {
      const { ev, now } = action;
      switch (ev.type) {
        case "run:snapshot": {
          const statusAt = { ...state.statusAt };
          for (const s of ev.run.seats) if (statusAt[s.index] == null) statusAt[s.index] = now;
          const chat = state.chat.length ? state.chat : [line(now, "info", `*** Connected to #lanparty — run ${ev.run.id} (${ev.run.task.name}, k=${ev.run.k})`)];
          return { ...state, run: ev.run, statusAt, chat, error: null };
        }
        case "run:status": {
          if (!state.run) return state;
          const run: Run = {
            ...state.run,
            status: ev.status,
            summary: ev.summary ?? state.run.summary,
            divergence: ev.divergence ?? state.run.divergence,
            portalUrl: ev.portalUrl ?? state.run.portalUrl,
            finishedAt: ev.status === "done" || ev.status === "cancelled" ? state.run.finishedAt ?? now : state.run.finishedAt,
          };
          let chat = state.chat;
          if (ev.status === "running") chat = pushChat(chat, line(now, "info", `*** All seats up. Party started.`));
          if (ev.status === "done" && ev.summary) chat = pushChat(chat, line(now, "info", `*** PARTY'S OVER — ${ev.summary.pass}/${ev.summary.k} passed`));
          if (ev.status === "cancelled") chat = pushChat(chat, line(now, "warn", `*** Party cancelled by host`));
          return { ...state, run, chat };
        }
        case "seat:status": {
          if (!state.run) return state;
          let newLine: ChatLine | null = null;
          const run = patchSeat(state.run, ev.seat, (s) => {
            const next: Seat = {
              ...s,
              status: ev.status,
              sessionId: ev.sessionId ?? s.sessionId,
              streamUrl: ev.streamUrl ?? s.streamUrl,
              replayUrl: ev.replayUrl ?? s.replayUrl,
              verdict: ev.verdict ?? s.verdict,
              error: ev.error ?? s.error,
              startedAt: ev.startedAt ?? s.startedAt,
              finishedAt: ev.finishedAt ?? s.finishedAt,
            };
            if (s.status !== ev.status) newLine = statusLine(next, ev.status, now);
            return next;
          });
          const changed = state.run.seats.find((s) => s.index === ev.seat)?.status !== ev.status;
          const statusAt = changed ? { ...state.statusAt, [ev.seat]: now } : state.statusAt;
          return { ...state, run, statusAt, chat: newLine ? pushChat(state.chat, newLine) : state.chat };
        }
        case "seat:step": {
          if (!state.run) return state;
          const run = patchSeat(state.run, ev.seat, (s) => {
            const steps = s.steps.some((x) => x.n === ev.step.n) ? s.steps.map((x) => (x.n === ev.step.n ? ev.step : x)) : [...s.steps, ev.step];
            return { ...s, steps, usage: ev.usage ?? s.usage };
          });
          const text = (prettyToken(ev.step.token) || describeStep(ev.step)) + (ev.step.error ? ` [!] ${ev.step.error}` : "");
          return { ...state, run, chat: pushChat(state.chat, line(now, ev.step.error ? "error" : "msg", text, ev.seat)) };
        }
        case "seat:bubble": {
          if (!state.run) return state;
          const run = patchSeat(state.run, ev.seat, (s) => ({ ...s, bubble: ev.text }));
          return { ...state, run, bubbleAt: { ...state.bubbleAt, [ev.seat]: now } };
        }
        case "log": {
          const kind: ChatLine["kind"] = ev.level === "error" ? "error" : ev.level === "warn" ? "warn" : "info";
          return { ...state, chat: pushChat(state.chat, line(ev.at || now, kind, ev.text, ev.seat)) };
        }
        default:
          return state;
      }
    }
    default:
      return state;
  }
}

const KNOWN_EVENTS = new Set(["run:snapshot", "run:status", "seat:status", "seat:frame", "seat:step", "seat:bubble", "log"]);
const KNOWN_SEAT_STATUS = new Set(["queued", "booting", "running", "grading", "pass", "fail", "error", "cancelled"]);

/** Counts what the socket delivered; exposed as window.__lanpartyWs for debugging against a real server. */
const wsStats: { counts: Record<string, number>; unknownTypes: string[]; unknownSeatStatus: string[]; framesNoWH: number; stepsWithoutThumb: number; stepsWithThumb: number } = {
  counts: {},
  unknownTypes: [],
  unknownSeatStatus: [],
  framesNoWH: 0,
  stepsWithoutThumb: 0,
  stepsWithThumb: 0,
};
(window as unknown as { __lanpartyWs?: unknown }).__lanpartyWs = wsStats;

let statsTick = 0;
function noteEvent(ev: ServerEvent): void {
  const t = (ev as { type: string }).type;
  wsStats.counts[t] = (wsStats.counts[t] ?? 0) + 1;
  if (++statsTick % 10 === 0 || t === "run:status") {
    try {
      document.documentElement.dataset.wsStats = JSON.stringify(wsStats);
    } catch {
      /* ignore */
    }
  }
  if (!KNOWN_EVENTS.has(t) && !wsStats.unknownTypes.includes(t)) wsStats.unknownTypes.push(t);
  if (ev.type === "seat:status" && !KNOWN_SEAT_STATUS.has(ev.status) && !wsStats.unknownSeatStatus.includes(ev.status)) wsStats.unknownSeatStatus.push(ev.status);
  if (ev.type === "seat:frame" && (!ev.w || !ev.h)) wsStats.framesNoWH++;
  if (ev.type === "seat:step") {
    if (ev.step.thumb) wsStats.stepsWithThumb++;
    else wsStats.stepsWithoutThumb++;
  }
}

function initial(): RunState {
  return { run: null, chat: [], bubbleAt: {}, statusAt: {}, connected: false, error: null, reconnects: 0 };
}

/**
 * Subscribe to a run: snapshot + incremental events. Handles reconnect with
 * backoff. Frames go straight to the frame cache (never through React state).
 */
export function useRun(runId: string): RunState {
  const [state, dispatch] = useReducer(reduce, undefined, initial);
  const lastStatus = useRef<Run["status"] | null>(null);
  lastStatus.current = state.run?.status ?? null;

  useEffect(() => {
    dispatch({ type: "reset" });
    bindRun(runId);
    let closed = false;
    let attempt = 0;
    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopMock: (() => void) | null = null;

    const handle = (ev: ServerEvent) => {
      const now = Date.now();
      noteEvent(ev);
      if (ev.type === "run:status" && (ev.status === "done" || ev.status === "cancelled") && !MOCK) {
        // The socket carries steps without thumbs and no replay/recording
        // urls beyond seat:status; the persisted run has everything.
        getRun(runId)
          .then((run) => {
            if (!closed && run.id === runId) dispatch({ type: "event", ev: { type: "run:snapshot", run }, now: Date.now() });
          })
          .catch(() => {
            /* best effort */
          });
      }
      if (ev.type === "seat:frame") {
        void pushFrame(ev.seat, ev.jpeg, ev.w, ev.h, ev.at || now);
        return;
      }
      if (ev.type === "run:snapshot") {
        for (const s of ev.run.seats) {
          const last = s.steps[s.steps.length - 1];
          if (last?.thumb) void pushThumbIfEmpty(s.index, last.thumb, last.at || 0);
        }
      }
      if (ev.type === "seat:step" && ev.step.thumb) {
        void pushThumbIfEmpty(ev.seat, ev.step.thumb, ev.step.at || now);
      }
      if (ev.type === "seat:status") {
        if (ev.status === "pass") sound.play("pass");
        else if (ev.status === "fail" || ev.status === "error") sound.play("fail");
        else if (ev.status === "booting") sound.play("boot");
      }
      dispatch({ type: "event", ev, now });
    };

    if (MOCK) {
      stopMock = openMockStream(runId, handle);
      dispatch({ type: "connected", value: true });
      return () => {
        closed = true;
        stopMock?.();
      };
    }

    const connect = () => {
      if (closed) return;
      const proto = location.protocol === "https:" ? "wss" : "ws";
      let ws: WebSocket;
      try {
        ws = new WebSocket(`${proto}://${location.host}/ws?run=${encodeURIComponent(runId)}`);
      } catch (e) {
        dispatch({ type: "error", text: String(e) });
        schedule();
        return;
      }
      socket = ws;
      ws.onopen = () => {
        attempt = 0;
        dispatch({ type: "connected", value: true });
        dispatch({ type: "error", text: null });
        try {
          ws.send(JSON.stringify({ type: "subscribe", runId }));
        } catch {
          /* ignore */
        }
      };
      ws.onmessage = (m) => {
        const ev = decode<ServerEvent>(typeof m.data === "string" ? m.data : "");
        if (ev) handle(ev);
      };
      ws.onerror = () => {
        dispatch({ type: "error", text: "socket error" });
      };
      ws.onclose = () => {
        if (socket === ws) socket = null;
        dispatch({ type: "connected", value: false });
        const st = lastStatus.current;
        if (st === "done" || st === "cancelled") return;
        schedule();
      };
    };

    const schedule = () => {
      if (closed || timer) return;
      const delay = Math.min(8000, 500 * 2 ** Math.min(attempt, 4)) + Math.random() * 250;
      attempt++;
      timer = setTimeout(() => {
        timer = null;
        connect();
      }, delay);
    };

    timer = setTimeout(() => {
      timer = null;
      connect();
    }, 0);

    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      if (socket) {
        try {
          socket.close();
        } catch {
          /* ignore */
        }
      }
    };
  }, [runId]);

  return state;
}
