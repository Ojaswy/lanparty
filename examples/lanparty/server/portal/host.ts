/**
 * Host the mock insurance portal inside a Solari sandbox.
 *
 * Why a sandbox: the cloud browsers run on Solari's network, so a portal on
 * your laptop's localhost is unreachable from them. A sandbox boots from a
 * snapshot in about a second, we write the portal files in, start the
 * Python server in the background, and `previewUrl()` hands back a public
 * https URL on *.preview.getsolari.com that both the seats and the grader
 * can reach. One sandbox serves every seat; each seat carries its own key.
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Sandbox, SolariClient } from "@solarisdk/sdk";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = 8080;

export class PortalHost {
  private sandbox?: Sandbox;
  private url?: string;
  private booting?: Promise<string>;
  private keepalive?: NodeJS.Timeout;

  constructor(
    private readonly sdk: SolariClient,
    private readonly log: (level: "info" | "warn" | "error", text: string) => void,
  ) {}

  private releaseTimer?: NodeJS.Timeout;

  /** Shut the portal sandbox down after a grace period unless another run claims it. */
  releaseLater(graceMs = 3 * 60_000): void {
    if (this.releaseTimer) clearTimeout(this.releaseTimer);
    this.releaseTimer = setTimeout(() => {
      this.releaseTimer = undefined;
      this.log("info", "no party needed the portal for a while; releasing its sandbox");
      void this.shutdown();
    }, graceMs);
  }

  /** Public URL of a running portal, booting one if needed. Safe to call concurrently. */
  async ensure(): Promise<string> {
    if (this.releaseTimer) {
      clearTimeout(this.releaseTimer);
      this.releaseTimer = undefined;
    }
    if (this.url && (await this.healthy(this.url))) return this.url;
    if (!this.booting) this.booting = this.boot().finally(() => (this.booting = undefined));
    return this.booting;
  }

  private async healthy(url: string): Promise<boolean> {
    try {
      const res = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(4000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  private async boot(): Promise<string> {
    await this.shutdown();
    this.log("info", "booting a Solari sandbox to host the insurance portal…");
    const t0 = Date.now();
    const sandbox = await this.sdk.sandboxes.create({
      template: "base",
      cpu: 1,
      memMb: 2048,
      timeoutMs: 60 * 60_000,
      lifecycle: { onTimeout: "kill" },
      metadata: { app: "lanparty", role: "portal" },
    });
    this.sandbox = sandbox;
    await sandbox.connect();

    const [serverPy, indexHtml] = await Promise.all([
      readFile(join(here, "server.py"), "utf8"),
      readFile(join(here, "static", "index.html"), "utf8"),
    ]);
    await sandbox.commands.run("sh", { args: ["-c", "mkdir -p /opt/portal/static"] });
    await sandbox.files.write("/opt/portal/server.py", serverPy);
    await sandbox.files.write("/opt/portal/static/index.html", indexHtml);
    // commands.run waits for exit, so background the server with a shell
    // (this is what the cookbook's port-preview example does). If the guest
    // reaps the detached child, fall back to a long-lived commands.start handle.
    await sandbox.commands.run("sh", {
      args: ["-c", `cd /opt/portal && PORT=${PORT} nohup python3 server.py > /tmp/portal.log 2>&1 &`],
    });
    const { url } = await sandbox.previewUrl(PORT);
    const base = url.replace(/\/+$/, "");

    for (let i = 0; i < 40; i++) {
      if (i === 12 && !(await this.healthy(base))) {
        this.log("warn", "portal not up via nohup after 9s; starting it with commands.start instead");
        await sandbox.commands
          .start("python3", { args: ["server.py"], cwd: "/opt/portal", env: { PORT: String(PORT) }, background: true })
          .catch((err) => this.log("warn", `commands.start failed: ${(err as Error).message}`));
      }
      if (await this.healthy(base)) {
        this.url = base;
        this.log("info", `portal is live at ${base} (${Date.now() - t0}ms)`);
        this.keepalive = setInterval(() => void sandbox.setTimeout(60 * 60_000).catch(() => {}), 15 * 60_000);
        return base;
      }
      await new Promise((r) => setTimeout(r, 750));
    }
    const tail = await sandbox.commands.run("sh", { args: ["-c", "tail -n 20 /tmp/portal.log"] }).catch(() => ({ stdout: "" }));
    throw new Error(`portal never became healthy at ${base}. log: ${tail.stdout}`);
  }

  get publicUrl(): string | undefined {
    return this.url;
  }

  async shutdown(): Promise<void> {
    if (this.keepalive) clearInterval(this.keepalive);
    this.keepalive = undefined;
    if (this.releaseTimer) clearTimeout(this.releaseTimer);
    this.releaseTimer = undefined;
    const sb = this.sandbox;
    this.sandbox = undefined;
    this.url = undefined;
    if (sb) await sb.kill().catch(() => {});
  }
}
