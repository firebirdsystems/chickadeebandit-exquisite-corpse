// Pure, browser-free game logic for Exquisite Corpse. Imported by index.html
// (bound to app state via thin wrappers) and unit-tested directly in
// __tests__/logic.test.mjs.
//
// THE ONE RULE THIS FILE EXISTS TO KEEP: never count `segments` to work out the
// state of a round. Segments are sealed_until — a member's SELECT returns only
// their own panel while the round is open — so any count over them reads 0-or-1
// for every artist and is wrong for everyone. `handoffs` is the visible shadow
// of the same event (one row written per submit, inherit_visibility from the
// round), and is the only honest source for "how many panels are in".
//
// `segments` may still be asked the one question it can answer for the caller:
// "is MY panel among these" — that row is the one the policy does return.

// Panels submitted to a round so far. Counted from the shared hand-offs, not
// the sealed segments (see the file header).
export function panelCount(handoffs, roundId) {
  return handoffs.filter((h) => h.round_id === roundId).length;
}

// The position the next artist claims. Positions are claim order, first come
// first served — there is no reserved seat.
export function nextPosition(handoffs, roundId) {
  return panelCount(handoffs, roundId);
}

// The panel count the host is aiming for; 0 (or absent) means open-ended.
export function panelTarget(round) {
  const n = Number(round?.panel_target ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function roundProgress(round, handoffs) {
  const drawn = panelCount(handoffs, round.id);
  const target = panelTarget(round);
  return { drawn, target, complete: target > 0 && drawn >= target };
}

// Everyone who has put a panel in, in claim order. Readable by any artist —
// hand-offs carry the member id and nothing about the drawing itself. This is
// the audience for the reveal: the sealed segments cannot supply it.
export function artistIds(handoffs, roundId) {
  return handoffs
    .filter((h) => h.round_id === roundId)
    .sort((a, b) => (Number(a.position) - Number(b.position)))
    .map((h) => h.member_id);
}

// Segments belonging to a round, ordered by their assigned panel position.
export function orderedSegments(segments, roundId) {
  return segments
    .filter((s) => s.round_id === roundId)
    .sort((a, b) => (a.position - b.position) || String(a.created_at).localeCompare(String(b.created_at)));
}

export function mySegment(segments, round, me) {
  if (!me) return null;
  return segments.find((s) => s.round_id === round.id && s.member_id === me.id) ?? null;
}

// Mirrors what the server actually enforces: the round is open, and this member
// has not already drawn (sealed_until's max_per_member, one panel per member per
// round). No turn check — there is no turn. A full round is the one soft gate:
// once the host's target is met the canvas closes, but the server does not know
// about targets, so this is UX, not a control.
//
// `mySegment` is deliberately the "have I drawn" check rather than `hasDrawn`:
// my own segment is the row the policy DOES return to me, and it is what the
// server's one-per-member rule keys on.
export function canSubmit(round, segments, handoffs, me) {
  if (!me || round.status !== "open" || round.archived) return false;
  if (mySegment(segments, round, me)) return false;
  return !roundProgress(round, handoffs).complete;
}

// Mirrors owner_or_visibility + write_owner_only: only the creator manages the
// round (reveal / archive). Adults get no bypass here — the host owns their game.
export function canManageRound(round, me) {
  return !!me && !!round && round.created_by_id === me.id;
}

// Host may reveal an open round that has at least one panel; the UI recommends
// waiting for the target (when there is one) but allows an early reveal.
export function canReveal(round, handoffs, me) {
  if (!canManageRound(round, me)) return false;
  if (round.status !== "open" || round.archived) return false;
  return panelCount(handoffs, round.id) > 0;
}

// The hand-off marks the next artist continues: those left by the panel
// immediately below the one being claimed, i.e. the most recent hand-off.
// Returns [] for the first panel of a round.
export function lastConnectors(handoffs, roundId) {
  const forRound = handoffs
    .filter((h) => h.round_id === roundId)
    .sort((a, b) => Number(a.position) - Number(b.position));
  const prev = forRound[forRound.length - 1];
  if (!prev) return [];
  try {
    const parsed = typeof prev.connectors === "string" ? JSON.parse(prev.connectors) : prev.connectors;
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

// From this artist's strokes, the low-information hand-off passed to the next
// artist: normalized x (0..1) and color of each stroke that crosses the bottom
// band. Reveals continuation points, never the drawing. Pure + deterministic.
export function computeConnectors(strokes, width, height, band = 24, max = 14) {
  if (!width || !height) return [];
  const out = [];
  for (const stroke of strokes) {
    if (!stroke || stroke.erase || !Array.isArray(stroke.points) || !stroke.points.length) continue;
    let lowest = null;
    for (const p of stroke.points) {
      if (p.y >= height - band && (!lowest || p.y > lowest.y)) lowest = p;
    }
    if (lowest) {
      out.push({ x: Math.min(1, Math.max(0, lowest.x / width)), color: stroke.color || "#111827" });
    }
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Fields the in-app search matches against (see hub-sdk `searchMatch`).
 * The theme is what a drawing is remembered by once the title has
 * blurred; the starter is credited too.
 */
export function searchableFields(item) {
  return [item.title, item.theme, item.created_by_name];
}
