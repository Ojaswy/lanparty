/**
 * Social card for a result page: a 1200x630 PNG rendered from SVG with sharp,
 * so a shared /r/:id link unfurls as the scoreboard on X and LinkedIn.
 */
import sharp from "sharp";
import type { Run } from "../shared/types.js";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Greedy word wrap into at most `lines` lines of ~`width` chars. */
function wrap(text: string, width: number, lines: number): string[] {
  const words = text.split(/\s+/);
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > width) {
      out.push(cur.trim());
      cur = w;
      if (out.length === lines) break;
    } else cur = (cur + " " + w).trim();
  }
  if (out.length < lines && cur) out.push(cur);
  if (out.length === lines && words.join(" ").length > out.join(" ").length) out[lines - 1] = out[lines - 1].slice(0, width - 1) + "…";
  return out;
}

export function divergenceHeadline(run: Run): string {
  const diverged = run.divergence?.entries.filter((e) => e.step !== null) ?? [];
  if (run.status !== "done") return "party in progress…";
  if (!diverged.length) return "no divergence — every seat took the majority path";
  const counts = new Map<string, number>();
  for (const e of diverged) counts.set(e.summary ?? "diverged", (counts.get(e.summary ?? "diverged") ?? 0) + 1);
  const [top, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const stepOf = diverged.find((e) => e.summary === top)?.step;
  return `${n} of ${diverged.length} failing seat${diverged.length === 1 ? "" : "s"}${stepOf ? ` at step ${stepOf}` : ""}: ${top}`;
}

export async function renderOgPng(run: Run): Promise<Buffer> {
  const s = run.summary;
  const pass = s?.pass ?? run.seats.filter((x) => x.status === "pass").length;
  const k = run.k;
  const pct = s ? Math.round(s.passRate * 100) : null;
  const headline = wrap(divergenceHeadline(run), 62, 2);

  const perRow = 20;
  const seatsRow = run.seats
    .map((seat, i) => {
      const x = 60 + (i % perRow) * 54;
      const y = 292 + Math.floor(i / perRow) * 50;
      const fill = seat.status === "pass" ? "#00c853" : seat.status === "fail" ? "#ff3b3b" : seat.status === "error" ? "#ffd54f" : "#5a5a5a";
      return `<rect x="${x}" y="${y}" width="44" height="34" fill="#d9d2c0" stroke="#404040" stroke-width="3"/><rect x="${x + 6}" y="${y + 5}" width="32" height="22" fill="${fill}"/>`;
    })
    .join("");

  const stamp = run.demo
    ? `<text x="1000" y="170" font-family="Courier New, monospace" font-size="30" font-weight="bold" fill="#ff3b3b" opacity="0.85" transform="rotate(-12 1000 170)" text-anchor="middle">DEMO REPLAY</text>`
    : "";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs><pattern id="floor" width="40" height="40" patternUnits="userSpaceOnUse"><rect width="40" height="40" fill="#e8d9b5"/><rect width="20" height="20" fill="#d8c9a5"/><rect x="20" y="20" width="20" height="20" fill="#d8c9a5"/></pattern></defs>
  <rect width="1200" height="630" fill="url(#floor)"/>
  <rect x="30" y="30" width="1140" height="570" fill="#c0c0c0" stroke="#ffffff" stroke-width="4"/>
  <rect x="34" y="34" width="1132" height="562" fill="none" stroke="#404040" stroke-width="4"/>
  <rect x="40" y="40" width="1120" height="44" fill="#0a246a"/>
  <rect x="40" y="40" width="1120" height="44" fill="#3a6ea5" opacity="0.6"/>
  <text x="56" y="70" font-family="Courier New, monospace" font-size="24" font-weight="bold" fill="#ffffff">LANPARTY.EXE — ${esc(run.task.name)}</text>
  <text x="60" y="180" font-family="Courier New, monospace" font-size="92" font-weight="bold" fill="#000080">pass@${k} = ${pass}/${k}</text>
  <text x="60" y="240" font-family="Courier New, monospace" font-size="30" fill="#111">${pct === null ? "running" : `${pct}% reliable`} · ${esc(run.model)} · ${s?.medianSteps ?? "–"} median steps · $${(s?.totalCostUsd ?? 0).toFixed(2)}</text>
  ${stamp}
  ${seatsRow}
  <rect x="60" y="420" width="1080" height="130" fill="#ffffe1" stroke="#000"/>
  <text x="80" y="458" font-family="Courier New, monospace" font-size="24" font-weight="bold" fill="#000">DIVERGENCE REPORT</text>
  ${headline.map((line, i) => `<text x="80" y="${496 + i * 30}" font-family="Courier New, monospace" font-size="23" fill="#000">${esc(line)}</text>`).join("")}
  <text x="60" y="583" font-family="Courier New, monospace" font-size="20" fill="#404040">${k} identical cloud machines on Solari · same task · same start state · every seat live</text>
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
