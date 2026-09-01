import { useEffect, useRef } from "react";
import type { Step } from "../../../shared/types";
import { prettyToken, stripTag } from "../api";

export function StepTape({ steps, highlightN }: { steps: Step[]; highlightN?: number | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const count = steps.length;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollLeft = el.scrollWidth;
  }, [count]);

  return (
    <div className="steptape" ref={ref}>
      {steps.length === 0 ? <div className="empty">no steps yet — the agent is looking at the screen</div> : null}
      {steps.map((s) => {
        const caption = prettyToken(s.token) || s.action.name;
        const target = s.target ? stripTag(s.target) : "";
        return (
          <div className={`step${highlightN === s.n ? " diverged" : ""}`} key={s.n} title={`${caption}${s.note ? `\n${s.note}` : ""}${s.error ? `\nERROR: ${s.error}` : ""}`}>
            {s.thumb ? <img src={`data:image/jpeg;base64,${s.thumb}`} alt={`step ${s.n}`} /> : <div className="noimg" />}
            <div className="num">
              #{s.n} {s.error ? "!" : ""}
            </div>
            <div className="tok">{caption}</div>
            {target ? <div className="target">{target}</div> : null}
          </div>
        );
      })}
    </div>
  );
}
