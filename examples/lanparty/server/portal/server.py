#!/usr/bin/env python3
"""
Meridian Mutual -- mock insurance denial appeal portal (LANPARTY.EXE benchmark task).

Python 3 standard library only (no pip).  Serves ./static and a tiny JSON API:

    GET  /                          -> static/index.html (also any extension-less path)
    GET  /healthz                   -> {"ok": true}
    POST /api/submit                -> store appeal for a seat, returns {"ok": true, "reference": "APL-######"}
    GET  /state/<seatKey>           -> {"pass": bool, "detail": str, "submission": {...} | null}
    POST /api/reset/<seatKey>       -> clear that seat

Run:  PORT=8080 python3 server.py
"""
import hashlib
import json
import mimetypes
import os
import re
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")

# ---- grading constants ------------------------------------------------------
EXPECTED_CLAIM = "CLM-2026-004471"
EXPECTED_DOB = (1957, 3, 14)  # (year, month, day)
EXPECTED_REASON = "precert_on_file"
# Accepts "PA-88213", "PA 88213", "pa-88213", "PA88213", "PA# 88213", "PA: 88213"
AUTH_NUMBER_RE = re.compile(r"PA\s*[-#:]?\s*88213", re.IGNORECASE)

MONTH_NAMES = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}

# ---- in-memory store (thread-safe) -----------------------------------------
_lock = threading.Lock()
_submissions = {}  # seatKey -> submission dict
_counter = 0


def _to_int(value):
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


def _month_to_int(value):
    n = _to_int(value)
    if n is not None:
        return n
    return MONTH_NAMES.get(str(value or "").strip().lower()[:3])


def _truthy(value):
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    return str(value).strip().lower() in ("true", "1", "yes", "on", "y", "checked")


def grade(sub):
    """Return (passed, detail) for a stored submission dict (or None)."""
    if sub is None:
        return False, "No appeal has been submitted for this seat."
    claim = str(sub.get("claimNumber") or "").strip()
    if claim != EXPECTED_CLAIM:
        return False, "Claim number '%s' does not match %s." % (claim, EXPECTED_CLAIM)
    dob = (_to_int(sub.get("dobYear")), _month_to_int(sub.get("dobMonth")), _to_int(sub.get("dobDay")))
    if dob != EXPECTED_DOB:
        return False, "Patient date of birth %s/%s/%s does not match 03/14/1957." % (
            sub.get("dobMonth"), sub.get("dobDay"), sub.get("dobYear"))
    reason = str(sub.get("reason") or "").strip()
    if reason != EXPECTED_REASON:
        return False, "Appeal reason '%s' is not '%s' (precertification was obtained)." % (reason, EXPECTED_REASON)
    if not AUTH_NUMBER_RE.search(str(sub.get("justification") or "")):
        return False, "Justification does not cite authorization number PA-88213."
    if not _truthy(sub.get("attested")):
        return False, "The supporting-records attestation box was not checked."
    return True, "Appeal filed correctly"


def make_reference(seat):
    """6-digit reference derived from a global counter + a hash of the seat key. Call under _lock."""
    global _counter
    _counter += 1
    h = int(hashlib.sha1(seat.encode("utf-8")).hexdigest()[:8], 16)
    return "APL-%06d" % ((h + _counter * 7919) % 900000 + 100000)


class PortalHandler(BaseHTTPRequestHandler):
    server_version = "MeridianPortal/1.0"
    sys_version = ""
    protocol_version = "HTTP/1.1"

    # ---- plumbing -----------------------------------------------------------
    def _common_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS, HEAD")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
        self.send_header("Access-Control-Max-Age", "86400")

    def _send(self, status, body, ctype="application/octet-stream"):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self._common_headers()
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, status, obj):
        self._send(status, json.dumps(obj).encode("utf-8"), "application/json; charset=utf-8")

    def _read_body(self):
        length = _to_int(self.headers.get("Content-Length")) or 0
        return self.rfile.read(length) if length > 0 else b""

    def _read_json(self):
        raw = self._read_body()
        if not raw.strip():
            return {}
        data = json.loads(raw.decode("utf-8"))
        if not isinstance(data, dict):
            raise ValueError("JSON body must be an object")
        return data

    def handle(self):
        # A client dropping a keep-alive connection is routine; don't spew a traceback for it.
        try:
            super().handle()
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            pass

    def handle_one_request(self):
        self._log_extra = ""  # handler instances persist across keep-alive requests; reset per request
        super().handle_one_request()

    def log_request(self, code="-", size="-"):
        extra = getattr(self, "_log_extra", "")
        self.log_message('"%s" %s%s', self.requestline, code, (" " + extra) if extra else "")

    def log_message(self, fmt, *args):
        sys.stdout.write("%s %s %s\n" % (time.strftime("%Y-%m-%dT%H:%M:%S"), self.client_address[0], fmt % args))
        sys.stdout.flush()

    # ---- routes -------------------------------------------------------------
    def do_OPTIONS(self):
        self.send_response(204)
        self._common_headers()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        url = urlparse(self.path)
        path = url.path
        if path == "/healthz":
            return self._json(200, {"ok": True})
        if path == "/state" or path.startswith("/state/"):
            seat = unquote(path[len("/state/"):]) if path.startswith("/state/") else ""
            if not seat:
                seat = (parse_qs(url.query).get("seat") or [""])[0]
            if not seat:
                return self._json(400, {"error": "seat key required: GET /state/<seatKey>"})
            with _lock:
                sub = _submissions.get(seat)
                sub = dict(sub) if sub else None
            passed, detail = grade(sub)
            self._log_extra = "seat=%s pass=%s" % (seat, passed)
            return self._json(200, {"seat": seat, "pass": passed, "detail": detail, "submission": sub})
        if path.startswith("/api/"):
            return self._json(404, {"error": "not found"})
        return self._serve_static(path)

    def do_POST(self):
        url = urlparse(self.path)
        path = url.path
        if path == "/api/submit":
            try:
                data = self._read_json()
            except Exception as exc:  # malformed JSON
                return self._json(400, {"ok": False, "error": "invalid JSON body: %s" % exc})
            seat = str(data.get("seat") or "anon").strip() or "anon"
            sub = {
                "seat": seat,
                "claimNumber": data.get("claimNumber"),
                "dobMonth": data.get("dobMonth"),
                "dobDay": data.get("dobDay"),
                "dobYear": data.get("dobYear"),
                "reason": data.get("reason"),
                "justification": data.get("justification"),
                "attested": data.get("attested"),
                "remoteAddr": self.client_address[0],
                "submittedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
            with _lock:
                sub["reference"] = make_reference(seat)
                _submissions[seat] = sub
            passed, detail = grade(sub)
            self._log_extra = "seat=%s ref=%s pass=%s (%s)" % (seat, sub["reference"], passed, detail)
            return self._json(200, {"ok": True, "reference": sub["reference"]})
        if path == "/api/reset" or path.startswith("/api/reset/"):
            self._read_body()  # drain any body so keep-alive connections stay in sync
            seat = unquote(path[len("/api/reset/"):]) if path.startswith("/api/reset/") else ""
            if not seat:
                seat = (parse_qs(url.query).get("seat") or [""])[0]
            if not seat:
                return self._json(400, {"ok": False, "error": "seat key required: POST /api/reset/<seatKey>"})
            with _lock:
                existed = _submissions.pop(seat, None) is not None
            self._log_extra = "seat=%s cleared=%s" % (seat, existed)
            return self._json(200, {"ok": True, "seat": seat, "cleared": existed})
        self._read_body()
        return self._json(404, {"ok": False, "error": "not found"})

    # ---- static files -------------------------------------------------------
    def _serve_static(self, path):
        rel = unquote(path).lstrip("/")
        if rel in ("", "index.html"):
            rel = "index.html"
        elif "." not in rel.rsplit("/", 1)[-1]:
            rel = "index.html"  # SPA fallback: extension-less paths render the app
        full = os.path.normpath(os.path.join(STATIC_DIR, rel))
        try:
            inside = os.path.commonpath([STATIC_DIR, full]) == STATIC_DIR
        except ValueError:
            inside = False
        if not inside or not os.path.isfile(full):
            return self._send(404, b"404 Not Found", "text/plain; charset=utf-8")
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
            ctype += "; charset=utf-8"
        with open(full, "rb") as fh:
            body = fh.read()
        self._send(200, body, ctype)


def main():
    port = int(os.environ.get("PORT", "8080"))
    mimetypes.add_type("text/html", ".html")
    httpd = ThreadingHTTPServer(("0.0.0.0", port), PortalHandler)
    httpd.daemon_threads = True
    print("Meridian Mutual portal listening on http://0.0.0.0:%d  (static dir: %s)" % (port, STATIC_DIR), flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
