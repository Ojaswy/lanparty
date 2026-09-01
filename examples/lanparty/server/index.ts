/**
 * LANPARTY.EXE server — HTTP API + WebSocket + static files.
 *
 *   npm run dev      # server on :8787 + Vite on :5173 (proxied)
 *   npm run dev:demo # same, but replayed seats (no keys needed)
 *   npm run build && npm start   # production: serves ./dist itself
 */
import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { Solari } from "@solarisdk/browser";
import { SolariClient } from "@solarisdk/sdk";
import express from "express";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import type { CreateRunRequest, ServerInfo, StepAction } from "../shared/types.js";
import type { OpenAICompatConfig } from "./agent/openaiCompat.js";
import { Bus } from "./bus.js";
import { renderOgPng } from "./og.js";
import { PortalHost } from "./portal/host.js";
import { estimateSeatCostUsd, SELECTABLE_CLAUDE_MODELS } from "./pricing.js";
import { Runner } from "./runner.js";
import { RunStore, trimRun } from "./store.js";
import { handleStreamUpgrade } from "./streamRelay.js";
import { TASKS } from "./tasks.js";
import { Semaphore } from "./util.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const dataDir = join(root, "data");
const PORT = Number(process.env.PORT ?? 8787);
const PUBLIC_URL = (process.env.PUBLIC_URL ?? `http://localhost:${process.env.NODE_ENV === "production" ? PORT : 5173}`).replace(/\/+$/, "");

const solariKey = process.env.SOLARI_API_KEY?.trim();
const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
const demoFlag = process.env.DEMO_MODE === "1" || process.argv.includes("--demo");
const demo = demoFlag || !solariKey || !anthropicKey;
if (demo && !demoFlag) {
  console.warn(`[lanparty] ${!solariKey ? "SOLARI_API_KEY" : "ANTHROPIC_API_KEY"} is not set — starting in DEMO MODE (replayed seats).`);
}

const defaultModel = process.env.LANPARTY_MODEL?.trim() || "claude-opus-5";
const effort = (process.env.LANPARTY_EFFORT?.trim() || "medium") as "low" | "medium" | "high" | "xhigh" | "max";
const maxK = Number(process.env.LANPARTY_MAX_K ?? 20);
const maxDesktopSeats = Number(process.env.LANPARTY_MAX_DESKTOP_SEATS ?? 2);
const costCeilingUsd = Number(process.env.LANPARTY_COST_CEILING_USD ?? 40);
const llmConcurrency = Number(process.env.LANPARTY_LLM_CONCURRENCY ?? 8);

const openai: OpenAICompatConfig | undefined = process.env.OPENAI_API_KEY
  ? {
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl: process.env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1",
      models: (process.env.OPENAI_MODELS ?? "gpt-5").split(",").map((m) => m.trim()).filter(Boolean),
    }
  : undefined;

const bus = new Bus();
const store = new RunStore(join(dataDir, "runs"));
await store.init();

const solari = !demo && solariKey ? new Solari({ apiKey: solariKey, maxAttempts: 3 }) : undefined;
const sdk = !demo && solariKey ? new SolariClient({ apiKey: solariKey }) : undefined;
const anthropic = !demo && anthropicKey ? new Anthropic({ apiKey: anthropicKey, maxRetries: 5, timeout: 120_000 }) : undefined;
const portal = sdk ? new PortalHost(sdk, (level, text) => console.log(`[portal:${level}] ${text}`)) : undefined;

const runner = new Runner({
  store,
  bus,
  solari,
  sdk,
  anthropic,
  openai,
  portal,
  llmGate: new Semaphore(Math.max(1, llmConcurrency)),
  config: {
    demo,
    defaultModel,
    maxK,
    maxDesktopSeats,
    effort,
    staggerMs: Number(process.env.LANPARTY_STAGGER_MS ?? 250),
    costCeilingUsd,
    seatTimeoutMs: Number(process.env.LANPARTY_SEAT_TIMEOUT_MS ?? 8 * 60_000),
    externalSeatTimeoutMs: Number(process.env.LANPARTY_EXTERNAL_SEAT_TIMEOUT_MS ?? 20 * 60_000),
    dataDir,
  },
});

const models = [defaultModel, ...SELECTABLE_CLAUDE_MODELS.filter((m) => m !== defaultModel), ...(openai?.models ?? [])];

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

function publicBase(req: express.Request): string {
  return process.env.PUBLIC_URL ? PUBLIC_URL : `${req.protocol}://${req.get("host")}`;
}

app.get("/api/info", (_req, res) => {
  const info: ServerInfo = {
    demo,
    hasSolariKey: Boolean(solariKey),
    hasAnthropicKey: Boolean(anthropicKey),
    defaultModel,
    models,
    costPerSeatUsd: Object.fromEntries(models.map((m) => [m, Number(estimateSeatCostUsd(m).toFixed(2))])),
    costCeilingUsd,
    maxK,
    maxDesktopSeats,
    tasks: TASKS,
    publicUrl: PUBLIC_URL,
  };
  res.json(info);
});

app.get("/api/runs", (_req, res) => {
  res.json(store.list(50).map(trimRun));
});

app.post("/api/runs", (req, res) => {
  try {
    const body = req.body as CreateRunRequest;
    const run = runner.createRun(body);
    res.status(201).json({ id: run.id, seatsUrl: `${publicBase(req)}/api/runs/${run.id}/seats` });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.get("/api/runs/:id", (req, res) => {
  const run = store.get(String(req.params.id));
  if (!run) return res.status(404).json({ error: "no such run" });
  res.json(run);
});

app.post("/api/runs/:id/cancel", (req, res) => {
  const ok = runner.cancel(String(req.params.id));
  res.json({ ok });
});

// ---- external-agent contract: bring your own brain ----
app.get("/api/runs/:id/seats", (req, res) => {
  const run = store.get(String(req.params.id));
  if (!run) return res.status(404).json({ error: "no such run" });
  res.json({ runId: run.id, agent: run.agent, task: run.task, portalUrl: run.portalUrl, seats: runner.externalSeats(run, publicBase(req)) });
});

app.post("/api/runs/:id/seats/:n/steps", (req, res) => {
  const run = store.get(String(req.params.id));
  const seat = run?.seats[Number(req.params.n)];
  if (!run || !seat) return res.status(404).json({ error: "no such seat" });
  const body = req.body as { action?: StepAction; url?: string; target?: string; note?: string };
  if (!body.action?.name) return res.status(400).json({ error: "action.name is required" });
  const step = runner.recordExternalStep(run, seat, { action: { name: body.action.name, input: body.action.input ?? {} }, url: body.url, target: body.target, note: body.note });
  if (!step) return res.status(409).json({ error: "seat is not running" });
  res.json({ ok: true, step: { ...step, thumb: undefined } });
});

app.post("/api/runs/:id/seats/:n/done", (req, res) => {
  const run = store.get(String(req.params.id));
  const seat = run?.seats[Number(req.params.n)];
  if (!run || !seat) return res.status(404).json({ error: "no such seat" });
  const ok = runner.markExternalDone(run, seat, (req.body as { claimed?: string })?.claimed);
  if (!ok) return res.status(409).json({ error: "seat is not waiting for an external agent" });
  res.json({ ok: true });
});

// ---- persisted replays (Solari's presigned URLs expire; these don't) ----
app.get("/api/runs/:id/seats/:n/replay.ndjson", (req, res) => {
  const p = join(dataDir, "runs", String(req.params.id), `seat-${Number(req.params.n)}.ndjson`);
  if (!existsSync(p)) return res.status(404).json({ error: "no replay for this seat (yet)" });
  res.type("application/x-ndjson").sendFile(p);
});

app.get("/api/runs/:id/seats/:n/recording.mp4", (req, res) => {
  const p = join(dataDir, "runs", String(req.params.id), `seat-${Number(req.params.n)}.mp4`);
  if (!existsSync(p)) return res.status(404).json({ error: "no recording for this seat (yet)" });
  res.type("video/mp4").sendFile(p);
});

app.get("/og/:id.png", async (req, res) => {
  const run = store.get(String(req.params.id));
  if (!run) return res.status(404).end();
  try {
    const png = await renderOgPng(run);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", run.status === "done" ? "public, max-age=3600" : "no-store");
    res.send(png);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// The insurance portal, served locally so you can try the traps yourself.
app.use("/portal", express.static(join(here, "portal", "static")));

// Production: serve the built client, with OG tags injected on result pages.
const dist = join(root, "dist");
if (existsSync(dist)) {
  app.use(express.static(dist, { index: false }));
  const indexHtml = await readFile(join(dist, "index.html"), "utf8");
  app.get(/^\/(?!api|ws|og|portal).*/, (req, res) => {
    const m = /^\/r\/([^/]+)/.exec(req.path);
    const run = m ? store.get(m[1]) : undefined;
    let html = indexHtml;
    if (run) {
      const s = run.summary;
      const title = s ? `pass@${s.k} = ${s.pass}/${s.k} — ${run.task.name} — LANPARTY.EXE` : `${run.task.name} — LANPARTY.EXE`;
      const desc = s ? `${run.k} identical Solari machines, one task, model ${run.model}. ${Math.round(s.passRate * 100)}% of graded seats passed.` : `A reliability party is in progress.`;
      const tags = [
        `<meta property="og:title" content="${title.replace(/"/g, "&quot;")}">`,
        `<meta property="og:description" content="${desc.replace(/"/g, "&quot;")}">`,
        `<meta property="og:image" content="${PUBLIC_URL}/og/${run.id}.png">`,
        `<meta name="twitter:card" content="summary_large_image">`,
        `<meta name="twitter:image" content="${PUBLIC_URL}/og/${run.id}.png">`,
      ].join("\n");
      html = html.replace("</head>", `${tags}\n</head>`);
    }
    res.type("html").send(html);
  });
}

const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  // View-only VNC relay for desktop seats (`/ws/stream/<run>/<seat>`).
  if (handleStreamUpgrade(req, socket, head, (runId, seat) => runner.resolveStream(runId, seat))) return;

  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== "/ws") {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    const runId = url.searchParams.get("run");
    const run = runId ? store.get(runId) : undefined;
    if (!run) {
      ws.close(4004, "no such run");
      return;
    }
    ws.send(JSON.stringify({ type: "run:snapshot", run }));
    const unsubscribe = bus.subscribe(run.id, ws);
    ws.on("close", unsubscribe);
    ws.on("error", unsubscribe);
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as { type?: string };
        if (msg.type === "cancel") runner.cancel(run.id);
      } catch {
        /* ignore */
      }
    });
  });
});

server.listen(PORT, () => {
  console.log(`[lanparty] ${demo ? "DEMO MODE" : "LIVE"} on http://localhost:${PORT}  (public: ${PUBLIC_URL})`);
  if (!demo) console.log(`[lanparty] models: ${models.join(", ")} · llm concurrency ${llmConcurrency} · cost ceiling $${costCeilingUsd}`);
});

async function shutdown() {
  console.log("[lanparty] shutting down…");
  await store.flush();
  await portal?.shutdown().catch(() => {});
  // The browser client keeps a loopback proxy open; without close() the process hangs.
  await solari?.close().catch(() => {});
  server.close();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
