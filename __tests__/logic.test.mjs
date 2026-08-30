import { describe, it, expect } from "vitest";
import {
  panelCount, nextPosition, roundProgress, artistIds,
  orderedSegments, mySegment, canSubmit, canManageRound, canReveal, submitDecision, topHandoffId,
  lastConnectors, computeConnectors, searchableFields,
} from "../src/logic.js";

const ALEX = { id: "m-alex", name: "Alex", role: "adult" };
const CASEY = { id: "m-casey", name: "Casey", role: "child" };
const RILEY = { id: "m-riley", name: "Riley", role: "child" };

function round(overrides = {}) {
  return {
    id: "r1", status: "open", archived: 0,
    created_by_id: "m-alex", panel_height: 300, ...overrides,
  };
}
function seg(member, position, roundId = "r1") {
  return { id: `s-${member}`, round_id: roundId, member_id: member, position, created_at: `2026-01-0${position + 1}` };
}
function ho(member, position, roundId = "r1", connectors = []) {
  return {
    id: `h-${member}`, round_id: roundId, member_id: member, position,
    connectors: JSON.stringify(connectors), created_at: `2026-01-0${position + 1}`,
  };
}

/**
 * What the server actually hands a member for an OPEN round: every hand-off
 * (inherit_visibility), but only their OWN segment (sealed_until). Every test
 * below builds its state through this, because building it any other way is
 * what hid the original bug — the suite passed a fully-populated segment array
 * that no member ever receives, so a turn derived from `segments.length`
 * looked correct in the test and was 0-for-everyone in the browser.
 */
function asSeenBy(me, allSegments, allHandoffs) {
  return {
    segments: allSegments.filter((s) => s.member_id === me.id),
    handoffs: allHandoffs,
  };
}

describe("panelCount / nextPosition — counted from the visible hand-offs", () => {
  it("counts every artist's panel, not just the reader's own", () => {
    const handoffs = [ho("m-alex", 0), ho("m-casey", 1)];
    expect(panelCount(handoffs, "r1")).toBe(2);
    expect(nextPosition(handoffs, "r1")).toBe(2);
  });

  it("ignores other rounds", () => {
    expect(panelCount([ho("m-alex", 0), ho("m-casey", 0, "r2")], "r1")).toBe(1);
    expect(nextPosition([ho("m-alex", 0), ho("m-casey", 5, "r2")], "r1")).toBe(1);
  });

  it("is 0 on a fresh round", () => {
    expect(nextPosition([], "r1")).toBe(0);
  });

  // member_references.handoffs.on_removed is "delete", so a member leaving
  // takes their row out of the MIDDLE of the sequence. Claiming `count` would
  // hand out a slot somebody already holds.
  it("claims above the highest slot when a row has gone missing from the middle", () => {
    const handoffs = [ho("m-alex", 0), ho("m-riley", 2)]; // position 1 departed
    expect(panelCount(handoffs, "r1")).toBe(2);
    expect(nextPosition(handoffs, "r1")).toBe(3);
  });

  it("never reissues a slot after a race left two panels on one position", () => {
    const handoffs = [ho("m-alex", 0), ho("m-casey", 1), ho("m-riley", 1)];
    expect(nextPosition(handoffs, "r1")).toBe(2);
  });

  it("survives the strings a DB read hands back", () => {
    expect(nextPosition([{ round_id: "r1", position: "4" }], "r1")).toBe(5);
  });
});




// ── The regression this whole rewrite exists for ─────────────────────────────
describe("canSubmit — under the sealing the server actually applies", () => {
  it("lets a second artist draw once the host has, though the host's panel is invisible to them", () => {
    const allSegments = [seg("m-alex", 0)];
    const allHandoffs = [ho("m-alex", 0)];

    const casey = asSeenBy(CASEY, allSegments, allHandoffs);
    expect(casey.segments).toHaveLength(0); // sealed — this is the whole trap
    expect(canSubmit(round(), casey.segments, casey.handoffs, CASEY)).toBe(true);

    const riley = asSeenBy(RILEY, allSegments, allHandoffs);
    expect(canSubmit(round(), riley.segments, riley.handoffs, RILEY)).toBe(true);
  });

  it("lets anyone open a fresh round — the host has no reserved first slot", () => {
    expect(canSubmit(round(), [], [], CASEY)).toBe(true);
    expect(canSubmit(round(), [], [], ALEX)).toBe(true);
  });

  it("refuses a second panel from the same artist", () => {
    const view = asSeenBy(ALEX, [seg("m-alex", 0)], [ho("m-alex", 0)]);
    expect(canSubmit(round(), view.segments, view.handoffs, ALEX)).toBe(false);
  });

  it("refuses on a revealed, archived, or memberless round", () => {
    expect(canSubmit(round({ status: "revealed" }), [], [], ALEX)).toBe(false);
    expect(canSubmit(round({ archived: 1 }), [], [], ALEX)).toBe(false);
    expect(canSubmit(round(), [], [], null)).toBe(false);
  });
});

describe("artistIds — the roster an artist may legitimately see", () => {
  it("lists who has drawn, in claim order", () => {
    expect(artistIds([ho("m-casey", 1), ho("m-alex", 0)], "r1")).toEqual(["m-alex", "m-casey"]);
  });
  it("is the reveal audience, which the sealed segments could never supply", () => {
    const handoffs = [ho("m-alex", 0), ho("m-casey", 1)];
    expect(artistIds(handoffs, "r1").filter((id) => id !== ALEX.id)).toEqual(["m-casey"]);
  });
});

describe("lastConnectors — the marks the next artist continues", () => {
  it("takes the highest position, whatever order the rows arrive in", () => {
    const handoffs = [
      ho("m-casey", 1, "r1", [{ x: 0.5, color: "#f00" }]),
      ho("m-alex", 0, "r1", [{ x: 0.1, color: "#00f" }]),
    ];
    expect(lastConnectors(handoffs, "r1")).toEqual([{ x: 0.5, color: "#f00" }]);
  });
  it("is empty for the first panel", () => expect(lastConnectors([], "r1")).toEqual([]));
  it("is safe on garbage connectors", () => {
    expect(lastConnectors([{ round_id: "r1", position: 0, connectors: "not json" }], "r1")).toEqual([]);
  });
  it("accepts an already-parsed array", () => {
    expect(lastConnectors([{ round_id: "r1", position: 0, connectors: [{ x: 0.2 }] }], "r1")).toEqual([{ x: 0.2 }]);
  });
});

describe("canReveal — host only, and counted from hand-offs", () => {
  it("is true for the host once any panel is in, even though the panels are sealed to them", () => {
    const view = asSeenBy(ALEX, [seg("m-casey", 0)], [ho("m-casey", 0)]);
    expect(view.segments).toHaveLength(0);
    expect(canReveal(round(), view.handoffs, ALEX)).toBe(true);
  });
  it("is false with nothing drawn, and false for a non-host", () => {
    expect(canReveal(round(), [], ALEX)).toBe(false);
    expect(canReveal(round(), [ho("m-casey", 0)], CASEY)).toBe(false);
  });
  it("is false once revealed or archived", () => {
    expect(canReveal(round({ status: "revealed" }), [ho("m-alex", 0)], ALEX)).toBe(false);
    expect(canReveal(round({ archived: 1 }), [ho("m-alex", 0)], ALEX)).toBe(false);
  });
});

describe("canManageRound", () => {
  it("is the creator only — an adult gets no bypass", () => {
    expect(canManageRound(round(), ALEX)).toBe(true);
    expect(canManageRound(round(), CASEY)).toBe(false);
    expect(canManageRound(round(), null)).toBe(false);
  });
});

describe("mySegment / orderedSegments", () => {
  it("finds my own panel and nobody else's", () => {
    const segs = [seg("m-alex", 0)];
    expect(mySegment(segs, round(), ALEX)?.id).toBe("s-m-alex");
    expect(mySegment(segs, round(), CASEY)).toBeNull();
    expect(mySegment(segs, round(), null)).toBeNull();
  });
  it("stacks the revealed panels by position", () => {
    const segs = [seg("m-riley", 2), seg("m-alex", 0), seg("m-casey", 1)];
    expect(orderedSegments(segs, "r1").map((s) => s.member_id)).toEqual(["m-alex", "m-casey", "m-riley"]);
  });
  it("breaks a position tie by created_at — two artists can claim the same slot", () => {
    const first = { ...seg("m-casey", 1), created_at: "2026-01-02T10:00:00Z" };
    const second = { ...seg("m-riley", 1), created_at: "2026-01-02T10:00:05Z" };
    expect(orderedSegments([second, first], "r1").map((s) => s.member_id)).toEqual(["m-casey", "m-riley"]);
  });
});

describe("computeConnectors", () => {
  const W = 200, H = 100;
  it("takes the lowest point of each stroke that reaches the seam band", () => {
    const strokes = [{ color: "#111827", points: [{ x: 20, y: 10 }, { x: 40, y: 95 }] }];
    expect(computeConnectors(strokes, W, H, 24)).toEqual([{ x: 0.2, color: "#111827" }]);
  });
  it("ignores strokes that never reach the band, and eraser strokes", () => {
    expect(computeConnectors([{ color: "#000", points: [{ x: 10, y: 10 }] }], W, H, 24)).toEqual([]);
    expect(computeConnectors([{ color: "#000", erase: true, points: [{ x: 10, y: 99 }] }], W, H, 24)).toEqual([]);
  });
  it("clamps x into 0..1 and caps how many marks leak", () => {
    const strokes = Array.from({ length: 20 }, () => ({ color: "#000", points: [{ x: 400, y: 99 }] }));
    const out = computeConnectors(strokes, W, H, 24, 14);
    expect(out).toHaveLength(14);
    expect(out.every((c) => c.x === 1)).toBe(true);
  });
  it("is empty without canvas dimensions", () => {
    expect(computeConnectors([{ color: "#000", points: [{ x: 1, y: 99 }] }], 0, H)).toEqual([]);
  });
});

describe("searchableFields", () => {
  it("matches on title, theme and host", () => {
    expect(searchableFields({ title: "Beast", theme: "Creature", created_by_name: "Alex" }))
      .toEqual(["Beast", "Creature", "Alex"]);
  });
});

// ── The concurrency question: two artists open the same round and both draw ──
describe("submitDecision — claiming a slot against freshly re-read state", () => {
  // Defaults describe an artist who started on an empty round. `at` builds the
  // pair a canvas records at its first stroke: the count, and which hand-off
  // was above at that moment.
  const at = (handoffs, roundId = "r1") => ({
    drawnAgainst: handoffs.length, drawnAgainstId: topHandoffId(handoffs, roundId),
  });
  const args = (over = {}) => ({
    round: round(), segments: [], handoffs: [], me: CASEY,
    drawnAgainst: 0, drawnAgainstId: null, ...over,
  });

  it("claims the next slot silently when nothing moved underneath", () => {
    const handoffs = [ho("m-alex", 0)];
    expect(submitDecision(args({ handoffs, ...at(handoffs) })))
      .toEqual({ action: "go", position: 1 });
  });

  it("asks before stacking under a panel that arrived mid-drawing", () => {
    // Casey set up their canvas when only Alex had drawn, so their top edge
    // continues Alex's marks — but Riley's panel is above them now.
    const started = [ho("m-alex", 0)];
    const handoffs = [ho("m-alex", 0), ho("m-riley", 1)];
    expect(submitDecision(args({ handoffs, ...at(started) }))).toEqual({
      action: "confirm", kind: "arrived", arrived: 1, drawn: 2, position: 2,
    });
  });

  it("counts every panel that landed while the artist was drawing", () => {
    const handoffs = [ho("m-alex", 0), ho("m-riley", 1), ho("m-host", 2)];
    expect(submitDecision(args({ handoffs, ...at([ho("m-alex", 0)]) })).arrived).toBe(2);
  });

  it("still claims the FRESH slot, never the stale one it drew against", () => {
    const handoffs = [ho("m-alex", 0), ho("m-riley", 1)];
    expect(submitDecision(args({ handoffs })).position).toBe(2);
  });

  it("blocks a second panel from the same artist", () => {
    const d = submitDecision(args({ segments: [seg("m-casey", 0)], handoffs: [ho("m-casey", 0)] }));
    expect(d).toEqual({ action: "blocked", reason: "already_drawn" });
  });

  it("blocks once the round was revealed or archived underneath", () => {
    expect(submitDecision(args({ round: round({ status: "revealed" }) })).reason).toBe("round_closed");
    expect(submitDecision(args({ round: round({ archived: 1 }) })).reason).toBe("round_closed");
  });

  it("measures arrivals by panel count, not by the slot number it claims", () => {
    // A departed member left a hole, so the next slot is 3 while only two
    // panels exist. Nothing arrived since Casey started drawing against two.
    const handoffs = [ho("m-alex", 0), ho("m-riley", 2)];
    expect(submitDecision(args({ handoffs, ...at(handoffs) })))
      .toEqual({ action: "go", position: 3 });
  });

  it("blocks when the member is unknown", () => {
    expect(submitDecision(args({ me: null })).reason).toBe("unknown_member");
  });

  it("prefers the blocking reasons over the confirmation", () => {
    // Both true at once: a panel arrived AND this artist has already drawn.
    const handoffs = [ho("m-casey", 0), ho("m-alex", 1)];
    expect(submitDecision(args({ segments: [seg("m-casey", 0)], handoffs, ...at([ho("m-casey", 0)]) })).action)
      .toBe("blocked");
  });
});

describe("submitDecision — a departure is not cancelled out by an arrival", () => {
  const at = (handoffs) => ({ drawnAgainst: handoffs.length, drawnAgainstId: topHandoffId(handoffs, "r1") });

  it("calls it an ARRIVAL when the panel above is still there, just no longer on top", () => {
    // Riley left from BELOW Casey while Alex landed on top. The count is
    // unchanged, but the panel Casey was continuing still exists — telling
    // them their neighbour left the roster would be flatly false.
    const started = [ho("m-host", 0), ho("m-riley", 1)];
    const now = [ho("m-riley", 1), ho("m-alex", 2)];
    const d = submitDecision({
      round: round(), segments: [], handoffs: now, me: CASEY, ...at(started),
    });
    expect(d).toMatchObject({ action: "confirm", kind: "arrived", arrived: 0 });
  });

  it("calls it an ARRIVAL when the round was empty when they started", () => {
    const now = [ho("m-alex", 0)];
    expect(submitDecision({
      round: round(), segments: [], handoffs: now, me: CASEY,
      drawnAgainst: 0, drawnAgainstId: null,
    })).toMatchObject({ action: "confirm", kind: "arrived", arrived: 1 });
  });

  it("asks when the panel above was removed, even though the count is unchanged", () => {
    // Casey started drawing to Riley's panel. Riley left the roster (their
    // hand-off is deleted) and Alex added one. Two panels before, two after —
    // the arithmetic sees nothing, but the edge above Casey is a new drawing.
    const started = [ho("m-host", 0), ho("m-riley", 1)];
    const now = [ho("m-host", 0), ho("m-alex", 1)]; // riley's row is GONE
    const d = submitDecision({
      round: round(), segments: [], handoffs: now, me: CASEY, ...at(started),
    });
    expect(d.action).toBe("confirm");
    expect(d.arrived).toBe(0);
    expect(d.kind).toBe("replaced");
  });

  it("asks when the panel above simply vanished", () => {
    const started = [ho("m-host", 0), ho("m-riley", 1)];
    const now = [ho("m-host", 0)];
    expect(submitDecision({ round: round(), segments: [], handoffs: now, me: CASEY, ...at(started) }))
      .toMatchObject({ action: "confirm", kind: "replaced", arrived: 0 });
  });

  it("stays silent when a departure and an arrival leave the SAME panel above", () => {
    // Riley's panel is still the top one; someone below them left. Nothing
    // about the edge Casey is continuing has changed.
    const started = [ho("m-host", 0), ho("m-riley", 1)];
    const now = [ho("m-riley", 1)];
    expect(submitDecision({ round: round(), segments: [], handoffs: now, me: CASEY, ...at(started) }))
      .toEqual({ action: "go", position: 2 });
  });
});

describe("topHandoff — one answer to \"what is above me\"", () => {
  it("picks the highest slot regardless of array order", () => {
    expect(topHandoffId([ho("m-casey", 1), ho("m-alex", 0)], "r1")).toBe("h-m-casey");
  });
  it("breaks a raced tie deterministically, whichever order the rows arrive", () => {
    const a = { ...ho("m-casey", 1), created_at: "2026-01-02T10:00:00Z" };
    const b = { ...ho("m-riley", 1), created_at: "2026-01-02T10:00:05Z" };
    expect(topHandoffId([a, b], "r1")).toBe(topHandoffId([b, a], "r1"));
    expect(topHandoffId([a, b], "r1")).toBe("h-m-riley");
  });
  it("is null on an empty round and ignores other rounds", () => {
    expect(topHandoffId([], "r1")).toBeNull();
    expect(topHandoffId([ho("m-alex", 9, "r2")], "r1")).toBeNull();
  });
});

// ── The second way a round can be finished ──────────────────────────────────

// ── The only way a round closes ─────────────────────────────────────────────
describe("roundProgress — a round is finished when everyone has drawn", () => {
  const roster = ["m-alex", "m-casey", "m-riley"];

  it("counts panels and reports not-complete while anyone is outstanding", () => {
    const handoffs = [ho("m-alex", 0), ho("m-casey", 1)];
    expect(roundProgress(round(), handoffs, roster)).toEqual({ drawn: 2, complete: false });
  });

  it("completes once the whole roster has drawn", () => {
    const handoffs = [ho("m-alex", 0), ho("m-casey", 1), ho("m-riley", 2)];
    expect(roundProgress(round(), handoffs, roster).complete).toBe(true);
  });

  // loadMembers() turns a failed family.members fetch into `members = []`, and
  // [].every() is vacuously true — which would call every round finished.
  it("is never complete against an unknown roster", () => {
    const handoffs = [ho("m-alex", 0)];
    expect(roundProgress(round(), handoffs, []).complete).toBe(false);
    expect(roundProgress(round(), [], []).complete).toBe(false);
  });

  it("reopens for a member who joins after everyone else has drawn", () => {
    const handoffs = [ho("m-alex", 0), ho("m-casey", 1), ho("m-riley", 2)];
    const withNewcomer = [...roster, "m-new"];
    expect(roundProgress(round(), handoffs, withNewcomer).complete).toBe(false);
    expect(canSubmit(round(), [], handoffs, { id: "m-new" }, withNewcomer)).toBe(true);
  });

  // A departing member's hand-off AND segment are deleted together, so the
  // round stays finished rather than reopening for people who have all drawn.
  it("stays complete after a member leaves", () => {
    const handoffs = [ho("m-alex", 0), ho("m-casey", 1)];
    expect(roundProgress(round(), handoffs, ["m-alex", "m-casey"]).complete).toBe(true);
  });

  /**
   * The badge decides nothing about fullness any more, and cannot disagree:
   * it is per-viewer and only surfaces a round to someone who has NOT drawn,
   * and that person not having drawn is exactly what keeps it incomplete.
   */
  it("is never complete for anyone the glance would badge", () => {
    for (const drawnBy of [[], ["m-alex"], ["m-alex", "m-casey"]]) {
      const handoffs = drawnBy.map((id, i) => ho(id, i));
      for (const viewer of roster) {
        const badged = !drawnBy.includes(viewer);   // what the glance's LEFT JOIN asks
        if (badged) expect(roundProgress(round(), handoffs, roster).complete).toBe(false);
      }
    }
  });

  it("never blocks a member who has not drawn", () => {
    const handoffs = [ho("m-alex", 0), ho("m-casey", 1)];
    expect(canSubmit(round(), [], handoffs, RILEY, roster)).toBe(true);
  });
});
