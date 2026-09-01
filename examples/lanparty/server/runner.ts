/**
 * The run orchestrator: fork one task into k seats, drive each with an agent
 * (or hand the seats to an external one), grade, summarise, and compute the
 * divergence report.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { Solari } from "@solarisdk/browser";
import { SolariError } from "@solarisdk/browser";
import type { SolariClient } from "@solarisdk/sdk";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CreateRunRequest, Run, RunSummary, Seat, Step, StepAction, TaskDef } from "../shared/types.js";
import { runClaudeAgent } from "./agent/computerUse.js";
import { runOpenAICompatAgent, type OpenAICompatConfig } from "./agent/openaiCompat.js";
import type { AgentEvents, AgentOutcome } from "./agent/types.js";
import type { Bus } from "./bus.js";
import { runDemoSeat } from "./demo.js";
import { buildDivergence, stepToken } from "./divergence.js";
import { grade } from "./grader.js";
import type { PortalHost } from "./portal/host.js";
import { isClaudeModel } from "./pricing.js";
import { BrowserSeat } from "./seats/browserSeat.js";
import { DesktopSeat } from "./seats/desktopSeat.js";
import type { SeatDriver } from "./seats/types.js";
import type { RunStore } from "./store.js";
import { findTask } from "./tasks.js";
import { median, passKCurve, Semaphore, sleep } from "./util.js";

export interface RunnerConfig {
  demo: boolean;
  defaultModel: string;
  maxK: number;
  maxDesktopSeats: number;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  /** Delay between seat boots so 20 parallel launches don't thunder in at once. */
  staggerMs: number;
  /** Stop starting/continuing seats once a party has spent this much. */
  costCeilingUsd: number;
  /** Wall clock per seat (built-in agent), excluding boot. */
  seatTimeoutMs: number;
  /** Wall clock per seat for external agents. */
  externalSeatTimeoutMs: number;
  /** Where replay NDJSON / recordings are persisted. */
  dataDir: string;
}

export interface RunnerDeps {
  store: RunStore;
  bus: Bus;
  config: RunnerConfig;
  llmGate: Semaphore;
  solari?: Solari;
  sdk?: SolariClient;
  anthropic?: Anthropic;
  openai?: OpenAICompatConfig;
  portal?: PortalHost;
}

export interface ExternalSeatInfo {
  seat: number;
  key: string;
  kind: Seat["kind"];
  status: Seat["status"];
  /** Loopback-wrapped CDP endpoint: connect with `chromium.connectOverCDP` from the same host. */
  cdpEndpoint?: string;
  wsEndpoint?: string;
  startUrl?: string;
  /** Solari session id (for desktops: drive it with @solarisdk/desktop yourself). */
  sessionId?: string;
  /** Where to POST when your agent is done, and where to POST each step it takes. */
  doneUrl: string;
  stepsUrl: string;
}

function id(prefix: string): string {
  return `${prefix}_${randomBytes(4).toString("hex")}`;
}

interface LiveSeat {
  driver: SeatDriver;
  budget: AbortController;
  /** External agents: resolved when POST .../done arrives. */
  done?: { resolve: (claimed?: string) => void; promise: Promise<string | undefined> };
  upstreamStream?: string;
}

export class Runner {
  private readonly aborts = new Map<string, AbortController>();
  private readonly live = new Map<string, LiveSeat>(); // `${runId}:${seat}`

  constructor(private readonly deps: RunnerDeps) {}

  private get config() {
    return this.deps.config;
  }

  // ---------- public surface ----------

  resolveTask(req: CreateRunRequest): TaskDef {
    if (req.taskId) {
      const t = findTask(req.taskId);
      if (!t) throw new Error(`unknown task ${req.taskId}`);
      return t;
    }
    if (!req.task?.instruction) throw new Error("task.instruction is required");
    const t = req.task;
    return {
      id: t.id ?? "custom",
      name: t.name ?? "CUSTOM TASK",
      blurb: t.blurb ?? t.instruction.slice(0, 120),
      kind: t.kind ?? "browser",
      startUrl: t.startUrl ?? "https://example.com",
      openApp: t.openApp,
      instruction: t.instruction,
      successCheck: t.successCheck ?? { type: "llm_judge", rubric: `The task "${t.instruction}" is visibly complete on screen.` },
      maxSteps: Math.min(60, Math.max(3, t.maxSteps ?? 25)),
      profileId: t.profileId,
      desktopTemplate: t.desktopTemplate,
      needsPortal: t.needsPortal,
      stealth: t.stealth,
      tags: t.tags ?? ["custom"],
    };
  }

  createRun(req: CreateRunRequest): Run {
    const task = this.resolveTask(req);
    const k = Math.min(this.config.maxK, Math.max(1, Math.floor(req.k || 1)));
    const model = req.model || this.config.defaultModel;
    if (!this.config.demo && !isClaudeModel(model) && !this.deps.openai) throw new Error(`model ${model} needs OPENAI_API_KEY / OPENAI_BASE_URL`);
    const agent = req.agent === "external" ? "external" : "builtin";
    const desktopSeats = task.kind === "desktop" ? k : Math.min(this.config.maxDesktopSeats, Math.max(0, Math.floor(req.desktopSeats ?? 0)));
    const runId = id("run");
    const seats: Seat[] = [];
    for (let i = 0; i < k; i++) {
      const isDesktop = task.kind === "desktop" || i < desktopSeats;
      seats.push({
        index: i,
        key: `${runId}-${i}`,
        kind: isDesktop ? "desktop" : "browser",
        status: "queued",
        model: agent === "external" ? "external" : model,
        sprite: i % 8,
        steps: [],
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
      });
    }
    const run: Run = {
      id: runId,
      task,
      model,
      k,
      status: "booting",
      demo: this.config.demo,
      seats,
      createdAt: Date.now(),
      label: req.label,
      agent,
    };
    this.deps.store.put(run);
    const ac = new AbortController();
    this.aborts.set(runId, ac);
    void this.start(run, ac.signal).catch((err) => {
      this.deps.bus.log(run.id, "error", `run failed: ${(err as Error).message}`);
      run.status = "cancelled";
      for (const s of run.seats) if (s.status === "queued" || s.status === "booting") s.status = "cancelled";
      this.emitRunStatus(run);
    });
    return run;
  }

  cancel(runId: string): boolean {
    const ac = this.aborts.get(runId);
    if (!ac) return false;
    ac.abort();
    return true;
  }

  /** Upstream wss:// for the view-only relay; undefined once the seat is gone. */
  resolveStream(runId: string, seat: number): string | undefined {
    return this.live.get(`${runId}:${seat}`)?.upstreamStream;
  }

  /** External-agent contract: the endpoints for every seat of a run. */
  externalSeats(run: Run, base: string): ExternalSeatInfo[] {
    return run.seats.map((seat) => {
      const live = this.live.get(`${run.id}:${seat.index}`);
      const d = live?.driver as (BrowserSeat & { endpoints?: () => { cdpEndpoint: string; wsEndpoint: string } }) | undefined;
      const ep = d && d.kind === "browser" && "endpoints" in d ? d.endpoints?.() : undefined;
      return {
        seat: seat.index,
        key: seat.key,
        kind: seat.kind,
        status: seat.status,
        cdpEndpoint: ep?.cdpEndpoint,
        wsEndpoint: ep?.wsEndpoint,
        startUrl: run.task.startUrl ? this.substitute(run.task.startUrl, run, seat) : undefined,
        sessionId: seat.sessionId,
        doneUrl: `${base}/api/runs/${run.id}/seats/${seat.index}/done`,
        stepsUrl: `${base}/api/runs/${run.id}/seats/${seat.index}/steps`,
      };
    });
  }

  /** External agents report their own steps so the divergence report can include them. */
  recordExternalStep(run: Run, seat: Seat, body: { action: StepAction; url?: string; target?: string; note?: string }): Step | undefined {
    const live = this.live.get(`${run.id}:${seat.index}`);
    if (!live || seat.status !== "running") return undefined;
    const { driver } = live;
    const step: Step = {
      n: seat.steps.length + 1,
      at: Date.now(),
      action: body.action,
      note: body.note,
      url: body.url,
      target: body.target,
      token: stepToken({ action: body.action, url: body.url, target: body.target }, driver.width, driver.height),
    };
    seat.steps.push(step);
    this.deps.bus.emit({ type: "seat:step", runId: run.id, seat: seat.index, step, usage: seat.usage });
    if (body.note) {
      seat.bubble = body.note.slice(0, 200);
      this.deps.bus.emit({ type: "seat:bubble", runId: run.id, seat: seat.index, text: seat.bubble });
    }
    this.deps.store.touch(run.id);
    return step;
  }

  markExternalDone(run: Run, seat: Seat, claimed?: string): boolean {
    const live = this.live.get(`${run.id}:${seat.index}`);
    if (!live?.done) return false;
    live.done.resolve(claimed);
    return true;
  }

  // ---------- internals ----------

  private emitRunStatus(run: Run) {
    this.deps.store.touch(run.id);
    this.deps.bus.emit({ type: "run:status", runId: run.id, status: run.status, summary: run.summary, divergence: run.divergence, portalUrl: run.portalUrl });
  }

  private emitSeatStatus(run: Run, seat: Seat) {
    this.deps.store.touch(run.id);
    this.deps.bus.emit({
      type: "seat:status",
      runId: run.id,
      seat: seat.index,
      status: seat.status,
      sessionId: seat.sessionId,
      streamUrl: seat.streamUrl,
      replayUrl: seat.replayUrl,
      replayNdjsonUrl: seat.replayNdjsonUrl,
      recordingUrl: seat.recordingUrl,
      verdict: seat.verdict,
      error: seat.error,
      startedAt: seat.startedAt,
      finishedAt: seat.finishedAt,
    });
  }

  private async start(run: Run, signal: AbortSignal): Promise<void> {
    const { bus } = this.deps;
    run.startedAt = Date.now();
    bus.log(run.id, "info", `party started: ${run.k} seat(s), task "${run.task.name}", ${run.agent === "external" ? "external agent" : `model ${run.model}`}${run.demo ? " (DEMO REPLAY)" : ""}`);

    if (run.task.needsPortal && !run.demo) {
      if (!this.deps.portal) throw new Error("this task needs the sandbox-hosted portal, but no Solari SDK client is configured");
      run.portalUrl = await this.deps.portal.ensure();
      this.emitRunStatus(run);
    }

    run.status = "running";
    this.emitRunStatus(run);

    const budget = new AbortController();
    let costCeilingHit = false;
    const checkBudget = () => {
      const spent = run.seats.reduce((a, s) => a + s.usage.costUsd, 0);
      if (!costCeilingHit && spent >= this.config.costCeilingUsd) {
        costCeilingHit = true;
        bus.log(run.id, "warn", `cost ceiling of $${this.config.costCeilingUsd.toFixed(2)} reached; stopping the party`);
        budget.abort();
      }
    };

    const firstFrameAt: number[] = [];
    const seatPromises = run.seats.map(async (seat, i) => {
      await sleep(i * this.config.staggerMs, signal);
      if (signal.aborted || budget.signal.aborted) {
        seat.status = "cancelled";
        seat.verdict = budget.signal.aborted ? "cost ceiling reached before this seat started" : undefined;
        this.emitSeatStatus(run, seat);
        return;
      }
      if (run.demo) {
        await runDemoSeat(run, seat, {
          bus,
          signal,
          onStatus: () => this.emitSeatStatus(run, seat),
          onFirstFrame: () => firstFrameAt.push(Date.now()),
          touch: () => this.deps.store.touch(run.id),
        });
        return;
      }
      await this.runSeat(run, seat, signal, budget.signal, () => firstFrameAt.push(Date.now()), checkBudget);
    });
    await Promise.all(seatPromises);

    run.finishedAt = Date.now();
    run.summary = this.summarise(run, firstFrameAt, costCeilingHit);
    run.divergence = buildDivergence(run.seats);
    run.status = signal.aborted ? "cancelled" : "done";
    this.aborts.delete(run.id);
    bus.log(run.id, "info", `party's over: ${run.summary.pass}/${run.summary.k} passed (${Math.round(run.summary.passRate * 100)}% of graded seats), $${run.summary.totalCostUsd.toFixed(2)}`);
    this.emitRunStatus(run);
    await this.deps.store.flush();
    // Free the sandbox slot (and stop paying for it) if no other party needs the portal soon.
    this.deps.portal?.releaseLater();
  }

  private summarise(run: Run, firstFrameAt: number[], costCeilingHit: boolean): RunSummary {
    const seats = run.seats;
    const pass = seats.filter((s) => s.status === "pass").length;
    const fail = seats.filter((s) => s.status === "fail").length;
    const error = seats.filter((s) => s.status === "error" || s.status === "cancelled").length;
    const graded = pass + fail;
    const durations = seats.filter((s) => s.startedAt && s.finishedAt).map((s) => (s.finishedAt as number) - (s.startedAt as number));
    const bootMs = firstFrameAt.length === seats.length && run.startedAt ? Math.max(...firstFrameAt) - run.startedAt : null;
    return {
      k: run.k,
      pass,
      fail,
      error,
      passRate: graded ? pass / graded : 0,
      passK: passKCurve(pass, graded),
      costCeilingHit: costCeilingHit || undefined,
      medianSteps: median(seats.filter((s) => s.steps.length).map((s) => s.steps.length)),
      medianMs: median(durations),
      totalCostUsd: seats.reduce((a, s) => a + s.usage.costUsd, 0),
      bootMs,
    };
  }

  /**
   * Plans cap concurrent sessions (Free: 3 browsers / 1 VM, Starter: 20 / 2).
   * When Solari answers 429 ConcurrencyLimitExceeded the seat waits in the
   * queue and retries, so a 20-seat party on a small plan runs in waves
   * instead of erroring out.
   */
  private async bootWithBackoff(run: Run, seat: Seat, driver: SeatDriver, signal: AbortSignal): Promise<void> {
    const deadline = Date.now() + 15 * 60_000;
    let attempt = 0;
    for (;;) {
      try {
        await driver.boot();
        return;
      } catch (err) {
        const e = err as { status?: number; code?: string; message?: string };
        const limited = e?.status === 429 || e?.code === "ConcurrencyLimitExceeded" || /concurren/i.test(e?.message ?? "");
        const capacity = e?.status === 503 || /capacity/i.test(e?.message ?? "");
        if ((!limited && !capacity) || signal.aborted || Date.now() > deadline) throw err;
        attempt++;
        seat.status = "queued";
        this.emitSeatStatus(run, seat);
        if (attempt === 1) this.deps.bus.log(run.id, "warn", `seat ${seat.index} is waiting for a free slot (${limited ? "plan concurrency limit" : "no capacity"})`, seat.index);
        await sleep(Math.min(20_000, 3_000 * attempt), signal);
        if (signal.aborted) throw err;
        seat.status = "booting";
        this.emitSeatStatus(run, seat);
      }
    }
  }

  private substitute(url: string, run: Run, seat: Seat): string {
    return url.replace("{portal}", run.portalUrl ?? "").replace("{seat}", encodeURIComponent(seat.key)).replace("{run}", run.id);
  }

  private async runSeat(run: Run, seat: Seat, runSignal: AbortSignal, budgetSignal: AbortSignal, onFirstFrame: () => void, checkBudget: () => void): Promise<void> {
    const { bus, solari, sdk, anthropic, openai } = this.deps;
    const task = run.task;
    const key = `${run.id}:${seat.index}`;
    let lastFrame: string | undefined;
    let lastText: string | undefined;
    let gotFirstFrame = false;

    const events = {
      onFrame: (jpeg: Buffer, w: number, h: number) => {
        lastFrame = jpeg.toString("base64");
        if (!gotFirstFrame) {
          gotFirstFrame = true;
          onFirstFrame();
        }
        bus.emit({ type: "seat:frame", runId: run.id, seat: seat.index, jpeg: lastFrame, w, h, at: Date.now() });
      },
      onLog: (level: "info" | "warn" | "error", text: string) => bus.log(run.id, level, text, seat.index),
    };

    let driver: SeatDriver;
    if (seat.kind === "browser") {
      if (!solari) throw new Error("no Solari browser client (SOLARI_API_KEY missing)");
      driver = new BrowserSeat({ solari, task, startUrl: this.substitute(task.startUrl ?? "https://example.com", run, seat), events });
    } else {
      if (!sdk) throw new Error("no Solari desktop client (SOLARI_API_KEY missing)");
      driver = new DesktopSeat({ desktops: sdk.desktops, task, startUrl: task.startUrl ? this.substitute(task.startUrl, run, seat) : undefined, events });
    }

    const seatBudget = new AbortController();
    const live: LiveSeat = { driver, budget: seatBudget };
    this.live.set(key, live);
    seat.status = "booting";
    seat.startedAt = Date.now();
    this.emitSeatStatus(run, seat);

    const bootSignal = AbortSignal.any([runSignal, budgetSignal]);
    let outcome: AgentOutcome | undefined;
    let timedOut = false;
    try {
      await this.bootWithBackoff(run, seat, driver, bootSignal);
      seat.sessionId = driver.sessionId;
      if (driver.streamUrl) {
        live.upstreamStream = driver.streamUrl;
        seat.streamUrl = `/ws/stream/${run.id}/${seat.index}`;
      }
      seat.status = "running";
      this.emitSeatStatus(run, seat);
      bus.log(run.id, "info", `seat ${seat.index} online (${seat.kind} ${driver.sessionId ?? ""})`, seat.index);

      const timeoutMs = run.agent === "external" ? this.config.externalSeatTimeoutMs : this.config.seatTimeoutMs;
      const timeout = AbortSignal.timeout(timeoutMs);
      timeout.addEventListener("abort", () => (timedOut = true), { once: true });
      const seatSignal = AbortSignal.any([runSignal, budgetSignal, timeout]);

      const agentEvents: AgentEvents = {
        onText: (text) => {
          lastText = text;
          seat.bubble = text.slice(0, 200);
          bus.emit({ type: "seat:bubble", runId: run.id, seat: seat.index, text: seat.bubble });
        },
        onStep: ({ n, action, error, url, target }) => {
          const step: Step = {
            n,
            at: Date.now(),
            action,
            note: lastText,
            url,
            thumb: lastFrame,
            token: stepToken({ action, url, target }, driver.width, driver.height),
            target,
            error,
          };
          lastText = undefined;
          seat.steps.push(step);
          bus.emit({ type: "seat:step", runId: run.id, seat: seat.index, step: { ...step, thumb: undefined }, usage: seat.usage });
          this.deps.store.touch(run.id);
        },
        onUsage: (u) => {
          seat.usage = u;
          checkBudget();
        },
        onWaiting: (waiting) => {
          if (waiting && this.deps.llmGate.waiting > 0) bus.log(run.id, "info", `seat ${seat.index} waiting for a model slot (lag)`, seat.index);
        },
        onLog: events.onLog,
      };

      if (run.agent === "external") {
        let resolveDone!: (claimed?: string) => void;
        const promise = new Promise<string | undefined>((resolve) => (resolveDone = resolve));
        live.done = { resolve: resolveDone, promise };
        bus.log(run.id, "info", `seat ${seat.index} is waiting for an external agent (GET /api/runs/${run.id}/seats)`, seat.index);
        const claimed = await Promise.race([promise, new Promise<undefined>((resolve) => seatSignal.addEventListener("abort", () => resolve(undefined), { once: true }))]);
        outcome = seatSignal.aborted && !claimed ? { reason: "cancelled", finalText: "", steps: seat.steps.length, usage: seat.usage } : { reason: "done", finalText: claimed ?? "", steps: seat.steps.length, usage: seat.usage };
      } else {
        const agentOpts = { model: seat.model, seat: driver, instruction: task.instruction, hints: task.kind === "desktop" ? "This is a full Linux desktop; apps may take a few seconds to open. Use the wait action after launching or saving." : undefined, maxSteps: task.maxSteps, effort: this.config.effort, signal: seatSignal, events: agentEvents, gate: this.deps.llmGate };
        if (isClaudeModel(seat.model)) {
          if (!anthropic) throw new Error("no Anthropic client (ANTHROPIC_API_KEY missing)");
          outcome = await runClaudeAgent(anthropic, agentOpts);
        } else {
          if (!openai) throw new Error("no OpenAI-compatible provider configured");
          outcome = await runOpenAICompatAgent(openai, agentOpts);
        }
      }

      if (runSignal.aborted) {
        seat.status = "cancelled";
      } else if (budgetSignal.aborted && outcome.reason === "cancelled") {
        seat.status = "cancelled";
        seat.verdict = "cost ceiling reached";
      } else if (outcome.reason === "error" || outcome.reason === "refusal") {
        seat.status = "error";
        seat.error = outcome.error ?? outcome.reason;
      } else {
        seat.status = "grading";
        this.emitSeatStatus(run, seat);
        const verdict = await grade(task.successCheck, driver, { seatKey: seat.key, runId: run.id, client: anthropic, model: isClaudeModel(run.model) ? run.model : undefined, instruction: task.instruction });
        seat.status = verdict.pass ? "pass" : "fail";
        const notes = [
          outcome.reason === "gave_up" ? `agent gave up: ${outcome.finalText}` : "",
          outcome.reason === "max_steps" ? "step budget exhausted" : "",
          timedOut ? "wall clock exceeded" : "",
          outcome.reason === "done" && outcome.finalText ? `claimed: ${outcome.finalText.slice(0, 120)}` : "",
        ].filter(Boolean);
        seat.verdict = `${verdict.detail}${notes.length ? ` (${notes.join("; ")})` : ""}`;
      }
    } catch (err) {
      seat.status = runSignal.aborted ? "cancelled" : "error";
      seat.error = (err as Error).message;
      bus.log(run.id, "error", `seat ${seat.index} crashed: ${seat.error}`, seat.index);
    } finally {
      seat.finishedAt = Date.now();
      this.emitSeatStatus(run, seat);
      await driver.teardown().catch(() => {});
      this.live.delete(key);
      bus.log(run.id, "info", `seat ${seat.index} ${seat.status.toUpperCase()}${seat.verdict ? ` — ${seat.verdict}` : ""}`, seat.index);
      // Replay upload is async on Solari's side; fetch it without blocking the scoreboard.
      void this.persistReplay(run, seat, driver).catch((e) => bus.log(run.id, "warn", `seat ${seat.index}: replay not saved: ${(e as Error).message}`, seat.index));
    }
  }

  /**
   * Solari's replay URLs are presigned and expire, so download the rrweb
   * NDJSON (browser) or the mp4 (desktop) and serve it from here forever.
   */
  private async persistReplay(run: Run, seat: Seat, driver: SeatDriver): Promise<void> {
    const dir = join(this.config.dataDir, "runs", run.id);
    await mkdir(dir, { recursive: true });
    if (seat.kind === "browser") {
      const solari = this.deps.solari;
      if (!solari || !seat.sessionId) return;
      // The first polls usually 404: the upload happens after release.
      for (let attempt = 0; attempt < 30; attempt++) {
        try {
          const bytes = await solari.sessions.downloadReplay(seat.sessionId);
          if (bytes.byteLength < 10) throw new SolariError("empty replay", 404);
          await writeFile(join(dir, `seat-${seat.index}.ndjson`), bytes);
          seat.replayNdjsonUrl = `/api/runs/${run.id}/seats/${seat.index}/replay.ndjson`;
          seat.replayUrl = `/replay/${run.id}/${seat.index}`;
          this.emitSeatStatus(run, seat);
          return;
        } catch (err) {
          if (err instanceof SolariError && err.status === 404) {
            await sleep(3000);
            continue;
          }
          throw err;
        }
      }
      throw new Error("replay never uploaded (was the session created with recording: true?)");
    }
    const url = await driver.replayUrl();
    if (!url) return;
    const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`recording download ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > 250 * 1024 * 1024) throw new Error("recording too large to persist");
    await writeFile(join(dir, `seat-${seat.index}.mp4`), buf);
    seat.recordingUrl = `/api/runs/${run.id}/seats/${seat.index}/recording.mp4`;
    seat.replayUrl = `/replay/${run.id}/${seat.index}`;
    this.emitSeatStatus(run, seat);
  }
}
