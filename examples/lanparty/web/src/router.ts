import { useEffect, useState } from "react";

/** Tiny pathname router: history.pushState + popstate, no library. */

const NAV_EVENT = "lanparty:navigate";

export const MOCK = typeof location !== "undefined" && /(?:\?|&)mock=1(?:&|$)/.test(location.search);

/** Keep `?mock=1` sticky across client-side navigation so the fake backend stays on. */
export function href(path: string): string {
  if (!MOCK) return path;
  if (/[?&]mock=1/.test(path)) return path;
  return path + (path.includes("?") ? "&" : "?") + "mock=1";
}

export function navigate(path: string, replace = false): void {
  const target = href(path);
  if (replace) history.replaceState({}, "", target);
  else history.pushState({}, "", target);
  window.dispatchEvent(new Event(NAV_EVENT));
}

function readPath(): string {
  return location.pathname;
}

export function usePath(): string {
  const [path, setPath] = useState(readPath);
  useEffect(() => {
    const on = () => setPath(readPath());
    window.addEventListener("popstate", on);
    window.addEventListener(NAV_EVENT, on);
    return () => {
      window.removeEventListener("popstate", on);
      window.removeEventListener(NAV_EVENT, on);
    };
  }, []);
  return path;
}

export function useQuery(): URLSearchParams {
  const [q, setQ] = useState(() => new URLSearchParams(location.search));
  useEffect(() => {
    const on = () => setQ(new URLSearchParams(location.search));
    window.addEventListener("popstate", on);
    window.addEventListener(NAV_EVENT, on);
    return () => {
      window.removeEventListener("popstate", on);
      window.removeEventListener(NAV_EVENT, on);
    };
  }, []);
  return q;
}

/** Intercept plain anchors so internal links stay client-side. */
export function onLinkClick(e: React.MouseEvent<HTMLAnchorElement>): void {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.currentTarget;
  if (a.target && a.target !== "_self") return;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin) return;
  e.preventDefault();
  navigate(url.pathname + url.search);
}
