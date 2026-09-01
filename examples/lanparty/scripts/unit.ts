// Unit checks for the pure parts: pass^k estimator, LCS divergence, RFB input filter.
// `npm run test:unit`
import { buildDivergence, describe, lcsAlign } from "../server/divergence.js";
import { ClientFilter } from "../server/streamRelay.js";
import { choose, passKCurve, passPow } from "../server/util.js";
import type { Seat } from "../shared/types.js";

let failed = 0;
const eq = (got: unknown, want: unknown, msg: string) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"} ${msg}${ok ? "" : `\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`}`);
  if (!ok) failed++;
};

// ---- pass^k (tau-bench estimator) ----
eq(choose(20, 4), 4845, "C(20,4)");
eq(+passPow(13, 20, 4).toFixed(4), +(715 / 4845).toFixed(4), "pass^4 for 13/20 is 14.76% (unbiased), not 17.85% (naive)");
eq(passKCurve(13, 20), { "1": 0.65, "2": 78 / 190, "4": 715 / 4845, "8": choose(13, 8) / choose(20, 8) }, "curve at j = 1, 2, 4, 8");
eq(Object.keys(passKCurve(3, 6)), ["1", "2", "4"], "j > n omitted");
eq(passKCurve(0, 0), {}, "no graded seats → empty curve");

// ---- LCS alignment ----
eq(lcsAlign(["a", "b", "x", "c"], ["a", "b", "c"]), [0, 1, -1, 2], "extra seat step is unmatched");
eq(lcsAlign(["a", "c"], ["a", "b", "c"]), [0, 2], "missing step aligns around it");

// ---- divergence report ----
const mk = (i: number, status: Seat["status"], tokens: string[]): Seat => ({
  index: i,
  key: `s${i}`,
  kind: "browser",
  status,
  model: "m",
  sprite: 0,
  steps: tokens.map((t, n) => ({ n: n + 1, at: 0, action: { name: "left_click", input: {} }, token: t })),
  usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
});
const rep = buildDivergence([
  mk(0, "pass", ["left[button:A]", "left[button:B]", "left[button:Submit]"]),
  mk(1, "pass", ["left[button:A]", "scroll:down", "left[button:B]", "left[button:Submit]"]),
  mk(2, "fail", ["left[button:A]", "left[button:B]", "left[button:Cancel]"]),
  mk(3, "fail", ["left[button:A]", "left[button:B]"]),
  mk(4, "fail", ["scroll:down", "left[button:A]", "left[button:B]", "left[button:Submit]"]),
  mk(5, "error", []),
]);
eq(rep.majorityPath, ["left[button:A]", "left[button:B]", "left[button:Submit]"], "majority path stops when half the seats are done");
eq(rep.entries[2], { seat: 2, step: 3, majorityToken: "left[button:Submit]", seatToken: "left[button:Cancel]", summary: 'Clicked "Cancel" instead of clicked "Submit"' }, "wrong click at step 3");
eq(rep.entries[3].summary, 'Stopped after 2 step(s); the majority went on to clicked "Submit"', "stopped short");
eq(rep.entries[4].step, 1, "extra scroll before A is flagged at step 1");
eq(rep.entries[5].summary, "Never acted", "seat with no steps");
eq(rep.passingSeats, [0, 1], "passing seats listed");
eq(describe("left@3,5→/#appeal/2"), "clicked screen area 3,5 (→ /#appeal/2)", "grid fallback wording");
eq(describe("type:CLM-2026-004471"), 'typed "CLM-2026-004471"', "type wording");
const zeroPass = buildDivergence([mk(0, "fail", ["left[button:A]"]), mk(1, "fail", ["left[button:A]", "left[button:B]"])]);
eq(zeroPass.majorityPath, ["left[button:A]"], "with zero passes the reference is the seats that acted");

// ---- RFB client filter (view-only enforcement) ----
const f = new ClientFilter();
const version = Buffer.from("RFB 003.008\n");
const security = Buffer.from([1]); // None
const init = Buffer.from([1]); // shared
const setPixelFormat = Buffer.alloc(20, 0);
const setEncodings = Buffer.concat([Buffer.from([2, 0, 0, 2]), Buffer.from([0, 0, 0, 0, 0, 0, 0, 7])]);
const fbUpdate = Buffer.from([3, 0, 0, 0, 0, 0, 1, 0, 1, 0]);
const keyEvent = Buffer.from([4, 1, 0, 0, 0, 0, 0, 0x61]);
const pointerEvent = Buffer.from([5, 1, 0, 10, 0, 20]);
const cutText = Buffer.concat([Buffer.from([6, 0, 0, 0, 0, 0, 0, 2]), Buffer.from("hi")]);
const out1 = f.push(Buffer.concat([version, security, init, setPixelFormat, setEncodings]));
eq(out1.length, 12 + 1 + 1 + 20 + 12, "handshake + pixel format + encodings forwarded");
const out2 = f.push(Buffer.concat([keyEvent, pointerEvent, fbUpdate, cutText]));
eq([...out2], [...fbUpdate], "key, pointer and cut-text dropped; framebuffer request kept");
// Split a pointer event across two chunks: nothing should leak.
const g = new ClientFilter();
g.push(Buffer.concat([version, security, init]));
const partA = g.push(pointerEvent.subarray(0, 3));
const partB = g.push(Buffer.concat([pointerEvent.subarray(3), fbUpdate]));
eq([...partA, ...partB], [...fbUpdate], "fragmented pointer event dropped whole");

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
