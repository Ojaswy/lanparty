/**
 * LANPARTY.EXE — shared contract between the server (Solari + Claude) and the
 * web client (the isometric LAN room). Everything the UI renders comes from
 * these types, whether the seats are real cloud browsers/desktops or demo
 * replays.
 */

/** Which Solari product backs a seat. */
export type SeatKind = "browser" | "desktop";

/** How a run decides whether a seat passed. */
export type SuccessCheck =
  | { type: "url_contains"; value: string }
  | { type: "text_present"; value: string }
  | { type: "selector_present"; value: string }
  | {
      /** GET `${url}` (with `{seat}` replaced by the seat's key) → `{ pass: boolean, detail?: string }`. */
      type: "grader_endpoint";
      url: string;
    }
  | {
      /** Claude looks at the final screenshot + instruction and returns pass/fail. */
      type: "llm_judge";
      rubric: string;
    };

export interface TaskDef {
  id: string;
  name: string;
  /** One-line description shown on the task card. */
  blurb: string;
  kind: SeatKind;
  /** For browser seats: page to open first. Supports `{seat}` and `{run}` placeholders. */
  startUrl?: string;
  /** For desktop seats: app to open (`google-chrome`, `libreoffice`, ...) and optional args. */
  openApp?: { name: string; args?: string[] };
  /** The instruction handed to the agent. */
  instruction: string;
  successCheck: SuccessCheck;
  /** Hard cap on agent actions per seat. */
  maxSteps: number;
  /** Solari browser profile to start from (identical logged-in state for every seat). */
  profileId?: string;
  /** Solari desktop template (`default`, `office`, `code`). */
  desktopTemplate?: string;
  /** Needs the built-in insurance portal to be hosted in a Solari sandbox first. */
  needsPortal?: boolean;
  /** Stealth mode for browser seats (required for proxies/captcha; slower). */
  stealth?: boolean;
  /** Tags shown on the card ("real site", "pinetree", "office"). */
  tags?: string[];
}

export type SeatStatus =
  | "queued"
  | "booting"
  | "running"
  | "grading"
  | "pass"
  | "fail"
  | "error"
  | "cancelled";

/** One agent action, normalised so the divergence report can compare seats. */
export interface StepAction {
  /** Member name from the computer toolset: left_click, type, key, scroll, screenshot, ... */
  name: string;
  /** Raw tool input as Claude sent it. */
  input: Record<string, unknown>;
}

export interface Step {
  n: number;
  at: number;
  action: StepAction;
  /** What the agent said before acting (its "thought bubble"). */
  note?: string;
  /** Page URL after the action (browser seats). */
  url?: string;
  /** Tiny JPEG (base64, ~160px wide) of the screen after the action, for the step tape. */
  thumb?: string;
  /** Normalised token used by the divergence report, e.g. `click@2,3` or `type`. */
  token: string;
  /** What was under the cursor for click actions: the element's label ("Submit Appeal"). */
  target?: string;
  /** Set when the seat's tool execution failed. */
  error?: string;
}

export interface SeatUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface Seat {
  index: number;
  /** Stable key used in URLs and grader endpoints, e.g. `run_ab12-3`. */
  key: string;
  kind: SeatKind;
  status: SeatStatus;
  /** Model powering this seat (a run can mix models for A/B). */
  model: string;
  /** Sprite variant so every seat has a distinct pixel kid. */
  sprite: number;
  sessionId?: string;
  /**
   * In-app replay page (`/replay/<run>/<seat>`), available once the seat's
   * rrweb recording (browser) or mp4 (desktop) has been downloaded from Solari.
   * Solari's own replay URLs are presigned and expire, so we persist the data.
   */
  replayUrl?: string;
  /** Raw rrweb NDJSON download (`/api/runs/:id/seats/:n/replay.ndjson`), browser seats only. */
  replayNdjsonUrl?: string;
  /** Downloaded desktop recording (`/api/runs/:id/seats/:n/recording.mp4`), desktop seats only. */
  recordingUrl?: string;
  /**
   * Live VNC view for desktop seats, as a same-origin websocket PATH
   * (`/ws/stream/<run>/<seat>`). The server relays the RFB bytes and drops
   * input, so the signed Solari stream URL never reaches a browser.
   */
  streamUrl?: string;
  steps: Step[];
  startedAt?: number;
  finishedAt?: number;
  /** Final verdict detail from the success check. */
  verdict?: string;
  error?: string;
  usage: SeatUsage;
  /** Last thing the agent said (rendered as a speech bubble). */
  bubble?: string;
}

export type RunStatus = "booting" | "running" | "done" | "cancelled";

export interface DivergenceEntry {
  seat: number;
  /** 1-based step where this seat first left the majority path; null if it never diverged (or never acted). */
  step: number | null;
  majorityToken?: string;
  seatToken?: string;
  /** Human sentence: "Clicked the Cancel button instead of Next on page 3". */
  summary?: string;
}

export interface DivergenceReport {
  /** Per-step plurality token across passing seats. */
  majorityPath: string[];
  passingSeats: number[];
  entries: DivergenceEntry[];
}

export interface RunSummary {
  k: number;
  pass: number;
  fail: number;
  /** Seats that never produced a gradable outcome (crash, refusal, cancelled). Not counted in passRate. */
  error: number;
  /** pass / (pass + fail): the reliability estimate over graded seats. */
  passRate: number;
  /**
   * pass^j for j = 1, 2, 4, 8: the probability that j fresh trials ALL pass,
   * estimated without bias as C(c, j) / C(n, j) over c passes in n graded
   * seats (the tau-bench estimator). Only entries with j <= n are present.
   */
  passK: Record<string, number>;
  /** True when the party stopped early because it hit the cost ceiling. */
  costCeilingHit?: boolean;
  medianSteps: number | null;
  medianMs: number | null;
  totalCostUsd: number;
  /** Seat boot time: time from run start until every seat had its first screenshot. */
  bootMs: number | null;
}

export interface Run {
  id: string;
  task: TaskDef;
  /** Default model for seats. */
  model: string;
  k: number;
  status: RunStatus;
  /** true when seats are demo replays rather than live Solari sessions. */
  demo: boolean;
  seats: Seat[];
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  summary?: RunSummary;
  divergence?: DivergenceReport;
  /** Public URL of the sandbox-hosted portal, when the task needs it. */
  portalUrl?: string;
  /** Free-text label ("claude-opus-5 vs claude-sonnet-5"), optional. */
  label?: string;
  agent: "builtin" | "external";
}

export interface CreateRunRequest {
  taskId?: string;
  /**
   * Who drives the seats. `builtin` (default) is the server's computer-use
   * agent; `external` boots the seats and hands out CDP endpoints so any
   * agent, in any language, can sit down (see GET /api/runs/:id/seats).
   */
  agent?: "builtin" | "external";
  /** Inline task (custom URL + instruction). */
  task?: Partial<TaskDef> & Pick<TaskDef, "instruction">;
  k: number;
  model?: string;
  /** Number of desktop "premium seats" to include (0-2 on Starter). Browser tasks only. */
  desktopSeats?: number;
  label?: string;
}

export interface ServerInfo {
  demo: boolean;
  hasSolariKey: boolean;
  hasAnthropicKey: boolean;
  defaultModel: string;
  /** Selectable models; names not starting with `claude-` route to the OpenAI-compatible provider. */
  models: string[];
  /** Rough $ per seat per model (25-step task), for the START button's estimate. */
  costPerSeatUsd: Record<string, number>;
  costCeilingUsd: number;
  maxK: number;
  maxDesktopSeats: number;
  tasks: TaskDef[];
  publicUrl: string;
}
