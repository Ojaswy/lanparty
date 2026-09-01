# Meridian Mutual — mock denial-appeal portal (LANPARTY.EXE benchmark task)

A self-contained, offline, circa-2000 "Provider Services Portal" plus a tiny grader API.
Python 3 stdlib only (no pip), one HTML file, no external requests.

```
server.py            HTTP server + in-memory grader   (PORT env, default 8080)
static/index.html    single-page portal (vanilla JS, inline CSS)
```

## Run locally

```
python3 server.py
# then open  http://localhost:8080/?seat=test
```

Each agent seat opens `/?seat=<seatKey>` (`#seat=<seatKey>` also works). The page stores the seat in a JS
variable (`window.LANPARTY_SEAT`) and `sessionStorage`, shows it in the footer as "Terminal ID", and sends it
with the submission. No seat param => `anon`.

## The task an agent must complete

File an appeal for the denied claim shown in the letter on the home page:

1. Dismiss the **PORTAL NOTICE** modal with **I Acknowledge**.
2. Click **File an Appeal**.
3. Step 1: Claim Number `CLM-2026-004471`, DOB `March / 14 / 1957` (three native selects), **Continue**.
4. Step 2: Reason = **Precertification was obtained (authorization on file)**, a justification of at least
   40 characters that cites authorization **PA-88213** (the letter says "cite the authorization number"; the
   internal provider note gives it), tick the attestation checkbox, **Continue**.
5. Step 3: scroll to the very bottom, click the plain gray **Submit Appeal** button.
6. Confirmation shows `Appeal received. Reference number: APL-######`.

## Traps (deliberate)

| Where | Trap | Effect |
|---|---|---|
| Modal | **Exit Portal** (listed first) | dead-end "Session Ended" page; nav/sidebar hidden; only a reload recovers |
| Home | **Check Claim Status** | dead-end "No records found" table (has a Return to Home button) |
| Home | **Print Letter** | does nothing |
| Step 1 | big bold green **Save Draft** | only prints "Draft saved…", never advances; the real button is the plain gray **Continue** |
| Step 1 | DOB is three `<select>`s | must be exactly 03 / 14 / 1957; claim number must match exactly (inline red errors otherwise) |
| Step 2 | justification hint says only "min 40 characters" | grader additionally requires PA-88213 to be cited; the page never says so |
| Step 3 | page is longer than 800px | buttons are below the fold; the review page is the only view that needs scrolling |
| Step 3 | bold blue **Cancel Appeal** sits left of plain gray **Submit Appeal** | Cancel wipes all state and returns Home |
| Everywhere | yellow "session will expire in 14:59" banner | counts down and wraps; never actually expires |

## Grading (`GET /state/<seatKey>`)

Returns `{"pass": bool, "detail": str, "submission": {...} | null}`. `pass` is true only when ALL hold:

1. a submission exists for that seat;
2. `claimNumber == "CLM-2026-004471"` (surrounding whitespace ignored);
3. DOB == 1957-03-14 (`dobYear/dobMonth/dobDay`; month accepts `03`, `3` or `March`);
4. `reason == "precert_on_file"`;
5. justification contains the auth number, case-insensitive, regex `PA\s*[-#:]?\s*88213`
   (`PA-88213`, `PA 88213`, `pa-88213`, `PA88213` all pass);
6. `attested` is truthy (`true`, `"true"`, `"on"`, `"yes"`, `1`).

`detail` names the first failing rule, or is `"Appeal filed correctly"`. A re-submission for the same seat
overwrites the previous one.

## API

| Method | Path | Body / result |
|---|---|---|
| GET | `/healthz` | `{"ok": true}` |
| POST | `/api/submit` | JSON `{seat, claimNumber, dobMonth, dobDay, dobYear, reason, justification, attested}` -> `{"ok": true, "reference": "APL-######"}` |
| GET | `/state/<seatKey>` (or `/state?seat=`) | `{seat, pass, detail, submission}` |
| POST | `/api/reset/<seatKey>` | `{"ok": true, "seat", "cleared": bool}` |
| OPTIONS | any | 204 with CORS headers |

Every response carries `Cache-Control: no-store` and `Access-Control-Allow-Origin: *`. One log line per request
is written to stdout. Any path without a file extension serves `index.html`, so query/hash routing survives reloads.
The reference number is `(sha1(seat) + counter*7919) % 900000 + 100000`, so it is stable per seat/order.

## Quick self-test

```
curl -s localhost:8080/healthz
curl -s -X POST localhost:8080/api/submit -H 'Content-Type: application/json' \
  -d '{"seat":"t1","claimNumber":"CLM-2026-004471","dobMonth":"03","dobDay":"14","dobYear":"1957","reason":"precert_on_file","justification":"Prior authorization PA-88213 was approved on 07/15/2026 by phone; please reprocess.","attested":true}'
curl -s localhost:8080/state/t1        # -> "pass": true
curl -s -X POST localhost:8080/api/reset/t1
```
