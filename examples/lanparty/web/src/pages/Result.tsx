import { useEffect, useMemo, useState } from "react";
import type { Run } from "../../../shared/types";
import { getRun } from "../api";
import { href, onLinkClick } from "../router";
import { RoomCanvas, type SeatView } from "../room/RoomCanvas";
import { bindRun, pushThumbIfEmpty } from "../room/frames";
import { Window } from "../ui/Window";
import { Scoreboard } from "../components/Scoreboard";
import { Divergence } from "../components/Divergence";
import { SharePanel } from "../components/SharePanel";
import { SeatWindow } from "../components/SeatWindow";

export function Result({ id }: { id: string }) {
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openSeat, setOpenSeat] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    setRun(null);
    setError(null);
    bindRun(`result:${id}`);
    getRun(id)
      .then((r) => {
        if (!alive) return;
        setRun(r);
        for (const s of r.seats) {
          const last = s.steps[s.steps.length - 1];
          if (last?.thumb) void pushThumbIfEmpty(s.index, last.thumb, last.at || 1);
        }
      })
      .catch((e) => alive && setError(String((e as Error)?.message ?? e)));
    return () => {
      alive = false;
    };
  }, [id]);

  useEffect(() => {
    if (run?.summary) document.title = `${run.summary.pass}/${run.k} passed — ${run.task.name} — LANPARTY.EXE`;
    return () => {
      document.title = "LANPARTY.EXE";
    };
  }, [run]);

  const seatViews: SeatView[] = useMemo(
    () =>
      (run?.seats ?? []).map((s) => ({
        index: s.index,
        kind: s.kind,
        status: s.status,
        sprite: s.sprite,
        model: s.model,
        steps: s.steps.length,
        sessionId: s.sessionId,
      })),
    [run],
  );

  if (error) {
    return (
      <div className="error-screen">
        <h1> LANPARTY.EXE </h1>
        {"\n"}A fatal exception has occurred while loading run {id}.{"\n\n"}
        {error}
        {"\n\n"}
        <a href={href("/")} onClick={onLinkClick} style={{ color: "#fff" }}>
          Press any key to return to the lobby _
        </a>
      </div>
    );
  }
  if (!run) {
    return <div className="loading-screen">{`Loading party ${id} ...`}</div>;
  }

  const shareUrl = `${location.origin}/r/${encodeURIComponent(run.id)}`;
  const pass = run.summary?.pass ?? run.seats.filter((s) => s.status === "pass").length;
  const seat = openSeat != null ? run.seats.find((s) => s.index === openSeat) : undefined;

  return (
    <div className="result-page">
      <div className="result-title">
        <span>{run.task.name}</span>
        <span className={`pill ${run.status}`}>{run.status}</span>
        <span className="mono" style={{ fontSize: 16, textShadow: "none", opacity: 0.9 }}>
          {run.id} · k={run.k} · {run.model}
          {run.label ? ` · ${run.label}` : ""}
        </span>
        <span style={{ flex: 1 }} />
        <a href={href("/")} onClick={onLinkClick} className="mono" style={{ fontSize: 16 }}>
          ← lobby
        </a>
        <a href={href(`/run/${encodeURIComponent(run.id)}`)} onClick={onLinkClick} className="mono" style={{ fontSize: 16 }}>
          room ↗
        </a>
      </div>

      <div className="result-hero" style={{ marginTop: 12, position: "relative" }}>
        <div className="result-hero-inner">
          <RoomCanvas seats={seatViews} runStatus={run.status} demo={run.demo} live={false} onSeatClick={setOpenSeat} />
          {seat ? <SeatWindow run={run} seat={seat} onClose={() => setOpenSeat(null)} initial={{ x: 20, y: 20 }} /> : null}
        </div>
      </div>

      <div className="result-body">
        <div className="result-two">
          <Window title={`SCOREBOARD — ${pass}/${run.k} PASSED`}>
            <Scoreboard run={run} />
          </Window>
          <Window title="DIVERGENCE REPORT — where did the failing seats leave the path?">
            <Divergence run={run} />
          </Window>
        </div>
        <Window title="SHARE THIS PARTY">
          <SharePanel run={run} url={shareUrl} />
        </Window>
      </div>
    </div>
  );
}
