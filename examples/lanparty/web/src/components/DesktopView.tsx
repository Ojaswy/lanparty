import { useEffect, useRef, useState } from "react";
import RFB from "@novnc/novnc";

/**
 * Seat.streamUrl is a same-origin websocket PATH (`/ws/stream/<run>/<seat>`)
 * relayed view-only by the server; absolute ws(s):// URLs are still accepted
 * (the mock uses one).
 */
export function resolveStreamUrl(streamUrl: string): string {
  if (streamUrl.startsWith("/")) {
    return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${streamUrl}`;
  }
  return streamUrl;
}

/**
 * Live noVNC view of a desktop seat's RFB stream (view-only). If the stream
 * cannot be reached, shows NO SIGNAL — over the seat's last JPEG frame when
 * one is available, so the window is never blank.
 */
export function DesktopView({ streamUrl, fallback }: { streamUrl?: string; fallback?: string | null }) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"connecting" | "live" | "nosignal">("connecting");

  useEffect(() => {
    const el = host.current;
    if (!el || !streamUrl) {
      setState("nosignal");
      return;
    }
    setState("connecting");
    let rfb: any = null;
    try {
      rfb = new RFB(el, resolveStreamUrl(streamUrl), {});
      rfb.viewOnly = true;
      rfb.scaleViewport = true;
      rfb.background = "#000";
      rfb.addEventListener("connect", () => setState("live"));
      rfb.addEventListener("disconnect", () => setState("nosignal"));
      rfb.addEventListener("securityfailure", () => setState("nosignal"));
    } catch {
      setState("nosignal");
    }
    return () => {
      try {
        rfb?.disconnect();
      } catch {
        /* ignore */
      }
      el.replaceChildren();
    };
  }, [streamUrl]);

  const showFallback = state !== "live" && !!fallback;
  return (
    <>
      <div className="novnc" ref={host} style={{ display: state === "live" ? "block" : "none" }} />
      {showFallback ? <img src={fallback ?? undefined} alt="last frame" /> : null}
      {state !== "live" ? (
        <div className={showFallback ? "nosignal soft" : "nosignal"}>{state === "connecting" ? "CONNECTING..." : showFallback ? "VNC: NO SIGNAL — last frame" : "NO SIGNAL"}</div>
      ) : null}
    </>
  );
}
