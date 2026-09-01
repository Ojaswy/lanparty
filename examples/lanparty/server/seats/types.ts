import type { SeatKind, StepAction } from "../../shared/types.js";

/** What the agent loop needs from a seat, regardless of which Solari product backs it. */
export interface SeatDriver {
  readonly kind: SeatKind;
  /** Screen size the agent sees (screenshots are captured at exactly this size). */
  readonly width: number;
  readonly height: number;
  /** Solari session id once booted. */
  sessionId?: string;
  /** wss:// RFB stream (desktop seats) for the client-side noVNC view. */
  streamUrl?: string;

  /** Create the Solari session, open the start URL / app, wait until it is ready. */
  boot(): Promise<void>;
  /** Full-size PNG of the screen. */
  screenshot(): Promise<Buffer>;
  /** Crop of the screen at native resolution (PNG). */
  zoom(region: [number, number, number, number]): Promise<Buffer>;
  /** Execute one computer-toolset action. Throws on failure. Returns optional text for the tool result. */
  act(action: StepAction): Promise<string | undefined>;
  /** Label of the element the last click landed on (browser seats), for readable divergence reports. */
  lastTarget(): string | undefined;
  /** Current URL (browser seats) or undefined. */
  url(): Promise<string | undefined>;
  /** Visible page text (browser seats) for `text_present` checks; empty for desktops. */
  pageText(): Promise<string>;
  /** Whether a CSS selector exists (browser seats). */
  hasSelector(selector: string): Promise<boolean>;
  /** Release the session. Idempotent. */
  teardown(): Promise<void>;
  /** Replay/recording URL, best effort, after teardown. */
  replayUrl(): Promise<string | undefined>;
}

export interface SeatDriverEvents {
  /** Live frame for the isometric CRT (small JPEG). */
  onFrame?: (jpeg: Buffer, w: number, h: number) => void;
  onLog?: (level: "info" | "warn" | "error", text: string) => void;
}

/** Map Claude's xdotool-style key names to Playwright key names. */
export const XDO_TO_PLAYWRIGHT: Record<string, string> = {
  return: "Enter",
  enter: "Enter",
  kp_enter: "Enter",
  tab: "Tab",
  escape: "Escape",
  esc: "Escape",
  backspace: "Backspace",
  delete: "Delete",
  space: " ",
  ctrl: "Control",
  control: "Control",
  alt: "Alt",
  shift: "Shift",
  super: "Meta",
  meta: "Meta",
  cmd: "Meta",
  win: "Meta",
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  page_down: "PageDown",
  pagedown: "PageDown",
  page_up: "PageUp",
  pageup: "PageUp",
  home: "Home",
  end: "End",
  insert: "Insert",
  minus: "-",
  plus: "+",
  equal: "=",
  comma: ",",
  period: ".",
  slash: "/",
  backslash: "\\",
  semicolon: ";",
  apostrophe: "'",
  grave: "`",
  bracketleft: "[",
  bracketright: "]",
};

export function toPlaywrightKey(k: string): string {
  const lower = k.toLowerCase();
  if (XDO_TO_PLAYWRIGHT[lower]) return XDO_TO_PLAYWRIGHT[lower];
  if (/^f\d{1,2}$/i.test(k)) return k.toUpperCase();
  if (k.length === 1) return k;
  // Capitalised single words like "Shift_L" -> "Shift"
  const base = k.replace(/_[LR]$/, "");
  return XDO_TO_PLAYWRIGHT[base.toLowerCase()] ?? base;
}

/** "ctrl+shift+t" -> "Control+Shift+T" */
export function toPlaywrightChord(text: string): string {
  return text
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean)
    .map(toPlaywrightKey)
    .join("+");
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function coord(input: Record<string, unknown>, key = "coordinate"): [number, number] | undefined {
  const c = input[key];
  if (Array.isArray(c) && c.length === 2 && typeof c[0] === "number" && typeof c[1] === "number") {
    return [c[0], c[1]];
  }
  return undefined;
}
