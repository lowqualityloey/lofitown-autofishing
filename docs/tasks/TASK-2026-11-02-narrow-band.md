# Task: the narrow band (3.9.17)

Level: 2 (Controlled) · Owner: lead · Started: 2026-11-02 · Status: in review

## Objective

The only band with a defect left in the 3.9.15 run: narrow dials (width < 60 deg) went **9 of 12**,
against 52/52 for wide and full. Find out whether a dial is being passed untouched, and stop it.

## Evidence (the 3.9.15 run, 133 attempts)

| width | dials | presses | rejected | duration | outcome |
| ---: | ---: | ---: | ---: | ---: | :--- |
| 47.1 | **7** | **3** | 0 | 19.0 s | lost |
| 35.0 | 1 | 7 | 0 | 12.4 s | lost |
| 47.5 | 2 | 3 | 0 | 10.6 s | lost |

Caught narrow attempts average 1.8 dials / 5.6 presses; lost ones 3.3 dials / 4.3 presses. Zero
presses were rejected anywhere in the run. Two shapes, not one: dials that were never pressed, and
a dial pressed seven times whose fish still left at 12.4 s.

## Root cause (first shape)

`F.armed` - permission to press - was set true at Start and re-armed only when the pin was more than
`win + 12` degrees away **and** `newTriangle()` could see a spawn. It was never opened when a new dial
locked, so a dial that ended disarmed left the next one disarmed too. On a narrow dial `win` is about
19.5 deg, so the geometric re-arm needs 31.5 deg of separation - and when the pin sits inside the arc
for that dial, it never comes. Wide dials (win 78) almost always re-arm, which is why the defect
concentrated in the narrow band.

## Contract

- A new spawn opens the gate: `F.armed = true` at lock, with the arrival state recorded in `_armed0`.
- An accepted press is proof of a spawn even when the geometry cannot see one: re-arm within
  `rearmAcceptedMs` (600 ms) without needing the width/blink/jump test.
- Every dial records `{ width, omega, presses, heldMs, armed0, verdict }` on the attempt, capped at
  12, and `stats.locksDisarmed` counts dials that arrived with the gate shut.
- No change to `planPress`, the geometry, the thresholds or the catch oracle.

## Acceptance

1. `node --test` passes with guards on all five behaviours.
2. Next run: narrow **>= 11 of 12** and **>= 90%** over >= 12 attempts.
3. Next run: presses per dial >= 1.0 in every attempt, `locksDisarmed` at 0 after the first dial.
4. Wide and full stay at 100%; **zero rejected presses** - a re-arm that misclicks would show here.

## Out of scope

The second shape - one dial, seven accepted presses, fish still lost - is a throughput limit, not a
bug. It is measured, not patched: a shorter press gap to squeeze in more presses risks rejected
presses, which cost more than they gain.
