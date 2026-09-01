import { useMemo, useState } from "react";
import type { Run } from "../../../shared/types";
import { Button } from "../ui/Button";
import { navigate } from "../router";

function lowerFirst(s: string): string {
  return s ? s[0].toLowerCase() + s.slice(1) : s;
}

export function composeShareText(run: Run, url: string): string {
  const sum = run.summary;
  const k = run.k;
  const pass = sum?.pass ?? run.seats.filter((s) => s.status === "pass").length;
  const kinds = run.seats.some((s) => s.kind === "desktop") ? (run.seats.every((s) => s.kind === "desktop") ? "cloud desktops" : "cloud browsers (+desktops)") : "cloud browsers";
  let divLine = "";
  const entries = run.divergence?.entries.filter((e) => e.step != null && e.summary) ?? [];
  if (entries.length) {
    // Group identical divergences (same step, same server-written sentence) and lead with the biggest group.
    const groups = new Map<string, { n: number; step: number; summary: string }>();
    for (const e of entries) {
      const key = `${e.step}|${e.summary}`;
      const g = groups.get(key) ?? { n: 0, step: e.step ?? 0, summary: e.summary ?? "" };
      g.n++;
      groups.set(key, g);
    }
    const top = [...groups.values()].sort((a, b) => b.n - a.n)[0];
    divLine = ` Divergence: ${top.n} seat${top.n === 1 ? "" : "s"}: ${lowerFirst(top.summary).replace(/\.?$/, "")} (step ${top.step}).`;
  } else if (run.status === "done" && pass === k) {
    divLine = " Zero divergence.";
  }
  return `${k} identical ${kinds} on Solari, same task, same start state: pass@${k} = ${pass}/${k}.${divLine} ${url}`;
}

export function SharePanel({ run, url }: { run: Run; url: string }) {
  const text = useMemo(() => composeShareText(run, url), [run, url]);
  const [copied, setCopied] = useState<"link" | "text" | null>(null);

  const copy = async (what: "link" | "text") => {
    try {
      await navigator.clipboard.writeText(what === "link" ? url : text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* ignore */
    }
  };

  const rerun = () => {
    const desktops = run.seats.filter((s) => s.kind === "desktop").length;
    const q = new URLSearchParams({ task: run.task.id, k: String(run.k), model: run.model });
    if (desktops && run.task.kind !== "desktop") q.set("desktops", String(desktops));
    if (run.label) q.set("label", run.label);
    if (run.agent === "external") q.set("agent", "external");
    navigate(`/?${q.toString()}`);
  };

  return (
    <div className="share">
      <textarea className="field" readOnly value={text} onFocus={(e) => e.currentTarget.select()} />
      <div className="btn-row" style={{ justifyContent: "flex-start" }}>
        <Button onClick={() => copy("link")}>{copied === "link" ? "COPIED!" : "COPY LINK"}</Button>
        <Button onClick={() => copy("text")}>{copied === "text" ? "COPIED!" : "COPY POST"}</Button>
        <Button tone="primary" onClick={rerun}>
          RE-RUN THIS TASK
        </Button>
      </div>
    </div>
  );
}
