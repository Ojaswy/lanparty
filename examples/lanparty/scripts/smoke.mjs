// End-to-end smoke test in DEMO MODE: boots the server, starts a party of 6,
// watches the websocket until it finishes, checks the summary, divergence and
// OG image. No keys needed. `node scripts/smoke.mjs`
import { execSync, spawn } from "node:child_process";
import WebSocket from "ws";

const PORT = 8790;
const base = `http://localhost:${PORT}`;
// A stale server from an earlier run would silently answer instead of the
// fresh one we spawn below, so refuse to start if the port already answers.
try {
  await fetch(`${base}/api/info`, { signal: AbortSignal.timeout(1500) });
  console.error(`FAIL something is already listening on :${PORT}; kill it first`);
  process.exit(2);
} catch {
  /* good: nothing there */
}
const server = spawn(process.platform === "win32" ? "npx.cmd" : "npx", ["tsx", "server/index.ts", "--demo"], {
  env: { ...process.env, PORT: String(PORT), DEMO_MODE: "1" },
  stdio: ["ignore", "pipe", "pipe"],
  shell: process.platform === "win32",
});
server.stdout.on("data", (d) => process.stdout.write(`[server] ${d}`));
server.stderr.on("data", (d) => process.stdout.write(`[server:err] ${d}`));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${base}/api/info`);
      if (r.ok) return r.json();
    } catch {}
    await sleep(500);
  }
  throw new Error("server never came up");
}

let failed = false;
const check = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"} ${msg}`);
  if (!cond) failed = true;
};

try {
  const info = await waitForServer();
  check(info.demo === true, "info.demo is true without keys");
  check(Array.isArray(info.tasks) && info.tasks.length >= 4, `tasks listed (${info.tasks?.length})`);

  const created = await fetch(`${base}/api/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ taskId: "denial-appeal", k: 6, desktopSeats: 1 }),
  }).then((r) => r.json());
  check(typeof created.id === "string", `run created ${created.id}`);

  const events = { frames: 0, steps: 0, bubbles: 0, statuses: 0, logs: 0 };
  let finalStatus;
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${PORT}/ws?run=${created.id}`);
    const timer = setTimeout(() => reject(new Error("run did not finish in 120s")), 120_000);
    ws.on("message", (raw) => {
      const ev = JSON.parse(String(raw));
      if (ev.type === "run:snapshot") check(ev.run.k === 6, "snapshot has 6 seats");
      if (ev.type === "seat:frame") events.frames++;
      if (ev.type === "seat:step") events.steps++;
      if (ev.type === "seat:bubble") events.bubbles++;
      if (ev.type === "seat:status") events.statuses++;
      if (ev.type === "log") events.logs++;
      if (ev.type === "run:status" && (ev.status === "done" || ev.status === "cancelled")) {
        finalStatus = ev;
        clearTimeout(timer);
        ws.close();
        resolve();
      }
    });
    ws.on("error", reject);
  });
  console.log("events:", events);
  check(events.frames > 20, "received live frames");
  check(events.steps > 20, "received step events");
  check(events.bubbles > 5, "received bubbles");
  check(finalStatus?.status === "done", "run finished");
  const s = finalStatus?.summary;
  check(s && s.pass + s.fail + s.error === 6, `summary adds up: ${JSON.stringify(s)}`);
  check(s && typeof s.passK?.["1"] === "number" && Math.abs(s.passK["1"] - s.passRate) < 1e-9, `pass^1 equals the graded pass rate (${s?.passK?.["1"]})`);
  if (s && s.passK["2"] !== undefined) check(s.passK["2"] <= s.passRate * s.passRate + 1e-9, `pass^2 (${s.passK["2"].toFixed(3)}) is not above the naive p^2 (${(s.passRate ** 2).toFixed(3)})`);
  const d = finalStatus?.divergence;
  check(d && d.majorityPath.length > 5, `majority path has ${d?.majorityPath.length} steps`);
  const diverged = d?.entries.filter((e) => e.step !== null) ?? [];
  console.log("divergence entries:", d?.entries);
  check(d && d.entries.length === 6, "divergence entry per seat");

  const run = await fetch(`${base}/api/runs/${created.id}`).then((r) => r.json());
  check(run.seats.every((x) => x.steps.length > 0 || x.status === "error"), "every seat has steps");
  check(run.seats[0].steps[0].thumb?.length > 100, "steps carry thumbnails");
  const list = await fetch(`${base}/api/runs`).then((r) => r.json());
  check(list[0].id === created.id && list[0].seats[0].steps[0].thumb === undefined, "listing trims thumbs");
  const og = await fetch(`${base}/og/${created.id}.png`);
  const ogBuf = Buffer.from(await og.arrayBuffer());
  check(og.ok && ogBuf.length > 5000 && ogBuf[1] === 0x50, `og image ${ogBuf.length} bytes`);
  console.log(`diverged seats: ${diverged.map((e) => `#${e.seat}@${e.step}: ${e.summary}`).join(" | ")}`);
} catch (err) {
  console.error("SMOKE ERROR", err);
  failed = true;
} finally {
  if (process.platform === "win32") {
    // `shell: true` means server.pid is the cmd.exe wrapper; /t kills the tree.
    try {
      execSync(`taskkill /pid ${server.pid} /f /t`, { stdio: "ignore" });
    } catch {}
  } else {
    server.kill("SIGTERM");
  }
  await sleep(500);
  process.exit(failed ? 1 : 0);
}
