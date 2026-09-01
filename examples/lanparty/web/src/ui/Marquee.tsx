export function Marquee({ text }: { text: string }) {
  return (
    <div className="marquee" aria-label={text}>
      <span className="marquee-track">
        {text}
        {"        "}
        {text}
      </span>
    </div>
  );
}
