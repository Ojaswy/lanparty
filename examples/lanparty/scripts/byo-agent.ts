/**
 * Bring-your-own-agent reference client.
 *
 * LANPARTY boots the seats; your agent sits down. This one is deliberately
 * dumb — plain Playwright selectors on the saucedemo checkout — to show the
 * contract, not to be clever:
 *
 *   1. POST /api/runs { taskId, k, agent: "external" }        → { id }
 *   2. GET  /api/runs/:id/seats  (poll until status "running") → cdpEndpoint per seat
 *   3. chromium.connectOverCDP(cdpEndpoint), do the task
 *   4. POST .../seats/:n/steps for each action (optional; feeds the divergence report)
 *   5. POST .../seats/:n/done   → LANPARTY grades the seat and tears it down
 *
 * Endpoints are loopback-wrapped by the Solari SDK, so run this on the same
 * host as the LANPARTY server. Any language works; this is ~80 lines of TS.
 *
 *   npx tsx scripts/byo-agent.ts --k 3 --task saucedemo-checkout
 */
import { chromium } from "patchright-core";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1] ?? "true"] : [])).filter((x) => x.length));
const BASE = (args.server ?? "http://localhost:8787").replace(/\/+$/, "");
const K = Number(args.k ?? 2);
const TASK = args.task ?? "saucedemo-checkout";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const { id } = (await post(`${BASE}/api/runs`, { taskId: TASK, k: K, agent: "external", label: "byo-agent.ts" }).then((r) => r.json())) as { id: string };
console.log(`party ${id} created → watch it at ${BASE.replace("8787", "5173")}/run/${id}`);

interface SeatInfo {
  seat: number;
  status: string;
  cdpEndpoint?: string;
  startUrl?: string;
  doneUrl: string;
  stepsUrl: string;
}

async function seats(): Promise<SeatInfo[]> {
  return (await fetch(`${BASE}/api/runs/${id}/seats`).then((r) => r.json())).seats as SeatInfo[];
}

async function drive(info: SeatInfo): Promise<void> {
  const step = (name: string, input: Record<string, unknown>, target?: string, note?: string, url?: string) =>
    post(info.stepsUrl, { action: { name, input }, target, note, url }).catch(() => {});
  const browser = await chromium.connectOverCDP(info.cdpEndpoint!);
  try {
    const ctx = browser.contexts()[0];
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    if (!page.url().startsWith("https://www.saucedemo.com")) await page.goto(info.startUrl ?? "https://www.saucedemo.com/");
    const click = async (sel: string, label: string, note?: string) => {
      const box = await page.locator(sel).first().boundingBox();
      await page.locator(sel).first().click();
      await step("left_click", { coordinate: box ? [Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2)] : [0, 0] }, label, note, page.url());
    };
    const type = async (sel: string, text: string, label: string) => {
      await page.locator(sel).fill(text);
      await step("type", { text }, label, undefined, page.url());
    };
    await type("#user-name", "standard_user", "input:user-name");
    await type("#password", "secret_sauce", "input:password");
    await click("#login-button", "input:Login", "Logging in with the demo credentials.");
    await click("#add-to-cart-sauce-labs-backpack", "button:Add to cart", "Adding the backpack.");
    await click(".shopping_cart_link", "a:cart");
    await click("#checkout", "button:Checkout");
    await type("#first-name", "Ada", "input:first-name");
    await type("#last-name", "Lovelace", "input:last-name");
    await type("#postal-code", "10115", "input:postal-code");
    await click("#continue", "input:Continue");
    await click("#finish", "button:Finish", "Finishing the order.");
    await page.waitForSelector("text=Thank you for your order", { timeout: 10_000 }).catch(() => {});
    await post(info.doneUrl, { claimed: `DONE: ${await page.title()}` });
    console.log(`seat ${info.seat}: done`);
  } catch (err) {
    console.error(`seat ${info.seat}: ${(err as Error).message}`);
    await post(info.doneUrl, { claimed: `GIVE UP: ${(err as Error).message}` });
  } finally {
    // Disconnect our client only; LANPARTY owns the session and closes it after grading.
    await browser.close().catch(() => {});
  }
}

const started = new Set<number>();
for (let i = 0; i < 600 && started.size < K; i++) {
  for (const s of await seats()) {
    if (s.status === "running" && s.cdpEndpoint && !started.has(s.seat)) {
      started.add(s.seat);
      void drive(s);
    }
  }
  await sleep(1000);
}
// Wait for the party to finish, then print the scoreboard.
for (;;) {
  const run = (await fetch(`${BASE}/api/runs/${id}`).then((r) => r.json())) as { status: string; summary?: { pass: number; k: number; passRate: number } };
  if (run.status === "done" || run.status === "cancelled") {
    console.log(`party ${run.status}: ${run.summary?.pass}/${run.summary?.k} passed`);
    break;
  }
  await sleep(2000);
}
