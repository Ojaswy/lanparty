/** Tiny counting semaphore: gates how many seats talk to the model at once. */
export class Semaphore {
  private queue: Array<() => void> = [];
  private active = 0;

  constructor(public readonly limit: number) {}

  async acquire(signal?: AbortSignal): Promise<() => void> {
    if (this.active < this.limit) {
      this.active++;
      return this.release;
    }
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        this.queue = this.queue.filter((r) => r !== resolve);
        reject(new Error("aborted while waiting for the model gate"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.queue.push(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      });
    });
    this.active++;
    return this.release;
  }

  /** How many are waiting for a slot right now. */
  get waiting(): number {
    return this.queue.length;
  }

  private release = () => {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  };
}

/** C(n, k) as a float (n, k small). */
export function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  k = Math.min(k, n - k);
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

/**
 * Unbiased pass^j estimator from tau-bench: with c passes in n trials, the
 * probability that j independent fresh trials all pass is C(c, j) / C(n, j).
 * (The naive (c/n)^j overestimates it.)
 */
export function passPow(c: number, n: number, j: number): number {
  if (n <= 0 || j > n) return NaN;
  return choose(c, j) / choose(n, j);
}

export function passKCurve(c: number, n: number, js: number[] = [1, 2, 4, 8]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const j of js) if (j <= n) out[String(j)] = passPow(c, n, j);
  return out;
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}
