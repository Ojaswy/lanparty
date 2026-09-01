/**
 * In-browser MOCK MODE (`?mock=1`): a fake ServerInfo, a fake k=8 run that
 * animates through every seat status over ~16s, fake JPEG frames painted on a
 * canvas (a 1998 insurance portal), steps with thumbs, bubbles, a 5/3
 * pass/fail split and a divergence report. Exercises every component
 * without the server.
 */
import type { CreateRunRequest, DivergenceEntry, DivergenceReport, Run, RunSummary, Seat, ServerInfo, Step, TaskDef } from "../../shared/types";
import type { ServerEvent } from "../../shared/protocol";

const MODELS = ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"];

const TASKS: TaskDef[] = [
  {
    id: "denial-appeal",
    name: "FILE THE APPEAL",
    blurb: "A 1998 insurance portal denied claim CLM-2026-004471. Read the letter, file the appeal, cite the auth number, survive the traps.",
    kind: "browser",
    startUrl: "{portal}/?seat={seat}",
    instruction: "File an appeal for claim CLM-2026-004471 through the Meridian Mutual provider portal and SUBMIT it (not save a draft, not cancel).",
    successCheck: { type: "grader_endpoint", url: "{portal}/state/{seat}" },
    maxSteps: 30,
    needsPortal: true,
    tags: ["pinetree", "forms", "traps"],
  },
  {
    id: "saucedemo-checkout",
    name: "BUY THE BACKPACK",
    blurb: "Log in to the Sauce Labs demo store, buy the backpack, finish checkout. Real site, real forms.",
    kind: "browser",
    startUrl: "https://www.saucedemo.com/",
    instruction: "Log in, add the backpack, check out.",
    successCheck: { type: "text_present", value: "Thank you for your order" },
    maxSteps: 25,
    tags: ["real site", "e-commerce"],
  },
  {
    id: "libreoffice-sum",
    name: "SUM IT UP (DESKTOP)",
    blurb: "A real Ubuntu desktop. Open LibreOffice Calc, type three numbers, put their sum below, save as sum.ods.",
    kind: "desktop",
    openApp: { name: "libreoffice", args: ["--calc"] },
    instruction: "Type 12, 30, 58 into A1:A3, sum them in A4, save as sum.ods.",
    successCheck: { type: "llm_judge", rubric: "A4 shows 100 and the file was saved." },
    maxSteps: 25,
    desktopTemplate: "default",
    tags: ["desktop", "office"],
  },
];

export function mockInfo(): ServerInfo {
  return {
    demo: true,
    hasSolariKey: false,
    hasAnthropicKey: true,
    defaultModel: MODELS[0],
    models: MODELS,
    costPerSeatUsd: { "claude-opus-5": 0.42, "claude-sonnet-5": 0.17, "claude-haiku-4-5": 0.08 },
    costCeilingUsd: 25,
    maxK: 20,
    maxDesktopSeats: 2,
    tasks: TASKS,
    publicUrl: location.origin,
  };
}

/* ---------- frame painter: a 1998 web form ---------- */

type Page = "notice" | "start" | "form1" | "form2" | "form3" | "review" | "done" | "cancelconfirm" | "cancelled" | "error";

interface Stage {
  page: Page;
  claim?: string;
  dob?: string;
  reason?: string;
  just?: string;
  attest?: boolean;
  dropdown?: boolean;
  cursor?: [number, number];
  focus?: "claim" | "dob" | null;
}

let paintCanvas: HTMLCanvasElement | null = null;

function paint(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, quality: number): string {
  if (!paintCanvas) paintCanvas = document.createElement("canvas");
  paintCanvas.width = w;
  paintCanvas.height = h;
  const ctx = paintCanvas.getContext("2d");
  if (!ctx) return "";
  ctx.save();
  ctx.scale(w / 320, h / 200);
  draw(ctx);
  ctx.restore();
  const url = paintCanvas.toDataURL("image/jpeg", quality);
  return url.slice(url.indexOf(",") + 1);
}

function bevelBox(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, sunken = false, fill = "#c0c0c0"): void {
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = sunken ? "#808080" : "#ffffff";
  ctx.fillRect(x, y, w, 1);
  ctx.fillRect(x, y, 1, h);
  ctx.fillStyle = sunken ? "#ffffff" : "#404040";
  ctx.fillRect(x, y + h - 1, w, 1);
  ctx.fillRect(x + w - 1, y, 1, h);
}

function button(ctx: CanvasRenderingContext2D, label: string, x: number, y: number, w: number, danger = false): void {
  bevelBox(ctx, x, y, w, 12);
  ctx.fillStyle = danger ? "#800000" : "#000";
  ctx.font = "7px Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + w / 2, y + 6.5);
  ctx.textAlign = "left";
}

function field(ctx: CanvasRenderingContext2D, label: string, value: string, x: number, y: number, w: number, focused = false): void {
  ctx.fillStyle = "#000";
  ctx.font = "7px Arial, sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x, y + 6);
  bevelBox(ctx, x + 70, y, w, 12, true, focused ? "#ffffe8" : "#ffffff");
  ctx.fillStyle = "#000";
  ctx.font = "7px 'Courier New', monospace";
  ctx.fillText(value, x + 73, y + 6.5);
  if (focused) {
    ctx.fillRect(x + 73 + ctx.measureText(value).width + 1, y + 3, 1, 7);
  }
}

function drawPage(ctx: CanvasRenderingContext2D, st: Stage, desktop: boolean): void {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 320, 200);
  let top = 0;
  if (desktop) {
    ctx.fillStyle = "#2c001e";
    ctx.fillRect(0, 0, 320, 9);
    ctx.fillStyle = "#fff";
    ctx.font = "6px Arial, sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText("Activities   Chromium", 4, 4.5);
    ctx.fillText("Tue 21:04", 280, 4.5);
    top = 9;
  }
  // browser chrome
  ctx.fillStyle = "#000080";
  ctx.fillRect(0, top, 320, 11);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 7px Arial, sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText("Meridian Mutual Provider Portal - Netscape", 4, top + 5.5);
  bevelBox(ctx, 296, top + 2, 7, 7);
  bevelBox(ctx, 304, top + 2, 7, 7);
  bevelBox(ctx, 312, top + 2, 7, 7);
  bevelBox(ctx, 0, top + 11, 320, 10);
  ctx.fillStyle = "#000";
  ctx.font = "7px Arial, sans-serif";
  ctx.fillText("File   Edit   View   Go   Communicator   Help", 4, top + 16);
  bevelBox(ctx, 0, top + 21, 320, 12);
  ctx.fillStyle = "#000";
  ctx.fillText("Location:", 4, top + 27);
  bevelBox(ctx, 38, top + 23, 276, 9, true, "#fff");
  ctx.fillStyle = "#000";
  ctx.font = "6px 'Courier New', monospace";
  const path =
    st.page === "notice" || st.page === "start"
      ? "/"
      : st.page === "form1"
        ? "/appeal/1"
        : st.page === "form2"
          ? "/appeal/2"
          : st.page === "form3"
            ? "/appeal/3"
            : st.page === "review"
              ? "/appeal/review"
              : st.page === "done"
                ? "/appeal/done"
                : st.page === "cancelconfirm"
                  ? "/appeal/cancel"
                  : st.page === "cancelled"
                    ? "/appeal/cancelled"
                    : "/appeal/error";
  ctx.fillText(`http://portal.meridianmutual.example${path}`, 41, top + 27.5);

  const body = top + 34;
  // page header
  ctx.fillStyle = "#1c3f7a";
  ctx.fillRect(0, body, 320, 16);
  ctx.fillStyle = "#ffd54f";
  ctx.font = "bold 9px 'Times New Roman', serif";
  ctx.fillText("MERIDIAN MUTUAL", 8, body + 8);
  ctx.fillStyle = "#fff";
  ctx.font = "7px 'Times New Roman', serif";
  ctx.fillText("Provider Portal  ·  Claims  ·  Appeals  ·  Logout", 110, body + 8.5);
  // sidebar
  ctx.fillStyle = "#e8e8e8";
  ctx.fillRect(0, body + 16, 60, 200 - body - 16);
  ctx.fillStyle = "#000080";
  ctx.font = "6px Arial, sans-serif";
  ["Home", "Claims", "> Appeals", "Remittance", "Eligibility", "Help"].forEach((s, i) => ctx.fillText(s, 5, body + 26 + i * 10));

  const cx = 68;
  const cy = body + 22;
  ctx.fillStyle = "#000";
  ctx.font = "bold 8px 'Times New Roman', serif";

  const stepTitle = (n: number, t: string) => {
    ctx.fillStyle = "#000";
    ctx.font = "bold 8px 'Times New Roman', serif";
    ctx.fillText(`Appeal — Step ${n} of 4: ${t}`, cx, cy + 4);
    ctx.fillStyle = "#808080";
    ctx.fillRect(cx, cy + 10, 240, 1);
  };
  const navButtons = () => {
    button(ctx, "Save Draft", cx + 10, 176, 50);
    button(ctx, "< Back", cx + 64, 176, 40);
    button(ctx, "Next >", cx + 190, 176, 44);
    button(ctx, "Cancel Appeal", cx + 108, 176, 60, true);
  };

  switch (st.page) {
    case "notice": {
      ctx.fillText("Denial Letter — Claim CLM-2026-004471", cx, cy + 4);
      ctx.font = "6px 'Times New Roman', serif";
      ctx.fillStyle = "#000";
      ["Patient: J. RIVERA   DOB: 03/12/1961", "Service: Arthroscopic repair, 2026-02-11", "Status: DENIED — Reason 197 (auth not on file)", "Provider notes: Prior auth MM-77-4410 approved 2026-02-03."].forEach((s, i) =>
        ctx.fillText(s, cx, cy + 18 + i * 9),
      );
      button(ctx, "File Appeal", cx + 150, cy + 60, 60);
      // session notice modal
      bevelBox(ctx, 90, 70, 180, 70);
      ctx.fillStyle = "#000080";
      ctx.fillRect(92, 72, 176, 10);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 7px Arial, sans-serif";
      ctx.fillText("Session Notice", 95, 77);
      ctx.fillStyle = "#000";
      ctx.font = "6px Arial, sans-serif";
      ctx.fillText("Your session will expire in 5 minutes.", 98, 95);
      ctx.fillText("Please save your work.", 98, 104);
      button(ctx, "OK", 160, 118, 40);
      break;
    }
    case "start": {
      ctx.fillText("Denial Letter — Claim CLM-2026-004471", cx, cy + 4);
      ctx.font = "6px 'Times New Roman', serif";
      ["Patient: J. RIVERA   DOB: 03/12/1961", "Service: Arthroscopic repair, 2026-02-11", "Status: DENIED — Reason 197 (auth not on file)", "Provider notes: Prior auth MM-77-4410 approved 2026-02-03."].forEach((s, i) =>
        ctx.fillText(s, cx, cy + 18 + i * 9),
      );
      button(ctx, "File Appeal", cx + 150, cy + 60, 60);
      button(ctx, "Print", cx + 90, cy + 60, 50);
      break;
    }
    case "form1":
      stepTitle(1, "Identify the claim");
      field(ctx, "Claim number:", st.claim ?? "", cx, cy + 20, 120, st.focus === "claim");
      field(ctx, "Patient DOB:", st.dob ?? "", cx, cy + 38, 80, st.focus === "dob");
      ctx.fillStyle = "#606060";
      ctx.font = "6px Arial, sans-serif";
      ctx.fillText("(MM/DD/YYYY)", cx + 156, cy + 44);
      navButtons();
      break;
    case "form2":
      stepTitle(2, "Reason for appeal");
      ctx.fillStyle = "#000";
      ctx.font = "7px Arial, sans-serif";
      ctx.fillText("Appeal reason:", cx, cy + 26);
      bevelBox(ctx, cx + 70, cy + 20, 140, 12, true, "#fff");
      ctx.fillStyle = "#000";
      ctx.fillText(st.reason ?? "-- select --", cx + 73, cy + 26);
      bevelBox(ctx, cx + 199, cy + 21, 10, 10);
      ctx.fillStyle = "#000";
      ctx.fillText("▼", cx + 201, cy + 26);
      if (st.dropdown) {
        ctx.fillStyle = "#fff";
        ctx.fillRect(cx + 70, cy + 32, 140, 40);
        ctx.strokeStyle = "#000";
        ctx.strokeRect(cx + 70.5, cy + 32.5, 139, 39);
        ["Timely filing", "Medical necessity (auth on file)", "Duplicate claim", "Other"].forEach((s, i) => {
          if (i === 1) {
            ctx.fillStyle = "#000080";
            ctx.fillRect(cx + 71, cy + 33 + i * 10, 138, 10);
            ctx.fillStyle = "#fff";
          } else ctx.fillStyle = "#000";
          ctx.fillText(s, cx + 74, cy + 38 + i * 10);
        });
      }
      navButtons();
      break;
    case "form3":
      stepTitle(3, "Justification");
      ctx.fillStyle = "#000";
      ctx.font = "7px Arial, sans-serif";
      ctx.fillText("Justification:", cx, cy + 24);
      bevelBox(ctx, cx + 70, cy + 18, 170, 60, true, "#fff");
      ctx.fillStyle = "#000";
      ctx.font = "6px 'Courier New', monospace";
      {
        const words = (st.just ?? "").split(" ");
        let lineTxt = "";
        let ly = cy + 26;
        for (const w of words) {
          if ((lineTxt + " " + w).length > 44) {
            ctx.fillText(lineTxt, cx + 73, ly);
            ly += 8;
            lineTxt = w;
          } else lineTxt = (lineTxt + " " + w).trim();
        }
        ctx.fillText(lineTxt, cx + 73, ly);
      }
      navButtons();
      break;
    case "review":
      stepTitle(4, "Review and submit");
      ctx.fillStyle = "#000";
      ctx.font = "6px Arial, sans-serif";
      [`Claim: ${st.claim ?? ""}`, `DOB: ${st.dob ?? ""}`, `Reason: ${st.reason ?? ""}`, `Justification: ${(st.just ?? "").slice(0, 48)}…`].forEach((s, i) => ctx.fillText(s, cx, cy + 22 + i * 9));
      bevelBox(ctx, cx, cy + 62, 9, 9, true, "#fff");
      if (st.attest) {
        ctx.fillStyle = "#000";
        ctx.font = "bold 8px Arial, sans-serif";
        ctx.fillText("✓", cx + 1, cy + 67);
      }
      ctx.fillStyle = "#000";
      ctx.font = "6px Arial, sans-serif";
      ctx.fillText("I attest that supporting records are attached.", cx + 13, cy + 67);
      button(ctx, "Save Draft", cx + 10, 176, 50);
      button(ctx, "Cancel Appeal", cx + 108, 176, 60, true);
      button(ctx, "SUBMIT APPEAL", cx + 180, 176, 60);
      break;
    case "done":
      ctx.fillStyle = "#006400";
      ctx.font = "bold 10px 'Times New Roman', serif";
      ctx.fillText("Appeal submitted.", cx, cy + 12);
      ctx.fillStyle = "#000";
      ctx.font = "8px 'Courier New', monospace";
      ctx.fillText("Reference: APL-2026-1187", cx, cy + 30);
      ctx.font = "6px Arial, sans-serif";
      ctx.fillText("A determination will be mailed within 30 days.", cx, cy + 44);
      button(ctx, "Print confirmation", cx, cy + 60, 80);
      break;
    case "cancelconfirm":
      stepTitle(3, "Justification");
      bevelBox(ctx, 100, 70, 170, 66);
      ctx.fillStyle = "#000080";
      ctx.fillRect(102, 72, 166, 10);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 7px Arial, sans-serif";
      ctx.fillText("Cancel Appeal?", 105, 77);
      ctx.fillStyle = "#000";
      ctx.font = "6px Arial, sans-serif";
      ctx.fillText("This will discard the appeal in progress.", 108, 95);
      ctx.fillText("Are you sure?", 108, 104);
      button(ctx, "Yes, cancel", 120, 116, 56);
      button(ctx, "No", 190, 116, 40);
      break;
    case "cancelled":
      ctx.fillStyle = "#8b0000";
      ctx.font = "bold 10px 'Times New Roman', serif";
      ctx.fillText("Appeal cancelled.", cx, cy + 12);
      ctx.fillStyle = "#000";
      ctx.font = "6px Arial, sans-serif";
      ctx.fillText("No reference number was issued.", cx, cy + 28);
      button(ctx, "Return to claim", cx, cy + 44, 70);
      break;
    case "error":
      stepTitle(4, "Review and submit");
      ctx.fillStyle = "#c00000";
      ctx.font = "bold 7px Arial, sans-serif";
      ctx.fillText("ERROR: Patient DOB does not match our records.", cx, cy + 24);
      ctx.fillStyle = "#000";
      ctx.font = "6px Arial, sans-serif";
      ctx.fillText(`Entered: ${st.dob ?? ""}   (expected MM/DD/YYYY)`, cx, cy + 36);
      button(ctx, "< Back", cx + 64, 176, 40);
      break;
  }

  // cursor
  if (st.cursor) {
    const [mx, my] = st.cursor;
    const x = mx * 0.3125;
    const y = my * 0.3125;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + 9);
    ctx.lineTo(x + 2.5, y + 7);
    ctx.lineTo(x + 6, y + 7);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.moveTo(x + 1, y + 2);
    ctx.lineTo(x + 1, y + 7);
    ctx.lineTo(x + 2.2, y + 6);
    ctx.lineTo(x + 4.5, y + 6);
    ctx.closePath();
    ctx.fill();
  }
}

function frameFor(st: Stage, desktop: boolean): { jpeg: string; thumb: string } {
  return {
    jpeg: paint(320, 200, (ctx) => drawPage(ctx, st, desktop), 0.62),
    thumb: paint(160, 100, (ctx) => drawPage(ctx, st, desktop), 0.5),
  };
}

/* ---------- script ---------- */

type Variant = "ok" | "cancel" | "baddob";

interface ScriptStep {
  action: Step["action"];
  token: string;
  note: string;
  url: string;
  target?: string;
  stage: Stage;
}

const CLAIM = "CLM-2026-004471";
const JUST = "Per prior authorization MM-77-4410 (approved 2026-02-03) the arthroscopic repair on 2026-02-11 was medically necessary and pre-approved; reason 197 does not apply.";

function coord(gx: number, gy: number): [number, number] {
  return [gx * 102 + 51, gy * 64 + 32];
}

/** Element under the cursor per (cell, page), like the server's DOM probe reports it. */
const TARGETS: Record<string, string> = {
  "5,4|/": "button:OK", "6,7|/appeal/1": "button:File Appeal", "3,4|/appeal/1": "input:Claim number", "3,5|/appeal/1": "input:Patient DOB",
  "8,9|/appeal/2": "button:Next >", "4,5|/appeal/2": "select:Appeal reason", "4,6|/appeal/2": "option:Medical necessity (auth on file)",
  "8,9|/appeal/3": "button:Next >", "2,9|/appeal/cancel": "button:Cancel Appeal", "4,6|/appeal/cancelled": "button:Yes, cancel",
  "8,9|/appeal/review": "button:Next >", "3,8|/appeal/review": "checkbox:I attest that supporting records are attached.",
  "8,9|/appeal/done": "button:SUBMIT APPEAL", "8,9|/appeal/error": "button:SUBMIT APPEAL",
};
/** Set per script build: desktop seats have no DOM, so they get the grid fallback tokens. */
let GRID_TOKENS = false;

function click(gx: number, gy: number, note: string, path: string, stage: Stage): ScriptStep {
  const c = coord(gx, gy);
  const url = `http://portal.meridianmutual.example${path}`;
  const target = GRID_TOKENS ? undefined : TARGETS[`${gx},${gy}|${path}`];
  const token = target ? `left[${target}]→${path}` : `left@${gx},${gy}→${path}`;
  return { action: { name: "left_click", input: { coordinate: c } }, token, note, url, target, stage: { ...stage, cursor: c } };
}

function type(text: string, note: string, path: string, stage: Stage, cursor?: [number, number]): ScriptStep {
  const url = `http://portal.meridianmutual.example${path}`;
  return { action: { name: "type", input: { text } }, token: `type:${text.length > 24 ? text.slice(0, 24) + "…" : text}`, note, url, stage: { ...stage, cursor } };
}

function scriptFor(variant: Variant, grid = false): ScriptStep[] {
  GRID_TOKENS = grid;
  const dob = variant === "baddob" ? "12/03/1961" : "03/12/1961";
  const reason = "Medical necessity (auth on file)";
  const s: ScriptStep[] = [
    click(5, 4, "There's a session notice covering the letter. Dismissing it first.", "/", { page: "start" }),
    click(6, 7, "Denial reason 197 = auth not on file. The provider notes have auth MM-77-4410. Starting the appeal.", "/appeal/1", { page: "form1", focus: null }),
    click(3, 4, "Clicking the claim number field.", "/appeal/1", { page: "form1", focus: "claim" }),
    type(CLAIM, "Entering the claim number exactly as printed.", "/appeal/1", { page: "form1", claim: CLAIM, focus: "claim" }, coord(3, 4)),
    click(3, 5, "Now the patient's date of birth.", "/appeal/1", { page: "form1", claim: CLAIM, focus: "dob" }),
    type(
      dob,
      variant === "baddob" ? "The letter says 03/12/1961 — that's day/month, so 12/03/1961 in this form." : "DOB is 03/12/1961 on the letter and the form wants MM/DD/YYYY.",
      "/appeal/1",
      { page: "form1", claim: CLAIM, dob, focus: "dob" },
      coord(3, 5),
    ),
    click(8, 9, "Next.", "/appeal/2", { page: "form2", claim: CLAIM, dob }),
    click(4, 5, "Opening the reason dropdown.", "/appeal/2", { page: "form2", claim: CLAIM, dob, dropdown: true }),
    click(4, 6, "Picking 'Medical necessity (auth on file)' — matches the provider notes.", "/appeal/2", { page: "form2", claim: CLAIM, dob, reason }),
    click(8, 9, "Next.", "/appeal/3", { page: "form3", claim: CLAIM, dob, reason }),
    type(JUST, "Writing the justification and citing the auth number.", "/appeal/3", { page: "form3", claim: CLAIM, dob, reason, just: JUST }, coord(6, 5)),
  ];
  if (variant === "cancel") {
    s.push(click(2, 9, "Done with the justification. 'Cancel Appeal' should close this step and move on.", "/appeal/cancel", { page: "cancelconfirm", claim: CLAIM, dob, reason, just: JUST }));
    s.push(click(4, 6, "Confirming.", "/appeal/cancelled", { page: "cancelled" }));
    return s;
  }
  s.push(click(8, 9, "Next — on to review.", "/appeal/review", { page: "review", claim: CLAIM, dob, reason, just: JUST }));
  s.push(click(3, 8, "Attesting that records are attached.", "/appeal/review", { page: "review", claim: CLAIM, dob, reason, just: JUST, attest: true }));
  if (variant === "baddob") {
    s.push(click(8, 9, "Submitting the appeal.", "/appeal/error", { page: "error", claim: CLAIM, dob, reason, just: JUST, attest: true }));
  } else {
    s.push(click(8, 9, "Submitting the appeal.", "/appeal/done", { page: "done", claim: CLAIM, dob, reason, just: JUST, attest: true }));
  }
  return s;
}

interface TimedEvent {
  at: number;
  ev: ServerEvent;
}

interface BuiltRun {
  initial: Run;
  final: Run;
  events: TimedEvent[];
  duration: number;
}

/** `?mock=1&mockk=20` builds a bigger fake party (layout testing); default k=8 with a 5/3 split. */
const K = Math.max(1, Math.min(20, Number(new URLSearchParams(location.search).get("mockk")) || 8));
const BASE_VARIANTS: Variant[] = ["ok", "ok", "cancel", "ok", "ok", "cancel", "ok", "baddob"];
const VARIANTS: Variant[] = Array.from({ length: K }, (_, i) => BASE_VARIANTS[i % BASE_VARIANTS.length]);
const KINDS: Seat["kind"][] = Array.from({ length: K }, (_, i) => (K >= 8 && (i === 6 || i === 7) ? "desktop" : "browser"));

/** tau-bench pass^j estimator: C(c, j) / C(n, j) for j in 1,2,4,8 with j <= n. */
function passKEstimate(c: number, n: number): Record<string, number> {
  const choose = (a: number, b: number): number => {
    if (b < 0 || b > a) return 0;
    let r = 1;
    for (let i = 1; i <= b; i++) r = (r * (a - b + i)) / i;
    return r;
  };
  const out: Record<string, number> = {};
  for (const j of [1, 2, 4, 8]) {
    if (j > n) continue;
    out[String(j)] = choose(c, j) / choose(n, j);
  }
  return out;
}

function rnd(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

function hex(seed: number, n = 6): string {
  let s = "";
  for (let i = 0; i < n; i++) s += Math.floor(rnd(seed * 31 + i) * 16).toString(16);
  return s;
}

let built: BuiltRun | null = null;

function buildMockRun(runId: string): BuiltRun {
  if (built) return built;
  const task = TASKS[0];
  const model = MODELS[0];
  const t0 = Date.now();
  const events: TimedEvent[] = [];
  const push = (at: number, ev: ServerEvent) => events.push({ at, ev });

  const seats: Seat[] = [];
  for (let i = 0; i < K; i++) {
    seats.push({
      index: i,
      key: `${runId}-${i}`,
      kind: KINDS[i],
      status: "queued",
      model,
      sprite: i % 8,
      steps: [],
      usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    });
  }
  const initial: Run = {
    id: runId,
    task,
    model,
    k: K,
    status: "booting",
    demo: true,
    seats: seats.map((s) => ({ ...s, steps: [] })),
    createdAt: t0,
    startedAt: t0,
    label: "opus-5 · appeal portal · demo",
    agent: "builtin",
  };

  push(0, { type: "log", runId, level: "info", text: `Forking ${K} seats from profile prof_meridian (6 browser + 2 desktop)`, at: t0 });
  push(80, { type: "log", runId, level: "info", text: "Portal sandbox ready at https://sbx-7f3a.solari.app", at: t0 + 80 });

  const finalSeats: Seat[] = [];
  let lastFinish = 0;
  let allRunningAt = 0;
  let allFirstFrameAt = 0;

  for (let i = 0; i < K; i++) {
    const variant = VARIANTS[i];
    const script = scriptFor(variant, KINDS[i] === "desktop");
    const sessionId = `sess_${hex(i + 7, 8)}`;
    const bootAt = 250 + i * 140;
    const runningAt = 1150 + i * 170 + Math.floor(rnd(i) * 200);
    allRunningAt = Math.max(allRunningAt, runningAt);
    const streamUrl = KINDS[i] === "desktop" ? `wss://mock.invalid/rfb/${sessionId}` : undefined;
    push(bootAt, { type: "seat:status", runId, seat: i, status: "booting", sessionId, streamUrl, startedAt: t0 + bootAt });
    push(bootAt + 60, { type: "log", runId, seat: i, level: "info", text: `seat ${i + 1}: solari ${KINDS[i]} session ${sessionId} booted in ${(0.5 + rnd(i + 3) * 0.6).toFixed(2)}s`, at: t0 + bootAt + 60 });

    // first frame: the start page with the notice
    const first = frameFor({ page: "notice" }, KINDS[i] === "desktop");
    push(runningAt - 120, { type: "seat:frame", runId, seat: i, jpeg: first.jpeg, w: 320, h: 200, at: t0 + runningAt - 120 });
    allFirstFrameAt = Math.max(allFirstFrameAt, runningAt - 120);
    push(runningAt, { type: "seat:status", runId, seat: i, status: "running", startedAt: t0 + bootAt });

    const steps: Step[] = [];
    let usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
    let at = runningAt + 500;
    const pitch = 640 + i * 22;
    for (let j = 0; j < script.length; j++) {
      const sc = script[j];
      at += pitch + Math.floor(rnd(i * 100 + j) * 240);
      const fr = frameFor(sc.stage, KINDS[i] === "desktop");
      usage = {
        inputTokens: usage.inputTokens + 2400 + Math.floor(rnd(i + j) * 600),
        outputTokens: usage.outputTokens + 90 + Math.floor(rnd(j + i * 3) * 80),
        costUsd: 0,
      };
      usage.costUsd = (usage.inputTokens * 5 + usage.outputTokens * 25) / 1_000_000;
      const step: Step = { n: j + 1, at: t0 + at, action: sc.action, note: sc.note, url: sc.url, thumb: fr.thumb, token: sc.token, target: sc.target };
      steps.push(step);
      push(at - 320, { type: "seat:bubble", runId, seat: i, text: sc.note });
      push(at, { type: "seat:frame", runId, seat: i, jpeg: fr.jpeg, w: 320, h: 200, at: t0 + at });
      push(at + 40, { type: "seat:step", runId, seat: i, step, usage: { ...usage } });
    }
    const gradingAt = at + 700;
    push(gradingAt, { type: "seat:status", runId, seat: i, status: "grading" });
    push(gradingAt + 30, { type: "log", runId, seat: i, level: "info", text: `grading seat ${i + 1} via grader_endpoint /state/${runId}-${i}`, at: t0 + gradingAt + 30 });
    const doneAt = gradingAt + 900 + Math.floor(rnd(i + 11) * 500);
    lastFinish = Math.max(lastFinish, doneAt);
    const pass = variant === "ok";
    const verdict = pass ? "appeal reference APL-2026-1187 issued" : variant === "cancel" ? "portal state: appeal cancelled (no reference)" : "portal state: validation error (DOB mismatch)";
    const replayUrl = `/replay/${runId}/${i}`;
    push(doneAt, { type: "seat:status", runId, seat: i, status: pass ? "pass" : "fail", verdict, replayUrl, finishedAt: t0 + doneAt });
    push(doneAt + 10, { type: "log", runId, seat: i, level: pass ? "info" : "warn", text: `seat ${i + 1}: ${pass ? "PASS" : "FAIL"} — ${verdict}`, at: t0 + doneAt + 10 });

    finalSeats.push({
      ...seats[i],
      status: pass ? "pass" : "fail",
      sessionId,
      streamUrl,
      replayUrl,
      steps,
      startedAt: t0 + bootAt,
      finishedAt: t0 + doneAt,
      verdict,
      usage,
      bubble: script[script.length - 1].note,
    });
  }

  push(allRunningAt + 20, { type: "run:status", runId, status: "running" });

  // summary + divergence
  const passN = finalSeats.filter((s) => s.status === "pass").length;
  const failN = finalSeats.filter((s) => s.status === "fail").length;
  const stepCounts = finalSeats.map((s) => s.steps.length).sort((a, b) => a - b);
  const times = finalSeats.map((s) => (s.finishedAt ?? 0) - (s.startedAt ?? 0)).sort((a, b) => a - b);
  const med = (xs: number[]) => (xs.length % 2 ? xs[(xs.length - 1) / 2] : (xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2);
  const summary: RunSummary = {
    k: K,
    pass: passN,
    fail: failN,
    error: 0,
    passRate: passN / (passN + failN),
    passK: passKEstimate(passN, passN + failN),
    medianSteps: med(stepCounts),
    medianMs: med(times),
    totalCostUsd: finalSeats.reduce((a, s) => a + s.usage.costUsd, 0),
    bootMs: allFirstFrameAt,
  };
  const majorityPath = scriptFor("ok").map((s) => s.token);
  const entries: DivergenceEntry[] = finalSeats.map((s) => {
    if (s.status === "pass") return { seat: s.index, step: null };
    const mine = s.steps.map((x) => x.token);
    for (let i = 0; i < Math.max(mine.length, majorityPath.length); i++) {
      if (mine[i] !== majorityPath[i]) {
        const describe = (t?: string) => {
          if (!t) return "nothing";
          const m = /^(left|double|right|middle|triple)(?:\[(.*)\]|@([^→]*))(?:→(.*))?$/.exec(t);
          if (m) return `clicked ${m[2] != null ? `"${m[2].replace(/^[a-z-]+:/, "")}"` : `grid ${m[3]}`}${m[4] ? ` (→ ${m[4]})` : ""}`;
          if (t.startsWith("type:")) return `typed "${t.slice(5)}"`;
          if (t.startsWith("key:")) return `pressed ${t.slice(4)}`;
          if (t.startsWith("scroll:")) return `scrolled ${t.slice(7)}`;
          return t;
        };
        const sentence = `${describe(mine[i])} instead of ${describe(majorityPath[i])}`;
        return { seat: s.index, step: i + 1, majorityToken: majorityPath[i], seatToken: mine[i], summary: sentence[0].toUpperCase() + sentence.slice(1) };
      }
    }
    return { seat: s.index, step: null, summary: "Same path as the majority, different outcome (timing or page state)" };
  });
  const divergence: DivergenceReport = { majorityPath, passingSeats: finalSeats.filter((s) => s.status === "pass").map((s) => s.index), entries };

  const finishAt = lastFinish + 700;
  push(finishAt, { type: "run:status", runId, status: "done", summary, divergence });

  events.sort((a, b) => a.at - b.at);
  const final: Run = { ...initial, status: "done", seats: finalSeats, finishedAt: t0 + finishAt, summary, divergence };
  built = { initial, final, events, duration: finishAt };
  return built;
}

/* ---------- public mock API ---------- */

function olderRuns(): Run[] {
  const base = buildMockRun("mock").final;
  const mk = (id: string, task: TaskDef, k: number, pass: number, ago: number, model: string): Run => {
    const seats: Seat[] = Array.from({ length: k }, (_, i) => ({
      index: i,
      key: `${id}-${i}`,
      kind: task.kind,
      status: i < pass ? "pass" : "fail",
      model,
      sprite: i % 8,
      steps: [],
      usage: { inputTokens: 20000, outputTokens: 900, costUsd: 0.12 },
      replayUrl: `/replay/${id}/${i}`,
    }));
    return {
      id,
      task,
      model,
      k,
      status: "done",
      demo: true,
      seats,
      createdAt: Date.now() - ago,
      finishedAt: Date.now() - ago + 60_000,
      agent: "builtin",
      summary: { k, pass, fail: k - pass, error: 0, passRate: pass / k, passK: passKEstimate(pass, k), medianSteps: 12, medianMs: 48_000, totalCostUsd: 0.12 * k, bootMs: 1100 },
      divergence: { majorityPath: base.divergence?.majorityPath ?? [], passingSeats: seats.filter((s) => s.status === "pass").map((s) => s.index), entries: seats.map((s) => ({ seat: s.index, step: s.status === "pass" ? null : 7, summary: s.status === "pass" ? undefined : 'Scrolled down instead of clicked "Continue" (→ /checkout-step-two.html)' })) },
    };
  };
  return [mk("mock-2", TASKS[1], 20, 13, 3_600_000 * 5, MODELS[1]), mk("mock-3", TASKS[2], 2, 1, 86_400_000, MODELS[0])];
}

export function mockListRuns(): Run[] {
  const b = buildMockRun("mock");
  const trimmed: Run = { ...b.final, seats: b.final.seats.map((s) => ({ ...s, steps: [] })) };
  return [trimmed, ...olderRuns()];
}

export function mockGetRun(id: string): Run {
  if (id === "mock") return buildMockRun("mock").final;
  const old = olderRuns().find((r) => r.id === id);
  if (old) return old;
  throw new Error(`mock: run ${id} not found (try /run/mock or /r/mock)`);
}

export function mockCreateRun(_req: CreateRunRequest): { id: string } {
  return { id: "mock" };
}

/** Replay the scripted events in real time. Returns a stop function. */
export function openMockStream(id: string, onEvent: (ev: ServerEvent) => void): () => void {
  if (id !== "mock") {
    const old = olderRuns().find((r) => r.id === id);
    const timer = setTimeout(() => {
      if (old) onEvent({ type: "run:snapshot", run: old });
      else onEvent({ type: "log", runId: id, level: "error", text: `mock: unknown run ${id}`, at: Date.now() });
    }, 0);
    return () => clearTimeout(timer);
  }
  const b = buildMockRun(id);
  const start = performance.now();
  const timers: number[] = [];
  const snap = setTimeout(() => onEvent({ type: "run:snapshot", run: { ...b.initial, createdAt: Date.now(), startedAt: Date.now() } }), 0);
  timers.push(snap as unknown as number);
  for (const te of b.events) {
    const delay = Math.max(0, te.at - (performance.now() - start));
    const t = setTimeout(() => {
      const ev = te.ev;
      // stamp live timestamps so durations look right
      if (ev.type === "seat:status") onEvent({ ...ev, startedAt: ev.startedAt ? Date.now() - (te.at - (ev.startedAt - b.initial.createdAt)) : undefined, finishedAt: ev.finishedAt ? Date.now() : undefined });
      else if (ev.type === "seat:frame") onEvent({ ...ev, at: Date.now() });
      else if (ev.type === "seat:step") onEvent({ ...ev, step: { ...ev.step, at: Date.now() } });
      else if (ev.type === "log") onEvent({ ...ev, at: Date.now() });
      else onEvent(ev);
    }, delay);
    timers.push(t as unknown as number);
  }
  return () => {
    for (const t of timers) clearTimeout(t);
  };
}
