import { useEffect, useMemo, useState } from "react";
import type { Run, Seat, Step } from "../../../shared/types";
import { Window } from "../ui/Window";
import { Button } from "../ui/Button";
import { StepTape } from "./StepTape";
import { DesktopView } from "./DesktopView";
import { getFrame, subscribeFrames } from "../room/frames";
import { fmtMs, fmtUsd, getRun, pad2, replayPath, seatFinished } from "../api";
import { MOCK, navigate } from "../router";

function useSeatFrame(seat: number): string | null {
  const [url, setUrl] = useState<string | null>(() => getFrame(seat)?.dataUrl ?? null);
  useEffect(() => {
    setUrl(getFrame(seat)?.dataUrl ?? null);
    return subscribeFrames((s) => {
      if (s === seat) setUrl(getFrame(seat)?.dataUrl ?? null);
    });
  }, [seat]);
  return url;
}

/**
 * Live `seat:step` events arrive without thumbs (the server strips them from
 * the socket to keep it light); the persisted run has them. Fetch the run
 * (debounced) while the window is open and merge thumbs by step number.
 */
function useStepThumbs(runId: string, seatIndex: number, stepCount: number, status: string): Record<number, string> {
  const [thumbs, setThumbs] = useState<Record<number, string>>({});
  useEffect(() => {
    if (MOCK) return;
    let alive = true;
    const t = setTimeout(() => {
      getRun(runId)
        .then((r) => {
          if (!alive) return;
          const s = r.seats.find((x) => x.index === seatIndex);
          if (!s) return;
          const next: Record<number, string> = {};
          for (const st of s.steps) if (st.thumb) next[st.n] = st.thumb;
          setThumbs(next);
        })
        .catch(() => {
          /* thumbs are cosmetic */
        });
    }, 900);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [runId, seatIndex, stepCount, status]);
  return thumbs;
}

export interface SeatWindowProps {
  run: Run;
  seat: Seat;
  onClose: () => void;
  initial?: { x: number; y: number };
  floating?: boolean;
}

export function SeatWindow({ run, seat, onClose, initial, floating = true }: SeatWindowProps) {
  const frame = useSeatFrame(seat.index);
  const thumbs = useStepThumbs(run.id, seat.index, seat.steps.length, seat.status);
  const [copied, setCopied] = useState(false);
  const title = `SEAT #${pad2(seat.index + 1)} — ${seat.sessionId ?? "not booted"}`;
  const entry = run.divergence?.entries.find((e) => e.seat === seat.index);
  const steps: Step[] = useMemo(() => seat.steps.map((s) => (s.thumb || !thumbs[s.n] ? s : { ...s, thumb: thumbs[s.n] })), [seat.steps, thumbs]);
  const highlightN = useMemo(() => {
    if (!entry || entry.step == null) return null;
    const path = seat.steps.filter((s) => s.token);
    return path[entry.step - 1]?.n ?? null;
  }, [entry, seat.steps]);
  const lastStep = seat.steps[seat.steps.length - 1];
  const cost = seat.usage?.costUsd ?? 0;
  const dur = seat.startedAt ? (seat.finishedAt ?? Date.now()) - seat.startedAt : null;

  const copy = async () => {
    if (!seat.sessionId) return;
    try {
      await navigator.clipboard.writeText(seat.sessionId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  // Replay: the server sets replayUrl once the recording is persisted. A
  // finished seat without one (demo seats, upload failures) still opens the
  // in-app page, which explains why there is nothing to play.
  const finished = seatFinished(seat.status);
  const replayTo = seat.replayUrl ?? (finished ? replayPath(run.id, seat.index) : undefined);
  const replayTitle = seat.replayUrl ? "open the replay" : finished ? "no recording persisted for this seat — opens the replay page anyway" : "recording not uploaded yet";

  const showBios = !frame && (seat.status === "queued" || seat.status === "booting" || seat.status === "running");

  return (
    <Window title={title} onClose={onClose} draggable floating={floating} initial={initial} className="seat-win">
      <div className="seat-live">
        {seat.kind === "desktop" && seat.streamUrl && seat.status !== "queued" && !finished ? (
          <DesktopView streamUrl={seat.streamUrl} fallback={frame} />
        ) : frame ? (
          <img src={frame} alt={`seat ${seat.index + 1} live view`} />
        ) : (
          <div style={{ padding: 10, color: "var(--phosphor)", fontFamily: "var(--font-body)", fontSize: 18, whiteSpace: "pre" }}>
            {showBios
              ? `SOLARI BIOS v0.1  (C) 2026 Solari Systems\n\nCPU: Claude ${seat.model}\nMemory Test: 65536K OK\n\nDetecting ${seat.kind} seat ... ${seat.sessionId ?? "waiting"}\nBooting seat ${pad2(seat.index + 1)} ...${seat.status === "queued" ? "\n\n[queued — waiting for a free slot]" : "\n\n_"}`
              : seat.status === "cancelled"
                ? "\n\n   [ seat powered off ]"
                : "\n\n   [ no frame received ]"}
          </div>
        )}
        <div className="scanlines" />
        <div className="status-overlay">
          {seat.status.toUpperCase()}
          {seat.kind === "desktop" ? " · DESKTOP" : ""}
        </div>
      </div>

      <StepTape steps={steps} highlightN={highlightN} />

      <div className="seat-bubble-text" title="last thing the agent said">
        {seat.bubble ?? lastStep?.note ?? <span className="muted">(the agent hasn't said anything yet)</span>}
      </div>

      <dl className="seat-meta">
        <dt>status</dt>
        <dd>
          <span className={`badge ${seat.status === "pass" ? "pass" : seat.status === "fail" ? "fail" : seat.status === "error" ? "error" : "other"}`}>{seat.status}</span>{" "}
          {seat.verdict ?? ""}
        </dd>
        {seat.error ? (
          <>
            <dt>error</dt>
            <dd style={{ color: "#c00", whiteSpace: "normal" }}>{seat.error}</dd>
          </>
        ) : null}
        {entry && entry.step != null ? (
          <>
            <dt>diverged</dt>
            <dd style={{ color: "#900", whiteSpace: "normal" }}>
              step {entry.step}: {entry.summary}
            </dd>
          </>
        ) : null}
        <dt>model</dt>
        <dd>{seat.model}</dd>
        <dt>steps / time</dt>
        <dd>
          {seat.steps.length} · {fmtMs(dur)}
        </dd>
        <dt>tokens / cost</dt>
        <dd>
          {seat.usage?.inputTokens ?? 0} in · {seat.usage?.outputTokens ?? 0} out · {fmtUsd(cost)}
        </dd>
        <dt>session</dt>
        <dd>{seat.sessionId ?? "—"}</dd>
      </dl>

      <div className="btn-row">
        <Button onClick={() => replayTo && navigate(replayTo)} disabled={!replayTo} title={replayTitle}>
          OPEN REPLAY
        </Button>
        <Button onClick={copy} disabled={!seat.sessionId}>
          {copied ? "COPIED!" : "COPY SESSION ID"}
        </Button>
        <Button onClick={onClose}>CLOSE</Button>
      </div>
    </Window>
  );
}
