# Drawing Game

The classic collaborative drawing game, played asynchronously inside Chickadee Bandit.

A host starts a drawing; anyone in the household may add a panel to it, one
each, in whatever order people are ready. There is no turn — if you haven't
drawn yet, you can draw now. Each artist sees only faint **connector ticks**
showing where the previous artist's lines crossed the bottom edge. Every panel
stays **sealed** until the host reveals the finished, absurd figure to the whole
household at once.

## How the pieces map to the platform

| Concern | Mechanism |
|---|---|
| Everyone can browse drawings, only the host controls one | `rounds` → `owner_or_visibility` with `write_owner_only` |
| A panel is hidden from everyone but its author until reveal | `segments` → `sealed_until` on `rounds.status = 'revealed'` |
| One panel per artist per drawing | `segments` → `max_per_member` (scope `round_id`) |
| Panels can't be edited after the reveal | `segments` → `frozen_when` (parent `status = 'revealed'`) |
| The next artist sees only the previous edge, never the drawing | `handoffs` → `inherit_visibility`; stores low-info connector x/colors only |
| A departed host's drawing stays sealed rather than becoming anyone's to reveal | `member_references` empties `created_by_id`; `write_owner_only` then matches nobody |

### Why there is no turn order

There used to be one, and it was the app's defining bug. A fixed order was
stored in `rounds.turn_order`, and "whose turn is it" was derived from how many
`segments` had been submitted. But `segments` is `sealed_until`: a member's
SELECT returns **only their own row** until the round is revealed. That count
therefore read 0-or-1 for every artist, so the Glance badge and the app itself
disagreed about who was up.

Free order removes the question rather than fixing the arithmetic. Anyone who
has not drawn may draw, so nothing needs to know whose turn it is, and every
piece of round state the app does need — how many panels are in, who has drawn,
which edge to continue — comes from `handoffs`, which `inherit_visibility` makes
readable by every participant. `max_per_member` still enforces one panel each,
server-side. The confidentiality-critical property — nobody, the host included,
sees another artist's panel before the reveal — was always `sealed_until`'s job
and is unchanged.

### When the host leaves

`write_owner_only` means the hub accepts a write to a round only from its
creator, and `member_references` empties `created_by_id` when that member leaves
the household. So a departed host's drawing can never be revealed — by anyone.

That is the confidentiality rule working, not a gap to route around. The
alternative is dropping `write_owner_only` so household adults can wind the
round up, and that hands *every* adult the ability to flip *any* round to
`revealed` and release panels from a drawing they had no part in. The app's one
promise is that nobody sees another artist's panel before the reveal; an
unrevealable round is a much smaller price than an unreliable seal. (The
scenario at `scenarios.json[0]` steps 5–6 pins this: a non-host adult's UPDATE
must narrow to zero rows.)

What was wrong was only that the app stayed silent about it — it kept badging
the round on the Glance and kept offering the canvas, so artists could spend
their one panel on a drawing that would stay sealed from everyone including
themselves. The round now says so, stops taking panels, and drops off the
Glance; retention retires it on the normal 365-day schedule.

### Who counts as "everyone"

A round is "finished" when everyone has drawn — and "everyone" is
`family.app_members` when the hub provides it: the members the household's own
settings (`visible_to`, per-member grants and restrictions, `min_age`) would
actually let into this app. On a hub that predates the key, or when the fetch
fails, the app falls back to `family.members`, the whole roster — in a
household that restricts this app, the roster then overstates who is playing
and the "Ready to reveal" pill may never appear. Nothing breaks either way:
the host can reveal at any point from the first panel on. Names always come
from the full roster, so a panel drawn by a since-restricted member keeps its
name.

## Develop

```bash
npm install
npm test          # pure logic + manifest validation
npm run build     # validates manifest + migrations, writes dist/bundle.json
npm run dev       # local dev server at http://localhost:3001
```
