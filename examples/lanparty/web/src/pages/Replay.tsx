import { useEffect, useRef, useState } from "react";
import type { Run, Seat } from "../../../shared/types";
import { fmtMs, fmtUsd, getRun, pad2 } from "../api";
import { href, navigate, onLinkClick } from "../router";
import { Window } from "../ui/Window";
import { Button } from "../ui/Button";
import { StepTape } from "../components/StepTape";

// rrweb-player 2.1.1 UMD build (its package.json `jsdelivr` field points at umd/) + stylesheet.
const RRWEB_JS = "https://cdn.jsdelivr.net/npm/rrweb-player@2.1.1/umd/rrweb-player.min.js";
const RRWEB_CSS = "https://cdn.jsdelivr.net/npm/rrweb-player@2.1.1/dist/style.css";

type RrwebPlayerCtor = new (opts: { target: HTMLElement; props: Record<string, unknown> }) => { $destroy?: () => void; pause?: () => void };

let rrwebLoading: Promise<RrwebPlayerCtor> | null = null;

/** Load the player from the CDN at runtime (no npm dependency). */
function loadRrwebPlayer(): Promise<RrwebPlayerCtor> {
  const w = window as unknown as { rrwebPlayer?: RrwebPlayerCtor };
  if (w.rrwebPlayer) return Promise.resolve(w.rrwebPlayer);
  if (rrwebLoading) return rrwebLoading;
  rrwebLoading = new Promise<RrwebPlayerCtor>((resolve, reject) => {
    if (!document.querySelector(`link[href="${RRWEB_CSS}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = RRWEB_CSS;
      document.head.appendChild(link);
    }
    const s = document.createElement("script");
    s.src = RRWEB_JS;
    s.async = true;
    const timer = setTimeout(() => reject(new Error("timed out loading rrweb-player from cdn.jsdelivr.net")), 20_000);
    s.onload = () => {
      clearTimeout(timer);
      if (w.rrwebPlayer) resolve(w.rrwebPlayer);
      else reject(new Error("rrweb-player loaded but window.rrwebPlayer is missing"));
    };
    s.onerror = () => {
      clearTimeout(timer);
      reject(new Error("could not load rrweb-player from cdn.jsdelivr.net (offline, or the CDN is blocked?)"));
    };
    document.head.appendChild(s);
  }).catch((e) => {
    rrwebLoading = null;
    throw e;
  });
  return rrwebLoading;
}

/** One rrweb event JSON per line; blank and malformed lines are skipped. */
async function fetchNdjson(url: string): Promise<{ events: unknown[]; skipped: number }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(res.status === 404 ? "no replay for this seat (yet)" : `GET ${url} → ${res.status}`);
  const text = await res.text();
  const events: unknown[] = [];
  let skipped = 0;
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try {
      events.push(JSON.parse(t));
    } catch {
      skipped++;
    }
  }
  return { events, skipped };
}

type Phase =
  | { kind: "loading"; text: string }
  | { kind: "rrweb"; events: unknown[]; skipped: number }
  | { kind: "video"; src: string }
  | { kind: "none"; text: string }
  | { kind: "error"; text: string };

export function Replay({ id, n }: { id: string; n: number }) {
  const [run, setRun] = useState<Run | null>(null);
  const [seat, setSeat] = useState<Seat | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "loading", text: "Loading run…" });
  const [status, setStatus] = useState("Ready");
  const screenRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    setPhase({ kind: "loading", text: `Loading run ${id}…` });
    getRun(id)
      .then(async (r) => {
        if (!alive) return;
        setRun(r);
        const s = r.seats.find((x) => x.index === n);
        if (!s) {
          setPhase({ kind: "error", text: `Run ${id} has no seat #${n + 1}.` });
          return;
        }
        setSeat(s);
        if (s.replayNdjsonUrl) {
          setPhase({ kind: "loading", text: "Downloading rrweb recording…" });
          try {
            const [{ events, skipped }] = await Promise.all([fetchNdjson(s.replayNdjsonUrl), loadRrwebPlayer()]);
            if (!alive) return;
            if (!events.length) setPhase({ kind: "none", text: "The recording is empty (no rrweb events were captured)." });
            else setPhase({ kind: "rrweb", events, skipped });
          } catch (e) {
            if (alive) setPhase({ kind: "error", text: String((e as Error)?.message ?? e) });
          }
        } else if (s.recordingUrl) {
          setPhase({ kind: "video", src: s.recordingUrl });
        } else if (r.demo || !s.sessionId) {
          setPhase({ kind: "none", text: "No recording for this seat — demo seats have no Solari session, so no rrweb recording." });
        } else if (s.status === "running" || s.status === "booting" || s.status === "grading" || s.status === "queued") {
          setPhase({ kind: "none", text: "No recording yet — the seat is still running. Recordings are uploaded when a seat finishes." });
        } else {
          setPhase({ kind: "none", text: "No recording for this seat." });
        }
      })
      .catch((e) => alive && setPhase({ kind: "error", text: String((e as Error)?.message ?? e) }));
    return () => {
      alive = false;
    };
  }, [id, n]);

  // Mount the rrweb player into the "screen" once events are ready.
  useEffect(() => {
    if (phase.kind !== "rrweb") return;
    const el = screenRef.current;
    if (!el) return;
    let player: { $destroy?: () => void; pause?: () => void } | null = null;
    let cancelled = false;
    loadRrwebPlayer()
      .then((Ctor) => {
        if (cancelled || !el.isConnected) return;
        el.replaceChildren();
        const width = Math.max(320, Math.min(1024, el.clientWidth - 8));
        const height = Math.round((width * 640) / 1024);
        player = new Ctor({ target: el, props: { events: phase.events, autoPlay: true, width, height, showController: true, skipInactive: true } });
        setStatus(`Playing · ${phase.events.length} events${phase.skipped ? ` (${phase.skipped} bad lines skipped)` : ""}`);
      })
      .catch((e) => setPhase({ kind: "error", text: String((e as Error)?.message ?? e) }));
    return () => {
      cancelled = true;
      try {
        player?.pause?.();
        player?.$destroy?.();
      } catch {
        /* ignore */
      }
      el.replaceChildren();
    };
  }, [phase]);

  useEffect(() => {
    document.title = seat && run ? `REPLAY — seat ${pad2(seat.index + 1)} — ${run.task.name} — LANPARTY.EXE` : "REPLAY — LANPARTY.EXE";
    return () => {
      document.title = "LANPARTY.EXE";
    };
  }, [seat, run]);

  const title = `REPLAY — seat ${pad2(n + 1)} — ${run?.task.name ?? id}`;
  const dur = seat?.startedAt ? (seat.finishedAt ?? Date.now()) - seat.startedAt : null;
  const badge = seat ? (seat.status === "pass" ? "pass" : seat.status === "fail" ? "fail" : seat.status === "error" ? "error" : "other") : "other";

  return (
    <div className="replay-page">
      <div className="replay-wrap">
        <Window title={title} className="wmp" onClose={() => navigate(`/r/${encodeURIComponent(id)}`)} bodyClassName="tight">
          <div className="wmp-menu">
            <span>File</span>
            <span>View</span>
            <span>Play</span>
            <span>Tools</span>
            <span>Help</span>
            <span className="spacer" />
            {run ? (
              <a href={href(`/r/${encodeURIComponent(run.id)}`)} onClick={onLinkClick}>
                ← back to results
              </a>
            ) : null}
          </div>
          <div className="wmp-screen" ref={phase.kind === "rrweb" ? screenRef : undefined}>
            {phase.kind === "video" ? <video controls src={phase.src} className="wmp-video" /> : null}
            {phase.kind === "loading" ? <div className="wmp-msg">{phase.text}</div> : null}
            {phase.kind === "none" ? (
              <div className="wmp-msg">
                <div className="wmp-msg-title">NO RECORDING</div>
                {phase.text}
              </div>
            ) : null}
            {phase.kind === "error" ? (
              <div className="wmp-msg error">
                <div className="wmp-msg-title">CANNOT PLAY</div>
                {phase.text}
              </div>
            ) : null}
          </div>
          <div className="wmp-controls">
            <span className="wmp-btn">▶</span>
            <span className="wmp-btn">▮▮</span>
            <span className="wmp-btn">■</span>
            <span className="wmp-btn">◀◀</span>
            <span className="wmp-btn">▶▶</span>
            <span className="wmp-status">{phase.kind === "rrweb" ? status : phase.kind === "video" ? "Playing recording.mp4" : phase.kind === "loading" ? "Buffering…" : "Stopped"}</span>
            {seat ? (
              <span className="wmp-meta">
                <span className={`badge ${badge}`}>{seat.status}</span> {seat.model} · {seat.steps.length} steps · {fmtMs(dur)} · {fmtUsd(seat.usage?.costUsd)}
                {seat.sessionId ? ` · ${seat.sessionId}` : ""}
              </span>
            ) : null}
          </div>
          <div className="wmp-tape">
            <StepTape steps={seat?.steps ?? []} />
          </div>
          <div className="btn-row" style={{ justifyContent: "space-between", padding: "4px 6px" }}>
            <span className="muted small">{seat?.verdict ?? seat?.error ?? ""}</span>
            <span className="row">
              {run ? <Button onClick={() => navigate(`/run/${encodeURIComponent(run.id)}`)}>ROOM</Button> : null}
              <Button tone="primary" onClick={() => navigate(`/r/${encodeURIComponent(id)}`)}>
                BACK TO RESULTS
              </Button>
            </span>
          </div>
        </Window>
      </div>
    </div>
  );
}
