import type { Run, Seat, Step } from "../../../shared/types";
import { fmtMs, fmtUsd, pad2, prettyToken, replayPath } from "../api";
import { href, onLinkClick } from "../router";

function pathSteps(seat: Seat): Step[] {
  return seat.steps.filter((s) => s.token && s.token.length > 0);
}

function badgeClass(seat: Seat): string {
  return seat.status === "pass" ? "pass" : seat.status === "fail" ? "fail" : seat.status === "error" ? "error" : "other";
}

export function Divergence({ run }: { run: Run }) {
  const div = run.divergence;
  if (!div) {
    return (
      <div className="muted" style={{ padding: 8 }}>
        The divergence report is generated when the party ends: for every failing seat, the first step where it left the path the passing majority took.
      </div>
    );
  }
  const byIndex = new Map<number, Seat>(run.seats.map((s) => [s.index, s]));
  const refSeat = div.passingSeats.length ? byIndex.get(div.passingSeats[0]) : run.seats.find((s) => pathSteps(s).length > 0);
  const refPath = refSeat ? pathSteps(refSeat) : [];

  return (
    <div className="divergence">
      <div>
        <div className="label">MAJORITY PATH — {div.passingSeats.length} passing seat{div.passingSeats.length === 1 ? "" : "s"}</div>
        <div className="majority-path">
          {div.majorityPath.length === 0 ? <span className="muted">no passing seats — nothing to compare against</span> : null}
          {div.majorityPath.map((tok, i) => (
            <span key={i} style={{ display: "contents" }}>
              <span className="stepchip" title={`${tok}${refPath[i]?.note ? `\n${refPath[i].note}` : ""}`}>
                <span className="n">{i + 1}</span>
                {prettyToken(tok)}
              </span>
              {i < div.majorityPath.length - 1 ? <span className="arrow">▶</span> : null}
            </span>
          ))}
        </div>
      </div>

      <div className="div-rows">
        {div.entries.map((e) => {
          const seat = byIndex.get(e.seat);
          if (!seat) return null;
          const mine = pathSteps(seat);
          const at = e.step != null ? mine[e.step - 1] : undefined;
          const theirs = e.step != null ? refPath[e.step - 1] : undefined;
          const dur = seat.startedAt && seat.finishedAt ? seat.finishedAt - seat.startedAt : null;
          const failed = seat.status !== "pass";
          const to = href(seat.replayUrl ?? replayPath(run.id, seat.index));
          return (
            <div className={`div-row ${badgeClass(seat)}`} key={e.seat}>
              <span className={`badge ${badgeClass(seat)}`}>#{pad2(seat.index + 1)}</span>
              <span>{seat.steps.length} steps</span>
              <span>{fmtMs(dur)}</span>
              <span>{fmtUsd(seat.usage?.costUsd)}</span>
              <span>
                {failed && e.step != null ? (
                  <span className="summary">
                    <b>diverged at step {e.step}:</b> {e.summary ?? `${prettyToken(e.seatToken) || "nothing"} instead of ${prettyToken(e.majorityToken) || "nothing"}`}
                  </span>
                ) : failed ? (
                  <span className="summary">{e.summary ?? seat.verdict ?? seat.error ?? "failed"}</span>
                ) : (
                  <span style={{ color: "#080" }}>followed the majority path{seat.verdict ? ` — ${seat.verdict}` : ""}</span>
                )}
                {failed && e.step != null && (at?.thumb || theirs?.thumb) ? (
                  <span className="thumbs">
                    {theirs?.thumb ? (
                      <span className="thumb majority">
                        <img src={`data:image/jpeg;base64,${theirs.thumb}`} alt="majority" />
                        majority · {prettyToken(theirs.token)}
                      </span>
                    ) : null}
                    {at?.thumb ? (
                      <span className="thumb mine">
                        <img src={`data:image/jpeg;base64,${at.thumb}`} alt={`seat ${seat.index + 1}`} />
                        seat {pad2(seat.index + 1)} · {prettyToken(at.token)}
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </span>
              <span>
                <a href={to} onClick={onLinkClick} title={seat.replayUrl ? "open the rrweb / mp4 replay" : "open the replay page (no recording persisted for this seat)"}>
                  REPLAY
                </a>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
