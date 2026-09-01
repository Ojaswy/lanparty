import { useEffect, useState } from "react";
import { sound } from "../sound";
import { navigate } from "../router";

export interface TaskButton {
  id: string;
  title: string;
  active?: boolean;
  onClick?: () => void;
}

export interface TaskbarProps {
  windows: TaskButton[];
  booting?: boolean;
  connected?: boolean;
  startLabel?: string;
}

function useClock(): string {
  const [t, setT] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setT(new Date()), 10_000);
    return () => clearInterval(id);
  }, []);
  let h = t.getHours();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${t.getMinutes() < 10 ? "0" : ""}${t.getMinutes()} ${ampm}`;
}

function useSound(): boolean {
  const [on, setOn] = useState(sound.enabled);
  useEffect(() => sound.subscribe(() => setOn(sound.enabled)), []);
  return on;
}

export function Taskbar({ windows, booting, connected = true, startLabel = "LANPARTY" }: TaskbarProps) {
  const clock = useClock();
  const soundOn = useSound();
  const [dialText, setDialText] = useState("Dialing Solari...");

  useEffect(() => {
    if (!booting) return;
    const msgs = ["Dialing Solari...", "Handshaking...", "Verifying username and password...", "Connected at 56,000 bps", "Forking seats..."];
    let i = 0;
    setDialText(msgs[0]);
    const id = setInterval(() => {
      i = (i + 1) % msgs.length;
      setDialText(msgs[i]);
    }, 1400);
    return () => clearInterval(id);
  }, [booting]);

  return (
    <div className="taskbar" role="toolbar">
      <button type="button" className="btn start-btn" onClick={() => navigate("/")} title="Back to the lobby">
        <span className="logo" />
        {startLabel}
      </button>
      <span className="divider" />
      {windows.map((w) => (
        <button key={w.id} type="button" className={`btn task-btn${w.active ? " active" : ""}`} onClick={w.onClick} title={w.title}>
          {w.title}
        </button>
      ))}
      <span className="spacer" />
      <div className="tray">
        {booting ? (
          <span className="modem" title="56k modem">
            <span className="bar">
              <i />
            </span>
            {dialText}
          </span>
        ) : null}
        <button
          type="button"
          className="btn icon-btn"
          onClick={() => sound.toggle()}
          title={soundOn ? "Sound on (click to mute)" : "Sound off (click to enable)"}
          aria-pressed={soundOn}
        >
          {soundOn ? "♪" : "×"}
        </button>
        <span title={connected ? "Connected" : "Reconnecting..."} style={{ color: connected ? "#080" : "#c00" }}>
          {connected ? "▮▮" : "▯▯"}
        </span>
        <span>{clock}</span>
      </div>
    </div>
  );
}
