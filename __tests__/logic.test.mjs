import { describe, it, expect } from "vitest";
import {
  panelCount, nextPosition, panelTarget, roundProgress, artistIds,
  orderedSegments, mySegment, canSubmit, canManageRound, canReveal,
  lastConnectors, computeConnectors, searchableFields,
} from "../src/logic.js";

const ALEX = { id: "m-alex", name: "Alex", role: "adult" };
const CASEY = { id: "m-casey", name: "Casey", role: "child" };
const RILEY = { id: "m-riley", name: "Riley", role: "child" };

function round(overrides = {}) {
  return {
    id: "r1", status: "open", archived: 0, panel_target: 0,
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
  });

  it("is 0 on a fresh round", () => {
    expect(nextPosition([], "r1")).toBe(0);
  });
});

describe("panelTarget", () => {
  it("reads a positive integer target", () => expect(panelTarget(round({ panel_target: 4 }))).toBe(4));
  it("treats 0, absent, negative and junk as open-ended", () => {
    expect(panelTarget(round({ panel_target: 0 }))).toBe(0);
    expect(panelTarget({})).toBe(0);
    expect(panelTarget(round({ panel_target: -3 }))).toBe(0);
    expect(panelTarget(round({ panel_target: "abc" }))).toBe(0);
  });
  it("survives the string a DB read hands back", () => {
    expect(panelTarget(round({ panel_target: "5" }))).toBe(5);
  });
});

describe("roundProgress", () => {
  it("is never complete without a target — the host decides when it's done", () => {
    const p = roundProgress(round({ panel_target: 0 }), [ho("m-alex", 0), ho("m-casey", 1)]);
    expect(p).toEqual({ drawn: 2, target: 0, complete: false });
  });
  it("completes once the target is met", () => {
    expect(roundProgress(round({ panel_target: 2 }), [ho("m-alex", 0)]).complete).toBe(false);
    expect(roundProgress(round({ panel_target: 2 }), [ho("m-alex", 0), ho("m-casey", 1)]).complete).toBe(true);
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

  it("refuses once the host's target is met", () => {
    const handoffs = [ho("m-alex", 0), ho("m-casey", 1)];
    expect(canSubmit(round({ panel_target: 2 }), [], handoffs, RILEY)).toBe(false);
    expect(canSubmit(round({ panel_target: 3 }), [], handoffs, RILEY)).toBe(true);
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
