# Launch plan

The challenge is judged on (a) whether the thing has product-market fit and (b) whether
you can ship. The launch is part of the build. Do it in this order.

## 0. Before posting

1. Redeem the Starter promo (`STARTER1MO-MKY4BNDK`) at console.getsolari.com so the party
   is 20 seats, not 3.
2. `cp .env.example .env`, fill both keys, `npm run dev`. Run **FILE THE APPEAL** at k=5
   once to check cost and timing on your Anthropic tier. If seats sit in "waiting for a
   model slot" a lot, lower `LANPARTY_LLM_CONCURRENCY`.
3. Run k=20 on `claude-opus-5`. Then RE-RUN the same task on `claude-sonnet-5`. Do not
   touch the task, the caps, or the portal between runs. Whatever the numbers are, those
   are the numbers.
4. Take the hero screenshot from the room while ~half the seats are still running
   (cheers + slumps + typing kids all visible). Record a 30–60s screen capture of START →
   seats lighting up → scoreboard → divergence window → replay.
5. Deploy somewhere with a persistent disk (Fly.io with a volume mounted at `data/`,
   Railway with a volume, or a $5 VPS with `npm run build && npm start`) and set
   `PUBLIC_URL` so `/r/:id` links unfurl with the scoreboard card. Keep your keys server-side;
   never put them in the client.
6. Push the fork: `git remote add origin git@github.com:<you>/solari-cookbook.git && git push -u origin main`.

## 1. The post (X)

Lead with the number and the divergence, not the aesthetic. The room is the image; the
text is the finding.

> I made 20 Claudes file the same insurance appeal at once, on 20 identical @getsolari cloud browsers.
>
> 13/20 passed. pass^4 = 15%.
>
> LANPARTY.EXE shows every seat live and pins the exact step where the other 7 broke (5 clicked "Cancel Appeal" instead of "Submit Appeal"). Replay for each.
>
> Built in a day on Solari for @harrychow_'s challenge. Repo + live party below 👇

Reply 1: the divergence report window screenshot + "This is the part that matters: not
that it failed, but *where*, on identical machines, with a replay."

Reply 2: the sonnet re-run scoreboard. "Same task, same 20 machines, `claude-sonnet-5`:
X/20. RE-RUN is one click."

Reply 3: the repo link + `npm run dev:demo` ("no keys needed to see it") + the
external-agent contract ("bring your own agent: it boots the seats, you sit down").

Reply 4: "Reply with a public URL + a one-line task and I'll run a 20-seat party on it
and post your pass@20." Then actually do it for the first ten replies.

## 2. LinkedIn

Same content, one image (the room), 5 lines: the question (does your agent work *reliably*),
the method (k identical machines, deterministic grader, divergence), the number, the link,
the tag.

## 3. What to say if asked

- *Why not just a loop with Playwright locally?* Because k identical machines that boot in
  under a second, each with its own recording and a shared logged-in profile, is the
  difference between an anecdote and an experiment. That's the Solari part.
- *Isn't the portal rigged?* The traps are documented and frozen; every seat sees the same
  ones; the grader explains the first failing rule; nothing was tuned between runs. Real
  portals have worse traps.
- *Why Claude by default?* It's the better computer-use agent today; the dropdown and the
  OpenAI-compatible adapter exist precisely so nobody has to take that on faith.
- *What would you build next?* SAVE STATE: snapshot a desktop seat at the divergence step
  (`desktop.snapshot()`), fork N seats from it (`create({ fromSnapshot })`) with different
  prompts, and answer "what if it had clicked Submit" without replaying 19 steps.
