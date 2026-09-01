import { useEffect, useMemo, useState } from "react";
import { useRun } from "../ws";
import { cancelRun } from "../api";
import { navigate } from "../router";
import { RoomCanvas, type SeatView } from "../room/RoomCanvas";
import { Window } from "../ui/Window";
import { Button } from "../ui/Button";
import { Taskbar, type TaskButton } from "../ui/Taskbar";
import { Scoreboard } from "../components/Scoreboard";
import { LanChat } from "../components/LanChat";
import { SeatWindow } from "../components/SeatWindow";

export function RunRoom({ id }: { id: string }) {
  const st = useRun(id);
  const run = st.run;
  const [showScore, setShowScore] = useState(true);
  const [showChat, setShowChat] = useState(true);
  const [openSeat, setOpenSeat] = useState<number | null>(null);
  const [dialogDismissed, setDialogDismissed] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    setDialogDismissed(false);
    setOpenSeat(null);
  }, [id]);

  useEffect(() => {
    document.title = run ? `${run.task.name} — LANPARTY.EXE` : "LANPARTY.EXE";
    return () => {
      document.title = "LANPARTY.EXE";
    };
  }, [run?.task.name]); // eslint-disable-line react-hooks/exhaustive-deps

  const seatViews: SeatView[] = useMemo(
    () =>
      (run?.seats ?? []).map((s) => ({
        index: s.index,
        kind: s.kind,
        status: s.status,
        sprite: s.sprite,
        model: s.model,
        steps: s.steps.length,
        bubble: s.bubble,
        bubbleAt: st.bubbleAt[s.index],
        statusAt: st.statusAt[s.index],
        sessionId: s.sessionId,
      })),
    [run?.seats, st.bubbleAt, st.statusAt],
  );

  if (!run) {
    return (
      <div className="room-page">
        <div className="xp-strip">
          <span className="strip-title">LANPARTY.EXE</span>
          <span className="strip-id">{id}</span>
        </div>
        <div className="loading-screen">
          {st.error ? `SOLARI BIOS v0.1\n\nCould not reach the party server.\n${st.error}\n\nRetrying${".".repeat((st.reconnects % 3) + 1)}` : `SOLARI BIOS v0.1\n\nDialing #lanparty ... run ${id}\nWaiting for run:snapshot ...`}
        </div>
        <Taskbar windows={[]} booting connected={st.connected} />
      </div>
    );
  }

  const live = run.status === "booting" || run.status === "running";
  const seat = openSeat != null ? run.seats.find((s) => s.index === openSeat) : undefined;
  const pass = run.summary?.pass ?? run.seats.filter((s) => s.status === "pass").length;

  const cancel = async () => {
    if (!confirm("Cancel the party? Every seat will be stopped and graded as-is.")) return;
    setCancelling(true);
    try {
      await cancelRun(run.id);
    } catch (e) {
      alert(String((e as Error)?.message ?? e));
    } finally {
      setCancelling(false);
    }
  };

  const rerun = () => {
    const desktops = run.seats.filter((s) => s.kind === "desktop").length;
    const q = new URLSearchParams({ task: run.task.id, k: String(run.k), model: run.model });
    if (desktops && run.task.kind !== "desktop") q.set("desktops", String(desktops));
    if (run.label) q.set("label", run.label);
    navigate(`/?${q.toString()}`);
  };

  const windows: TaskButton[] = [
    { id: "score", title: "Scoreboard", active: showScore, onClick: () => setShowScore((v) => !v) },
    { id: "chat", title: "LAN Chat", active: showChat, onClick: () => setShowChat((v) => !v) },
  ];
  if (seat) windows.push({ id: "seat", title: `Seat #${seat.index + 1}`, active: true, onClick: () => setOpenSeat(null) });

  return (
    <div className="room-page">
      <div className="xp-strip">
        <span className="strip-title">{run.task.name}</span>
        <span className="strip-id">{run.id}</span>
        <span className={`pill ${run.status}`}>{run.status}</span>
        {run.demo ? <span className="demo-tag">DEMO</span> : null}
        {run.agent === "external" ? <span className="demo-tag" style={{ background: "#9bd1ff" }}>EXTERNAL AGENT</span> : null}
        {run.label ? <span className="strip-id">· {run.label}</span> : null}
        <span className="spacer" />
        <span className="strip-id">
          k={run.k} · {run.model}
        </span>
        {live ? (
          <Button tone="danger" onClick={cancel} disabled={cancelling} style={{ minWidth: 0, padding: "1px 8px", fontSize: 15 }}>
            {cancelling ? "CANCELLING…" : "CANCEL PARTY"}
          </Button>
        ) : (
          <Button onClick={() => navigate(`/r/${encodeURIComponent(run.id)}`)} style={{ minWidth: 0, padding: "1px 8px", fontSize: 15 }}>
            RESULTS
          </Button>
        )}
      </div>

      <div className="room-main">
        <RoomCanvas seats={seatViews} runStatus={run.status} demo={run.demo} live={live || run.seats.some((s) => s.status === "pass")} onSeatClick={setOpenSeat} padRight={showScore || showChat ? 340 : 0} />

        <div className="float-col">
          {showScore ? (
            <Window title="SCOREBOARD" className="scoreboard-win" onMinimize={() => setShowScore(false)}>
              <Scoreboard run={run} />
            </Window>
          ) : null}
          {showChat ? (
            <Window title="LAN CHAT — #lanparty" className="chat-win" onMinimize={() => setShowChat(false)} bodyClassName="tight">
              <LanChat lines={st.chat} />
            </Window>
          ) : null}
        </div>

        {seat ? <SeatWindow run={run} seat={seat} onClose={() => setOpenSeat(null)} initial={{ x: 24, y: 24 }} /> : null}

        {(run.status === "done" || run.status === "cancelled") && !dialogDismissed ? (
          <div className="dialog-backdrop">
            <Window title={run.status === "done" ? "LANPARTY.EXE" : "LANPARTY.EXE — cancelled"} className="dialog" onClose={() => setDialogDismissed(true)}>
              <div className="dialog-body">
                <div className="dialog-icon" aria-hidden>
                  <svg viewBox="0 0 16 16" width="32" height="32" shapeRendering="crispEdges">
                    <rect x="1" y="1" width="14" height="11" fill="#d9d2c0" />
                    <rect x="3" y="3" width="10" height="7" fill={run.status === "done" ? "#0b1f0b" : "#0b0f0a"} />
                    <rect x="4" y="4" width="6" height="1" fill="#33ff66" />
                    <rect x="4" y="6" width="4" height="1" fill="#33ff66" />
                    <rect x="4" y="8" width="7" height="1" fill="#33ff66" />
                    <rect x="3" y="13" width="10" height="2" fill="#d9d2c0" />
                  </svg>
                </div>
                <div className="dialog-text">
                  {run.status === "done" ? `PARTY'S OVER — ${pass}/${run.k} PASSED` : "PARTY CANCELLED"}
                  <small>
                    {run.summary ? `median ${run.summary.medianSteps ?? "—"} steps · $${run.summary.totalCostUsd.toFixed(2)} total` : "seats were stopped before grading"}
                  </small>
                </div>
              </div>
              <div className="btn-row" style={{ justifyContent: "center" }}>
                <Button tone="primary" onClick={() => navigate(`/r/${encodeURIComponent(run.id)}`)}>
                  VIEW RESULTS
                </Button>
                <Button onClick={rerun}>RE-RUN</Button>
                <Button onClick={() => setDialogDismissed(true)}>LOOK AROUND</Button>
              </div>
            </Window>
          </div>
        ) : null}
      </div>

      <Taskbar windows={windows} booting={run.status === "booting"} connected={st.connected} />
    </div>
  );
}
