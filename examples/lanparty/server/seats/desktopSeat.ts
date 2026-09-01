/**
 * A seat backed by a Solari desktop: a real Ubuntu GUI in a microVM with an
 * X11 display and a VNC stream. The client mounts noVNC on `streamUrl` for the
 * premium-seat close-up; the room's CRT gets periodic JPEG frames from here.
 *
 * Gotchas encoded here (from the cookbook):
 *   - wait for `health().ready` before driving the GUI
 *   - `close()` only drops the local channel; `destroy()`/`kill()` ends the VM
 *   - `timeoutMs` is a rolling idle window, not a deadline
 */
import type { Desktop, DesktopClient } from "@solarisdk/sdk";
import sharp from "sharp";
import type { StepAction, TaskDef } from "../../shared/types.js";
import { coord, sleep, type SeatDriver, type SeatDriverEvents } from "./types.js";

const MAX_WAIT_S = 15;

export interface DesktopSeatOptions {
  desktops: DesktopClient;
  task: TaskDef;
  /** URL to open in Chrome for browser-style tasks run on a desktop; ignored when task.openApp is set. */
  startUrl?: string;
  width?: number;
  height?: number;
  events?: SeatDriverEvents;
  /** Boot from this snapshot instead of the template (identical starting state for every seat). */
  fromSnapshot?: string;
}

export class DesktopSeat implements SeatDriver {
  readonly kind = "desktop" as const;
  readonly width: number;
  readonly height: number;
  sessionId?: string;
  streamUrl?: string;

  private desktop?: Desktop;
  private cursor: [number, number] = [0, 0];
  private frameTimer?: NodeJS.Timeout;
  private closed = false;

  constructor(private readonly opts: DesktopSeatOptions) {
    this.width = opts.width ?? 1280;
    this.height = opts.height ?? 720;
  }

  private log(level: "info" | "warn" | "error", text: string) {
    this.opts.events?.onLog?.(level, text);
  }

  private get d(): Desktop {
    if (!this.desktop) throw new Error("seat not booted");
    return this.desktop;
  }

  async boot(): Promise<void> {
    const { desktops, task } = this.opts;
    const desktop = await desktops.create({
      template: task.desktopTemplate ?? "default",
      resolution: `${this.width}x${this.height}`,
      record: true,
      timeoutMs: 10 * 60_000,
      lifecycle: { onTimeout: "kill" },
      metadata: { app: "lanparty", task: task.id },
    });
    this.desktop = desktop;
    this.sessionId = desktop.sessionId;
    this.streamUrl = desktop.streamUrl;
    await desktop.connect();

    for (let i = 0; i < 40; i++) {
      const h = await desktop.health().catch(() => ({ ready: false }));
      if (h.ready) break;
      await sleep(1000);
    }

    try {
      await desktop.record.start({ fps: 8 });
    } catch (err) {
      this.log("warn", `recording not started: ${(err as Error).message}`);
    }

    if (task.openApp) {
      await desktop.open(task.openApp.name, task.openApp.args);
    } else if (this.opts.startUrl) {
      // The default template ships Chrome. Kiosk-ish flags keep the first-run
      // dialogs out of the agent's way.
      try {
        await desktop.open("google-chrome", ["--no-first-run", "--disable-infobars", "--start-maximized", this.opts.startUrl]);
      } catch {
        await desktop.open("chromium", ["--no-first-run", "--start-maximized", this.opts.startUrl]);
      }
    }
    await sleep(4000);

    this.frameTimer = setInterval(() => void this.pushFrame(), 1500);
    void this.pushFrame();
  }

  private pushing = false;
  private async pushFrame(): Promise<void> {
    if (this.closed || this.pushing || !this.desktop || !this.opts.events?.onFrame) return;
    this.pushing = true;
    try {
      const jpeg = await this.desktop.screenshot({ format: "jpeg", quality: 55 });
      const small = await sharp(Buffer.from(jpeg)).resize(320).jpeg({ quality: 45 }).toBuffer();
      this.opts.events.onFrame(small, 320, Math.round((320 * this.height) / this.width));
    } catch {
      /* transient */
    } finally {
      this.pushing = false;
    }
  }

  async screenshot(): Promise<Buffer> {
    const png = await this.d.screenshot({ format: "png" });
    return Buffer.from(png);
  }

  async zoom(region: [number, number, number, number]): Promise<Buffer> {
    const [x0, y0, x1, y1] = region;
    const left = Math.max(0, Math.min(x0, x1));
    const top = Math.max(0, Math.min(y0, y1));
    const width = Math.max(8, Math.min(this.width - left, Math.abs(x1 - x0)));
    const height = Math.max(8, Math.min(this.height - top, Math.abs(y1 - y0)));
    const png = await this.screenshot();
    return sharp(png).extract({ left, top, width, height }).png().toBuffer();
  }

  /** Solari's keyboard API takes xdotool-style key names, same as Claude's. */
  private keys(text: string): string[] {
    return text
      .split("+")
      .map((k) => k.trim())
      .filter(Boolean);
  }

  async act(action: StepAction): Promise<string | undefined> {
    const d = this.d;
    const input = action.input ?? {};
    const c = coord(input);
    const mods = typeof input.text === "string" && input.text.trim() && action.name !== "type" && action.name !== "key" && action.name !== "hold_key" ? this.keys(input.text) : [];
    const withMods = async (fn: () => Promise<void>) => {
      if (mods.length) await d.keyboard.down(mods);
      try {
        await fn();
      } finally {
        if (mods.length) await d.keyboard.up(mods);
      }
    };

    switch (action.name) {
      case "screenshot":
      case "zoom":
        return undefined;
      case "left_click":
      case "right_click":
      case "middle_click": {
        const button = action.name === "right_click" ? "right" : action.name === "middle_click" ? "middle" : "left";
        if (c) this.cursor = c;
        await withMods(() => d.mouse.click(this.cursor[0], this.cursor[1], { button, humanize: true }));
        await sleep(500);
        return "OK";
      }
      case "double_click": {
        if (c) this.cursor = c;
        await withMods(() => d.mouse.doubleClick(this.cursor[0], this.cursor[1], { humanize: true }));
        await sleep(500);
        return "OK";
      }
      case "triple_click": {
        if (c) this.cursor = c;
        await withMods(async () => {
          await d.mouse.doubleClick(this.cursor[0], this.cursor[1]);
          await d.mouse.click(this.cursor[0], this.cursor[1]);
        });
        await sleep(400);
        return "OK";
      }
      case "left_click_drag": {
        const from = coord(input, "start_coordinate") ?? this.cursor;
        const to = c ?? this.cursor;
        await withMods(() => d.mouse.drag({ x: from[0], y: from[1] }, { x: to[0], y: to[1] }, "left"));
        this.cursor = to;
        await sleep(400);
        return "OK";
      }
      case "mouse_move":
        if (c) {
          this.cursor = c;
          await d.mouse.move(c[0], c[1], { humanize: true });
        }
        return "OK";
      case "left_mouse_down":
        await d.mouse.down(this.cursor[0], this.cursor[1], "left");
        return "OK";
      case "left_mouse_up":
        await d.mouse.up(this.cursor[0], this.cursor[1], "left");
        return "OK";
      case "cursor_position": {
        const pos = await d.display.cursor().catch(() => ({ x: this.cursor[0], y: this.cursor[1] }));
        return `X=${pos.x}, Y=${pos.y}`;
      }
      case "scroll": {
        if (c) {
          this.cursor = c;
          await d.mouse.move(c[0], c[1]);
        }
        const dir = String(input.scroll_direction ?? "down");
        const amount = Math.max(1, Math.min(30, Number(input.scroll_amount ?? 3)));
        // X11 wheel = buttons 4/5 (vertical) and 6/7 (horizontal). xdotool ships
        // with the desktop template's X stack; fall back to keys if it doesn't.
        const btn = dir === "up" ? "4" : dir === "left" ? "6" : dir === "right" ? "7" : "5";
        const res = await d
          .exec("xdotool", { args: ["mousemove", String(this.cursor[0]), String(this.cursor[1]), "click", "--repeat", String(amount), "--delay", "30", btn] })
          .catch(() => ({ exitCode: 1, stdout: "", stderr: "" }));
        if (res.exitCode !== 0) {
          await d.keyboard.press(dir === "up" ? ["Page_Up"] : ["Page_Down"]);
        }
        await sleep(300);
        return "OK";
      }
      case "type": {
        await d.keyboard.type(String(input.text ?? ""));
        await sleep(200);
        return "OK";
      }
      case "key": {
        const keys = this.keys(String(input.text ?? ""));
        const repeat = Math.max(1, Math.min(100, Number(input.repeat ?? 1)));
        for (let i = 0; i < repeat; i++) await d.keyboard.press(keys);
        await sleep(300);
        return "OK";
      }
      case "hold_key": {
        const keys = this.keys(String(input.text ?? ""));
        const duration = Math.min(MAX_WAIT_S, Number(input.duration ?? 1)) * 1000;
        await d.keyboard.down(keys);
        await sleep(duration);
        await d.keyboard.up(keys);
        return "OK";
      }
      case "wait": {
        await sleep(Math.min(MAX_WAIT_S, Math.max(0, Number(input.duration ?? 1))) * 1000);
        return "OK";
      }
      default:
        throw new Error(`Unsupported computer action: ${action.name}`);
    }
  }

  async url(): Promise<string | undefined> {
    return undefined;
  }

  /** No DOM on a desktop; the divergence report falls back to screen-grid cells. */
  lastTarget(): string | undefined {
    return undefined;
  }

  async pageText(): Promise<string> {
    return "";
  }

  async hasSelector(): Promise<boolean> {
    return false;
  }

  /** Checkpoint the VM (it keeps running). Used for fork-from-step. */
  async snapshot(name?: string): Promise<string> {
    return this.d.snapshot(name);
  }

  private recordingUrl?: string;

  async teardown(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.frameTimer) clearInterval(this.frameTimer);
    const d = this.desktop;
    if (!d) return;
    try {
      await d.record.stop();
      this.recordingUrl = d.recordingUrl;
    } catch {
      /* no recording */
    }
    try {
      d.close();
      await this.opts.desktops.destroy(d.sessionId);
    } catch (err) {
      this.log("warn", `destroy failed: ${(err as Error).message}`);
    }
  }

  async replayUrl(): Promise<string | undefined> {
    return this.recordingUrl ?? this.desktop?.recordingUrl;
  }
}
