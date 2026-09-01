import type { Run } from "../../../shared/types";
import { fmtMs, fmtUsd, median } from "../api";

export function Scoreboard({ run }: { run: Run }) {
  const seats = run.seats;
  const pass = seats.filter((s) => s.status === "pass").length;
  const fail = seats.filter((s) => s.status === "fail").length;
  const errorLive = seats.filter((s) => s.status === "error" || s.status === "cancelled").length;
  const running = seats.filter((s) => s.status === "running" || s.status === "booting" || s.status === "grading").length;
  const finished = seats.filter((s) => s.finishedAt && s.startedAt);
  const sum = run.summary;
  const k = run.k || seats.length;
  const nPass = sum?.pass ?? pass;
  const nFail = sum?.fail ?? fail;
  const nErr = sum?.error ?? errorLive;
  // passRate is pass/(pass+fail) over GRADED seats; error/cancelled seats are excluded.
  const graded = nPass + nFail;
  const rate = sum ? sum.passRate : graded ? nPass / graded : 0;
  const pct = Math.round(rate * 100);
  const medSteps = sum?.medianSteps ?? median(seats.filter((s) => s.status === "pass" || s.status === "fail").map((s) => s.steps.length));
  const medMs = sum?.medianMs ?? median(finished.map((s) => (s.finishedAt ?? 0) - (s.startedAt ?? 0)));
  const cost = sum?.totalCostUsd ?? seats.reduce((a, s) => a + (s.usage?.costUsd ?? 0), 0);
  const bootMs = (() => {
    if (sum?.bootMs != null) return sum.bootMs;
    const t0 = run.startedAt ?? run.createdAt;
    const starts = seats.map((s) => s.startedAt).filter((x): x is number => typeof x === "number");
    if (starts.length < seats.length || !starts.length) return null;
    return Math.max(...starts) - t0;
  })();
  const models = Array.from(new Set(seats.map((s) => s.model))).filter(Boolean);
  const modelLabel = models.length > 1 ? models.join(" vs ") : models[0] || run.model;
  const done = run.status === "done";

  return (
    <div className="scoreboard">
      <div className={`score-big${nErr > 0 ? " four" : ""}`}>
        <div className="score-cell pass">
          <div className="n">{nPass}</div>
          <div className="l">PASS</div>
        </div>
        <div className="score-cell fail">
          <div className="n">{nFail}</div>
          <div className="l">FAIL</div>
        </div>
        {nErr > 0 ? (
          <div className="score-cell err" title="error / cancelled seats — not counted in the pass rate">
            <div className="n">{nErr}</div>
            <div className="l">ERR</div>
          </div>
        ) : null}
        <div className="score-cell run">
          <div className="n">{done ? 0 : running}</div>
          <div className="l">RUNNING</div>
        </div>
      </div>
      <div className="score-headline">
        pass@{k} = {nPass}/{k} = {pct}%{nErr > 0 ? <span className="of-graded"> of graded seats</span> : null}
        <small>{done ? (nErr > 0 ? `final · ${graded} graded, ${nErr} error/cancelled` : "final") : run.status === "cancelled" ? "cancelled" : "live — seats still finishing"}</small>
      </div>
      {sum?.costCeilingHit ? <div className="ceiling-hit">COST CEILING HIT — party stopped early</div> : null}
      <dl className="score-rows">
        {sum?.passK && Object.keys(sum.passK).length ? (
          <>
            <dt>pass^j</dt>
            <dd title="probability that j fresh trials all pass (tau-bench estimator over graded seats)">
              {Object.entries(sum.passK)
                .sort((a, b) => Number(a[0]) - Number(b[0]))
                .map(([j, p]) => `^${j} ${Math.round(p * 100)}%`)
                .join(" · ")}
            </dd>
          </>
        ) : null}
        <dt>median steps</dt>
        <dd>{medSteps == null ? "—" : medSteps}</dd>
        <dt>median time</dt>
        <dd>{fmtMs(medMs)}</dd>
        <dt>total cost</dt>
        <dd>{fmtUsd(cost)}</dd>
        <dt>boot</dt>
        <dd>{bootMs == null ? "booting…" : `all seats booted in ${fmtMs(bootMs)}`}</dd>
        <dt>model</dt>
        <dd title={modelLabel}>{modelLabel}</dd>
        {run.label ? (
          <>
            <dt>label</dt>
            <dd title={run.label}>{run.label}</dd>
          </>
        ) : null}
        <dt>seats</dt>
        <dd>
          {seats.filter((s) => s.kind === "browser").length} browser
          {seats.some((s) => s.kind === "desktop") ? ` + ${seats.filter((s) => s.kind === "desktop").length} desktop` : ""}
          {run.agent === "external" ? " · external agent" : ""}
        </dd>
      </dl>
    </div>
  );
}
