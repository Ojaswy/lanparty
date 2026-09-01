import { useEffect, useMemo, useRef, useState } from "react";
import type { CreateRunRequest, Run, ServerInfo, TaskDef } from "../../../shared/types";
import { createRun, fmtWhen, getInfo, listRuns } from "../api";
import { href, navigate, onLinkClick, useQuery } from "../router";
import { Window } from "../ui/Window";
import { Button } from "../ui/Button";
import { Marquee } from "../ui/Marquee";
import { HitCounter } from "../ui/HitCounter";
import { SevenSeg } from "../ui/SevenSeg";
import { ICONS, rasterize, type PixelMap } from "../room/sprites";
import { sound } from "../sound";

/* ---------- 8-bit clouds on a canvas ---------- */

const CLOUD: PixelMap = [
  "......wwww..........",
  "....wwwwwwww........",
  "...wwwwwwwwww.wwww..",
  "..wwwwwwwwwwwwwwwww.",
  ".wwwwwwwwwwwwwwwwwww",
  "wwwwwwwwwwwwwwwwwwww",
  "wwwwwwwwwwwwwwwwwwww",
  ".wwwwwwwwwwwwwwwwww.",
];

function Clouds() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const draw = () => {
      const w = (c.width = c.clientWidth);
      const h = (c.height = c.clientHeight);
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, w, h);
      const img = rasterize(CLOUD, "cloud");
      const seeds = [0.08, 0.3, 0.55, 0.78, 0.18, 0.66];
      seeds.forEach((s, i) => {
        const scale = i % 2 === 0 ? 4 : 3;
        const x = s * w;
        const y = 30 + ((i * 97) % 5) * 28 + (i % 3) * 22;
        ctx.globalAlpha = 0.92;
        ctx.drawImage(img, Math.round(x), Math.round(y), img.width * scale, img.height * scale);
      });
      ctx.globalAlpha = 1;
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(c);
    return () => ro.disconnect();
  }, []);
  return <canvas ref={ref} className="lobby-sky" />;
}

function PixelIcon({ map, name, size = 32 }: { map: PixelMap; name: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const img = rasterize(map, `icon:${name}`);
    c.width = size;
    c.height = size;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, size, size);
  }, [map, name, size]);
  return <canvas ref={ref} className="task-icon" width={size} height={size} />;
}

function iconFor(task: TaskDef): { map: PixelMap; name: string } {
  const tags = task.tags ?? [];
  if (task.kind === "desktop") return { map: ICONS.desktop, name: "desktop" };
  if (tags.includes("e-commerce")) return { map: ICONS.cart, name: "cart" };
  if (tags.includes("navigation")) return { map: ICONS.globe, name: "globe" };
  if (tags.includes("judge") || /todo/i.test(task.id)) return { map: ICONS.check, name: "check" };
  if (tags.includes("forms") || task.needsPortal) return { map: ICONS.form, name: "form" };
  return { map: ICONS.floppy, name: "floppy" };
}

/* ---------- page ---------- */

export function Lobby() {
  const q = useQuery();
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string>(q.get("task") ?? "");
  const [k, setK] = useState<number>(Number(q.get("k")) || 8);
  const [model, setModel] = useState<string>(q.get("model") ?? "");
  const [desktops, setDesktops] = useState<number>(Number(q.get("desktops")) || 0);
  const [label, setLabel] = useState<string>(q.get("label") ?? "");
  const [agent, setAgent] = useState<"builtin" | "external">(q.get("agent") === "external" ? "external" : "builtin");
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    let alive = true;
    getInfo()
      .then((i) => {
        if (!alive) return;
        setInfo(i);
        setTaskId((cur) => (cur && i.tasks.some((t) => t.id === cur) ? cur : (i.tasks[0]?.id ?? "")));
        setModel((cur) => (cur && i.models.includes(cur) ? cur : i.defaultModel));
        setK((cur) => Math.max(1, Math.min(i.maxK, cur)));
        setDesktops((cur) => Math.max(0, Math.min(i.maxDesktopSeats, cur)));
      })
      .catch((e) => alive && setError(String(e?.message ?? e)));
    listRuns()
      .then((r) => alive && setRuns(r))
      .catch(() => {
        /* recent list is optional */
      });
    return () => {
      alive = false;
    };
  }, []);

  const task = useMemo(() => info?.tasks.find((t) => t.id === taskId) ?? null, [info, taskId]);
  const isDesktopTask = task?.kind === "desktop";
  const perSeat = info?.costPerSeatUsd?.[model];
  const estimate = perSeat != null ? perSeat * k : null;
  const overCeiling = estimate != null && info != null && info.costCeilingUsd > 0 && estimate > info.costCeilingUsd;

  const start = async () => {
    if (!info || !task) return;
    setStarting(true);
    setError(null);
    sound.play("click");
    const body: CreateRunRequest = { taskId: task.id, k, model, label: label.trim() || undefined };
    if (!isDesktopTask && desktops > 0) body.desktopSeats = desktops;
    if (agent === "external") body.agent = "external";
    try {
      const { id } = await createRun(body);
      navigate(`/run/${encodeURIComponent(id)}`);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
      setStarting(false);
    }
  };

  return (
    <div className="lobby">
      <Clouds />
      <div className="lobby-ground" />
      <div className="lobby-content">
        {info?.demo ? (
          <div className="balloon">
            <div className="balloon-title">DEMO MODE</div>
            DEMO MODE — no SOLARI_API_KEY set. Seats are replayed trajectories; the room, scoreboard and divergence report are real code paths.
          </div>
        ) : null}

        <div className="lobby-row">
          <Window title="LANPARTY.EXE — Setup" className="setup-win" icon={<PixelIcon map={ICONS.desktop} name="desktop-sm" size={14} />} onMinimize={() => undefined} onClose={() => undefined}>
            <Marquee text="<< k identical machines. one task. is your agent actually reliable? >>" />

            {error ? (
              <div style={{ background: "#fff0f0", border: "1px solid #c00", padding: 6, marginTop: 8, color: "#900" }}>
                {error}
                {!info ? " — is the server running on :8787? (append ?mock=1 for the in-browser mock)" : ""}
              </div>
            ) : null}

            <fieldset className="groupbox" style={{ marginTop: 16 }}>
              <legend>TASK</legend>
              {!info ? <div className="muted">Loading tasks from the server…</div> : null}
              <div className="task-grid">
                {info?.tasks.map((t) => {
                  const ic = iconFor(t);
                  return (
                    <button type="button" key={t.id} className={`task-card${t.id === taskId ? " selected" : ""}`} onClick={() => setTaskId(t.id)} title={t.instruction}>
                      <PixelIcon map={ic.map} name={ic.name} />
                      <span style={{ minWidth: 0 }}>
                        <span className="task-name">{t.name}</span>
                        <span className="task-blurb">{t.blurb}</span>
                        <span style={{ display: "block", marginTop: 4 }}>
                          {t.kind === "desktop" ? <span className="chip desktop">DESKTOP</span> : null}
                          {(t.tags ?? []).map((tag) => (
                            <span className="chip" key={tag}>
                              {tag}
                            </span>
                          ))}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <div className="setup-grid">
              <div>
                <div className="label">SEATS (k)</div>
                <div className="wa-slider">
                  <input type="range" min={1} max={info?.maxK ?? 20} value={k} onChange={(e) => setK(Number(e.target.value))} aria-label="seats" />
                  <SevenSeg value={k} digits={2} />
                </div>
                <div className="help">
                  {k} identical {isDesktopTask ? "desktop" : "browser"} seat{k === 1 ? "" : "s"} — pass@{k}
                </div>
              </div>
              <div>
                <div className="label">MODEL</div>
                <div className="select-wrap">
                  <select className="field" value={model} onChange={(e) => setModel(e.target.value)} aria-label="model">
                    {(info?.models ?? [model]).map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <div className="label">PREMIUM DESKTOP SEATS</div>
                <div className="stepper" title="real Ubuntu desktops with a live VNC stream, capped by plan">
                  <Button onClick={() => setDesktops((d) => Math.max(0, d - 1))} disabled={isDesktopTask || desktops <= 0}>
                    -
                  </Button>
                  <span className="stepper-val">{isDesktopTask ? "n/a" : desktops}</span>
                  <Button onClick={() => setDesktops((d) => Math.min(info?.maxDesktopSeats ?? 0, d + 1))} disabled={isDesktopTask || desktops >= (info?.maxDesktopSeats ?? 0)}>
                    +
                  </Button>
                </div>
                <div className="help">{isDesktopTask ? "every seat of a desktop task is a real desktop" : `0–${info?.maxDesktopSeats ?? 0} real Ubuntu desktops with a live VNC stream`}</div>
              </div>
              <div>
                <div className="label">LABEL (optional)</div>
                <input className="field" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. opus-5 vs sonnet-5" maxLength={80} />
              </div>
              <div>
                <div className="label">AGENT</div>
                <div className="select-wrap">
                  <select className="field" value={agent} onChange={(e) => setAgent(e.target.value === "external" ? "external" : "builtin")} aria-label="agent">
                    <option value="builtin">builtin — Claude computer-use</option>
                    <option value="external">external — bring your own (CDP)</option>
                  </select>
                </div>
                <div className="help">{agent === "external" ? "seats boot and hand out CDP endpoints; your agent sits down" : "the built-in Claude agent drives every seat"}</div>
              </div>
            </div>

            <div className="start-row">
              <Button variant="huge" tone="primary" onClick={start} disabled={!info || !task || starting}>
                {starting ? "DIALING…" : "START PARTY"}
              </Button>
              {estimate != null ? (
                <span className="help" style={{ color: overCeiling ? "#a00" : undefined }}>
                  est. ${estimate.toFixed(2)} ({k} × ${perSeat?.toFixed(2)}/seat)
                  {info?.costCeilingUsd ? ` · ceiling $${info.costCeilingUsd.toFixed(0)}` : ""}
                  {overCeiling ? " — the party will stop early" : ""}
                </span>
              ) : null}
            </div>
          </Window>

          <Window title="RECENT PARTIES" className="recent-win" onMinimize={() => undefined} onClose={() => undefined}>
            <div className="listview">
              <table>
                <thead>
                  <tr>
                    <th>task</th>
                    <th>k</th>
                    <th>pass@k</th>
                    <th>model</th>
                    <th>when</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="empty">
                        no parties yet — be the first
                      </td>
                    </tr>
                  ) : null}
                  {runs.map((r) => {
                    const to = href(`/r/${encodeURIComponent(r.id)}`);
                    const pk = r.summary ? `${r.summary.pass}/${r.summary.k}` : r.status;
                    const cell = (v: React.ReactNode) => (
                      <td>
                        <a href={to} onClick={onLinkClick}>
                          {v}
                        </a>
                      </td>
                    );
                    return (
                      <tr className="lv-row" key={r.id} onClick={() => navigate(`/r/${encodeURIComponent(r.id)}`)}>
                        {cell(r.task?.name ?? "?")}
                        {cell(r.k)}
                        {cell(pk)}
                        {cell(r.model)}
                        {cell(fmtWhen(r.createdAt))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Window>
        </div>
      </div>

      <div className="footer-bar">
        <HitCounter seed={runs.length + (info?.tasks.length ?? 0)} />
        <span>Best viewed in Netscape 4.7 at 800x600</span>
        <span className="chip construction">
          <span>UNDER CONSTRUCTION</span>
        </span>
        <span className="spacer" />
        <a href="https://github.com" target="_blank" rel="noreferrer noopener">
          GitHub
        </a>
        <a href="https://solari.dev" target="_blank" rel="noreferrer noopener">
          Powered by Solari
        </a>
      </div>
    </div>
  );
}
