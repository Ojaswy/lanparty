/** 7-segment readout drawn with plain divs. Segments: a(top) b(tr) c(br) d(bottom) e(bl) f(tl) g(mid). */
const MAP: Record<string, string> = {
  "0": "abcdef",
  "1": "bc",
  "2": "abged",
  "3": "abgcd",
  "4": "fgbc",
  "5": "afgcd",
  "6": "afgedc",
  "7": "abc",
  "8": "abcdefg",
  "9": "abcdfg",
  "-": "g",
  " ": "",
};

function Digit({ ch }: { ch: string }) {
  const on = MAP[ch] ?? "";
  const seg = (k: string, cls: string, style: React.CSSProperties) => <span key={k} className={`seg ${cls}${on.includes(k) ? " on" : ""}`} style={style} />;
  return (
    <span className="digit">
      {seg("a", "h", { top: 0 })}
      {seg("b", "v", { top: 2, right: 0 })}
      {seg("c", "v", { bottom: 2, right: 0 })}
      {seg("d", "h", { bottom: 0 })}
      {seg("e", "v", { bottom: 2, left: 0 })}
      {seg("f", "v", { top: 2, left: 0 })}
      {seg("g", "h", { top: 11 })}
    </span>
  );
}

export function SevenSeg({ value, digits = 2 }: { value: number; digits?: number }) {
  const s = String(Math.max(0, Math.floor(value))).padStart(digits, " ").slice(-digits);
  return (
    <span className="sevenseg" aria-label={String(value)}>
      {s.split("").map((ch, i) => (
        <Digit key={i} ch={ch} />
      ))}
    </span>
  );
}
