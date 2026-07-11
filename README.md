# Exquisite Corpse

The classic collaborative drawing game, played asynchronously inside Chickadee Bandit.

A host starts a drawing and picks the artists. The host draws first, then the
drawing is passed to the others in a random order. Each artist, on their turn,
draws a single panel — seeing only faint
**connector ticks** showing where the previous artist's lines crossed the bottom
edge. Every panel stays **sealed** until the host reveals the finished, absurd
figure to the whole household at once.

## How the pieces map to the platform

| Concern | Mechanism |
|---|---|
| Everyone can browse drawings, only the host controls one | `rounds` → `owner_or_visibility` with `write_owner_only` |
| A panel is hidden from everyone but its author until reveal | `segments` → `sealed_until` on `rounds.status = 'revealed'` |
| One panel per artist per drawing | `segments` → `max_per_member` (scope `round_id`) |
| Panels can't be edited after the reveal | `segments` → `frozen_when` (parent `status = 'revealed'`) |
| The next artist sees only the previous edge, never the drawing | `handoffs` → `inherit_visibility`; stores low-info connector x/colors only |

### On turn order

`sealed_until` has no server-side turn gate (only `inherit_visibility` supports
`insert_only_by_parent_column_member`), so **turn order is enforced in the UI, not
the backend**. This is safe: panels are sealed and `max_per_member` allows exactly
one panel per artist, so an out-of-turn submission via raw SQL leaks nothing and can't
double-submit. The confidentiality-critical property — nobody, the host included, sees
another artist's panel before the reveal — *is* enforced by `sealed_until`.

## Develop

```bash
npm install
npm test          # pure logic + manifest validation
npm run build     # validates manifest + migrations, writes dist/bundle.json
npm run dev       # local dev server at http://localhost:3001
```
