# Range Log — Sniper Kill Counter

A tap-to-track game for logging real self-improvement work as sniper kills:

- **Architect** → Abstraction
- **Commander** → Leverage
- **Army** → Build

Tap a target to start a session ("Engaging"). A live timer, ballistic range
ruler, and projected kill count run while you work. Tap **Confirm Kill**
when you're done and the session is scored and added to your totals.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000 on your phone (or resize your browser — it's
capped at 480px wide and built mobile-first).

## The scoring formula

Every session is scored by how close its length lands to a **90-minute
zero**:

```
rate   = bell curve peaking at 1.0 exactly at 90 minutes, tapering off
         symmetrically on either side (σ = 45 minutes)
kills  = round(minutes_elapsed × rate)
```

So a 90-minute session scores the best possible rate. Much shorter
sessions (you didn't get warmed up) or much longer ones (diminishing
returns) score a lower rate, even though total elapsed minutes still add
up. This is the single fixed formula used for both the *live* projected
count during a session and the *final* count when you confirm — same
function, called at two different times, so the number on screen never
lies to you.

Rank labels use real range terminology: **Dead Zero** (rate ≥ 90%),
**Tight Group** (≥ 70%), **On Target** (≥ 40%), **Off Zero** (≥ 15%),
**No Zero** (below that).

## Why the timer survives closing the browser

Only one thing is authoritative: the session's `startTime`, saved to
`localStorage` the instant a session begins. Elapsed time is always
`Date.now() - startTime`, recomputed fresh on every tick and on every
page load — never an incrementing counter that could fall behind or reset.
Close the tab, put your phone away, come back three hours later: the timer
is exactly right the moment the page loads, and the projected kill count
(and its 90-minute taper) reflects that immediately.

## Code layout

The three category rules from the brief map directly onto the file
structure:

| Brief concept | File | Role |
|---|---|---|
| Architect · Abstraction | `lib/gameLogic.ts` | Pure scoring math. Zero UI or storage knowledge — everything else hits it through a few small functions. |
| Commander · Leverage | `lib/storage.ts` | The one place `localStorage` is read or written. Write it once, every screen reuses it. |
| Army · Build | `components/*` | The actual UI: optimal for the phone screen, flexible enough that new categories or ranks just extend the tables in `lib/theme.ts`. |

No Tailwind — every component styles itself with plain inline `style`
objects. `app/globals.css` only carries the things inline styles can't do:
a font import, a focus ring, and a `100dvh` fallback for older mobile
browsers.
