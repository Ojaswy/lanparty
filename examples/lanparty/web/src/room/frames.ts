/**
 * Frame cache: seat index -> latest decoded ImageBitmap (+ the data URL for
 * <img> consumers). Decoding happens off the main thread via createImageBitmap.
 * One run is shown per page, so the cache is keyed by seat index only and
 * cleared when the page switches runs.
 */

export interface FrameEntry {
  bitmap: ImageBitmap;
  w: number;
  h: number;
  at: number;
  dataUrl: string;
}

const frames = new Map<number, FrameEntry>();
const listeners = new Set<(seat: number) => void>();
let version = 0;
let currentRun = "";

function b64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function sniffMime(b64: string): string {
  // JPEG base64 starts with "/9j/", PNG with "iVBOR".
  if (b64.startsWith("iVBOR")) return "image/png";
  if (b64.startsWith("R0lGOD")) return "image/gif";
  return "image/jpeg";
}

export function bindRun(runId: string): void {
  if (runId === currentRun) return;
  currentRun = runId;
  clearFrames();
}

export function clearFrames(): void {
  for (const f of frames.values()) {
    try {
      f.bitmap.close();
    } catch {
      /* ignore */
    }
  }
  frames.clear();
  version++;
}

/** Decode a base64 image and store it as the seat's latest frame. Resolves after decode. */
export async function pushFrame(seat: number, b64: string, w: number, h: number, at: number): Promise<void> {
  const raw = b64.includes(",") ? b64.slice(b64.indexOf(",") + 1) : b64;
  const mime = sniffMime(raw);
  const dataUrl = `data:${mime};base64,${raw}`;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(b64ToBlob(raw, mime));
  } catch {
    return;
  }
  const prev = frames.get(seat);
  // Never let a slow decode of an old frame clobber a newer one.
  if (prev && prev.at > at) {
    bitmap.close();
    return;
  }
  frames.set(seat, { bitmap, w: w || bitmap.width, h: h || bitmap.height, at, dataUrl });
  if (prev) {
    try {
      prev.bitmap.close();
    } catch {
      /* ignore */
    }
  }
  version++;
  for (const l of listeners) l(seat);
}

/** Use a step thumbnail as the frame when no live frame has arrived yet (snapshots, result page). */
export async function pushThumbIfEmpty(seat: number, thumbB64: string | undefined, at: number): Promise<void> {
  if (!thumbB64) return;
  const cur = frames.get(seat);
  if (cur && cur.at >= at) return;
  await pushFrame(seat, thumbB64, 0, 0, at);
}

export function getFrame(seat: number): FrameEntry | undefined {
  return frames.get(seat);
}

export function frameVersion(): number {
  return version;
}

export function subscribeFrames(cb: (seat: number) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
