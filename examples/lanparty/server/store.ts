import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Run } from "../shared/types.js";

/**
 * Runs live in memory while active and are flushed to `data/runs/<id>.json`
 * on every meaningful change (debounced). Good enough for a single-node app;
 * swap for a database if you need more than one server.
 */
export class RunStore {
  private readonly runs = new Map<string, Run>();
  private readonly dirty = new Set<string>();
  private flushTimer?: NodeJS.Timeout;

  constructor(private readonly dir: string) {}

  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const files = await readdir(this.dir).catch(() => [] as string[]);
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const run = JSON.parse(await readFile(join(this.dir, f), "utf8")) as Run;
        // A run that was mid-flight when the process died can't be resumed.
        if (run.status === "running" || run.status === "booting") {
          run.status = "cancelled";
          for (const s of run.seats) if (s.status === "running" || s.status === "booting" || s.status === "queued" || s.status === "grading") s.status = "cancelled";
        }
        this.runs.set(run.id, run);
      } catch {
        /* skip corrupt file */
      }
    }
  }

  get(id: string): Run | undefined {
    return this.runs.get(id);
  }

  list(limit = 50): Run[] {
    return [...this.runs.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  }

  put(run: Run): void {
    this.runs.set(run.id, run);
    this.touch(run.id);
  }

  touch(id: string): void {
    this.dirty.add(id);
    if (!this.flushTimer) this.flushTimer = setTimeout(() => void this.flush(), 1500);
  }

  async flush(): Promise<void> {
    this.flushTimer = undefined;
    const ids = [...this.dirty];
    this.dirty.clear();
    await Promise.all(
      ids.map(async (id) => {
        const run = this.runs.get(id);
        if (!run) return;
        await writeFile(join(this.dir, `${id}.json`), JSON.stringify(run)).catch(() => {});
      }),
    );
  }
}

/** Listing view: seats without step thumbnails, so /api/runs stays small. */
export function trimRun(run: Run): Run {
  return {
    ...run,
    seats: run.seats.map((s) => ({ ...s, steps: s.steps.map((st) => ({ ...st, thumb: undefined })) })),
  };
}
