/**
 * A seat backed by a Solari cloud browser.
 *
 * `solari.launch()` returns a Playwright-compatible browser (patchright under
 * the hood, no local Playwright install). We drive it with the standard
 * Playwright page API, stream a small JPEG screencast to the room, and turn on
 * `recording` so every seat gets a shareable rrweb replay link when it closes.
 */
import type { Solari, BrowserSession } from "@solarisdk/browser";
import type { Page } from "patchright-core";
import type { StepAction, TaskDef } from "../../shared/types.js";
import { coord, sleep, toPlaywrightChord, toPlaywrightKey, type SeatDriver, type SeatDriverEvents } from "./types.js";

const SCROLL_PX_PER_CLICK = 100;
const MAX_WAIT_S = 15;

export interface BrowserSeatOptions {
  solari: Solari;
  task: TaskDef;
  /** Final start URL with `{seat}`/`{run}` already substituted. */
  startUrl: string;
  width?: number;
  height?: number;
  events?: SeatDriverEvents;
}

export class BrowserSeat implements SeatDriver {
  readonly kind = "browser" as const;
  readonly width: number;
  readonly height: number;
  sessionId?: string;
  streamUrl?: string;

  private browser?: BrowserSession;
  private page?: Page;
  private cursor: [number, number] = [0, 0];
  private screencastStop?: () => Promise<void> | void;
  private closed = false;
  private lastFrameAt = 0;

  constructor(private readonly opts: BrowserSeatOptions) {
    this.width = opts.width ?? 1280;
    this.height = opts.height ?? 800;
  }

  private log(level: "info" | "warn" | "error", text: string) {
    this.opts.events?.onLog?.(level, text);
  }

  async boot(): Promise<void> {
    const { solari, task } = this.opts;
    // recording: true is per session, not per account. Without it the replay
    // endpoint 404s forever.
    this.browser = await solari.launch({
      recording: true,
      stealth: task.stealth ?? false,
      profileId: task.profileId,
      retries: 1,
    });
    this.sessionId = this.browser.id;
    const context = this.browser.contexts()[0] ?? (await this.browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());
    this.page = page;
    await page.setViewportSize({ width: this.width, height: this.height });
    page.setDefaultTimeout(15_000);
    page.on("dialog", (d) => d.dismiss().catch(() => {}));

    // Live view for the CRT: Playwright's screencast delivers JPEG frames as
    // the page changes, no polling.
    try {
      await page.screencast.start({
        onFrame: ({ data, viewportWidth, viewportHeight }) => {
          const now = Date.now();
          if (now - this.lastFrameAt < 350) return; // ~3 fps is plenty for a 160px CRT
          this.lastFrameAt = now;
          this.opts.events?.onFrame?.(data, viewportWidth, viewportHeight);
        },
        size: { width: 320, height: 200 },
        quality: 45,
      });
      this.screencastStop = () => page.screencast.stop();
    } catch (err) {
      this.log("warn", `screencast unavailable, falling back to polling: ${(err as Error).message}`);
      this.startPolling();
    }

    await page.goto(this.opts.startUrl, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
  }

  private pollTimer?: NodeJS.Timeout;
  private startPolling() {
    this.pollTimer = setInterval(async () => {
      if (this.closed || !this.page) return;
      try {
        const jpeg = await this.page.screenshot({ type: "jpeg", quality: 40 });
        this.opts.events?.onFrame?.(jpeg, this.width, this.height);
      } catch {
        /* page navigating */
      }
    }, 1200);
  }

  private get p(): Page {
    if (!this.page) throw new Error("seat not booted");
    return this.page;
  }

  private lastTargetLabel?: string;

  lastTarget(): string | undefined {
    return this.lastTargetLabel;
  }

  /**
   * Endpoints for an external agent (loopback-wrapped by the SDK, so they only
   * work from the same host as this server). `connectOverCDP` is version-agnostic;
   * the Playwright wire endpoint needs patchright-core 1.62.x on the client.
   */
  endpoints(): { cdpEndpoint: string; wsEndpoint: string } | undefined {
    if (!this.browser) return undefined;
    return { cdpEndpoint: this.browser.cdpEndpoint, wsEndpoint: this.browser.wsEndpoint };
  }

  /** "button:Submit Appeal", "input:Claim Number", "a:File an Appeal" — what's under the cursor. */
  private async labelAt(x: number, y: number): Promise<string | undefined> {
    try {
      const label = await this.p.evaluate(
        ({ x, y }) => {
          const el = document.elementFromPoint(x, y);
          if (!el) return "";
          const best =
            (el.closest("button,a,input,select,textarea,label,summary,[role=button],[role=link],[role=menuitem],[role=option],[role=tab],[role=checkbox]") as HTMLElement | null) ??
            (el as HTMLElement);
          const tag = best.tagName.toLowerCase();
          const attr = (n: string) => best.getAttribute(n) ?? "";
          let text = "";
          if (tag === "input") {
            const i = best as HTMLInputElement;
            text = attr("aria-label") || (i.type === "submit" || i.type === "button" ? i.value : "") || i.placeholder || i.name || i.id || i.type;
          } else if (tag === "select" || tag === "textarea") {
            text = attr("aria-label") || (best as HTMLSelectElement).name || best.id || attr("placeholder");
          } else {
            text = attr("aria-label") || (best as HTMLElement).innerText || attr("alt") || attr("title") || attr("value");
          }
          return `${tag}:${text}`.replace(/\s+/g, " ").trim().slice(0, 48);
        },
        { x, y },
      );
      return label || undefined;
    } catch {
      return undefined;
    }
  }

  async screenshot(): Promise<Buffer> {
    return this.p.screenshot({ type: "png" });
  }

  async zoom(region: [number, number, number, number]): Promise<Buffer> {
    const [x0, y0, x1, y1] = region;
    const clip = {
      x: Math.max(0, Math.min(x0, x1)),
      y: Math.max(0, Math.min(y0, y1)),
      width: Math.max(8, Math.abs(x1 - x0)),
      height: Math.max(8, Math.abs(y1 - y0)),
    };
    return this.p.screenshot({ type: "png", clip });
  }

  private async withModifiers<T>(text: unknown, fn: () => Promise<T>): Promise<T> {
    const mods = typeof text === "string" && text.trim() ? text.split("+").map((m) => toPlaywrightKey(m.trim())) : [];
    for (const m of mods) await this.p.keyboard.down(m);
    try {
      return await fn();
    } finally {
      for (const m of mods.reverse()) await this.p.keyboard.up(m);
    }
  }

  async act(action: StepAction): Promise<string | undefined> {
    const page = this.p;
    const input = action.input ?? {};
    const c = coord(input);
    const mouse = page.mouse;
    const moveTo = async (xy?: [number, number]) => {
      if (!xy) return;
      this.cursor = xy;
      await mouse.move(xy[0], xy[1], { steps: 4 });
    };
    this.lastTargetLabel = undefined;
    if (action.name.endsWith("_click") && action.name !== "left_click_drag") {
      const [x, y] = c ?? this.cursor;
      this.lastTargetLabel = await this.labelAt(x, y);
    }

    switch (action.name) {
      case "screenshot":
      case "zoom":
        return undefined; // handled by the loop (returns an image)
      case "left_click":
      case "right_click":
      case "middle_click":
      case "double_click":
      case "triple_click": {
        const button = action.name === "right_click" ? "right" : action.name === "middle_click" ? "middle" : "left";
        const clickCount = action.name === "double_click" ? 2 : action.name === "triple_click" ? 3 : 1;
        await moveTo(c);
        await this.withModifiers(input.text, async () => {
          await mouse.click(this.cursor[0], this.cursor[1], { button, clickCount });
        });
        await this.settle();
        return "OK";
      }
      case "left_click_drag": {
        const from = coord(input, "start_coordinate") ?? this.cursor;
        const to = c ?? this.cursor;
        await this.withModifiers(input.text, async () => {
          await mouse.move(from[0], from[1]);
          await mouse.down();
          await mouse.move(to[0], to[1], { steps: 12 });
          await mouse.up();
        });
        this.cursor = to;
        await this.settle();
        return "OK";
      }
      case "mouse_move":
        await moveTo(c);
        return "OK";
      case "left_mouse_down":
        await mouse.down();
        return "OK";
      case "left_mouse_up":
        await mouse.up();
        return "OK";
      case "cursor_position":
        return `X=${this.cursor[0]}, Y=${this.cursor[1]}`;
      case "scroll": {
        await moveTo(c);
        const dir = String(input.scroll_direction ?? "down");
        const amount = Number(input.scroll_amount ?? 3) * SCROLL_PX_PER_CLICK;
        const dx = dir === "left" ? -amount : dir === "right" ? amount : 0;
        const dy = dir === "up" ? -amount : dir === "down" ? amount : 0;
        await this.withModifiers(input.text, async () => {
          await mouse.wheel(dx, dy);
        });
        await sleep(250);
        return "OK";
      }
      case "type": {
        const text = String(input.text ?? "");
        await page.keyboard.type(text, { delay: 8 });
        await this.settle(150);
        return "OK";
      }
      case "key": {
        const chord = toPlaywrightChord(String(input.text ?? ""));
        const repeat = Math.max(1, Math.min(100, Number(input.repeat ?? 1)));
        for (let i = 0; i < repeat; i++) await page.keyboard.press(chord);
        await this.settle();
        return "OK";
      }
      case "hold_key": {
        const chord = toPlaywrightChord(String(input.text ?? ""));
        const keys = chord.split("+");
        const duration = Math.min(MAX_WAIT_S, Number(input.duration ?? 1)) * 1000;
        for (const k of keys) await page.keyboard.down(k);
        await sleep(duration);
        for (const k of keys.reverse()) await page.keyboard.up(k);
        return "OK";
      }
      case "wait": {
        const duration = Math.min(MAX_WAIT_S, Math.max(0, Number(input.duration ?? 1))) * 1000;
        await sleep(duration);
        return "OK";
      }
      default:
        throw new Error(`Unsupported computer action: ${action.name}`);
    }
  }

  /** Give the page a beat to react (navigation, animations) before the next screenshot. */
  private async settle(ms = 400): Promise<void> {
    await sleep(ms);
    await this.p.waitForLoadState("domcontentloaded", { timeout: 3_000 }).catch(() => {});
  }

  async url(): Promise<string | undefined> {
    try {
      return this.p.url();
    } catch {
      return undefined;
    }
  }

  async pageText(): Promise<string> {
    try {
      return await this.p.evaluate(() => document.body?.innerText ?? "");
    } catch {
      return "";
    }
  }

  async hasSelector(selector: string): Promise<boolean> {
    try {
      return (await this.p.locator(selector).count()) > 0;
    } catch {
      return false;
    }
  }

  async teardown(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    try {
      await this.screencastStop?.();
    } catch {
      /* ignore */
    }
    try {
      // Give rrweb a moment to flush batched events before release.
      await sleep(800);
      await this.browser?.close();
    } catch (err) {
      this.log("warn", `close failed: ${(err as Error).message}`);
    }
  }

  async replayUrl(): Promise<string | undefined> {
    if (!this.sessionId) return undefined;
    // The upload happens asynchronously after release; the first polls 404.
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        const { url } = await this.opts.solari.sessions.getReplayUrl(this.sessionId);
        if (url) return url;
      } catch {
        /* not uploaded yet */
      }
      await sleep(2500);
    }
    return undefined;
  }
}
