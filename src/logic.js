// Pure, browser-free game logic for the Drawing Game (exquisite-corpse). Imported by index.html
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

/**
 * The position the next artist claims: one above the highest slot taken, NOT
 * the panel count. The two differ whenever a row has gone missing from the
 * middle — `member_references.handoffs.on_removed` is "delete", so a member
 * leaving takes their hand-off out of the sequence. Claiming `count` would then
 * hand out a position somebody already holds, and the duplicate decides the
 * stack order on a created_at tiebreak while `lastConnectors` picks between the
 * tied rows arbitrarily — the next artist continues the wrong edge.
 */
export function nextPosition(handoffs, roundId) {
  let max = -1;
  for (const h of handoffs) {
    if (h.round_id !== roundId) continue;
    const pos = Number(h.position);
    if (Number.isFinite(pos) && pos > max) max = pos;
  }
  return max + 1;
}

// The panel count the host is aiming for; 0 (or absent) means open-ended.



/**
 * `drawn` is the panel count. `complete` means the round can take no more
 * panels: one per member is enforced server-side (sealed_until's
 * max_per_member), so a round the whole roster has drawn on is finished.
 *
 * That is the ONLY way a round closes. A host-set panel target used to be a
 * second one, and it cost far more than it bought: `position` and the count
 * come apart in both directions — a departing member's hand-off is deleted,
 * two racing artists can share a slot — so every surface that compared a count
 * to a target disagreed with some other surface about what "full" meant. The
 * glance badge could not even ask the question, deciding fullness in SQL as
 * "some hand-off holds a slot at or past the last one" because a correlated
 * COUNT over a governed table fails closed.
 *
 * Closing on the roster removes all of it, and removes it by construction: the
 * badge is per-viewer and only ever surfaces a round to someone who has NOT
 * drawn, and if anyone has not drawn then the round is not complete. Badge and
 * canvas cannot disagree, so the glance needs no fullness test at all. Nothing
 * is lost — a host who wants a shorter drawing reveals it early, which is what
 * revealing has always meant.
 *
 * An empty roster means the roster is unknown (loadMembers swallows a failed
 * family.members fetch), and `[].every()` is vacuously true, so it must not
 * count.
 */
export function roundProgress(round, handoffs, memberIds = []) {
  const drawn = panelCount(handoffs, round.id);
  const drawnIds = new Set(artistIds(handoffs, round.id));
  const complete = memberIds.length > 0 && memberIds.every((id) => drawnIds.has(id));
  return { drawn, complete };
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
// round). No turn check — there is no turn.
//
// `mySegment` is deliberately the "have I drawn" check rather than `hasDrawn`:
// my own segment is the row the policy DOES return to me, and it is what the
// server's one-per-member rule keys on.
export function canSubmit(round, segments, handoffs, me, memberIds = []) {
  if (!me || round.status !== "open" || round.archived) return false;
  // A drawing whose host has left can never be revealed, so a panel added to it
  // would stay sealed from everyone forever — including its own artist, who
  // would also have spent their one panel for this round on it.
  if (isOrphanedRound(round)) return false;
  if (mySegment(segments, round, me)) return false;
  // roundProgress's roster clause cannot bite here — this member has no panel,
  // so if they are on the roster then not everyone has drawn. Kept as the
  // single source of "is this round finished" rather than open-coded.
  return !roundProgress(round, handoffs, memberIds).complete;
}

/**
 * What a submit should do, given what the artist drew against and the state
 * just re-read from the server. Pure, so the interesting cases are unit-
 * testable: the browser layer can only be driven through a canvas nobody can
 * draw on from a test, and the confirmation dialog it raises belongs to the
 * parent hub frame, out of reach of an app UI scenario.
 *
 * `drawnAgainst` / `drawnAgainstId` describe the panel this drawing was made
 * to continue: how many panels there were, and WHICH row was above.
 *
 * The id is what decides whether to ask. A count difference cannot: hand-offs
 * are deleted when a member leaves, so a departure and an arrival in the same
 * window cancel out to `arrived === 0` while the edge being continued has in
 * fact been replaced. The count is kept only to word the question.
 *
 *   { action: "blocked", reason }                  nothing can be done
 *   { action: "confirm", kind, arrived, drawn, position }   ask, then submit
 *   { action: "go", position }                     claim it silently
 */
export function submitDecision({ round, segments, handoffs, me, drawnAgainst, drawnAgainstId, memberIds = [] }) {
  const position = nextPosition(handoffs, round.id);
  if (!me) return { action: "blocked", reason: "unknown_member" };
  // Both of these the server enforces too (one panel per member; frozen_when
  // locks segments once the round is revealed) — deciding them here turns a
  // raw policy rejection into a sentence.
  if (mySegment(segments, round, me)) return { action: "blocked", reason: "already_drawn" };
  if (round.status !== "open" || round.archived) return { action: "blocked", reason: "round_closed" };
  // Re-read state can show the host gone since the canvas was opened.
  if (isOrphanedRound(round)) return { action: "blocked", reason: "host_gone" };

  const { drawn } = roundProgress(round, handoffs, memberIds);
  const arrived = Math.max(0, panelCount(handoffs, round.id) - drawnAgainst);
  // Has the panel we are continuing stopped being the panel above us?
  const replaced = topHandoffId(handoffs, round.id) !== drawnAgainstId;
  // There is deliberately no "the round filled up while you drew" case: a round
  // is complete only when everyone has drawn, and this member has not, so it
  // cannot have closed under them.
  if (replaced) {
    // Which question to ask turns on whether the panel we were continuing is
    // STILL THERE, not on the count. A member leaving from BELOW us while
    // someone else lands on top leaves the count unchanged, and picking the
    // wording off `arrived` then tells the artist their neighbour left the
    // roster when in truth a new panel just arrived. A null baseline means we
    // started on an empty round, so anything on top is an arrival.
    const baselineGone = drawnAgainstId != null &&
      !handoffs.some((h) => h.round_id === round.id && h.id === drawnAgainstId);
    return {
      action: "confirm", kind: baselineGone ? "replaced" : "arrived",
      arrived, drawn, position,
    };
  }
  return { action: "go", position };
}

/**
 * A round whose host has left the household. `member_references.rounds` is
 * `on_removed: "null"` with `null_value: ""`, so an empty `created_by_id` is the
 * hub's own record that the member is gone — a stored fact, still true when
 * `family.members` failed to load.
 *
 * Such a round can never be revealed, and that is correct rather than broken.
 * `rounds` keeps `write_owner_only`, so the hub accepts a write only from the
 * creator, and the creator no longer exists. Dropping that flag would let ANY
 * adult flip a round to 'revealed' — releasing every artist's sealed panel on a
 * drawing they had no part in, which is the one property this app exists to
 * hold ("nobody, the host included, sees another artist's panel before the
 * reveal"). An unrevealable round is the confidentiality rule working; the
 * defect was only that the app never said so, kept inviting panels into it, and
 * kept badging it on the Glance. Those are the parts fixed, client-side.
 *
 * Retention retires the row on the normal 365-day schedule, panels and files
 * with it.
 */
export function isOrphanedRound(round) {
  return !!round && round.created_by_id === "";
}

// Mirrors owner_or_visibility + write_owner_only: only the creator manages the
// round (reveal / archive). Adults get no bypass here — the host owns their game.
export function canManageRound(round, me) {
  return !!me && !!round && round.created_by_id === me.id && !isOrphanedRound(round);
}

// Host may reveal an open round that has at least one panel. Revealing before
// everyone has drawn is allowed — it is how a host ends a drawing early.
export function canReveal(round, handoffs, me) {
  if (!canManageRound(round, me)) return false;
  if (round.status !== "open" || round.archived) return false;
  return panelCount(handoffs, round.id) > 0;
}

/**
 * The hand-off whose marks the next artist continues: the one holding the
 * highest slot. Ties (two artists raced onto one position) break on created_at
 * then id, so the choice is deterministic rather than array-order dependent.
 *
 * Everything that asks "what is above me" goes through here — the ghost marks
 * and the did-it-change check both — so they cannot pick different rows.
 */
export function topHandoff(handoffs, roundId) {
  const forRound = handoffs
    .filter((h) => h.round_id === roundId)
    .sort((a, b) =>
      (Number(a.position) - Number(b.position)) ||
      String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) ||
      String(a.id ?? "").localeCompare(String(b.id ?? "")));
  return forRound[forRound.length - 1] ?? null;
}

/** Identity of the panel above the next slot, or null on an empty round. */
export function topHandoffId(handoffs, roundId) {
  return topHandoff(handoffs, roundId)?.id ?? null;
}

// The marks the next artist continues. Returns [] for the first panel.
export function lastConnectors(handoffs, roundId) {
  const prev = topHandoff(handoffs, roundId);
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
