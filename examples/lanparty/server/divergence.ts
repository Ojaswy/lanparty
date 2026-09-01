/**
 * The Divergence Report: where did the failing runs leave the path the
 * passing runs took?
 *
 * Every step is normalised to a coarse token. For browser seats a click is
 * identified by the element under the cursor ("button:Submit Appeal"), so
 * pixel jitter between seats compares equal while "Cancel Appeal" vs
 * "Submit Appeal" does not. Without a DOM (desktop seats) we fall back to a
 * 10x10 screen grid.
 *
 * The reference path is the per-step plurality token across passing seats.
 * Each failing seat is aligned to it with a longest-common-subsequence so an
 * extra scroll or a repeated click doesn't count as divergence; the first
 * seat step that is NOT part of the alignment is where it left the path.
 * The label is "first split from the majority path", never "the bug".
 */
import type { DivergenceEntry, DivergenceReport, Seat, Step, StepAction } from "../shared/types.js";

const GRID = 10; // 10x10 cells over the screen

export function tokenize(action: StepAction, width: number, height: number, urlAfter?: string, target?: string): string {
  const input = action.input ?? {};
  const cell = (xy: unknown): string => {
    if (!Array.isArray(xy) || xy.length !== 2) return "?";
    const gx = Math.max(0, Math.min(GRID - 1, Math.floor((Number(xy[0]) / width) * GRID)));
    const gy = Math.max(0, Math.min(GRID - 1, Math.floor((Number(xy[1]) / height) * GRID)));
    return `${gx},${gy}`;
  };
  const where = (xy: unknown) => (target ? `[${target}]` : `@${cell(xy)}`);
  const path = (() => {
    if (!urlAfter) return "";
    try {
      const u = new URL(urlAfter);
      return `→${u.pathname.replace(/\/+$/, "") || "/"}${u.hash ? u.hash.slice(0, 16) : ""}`;
    } catch {
      return "";
    }
  })();

  switch (action.name) {
    case "left_click":
    case "double_click":
    case "triple_click":
    case "right_click":
    case "middle_click":
      return `${action.name.replace("_click", "")}${where(input.coordinate)}${path}`;
    case "left_click_drag":
      return `drag@${cell(input.start_coordinate)}>${cell(input.coordinate)}`;
    case "type": {
      const t = String(input.text ?? "");
      // Content matters (typing "Mario" vs "Luigi" into the same field) but
      // don't leak long strings into the report.
      return `type:${t.length > 24 ? t.slice(0, 24) + "…" : t}`;
    }
    case "key":
      return `key:${String(input.text ?? "").toLowerCase()}${path}`;
    case "scroll":
      return `scroll:${String(input.scroll_direction ?? "down")}`;
    case "screenshot":
    case "zoom":
    case "cursor_position":
    case "mouse_move":
    case "wait":
      return ""; // observation-only, not part of the path
    default:
      return action.name;
  }
}

/** Steps that change state (observation-only actions are dropped). Returns [token, original step index]. */
export function pathOf(seat: Seat): Array<{ token: string; stepIndex: number }> {
  return seat.steps.map((s, i) => ({ token: s.token, stepIndex: i })).filter((t) => t.token.length > 0);
}

function plurality(tokens: string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
  let best: string | undefined;
  let bestN = 0;
  for (const [t, n] of counts) {
    if (n > bestN) {
      best = t;
      bestN = n;
    }
  }
  return best;
}

/** LCS alignment: returns, for each index of `a`, the matched index in `b` or -1. */
export function lcsAlign(a: string[], b: string[]): number[] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const match = new Array<number>(n).fill(-1);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      match[i] = j;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return match;
}

export function buildDivergence(seats: Seat[]): DivergenceReport {
  const passing = seats.filter((s) => s.status === "pass");
  const reference = passing.length ? passing : seats.filter((s) => s.steps.length > 0);
  const paths = reference.map((s) => pathOf(s).map((p) => p.token));
  const maxLen = Math.max(0, ...paths.map((p) => p.length));
  const majorityPath: string[] = [];
  for (let i = 0; i < maxLen; i++) {
    const present = paths.map((p) => p[i]).filter((x): x is string => typeof x === "string");
    // Stop once a strict majority of the reference seats has finished, so a
    // single long-winded seat can't extend the "majority" path on its own.
    if (present.length * 2 <= paths.length) break;
    const t = plurality(present);
    if (t === undefined) break;
    majorityPath.push(t);
  }

  const entries: DivergenceEntry[] = seats.map((seat) => {
    const p = pathOf(seat);
    const tokens = p.map((x) => x.token);
    if (seat.status === "pass") return { seat: seat.index, step: null };
    if (tokens.length === 0) return { seat: seat.index, step: null, summary: seat.error ? `Never acted: ${seat.error}` : "Never acted" };

    const match = lcsAlign(tokens, majorityPath);
    // First seat step that isn't part of the common subsequence.
    const firstUnmatched = match.findIndex((m) => m === -1);
    if (firstUnmatched !== -1) {
      const lastMatched = firstUnmatched === 0 ? -1 : match[firstUnmatched - 1];
      const theirs = majorityPath[lastMatched + 1];
      const mine = tokens[firstUnmatched];
      const stepNo = p[firstUnmatched].stepIndex + 1;
      const summary = theirs ? `${capitalize(describe(mine))} instead of ${describe(theirs)}` : `Kept going past the majority's finish line: ${describe(mine)}`;
      return { seat: seat.index, step: stepNo, majorityToken: theirs, seatToken: mine, summary };
    }
    // Everything the seat did is on the majority path: it stopped short.
    const lastMatched = match.length ? match[match.length - 1] : -1;
    const theirs = majorityPath[lastMatched + 1];
    if (theirs) {
      return { seat: seat.index, step: tokens.length + 1, majorityToken: theirs, seatToken: undefined, summary: `Stopped after ${tokens.length} step(s); the majority went on to ${describe(theirs)}` };
    }
    return { seat: seat.index, step: null, summary: "Same path as the majority, different outcome (timing or page state)" };
  });

  return { majorityPath, passingSeats: passing.map((s) => s.index), entries };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Turn a token back into words for the report. */
export function describe(token?: string): string {
  if (!token) return "nothing";
  const m = /^(left|double|triple|right|middle)(?:\[(.*?)\]|@([\d,]+))(→.*)?$/.exec(token);
  if (m) {
    const verb = m[1] === "left" ? "clicked" : m[1] === "double" ? "double-clicked" : m[1] === "triple" ? "triple-clicked" : `${m[1]}-clicked`;
    const what = m[2] ? `"${m[2].replace(/^(button|a|input|select|textarea|label|summary|div|span|li|td):/, "")}"` : `screen area ${m[3]}`;
    const nav = m[4] ? ` (→ ${m[4].slice(1)})` : "";
    return `${verb} ${what}${nav}`;
  }
  if (token.startsWith("drag@")) return `dragged ${token.slice(5)}`;
  if (token.startsWith("type:")) return `typed "${token.slice(5)}"`;
  if (token.startsWith("key:")) return `pressed ${token.slice(4).split("→")[0]}`;
  if (token.startsWith("scroll:")) return `scrolled ${token.slice(7)}`;
  return token;
}

export function stepToken(step: Pick<Step, "action" | "url" | "target">, width: number, height: number): string {
  return tokenize(step.action, width, height, step.url, step.target);
}
