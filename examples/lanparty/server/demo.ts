/**
 * DEMO MODE — no keys, no credits, same code paths.
 *
 * Seats replay scripted trajectories instead of driving real Solari sessions.
 * Frames are rendered here (SVG → JPEG via sharp) to look like the insurance
 * portal pages, so the room, scoreboard, step tape and divergence report all
 * light up exactly as they would for a live party. Every demo run is stamped
 * `demo: true` and the UI says so; nothing here pretends to be a real result.
 */
import sharp from "sharp";
import type { Run, Seat, Step, StepAction } from "../shared/types.js";
import type { Bus } from "./bus.js";
import { stepToken } from "./divergence.js";

const W = 1280;
const H = 800;

interface DemoStep {
  action: StepAction;
  note?: string;
  page: PageId;
  url?: string;
  /** Element under the cursor, as a real browser seat would record it. */
  target?: string;
}

type PageId = "notice" | "home" | "s1" | "s1filled" | "s2" | "s2filled" | "s3top" | "s3bottom" | "done" | "cancelled" | "draft" | "status" | "generic" | "generic2" | "genericDone";

function click(x: number, y: number, note?: string, page: PageId = "home", url?: string, target?: string): DemoStep {
  return { action: { name: "left_click", input: { coordinate: [x, y] } }, note, page, url, target };
}
function type(text: string, page: PageId, note?: string): DemoStep {
  return { action: { name: "type", input: { text } }, note, page };
}
function key(text: string, page: PageId, note?: string): DemoStep {
  return { action: { name: "key", input: { text } }, note, page };
}
function scroll(page: PageId, note?: string): DemoStep {
  return { action: { name: "scroll", input: { coordinate: [640, 500], scroll_direction: "down", scroll_amount: 10 } }, note, page };
}

const PORTAL = "https://demo.portal.local";

/** The path the passing majority takes through the portal. */
const HAPPY: DemoStep[] = [
  click(640, 452, "There's a portal notice modal. Acknowledging it first.", "home", undefined, "button:I Acknowledge"),
  click(322, 610, "The denial letter says to file an appeal citing the authorization number. Clicking File an Appeal.", "s1", `${PORTAL}/#appeal/1`, "button:File an Appeal"),
  click(520, 262, "Entering the claim number exactly as printed.", "s1", undefined, "input:claimNumber"),
  type("CLM-2026-004471", "s1"),
  click(444, 322, "Setting the patient's date of birth from the letter: 03/14/1957.", "s1", undefined, "select:dobMonth"),
  type("March", "s1"),
  click(560, 322, undefined, "s1", undefined, "select:dobDay"),
  type("14", "s1"),
  click(676, 322, undefined, "s1filled", undefined, "select:dobYear"),
  type("1957", "s1filled"),
  click(430, 420, "Not 'Save Draft' — that only saves. Continue is the plain button.", "s2", `${PORTAL}/#appeal/2`, "button:Continue"),
  click(520, 268, "Choosing the reason that matches the provider notes: precertification was obtained.", "s2", undefined, "select:reason"),
  type("Precert", "s2"),
  key("Return", "s2"),
  click(560, 380, "Writing the justification and citing auth PA-88213.", "s2", undefined, "textarea:justification"),
  type("Prior authorization PA-88213 was obtained by phone on 07/15/2026 for the 07/22/2026 service. Denial CO-197 is in error.", "s2filled"),
  click(268, 470, "Attesting that records are attached.", "s2filled", undefined, "input:attest"),
  click(430, 540, undefined, "s3top", `${PORTAL}/#appeal/3`, "button:Continue"),
  scroll("s3bottom", "The submit button is below the terms. Scrolling down."),
  click(760, 690, "Two buttons: 'Cancel Appeal' looks primary but I want the gray 'Submit Appeal'.", "done", `${PORTAL}/#appeal/done`, "button:Submit Appeal"),
];

type Outcome = "pass" | "cancel-trap" | "draft-trap" | "dob-wrong" | "error" | "generic-pass" | "generic-fail";

function scriptFor(outcome: Outcome): { steps: DemoStep[]; final: "pass" | "fail" | "error"; verdict: string; finalText: string } {
  switch (outcome) {
    case "pass":
      return { steps: HAPPY, final: "pass", verdict: "Appeal filed correctly", finalText: "DONE: The portal shows appeal reference APL-410233." };
    case "cancel-trap": {
      const steps = [...HAPPY.slice(0, 19), click(556, 690, "Clicking the blue button to submit the appeal.", "cancelled", `${PORTAL}/#home`, "button:Cancel Appeal"), click(322, 610, "Hmm, I'm back on the home page. Starting the appeal again.", "s1", `${PORTAL}/#appeal/1`, "button:File an Appeal")];
      return { steps, final: "fail", verdict: "No submission found for this seat", finalText: "GIVE UP: The appeal form keeps returning to the home page after I submit." };
    }
    case "draft-trap": {
      const steps = [...HAPPY.slice(0, 10), click(300, 420, "Clicking the green Save Draft button to proceed.", "draft", undefined, "button:Save Draft"), click(300, 420, "It says draft saved. Clicking again to continue.", "draft", undefined, "button:Save Draft"), click(300, 420, "Still on step 1. Trying once more.", "draft", undefined, "button:Save Draft")];
      return { steps, final: "fail", verdict: "No submission found for this seat", finalText: "GIVE UP: The form will not advance past step 1." };
    }
    case "dob-wrong": {
      const steps = [...HAPPY];
      steps[7] = type("15", "s1", "Setting the day to 15.");
      return { steps, final: "fail", verdict: "Patient DOB does not match the claim (expected 03/14/1957)", finalText: "DONE: The portal shows appeal reference APL-410240." };
    }
    case "error":
      return { steps: HAPPY.slice(0, 4), final: "error", verdict: "", finalText: "" };
    case "generic-pass":
      return {
        steps: [click(640, 300, "Reading the page and starting the task.", "generic", undefined, "input:search"), type("hello", "generic"), key("Return", "generic2"), click(600, 420, "Almost there.", "generic2", undefined, "button:Add to cart"), click(640, 520, "Finishing.", "genericDone", undefined, "button:Finish")],
        final: "pass",
        verdict: "Success check satisfied",
        finalText: "DONE: The task is complete.",
      };
    case "generic-fail":
      return {
        steps: [click(640, 300, "Reading the page and starting the task.", "generic", undefined, "input:search"), click(300, 300, "Trying a different link.", "generic", undefined, "a:Item 1"), scroll("generic2", "Looking for the right control."), click(640, 520, "This should do it.", "generic2", undefined, "button:Cancel")],
        final: "fail",
        verdict: "Success check not satisfied",
        finalText: "DONE: I believe the task is complete.",
      };
  }
}

/** Deterministic per-seat RNG so demo runs are reproducible. */
function rng(seed: string): () => number {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickOutcome(run: Run, seat: Seat): Outcome {
  const r = rng(`${run.id}:${seat.index}`)();
  const portal = run.task.needsPortal;
  if (!portal) return r < 0.7 ? "generic-pass" : "generic-fail";
  if (r < 0.65) return "pass";
  if (r < 0.82) return "cancel-trap";
  if (r < 0.9) return "draft-trap";
  if (r < 0.96) return "dob-wrong";
  return "error";
}

// ---------- frame rendering ----------

const frameCache = new Map<string, Promise<Buffer>>();

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function portalSvg(page: PageId, seat: Seat): string {
  const header = `<rect width="${W}" height="${H}" fill="#ffffff"/><rect width="${W}" height="54" fill="#000080"/><text x="24" y="36" font-family="Verdana, sans-serif" font-size="22" fill="#fff" font-weight="bold">MERIDIAN MUTUAL — Provider Services Portal</text><rect y="54" width="${W}" height="28" fill="#ffffcc"/><text x="24" y="73" font-family="Verdana" font-size="13" fill="#000">Your session will expire in 14:${String(59 - (seat.index % 40)).padStart(2, "0")}. Please save your work.</text>`;
  const btn = (x: number, y: number, w: number, label: string, primary = false) =>
    `<rect x="${x}" y="${y}" width="${w}" height="30" fill="${primary ? "#0a52c9" : "#c0c0c0"}" stroke="${primary ? "#031f4f" : "#404040"}"/><text x="${x + w / 2}" y="${y + 20}" text-anchor="middle" font-family="Verdana" font-size="13" fill="${primary ? "#fff" : "#000"}" font-weight="${primary ? "bold" : "normal"}">${esc(label)}</text>`;
  const field = (x: number, y: number, w: number, value = "") => `<rect x="${x}" y="${y}" width="${w}" height="26" fill="#fff" stroke="#808080"/><text x="${x + 6}" y="${y + 18}" font-family="Verdana" font-size="13" fill="#000">${esc(value)}</text>`;
  const label = (x: number, y: number, t: string, size = 13, bold = false) => `<text x="${x}" y="${y}" font-family="Verdana" font-size="${size}" fill="#000" font-weight="${bold ? "bold" : "normal"}">${esc(t)}</text>`;
  const stepBar = (n: number) => `<text x="24" y="120" font-family="Verdana" font-size="18" fill="#000080" font-weight="bold">Appeal — Step ${n} of 3</text><rect x="24" y="130" width="600" height="6" fill="#c0c0c0"/><rect x="24" y="130" width="${200 * n}" height="6" fill="#000080"/>`;

  const homeBody = `${label(24, 120, "DENIAL NOTICE", 18, true)}<rect x="24" y="140" width="700" height="360" fill="#f5f5f5" stroke="#808080"/>${label(40, 170, "Claim Number: CLM-2026-004471")}${label(40, 195, "Patient: Dolores P. Whitfield   DOB 03/14/1957")}${label(40, 220, "Date of Service: 07/22/2026     Billed: $4,860.00")}${label(40, 245, "Denial Reason: CO-197 — Precertification/authorization absent", 13, true)}${label(40, 285, "Our records indicate no precertification on file. If a valid")}${label(40, 305, "authorization exists, file an appeal and cite the authorization number.")}<rect x="40" y="330" width="660" height="80" fill="#ffffe0" stroke="#808080"/>${label(52, 355, "Provider notes (internal)", 12, true)}${label(52, 380, "Prior authorization WAS obtained: Auth # PA-88213, approved 07/15/2026 by phone.")}${btn(240, 595, 170, "File an Appeal")}${btn(430, 595, 170, "Check Claim Status")}${btn(620, 595, 120, "Print Letter")}`;

  switch (page) {
    case "notice":
    case "home":
      return `${header}${homeBody}${page === "notice" ? `<rect width="${W}" height="${H}" fill="#000" opacity="0.35"/><rect x="390" y="300" width="500" height="200" fill="#c0c0c0" stroke="#000"/><rect x="392" y="302" width="496" height="24" fill="#000080"/><text x="400" y="319" font-family="Verdana" font-size="13" fill="#fff" font-weight="bold">PORTAL NOTICE</text>${label(410, 360, "This portal is for contracted providers only.")}${label(410, 385, "Do not share your session.")}${btn(560, 437, 160, "I Acknowledge")}${btn(730, 437, 130, "Exit Portal")}` : ""}`;
    case "s1":
    case "s1filled":
    case "draft": {
      const filled = page !== "s1";
      return `${header}${stepBar(1)}${label(24, 180, "Claim Lookup", 16, true)}${label(24, 270, "Claim Number:")}${field(180, 250, 360, filled ? "CLM-2026-004471" : "")}${label(24, 330, "Patient DOB:")}${field(180, 310, 110, filled ? "March" : "Month")}${field(300, 310, 90, filled ? "14" : "Day")}${field(400, 310, 110, filled ? "1957" : "Year")}<rect x="180" y="405" width="180" height="32" fill="#2e8b2e" stroke="#003300"/><text x="270" y="426" text-anchor="middle" font-family="Verdana" font-size="14" fill="#fff" font-weight="bold">Save Draft</text>${btn(380, 406, 120, "Continue")}${page === "draft" ? `${label(180, 470, "Draft saved at 14:02. You may continue later.", 13, true)}` : ""}`;
    }
    case "s2":
    case "s2filled": {
      const filled = page === "s2filled";
      return `${header}${stepBar(2)}${label(24, 180, "Appeal Details", 16, true)}${label(24, 275, "Reason for appeal:")}${field(180, 255, 420, filled ? "Precertification was obtained (authorization on file)" : "-- select --")}${label(24, 340, "Justification:")}<rect x="180" y="320" width="560" height="110" fill="#fff" stroke="#808080"/>${filled ? `${label(188, 345, "Prior authorization PA-88213 was obtained by phone on")}${label(188, 365, "07/15/2026 for the 07/22/2026 service. Denial CO-197 is in error.")}` : ""}<rect x="180" y="460" width="16" height="16" fill="#fff" stroke="#000"/>${filled ? `<text x="182" y="474" font-family="Verdana" font-size="14" fill="#000">✓</text>` : ""}${label(204, 474, "I attest that supporting records are attached to this appeal")}${btn(180, 525, 100, "Back")}${btn(380, 525, 120, "Continue")}`;
    }
    case "s3top":
      return `${header}${stepBar(3)}${label(24, 180, "Review & Submit", 16, true)}<rect x="24" y="200" width="700" height="150" fill="#f5f5f5" stroke="#808080"/>${label(40, 230, "Claim: CLM-2026-004471    DOB: 03/14/1957")}${label(40, 255, "Reason: Precertification was obtained (authorization on file)")}${label(40, 280, "Justification: Prior authorization PA-88213 was obtained by phone…")}${label(40, 305, "Records attached: Yes")}${label(24, 390, "Terms and Conditions", 14, true)}${Array.from({ length: 16 }, (_, i) => label(24, 415 + i * 22, "Provider agrees that the information submitted is accurate and complete to the best of their knowledge and belief and that…")).join("")}`;
    case "s3bottom":
      return `${header}${Array.from({ length: 24 }, (_, i) => label(24, 100 + i * 22, "…the plan may request additional documentation. Appeals are reviewed within 30 days of receipt as required by applicable law and…")).join("")}<rect x="24" y="640" width="1232" height="2" fill="#808080"/>${btn(480, 675, 150, "Cancel Appeal", true)}${btn(680, 675, 150, "Submit Appeal")}`;
    case "done":
      return `${header}<text x="24" y="200" font-family="Verdana" font-size="26" fill="#006400" font-weight="bold">Appeal received.</text>${label(24, 250, `Reference number: APL-41${String(200 + seat.index * 7).padStart(4, "0")}`, 20, true)}${label(24, 300, "A determination letter will be mailed within 30 days.")}${btn(24, 340, 160, "Return to Home")}`;
    case "cancelled":
      return `${header}${homeBody}<rect x="24" y="90" width="500" height="22" fill="#ffe0e0"/>${label(30, 106, "Appeal cancelled. No appeal was submitted.", 12, true)}`;
    case "status":
      return `${header}${label(24, 120, "Claim Status", 18, true)}${label(24, 170, "No records found for the selected provider.")}`;
    case "generic":
    case "generic2":
    case "genericDone": {
      const t = seat.index % 3;
      const title = ["Sauce Labs Demo Store", "Wikipedia, the free encyclopedia", "todos"][t];
      return `<rect width="${W}" height="${H}" fill="#fff"/><rect width="${W}" height="70" fill="${["#1b2a3a", "#f6f6f6", "#f5f5f5"][t]}"/><text x="24" y="44" font-family="Verdana" font-size="22" fill="${t === 0 ? "#fff" : "#222"}" font-weight="bold">${esc(title)}</text>${Array.from({ length: 6 }, (_, i) => `<rect x="${60 + (i % 3) * 400}" y="${120 + Math.floor(i / 3) * 300}" width="340" height="240" fill="#fafafa" stroke="#ddd"/><rect x="${80 + (i % 3) * 400}" y="${140 + Math.floor(i / 3) * 300}" width="300" height="140" fill="#e6e6e6"/><text x="${80 + (i % 3) * 400}" y="${310 + Math.floor(i / 3) * 300}" font-family="Verdana" font-size="14" fill="#333">Item ${i + 1}${page !== "generic" && i === 1 ? " — added" : ""}</text>`).join("")}${page === "genericDone" ? `<rect x="300" y="330" width="680" height="120" fill="#e8f5e9" stroke="#2e7d32"/><text x="640" y="400" text-anchor="middle" font-family="Verdana" font-size="26" fill="#2e7d32" font-weight="bold">Thank you for your order!</text>` : ""}`;
    }
  }
}

async function renderFrame(page: PageId, seat: Seat): Promise<Buffer> {
  const key = `${page}:${seat.index % 8}`;
  let p = frameCache.get(key);
  if (!p) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${portalSvg(page, seat)}</svg>`;
    p = sharp(Buffer.from(svg)).resize(320, 200).jpeg({ quality: 50 }).toBuffer();
    frameCache.set(key, p);
  }
  return p;
}

export interface DemoHooks {
  bus: Bus;
  signal: AbortSignal;
  onStatus: () => void;
  onFirstFrame: () => void;
  touch: () => void;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    });
  });

export async function runDemoSeat(run: Run, seat: Seat, hooks: DemoHooks): Promise<void> {
  const { bus, signal } = hooks;
  const rand = rng(`${run.id}:${seat.index}:t`);
  const outcome = pickOutcome(run, seat);
  const script = scriptFor(outcome);
  const stepsBudget = run.task.maxSteps;

  seat.status = "booting";
  seat.startedAt = Date.now();
  seat.sessionId = `demo_${run.id.slice(4)}_${seat.index}`;
  hooks.onStatus();
  await sleep(500 + rand() * 900, signal);

  const emitFrame = async (page: PageId) => {
    const jpeg = await renderFrame(page, seat);
    const b64 = jpeg.toString("base64");
    bus.emit({ type: "seat:frame", runId: run.id, seat: seat.index, jpeg: b64, w: 320, h: 200, at: Date.now() });
    return b64;
  };

  let lastFrame = await emitFrame(run.task.needsPortal ? "notice" : "generic");
  hooks.onFirstFrame();
  if (signal.aborted) {
    seat.status = "cancelled";
    hooks.onStatus();
    return;
  }
  seat.status = "running";
  hooks.onStatus();
  bus.log(run.id, "info", `seat ${seat.index} online (demo replay)`, seat.index);

  let n = 0;
  for (const ds of script.steps) {
    if (signal.aborted) break;
    if (n >= stepsBudget) break;
    await sleep(900 + rand() * 1600, signal);
    if (ds.note) {
      seat.bubble = ds.note;
      bus.emit({ type: "seat:bubble", runId: run.id, seat: seat.index, text: ds.note });
    }
    n++;
    const step: Step = {
      n,
      at: Date.now(),
      action: ds.action,
      note: ds.note,
      url: ds.url ?? seat.steps.at(-1)?.url,
      thumb: lastFrame,
      token: stepToken({ action: ds.action, url: ds.url ?? seat.steps.at(-1)?.url, target: ds.target }, W, H),
      target: ds.target,
    };
    seat.steps.push(step);
    seat.usage = {
      inputTokens: seat.usage.inputTokens + 2400 + Math.round(rand() * 800),
      outputTokens: seat.usage.outputTokens + 90 + Math.round(rand() * 60),
      costUsd: seat.usage.costUsd + 0.014 + rand() * 0.004,
    };
    bus.emit({ type: "seat:step", runId: run.id, seat: seat.index, step: { ...step, thumb: undefined }, usage: seat.usage });
    hooks.touch();
    lastFrame = await emitFrame(ds.page);
    if (outcome === "error" && n === script.steps.length) {
      await sleep(600, signal);
      seat.status = "error";
      seat.error = "session lost: browser disconnected (simulated)";
      seat.finishedAt = Date.now();
      hooks.onStatus();
      bus.log(run.id, "error", `seat ${seat.index} crashed: ${seat.error}`, seat.index);
      return;
    }
  }

  if (signal.aborted) {
    seat.status = "cancelled";
    seat.finishedAt = Date.now();
    hooks.onStatus();
    return;
  }

  seat.bubble = script.finalText;
  bus.emit({ type: "seat:bubble", runId: run.id, seat: seat.index, text: script.finalText });
  seat.status = "grading";
  hooks.onStatus();
  await sleep(700 + rand() * 600, signal);
  seat.status = script.final;
  seat.verdict = script.verdict;
  seat.finishedAt = Date.now();
  // No Solari session behind a demo seat, so no rrweb recording to replay.
  seat.replayUrl = undefined;
  hooks.onStatus();
  bus.log(run.id, "info", `seat ${seat.index} ${seat.status.toUpperCase()} — ${seat.verdict}`, seat.index);
}
