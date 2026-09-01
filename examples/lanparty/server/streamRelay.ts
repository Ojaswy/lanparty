/**
 * View-only relay for desktop VNC streams.
 *
 * A desktop's `streamUrl` is a signed capability: anyone holding it can move
 * the mouse. Public result pages must never carry it. Instead the browser
 * connects to `/ws/stream/<run>/<seat>` on this server, which opens the real
 * upstream socket and pipes server→client bytes untouched, while parsing the
 * client→server RFB stream just enough to forward the handshake, pixel-format
 * and framebuffer requests and DROP KeyEvent / PointerEvent / ClientCutText.
 * noVNC's `viewOnly` is advisory; this is the enforcement.
 */
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import WebSocket, { WebSocketServer } from "ws";

const wss = new WebSocketServer({ noServer: true });

export interface StreamResolver {
  /** Return the upstream wss:// URL for a seat, or undefined if unknown/not live. */
  (runId: string, seat: number): string | undefined;
}

export function handleStreamUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, resolve: StreamResolver): boolean {
  const m = /^\/ws\/stream\/([^/]+)\/(\d+)$/.exec(new URL(req.url ?? "/", "http://x").pathname);
  if (!m) return false;
  const upstreamUrl = resolve(m[1], Number(m[2]));
  if (!upstreamUrl) {
    socket.destroy();
    return true;
  }
  wss.handleUpgrade(req, socket, head, (client) => relay(client, upstreamUrl));
  return true;
}

function relay(client: WebSocket, upstreamUrl: string): void {
  const upstream = new WebSocket(upstreamUrl, { perMessageDeflate: false });
  upstream.binaryType = "nodebuffer";
  client.binaryType = "nodebuffer";
  const filter = new ClientFilter();
  const pending: Buffer[] = [];

  upstream.on("open", () => {
    for (const b of pending) upstream.send(b);
    pending.length = 0;
  });
  upstream.on("message", (data) => {
    if (client.readyState === client.OPEN) client.send(data as Buffer);
  });
  client.on("message", (data) => {
    const out = filter.push(Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer));
    if (!out.length) return;
    if (upstream.readyState === upstream.OPEN) upstream.send(out);
    else pending.push(out);
  });
  const closeBoth = () => {
    try {
      client.close();
    } catch {}
    try {
      upstream.close();
    } catch {}
  };
  upstream.on("close", closeBoth);
  upstream.on("error", closeBoth);
  client.on("close", closeBoth);
  client.on("error", closeBoth);
}

/**
 * Parses the client side of RFB 3.x and forwards everything except input.
 * Handshake: ProtocolVersion (12 bytes) → security type (1 byte) [+ 16-byte
 * VNC-auth response if type 2] → ClientInit (1 byte) → messages.
 */
export class ClientFilter {
  private buf = Buffer.alloc(0);
  private phase: "version" | "security" | "auth" | "init" | "messages" = "version";
  private securityType = 1;

  push(chunk: Buffer): Buffer {
    this.buf = Buffer.concat([this.buf, chunk]);
    const out: Buffer[] = [];
    for (;;) {
      const n = this.consume(out);
      if (n === 0) break;
    }
    return Buffer.concat(out);
  }

  /** Consume one unit from buf into out (or drop it). Returns bytes consumed. */
  private consume(out: Buffer[]): number {
    const take = (n: number, forward: boolean): number => {
      if (this.buf.length < n) return 0;
      if (forward) out.push(this.buf.subarray(0, n));
      this.buf = this.buf.subarray(n);
      return n;
    };
    switch (this.phase) {
      case "version": {
        const n = take(12, true);
        if (n) this.phase = "security";
        return n;
      }
      case "security": {
        if (this.buf.length < 1) return 0;
        this.securityType = this.buf[0];
        const n = take(1, true);
        this.phase = this.securityType === 2 ? "auth" : "init";
        return n;
      }
      case "auth": {
        const n = take(16, true);
        if (n) this.phase = "init";
        return n;
      }
      case "init": {
        const n = take(1, true);
        if (n) this.phase = "messages";
        return n;
      }
      case "messages": {
        if (this.buf.length < 1) return 0;
        const type = this.buf[0];
        switch (type) {
          case 0: // SetPixelFormat: 1 + 3 pad + 16
            return take(20, true);
          case 2: {
            // SetEncodings: 1 + 1 pad + 2 count + 4*count
            if (this.buf.length < 4) return 0;
            const count = this.buf.readUInt16BE(2);
            return take(4 + 4 * count, true);
          }
          case 3: // FramebufferUpdateRequest
            return take(10, true);
          case 4: // KeyEvent — dropped
            return take(8, false);
          case 5: // PointerEvent — dropped
            return take(6, false);
          case 6: {
            // ClientCutText: 1 + 3 pad + 4 len + text — dropped
            if (this.buf.length < 8) return 0;
            const len = this.buf.readUInt32BE(4);
            return take(8 + len, false);
          }
          default:
            // Unknown client message: we can't frame it, so drop the rest.
            this.buf = Buffer.alloc(0);
            return 1;
        }
      }
    }
  }
}
