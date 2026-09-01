import { useEffect, useRef } from "react";
import type { ChatLine } from "../ws";
import { pad2, seatNick } from "../api";

const NICK_COLORS = ["#c00000", "#0000c0", "#008000", "#800080", "#c06000", "#008080", "#606000", "#a0007a"];

function ts(at: number): string {
  const d = new Date(at);
  return `[${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}]`;
}

export function LanChat({ lines }: { lines: ChatLine[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (!el || !stick.current) return;
    el.scrollTop = el.scrollHeight;
  }, [lines]);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };

  return (
    <div className="chat">
      <div className="chat-log" ref={ref} onScroll={onScroll}>
        {lines.length === 0 ? <div className="line sys">*** Connecting to #lanparty ...</div> : null}
        {lines.map((l) => {
          if (l.kind === "msg" && l.seat != null) {
            return (
              <div className="line" key={l.id}>
                <span className="ts">{ts(l.at)} </span>
                <span className="nick" style={{ color: NICK_COLORS[l.seat % NICK_COLORS.length] }}>
                  {"<"}
                  {seatNick(l.seat)}
                  {">"}
                </span>{" "}
                {l.text}
              </div>
            );
          }
          const cls = l.kind === "error" ? "error" : l.kind === "warn" ? "warn" : "sys";
          return (
            <div className={`line ${cls}`} key={l.id}>
              <span className="ts">{ts(l.at)} </span>
              {l.kind === "info" && l.seat != null ? `-${seatNick(l.seat)}- ` : ""}
              {l.text}
            </div>
          );
        })}
      </div>
      <div className="chat-input">[#lanparty] {lines.length} lines · read-only</div>
    </div>
  );
}
