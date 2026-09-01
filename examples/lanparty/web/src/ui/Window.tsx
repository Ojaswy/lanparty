import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

let zTop = 10;

export interface WindowProps {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  onClose?: () => void;
  onMinimize?: () => void;
  /** Title bar drags the window (only meaningful with `floating`). */
  draggable?: boolean;
  /** position:absolute inside the nearest positioned ancestor. */
  floating?: boolean;
  initial?: { x: number; y: number };
  width?: number | string;
  className?: string;
  style?: CSSProperties;
  bodyClassName?: string;
  inactive?: boolean;
  /** Called when the window is clicked (useful for taskbar focus). */
  onFocus?: () => void;
}

export function Window({
  title,
  icon,
  children,
  onClose,
  onMinimize,
  draggable,
  floating,
  initial,
  width,
  className,
  style,
  bodyClassName,
  inactive,
  onFocus,
}: WindowProps) {
  const [pos, setPos] = useState(initial ?? { x: 0, y: 0 });
  const [z, setZ] = useState(() => ++zTop);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (initial) setPos(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial?.x, initial?.y]);

  const raise = useCallback(() => {
    setZ(++zTop);
    onFocus?.();
  }, [onFocus]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggable || !floating) return;
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const parent = ref.current?.offsetParent as HTMLElement | null;
    const maxX = parent ? parent.clientWidth - 60 : Infinity;
    const maxY = parent ? parent.clientHeight - 30 : Infinity;
    setPos({
      x: Math.max(-200, Math.min(maxX, e.clientX - drag.current.dx)),
      y: Math.max(0, Math.min(maxY, e.clientY - drag.current.dy)),
    });
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    drag.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const cls = ["win", floating ? "floating" : "", inactive ? "inactive" : "", className ?? ""].filter(Boolean).join(" ");
  const st: CSSProperties = { width, ...style };
  if (floating) {
    st.left = pos.x;
    st.top = pos.y;
    st.zIndex = z;
  }

  return (
    <div ref={ref} className={cls} style={st} onPointerDown={floating ? raise : undefined} role="dialog" aria-label={title}>
      <div
        className={`win-title${draggable && floating ? " draggable" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {icon ? <span className="win-icon">{icon}</span> : null}
        <span className="win-title-text">{title}</span>
        <span className="win-btns">
          <button className="win-btn" type="button" title="Minimize" onClick={onMinimize} disabled={!onMinimize} aria-label="Minimize">
            _
          </button>
          <button className="win-btn" type="button" title="Maximize" disabled aria-label="Maximize">
            □
          </button>
          <button className="win-btn" type="button" title="Close" onClick={onClose} disabled={!onClose} aria-label="Close">
            X
          </button>
        </span>
      </div>
      <div className={`win-body ${bodyClassName ?? ""}`}>{children}</div>
    </div>
  );
}
