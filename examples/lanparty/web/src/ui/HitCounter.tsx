/** Fake visitor counter: 7 black boxes with green digits, seeded from a number. */
export function HitCounter({ seed }: { seed: number }) {
  // "Since 1998": a deterministic but plausible-looking count.
  const value = (1_337_000 + ((seed * 7919 + 4242) % 900_000)) % 10_000_000;
  const digits = String(value).padStart(7, "0").split("");
  return (
    <span className="hitcounter" title="You are visitor number">
      {digits.map((d, i) => (
        <span key={i} className="box">
          {d}
        </span>
      ))}
    </span>
  );
}
