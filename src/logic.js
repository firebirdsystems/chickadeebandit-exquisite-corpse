// Pure, browser-free game logic for Exquisite Corpse. Imported by index.html
// (bound to app state via thin wrappers) and unit-tested directly in
// __tests__/logic.test.mjs.

export function parseOrder(round) {
  if (!round) return [];
  if (Array.isArray(round.turn_order)) return round.turn_order;
  try {
    const parsed = JSON.parse(round.turn_order ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Segments belonging to a round, ordered by their assigned panel position.
export function orderedSegments(segments, roundId) {
  return segments
    .filter((s) => s.round_id === roundId)
    .sort((a, b) => (a.position - b.position) || String(a.created_at).localeCompare(String(b.created_at)));
}

// The turn is DERIVED from how many panels are in — never a mutable pointer.
// currentMemberId is whoever occupies the next open slot in turn_order.
export function deriveTurn(round, segments) {
  const order = parseOrder(round);
  const done = segments.filter((s) => s.round_id === round.id).length;
  const total = order.length;
  const complete = total > 0 && done >= total;
  return {
    done,
    total,
    complete,
    currentIndex: complete ? -1 : done,
    currentMemberId: complete ? null : (order[done] ?? null),
  };
}

export function mySegment(segments, round, me) {
  if (!me) return null;
  return segments.find((s) => s.round_id === round.id && s.member_id === me.id) ?? null;
}

export function isParticipant(round, me) {
  return !!me && parseOrder(round).includes(me.id);
}

// Mirrors the sealed_until server policy: I may submit iff it is my slot's turn,
// the round is open, and I have not already submitted. The server independently
// enforces one-panel-per-member and sealing — this only drives the UI.
export function canSubmit(round, segments, me) {
  if (!me || round.status !== "open" || round.archived) return false;
  if (mySegment(segments, round, me)) return false;
  return deriveTurn(round, segments).currentMemberId === me.id;
}

// A member's fixed panel position is their slot in the immutable turn_order.
export function positionFor(round, me) {
  return parseOrder(round).indexOf(me?.id);
}

// Mirrors owner_or_visibility + write_owner_only: only the creator manages the
// round (reveal / archive). Adults get no bypass here — the host owns their game.
export function canManageRound(round, me) {
  return !!me && !!round && round.created_by_id === me.id;
}

// Host may reveal an open round that has at least one panel; the UI recommends
// waiting until every slot is filled but allows an early reveal.
export function canReveal(round, segments, me) {
  if (!canManageRound(round, me)) return false;
  if (round.status !== "open" || round.archived) return false;
  return deriveTurn(round, segments).done > 0;
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
