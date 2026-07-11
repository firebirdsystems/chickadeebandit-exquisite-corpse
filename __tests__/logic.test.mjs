import { describe, it, expect } from "vitest";
import {
  parseOrder, orderedSegments, deriveTurn, mySegment, isParticipant,
  canSubmit, positionFor, canManageRound, canReveal, computeConnectors,
} from "../src/logic.js";

const ALEX = { id: "m-alex", name: "Alex", role: "adult" };
const CASEY = { id: "m-casey", name: "Casey", role: "child" };
const RILEY = { id: "m-riley", name: "Riley", role: "child" };
const OUTSIDER = { id: "m-out", name: "Sam", role: "adult" };

function round(overrides = {}) {
  return {
    id: "r1", status: "open", archived: 0,
    turn_order: JSON.stringify(["m-alex", "m-casey", "m-riley"]),
    created_by_id: "m-alex", panel_height: 300, ...overrides,
  };
}
function seg(member, position, roundId = "r1") {
  return { id: `s-${member}`, round_id: roundId, member_id: member, position, created_at: `2026-01-0${position + 1}` };
}

describe("parseOrder", () => {
  it("parses a JSON string array", () => {
    expect(parseOrder(round())).toEqual(["m-alex", "m-casey", "m-riley"]);
  });
  it("accepts an already-parsed array", () => {
    expect(parseOrder({ turn_order: ["a", "b"] })).toEqual(["a", "b"]);
  });
  it("is safe on garbage", () => {
    expect(parseOrder({ turn_order: "not json" })).toEqual([]);
    expect(parseOrder(null)).toEqual([]);
  });
});

describe("deriveTurn", () => {
  it("first artist is up with no panels in", () => {
    const t = deriveTurn(round(), []);
    expect(t).toMatchObject({ done: 0, total: 3, complete: false, currentIndex: 0, currentMemberId: "m-alex" });
  });
  it("advances as panels accumulate (derived, not a stored pointer)", () => {
    const t = deriveTurn(round(), [seg("m-alex", 0)]);
    expect(t.currentMemberId).toBe("m-casey");
    expect(t.currentIndex).toBe(1);
  });
  it("is complete when every slot is filled", () => {
    const t = deriveTurn(round(), [seg("m-alex", 0), seg("m-casey", 1), seg("m-riley", 2)]);
    expect(t).toMatchObject({ complete: true, currentIndex: -1, currentMemberId: null });
  });
  it("only counts segments for this round", () => {
    const t = deriveTurn(round(), [seg("m-alex", 0, "other")]);
    expect(t.done).toBe(0);
  });
});

describe("canSubmit — mirrors the sealed_until turn/one-per-member rules", () => {
  it("true only for the member whose turn it is", () => {
    expect(canSubmit(round(), [], ALEX)).toBe(true);
    expect(canSubmit(round(), [], CASEY)).toBe(false); // not their turn yet
  });
  it("false once the member has already drawn (max_per_member)", () => {
    const segs = [seg("m-alex", 0)];
    expect(canSubmit(round(), segs, ALEX)).toBe(false);
    expect(canSubmit(round(), segs, CASEY)).toBe(true);
  });
  it("false on revealed or archived rounds", () => {
    expect(canSubmit(round({ status: "revealed" }), [], ALEX)).toBe(false);
    expect(canSubmit(round({ archived: 1 }), [], ALEX)).toBe(false);
  });
  it("false for a non-member / missing caller", () => {
    expect(canSubmit(round(), [], OUTSIDER)).toBe(false);
    expect(canSubmit(round(), [], null)).toBe(false);
  });
});

describe("positionFor", () => {
  it("is the member's fixed slot in the immutable turn order", () => {
    expect(positionFor(round(), CASEY)).toBe(1);
    expect(positionFor(round(), RILEY)).toBe(2);
  });
  it("is -1 for a non-participant", () => {
    expect(positionFor(round(), OUTSIDER)).toBe(-1);
  });
});

describe("host controls mirror owner_or_visibility write_owner_only", () => {
  it("only the creator manages the round — no adult bypass", () => {
    expect(canManageRound(round(), ALEX)).toBe(true);
    expect(canManageRound(round(), OUTSIDER)).toBe(false); // another adult
    expect(canManageRound(round(), CASEY)).toBe(false);
  });
  it("host can reveal an open round with at least one panel", () => {
    expect(canReveal(round(), [], ALEX)).toBe(false); // nothing drawn yet
    expect(canReveal(round(), [seg("m-alex", 0)], ALEX)).toBe(true);
    expect(canReveal(round({ status: "revealed" }), [seg("m-alex", 0)], ALEX)).toBe(false);
  });
  it("a non-host can never reveal", () => {
    expect(canReveal(round(), [seg("m-alex", 0)], CASEY)).toBe(false);
  });
});

describe("orderedSegments / mySegment / isParticipant", () => {
  it("orders by position then created_at", () => {
    const segs = [seg("m-riley", 2), seg("m-alex", 0), seg("m-casey", 1)];
    expect(orderedSegments(segs, "r1").map((s) => s.member_id)).toEqual(["m-alex", "m-casey", "m-riley"]);
  });
  it("finds my own segment", () => {
    expect(mySegment([seg("m-alex", 0)], round(), ALEX)?.member_id).toBe("m-alex");
    expect(mySegment([seg("m-alex", 0)], round(), CASEY)).toBeNull();
  });
  it("knows who is on the roster", () => {
    expect(isParticipant(round(), CASEY)).toBe(true);
    expect(isParticipant(round(), OUTSIDER)).toBe(false);
  });
});

describe("computeConnectors — low-info hand-off only", () => {
  const W = 200, H = 300;
  it("captures normalized x + color of strokes crossing the bottom band", () => {
    const strokes = [{ color: "#dc2626", points: [{ x: 50, y: 10 }, { x: 60, y: 290 }] }];
    const c = computeConnectors(strokes, W, H, 26);
    expect(c).toHaveLength(1);
    expect(c[0].color).toBe("#dc2626");
    expect(c[0].x).toBeCloseTo(0.3, 5); // 60/200
  });
  it("ignores strokes that never reach the bottom band", () => {
    const strokes = [{ color: "#000", points: [{ x: 20, y: 5 }, { x: 30, y: 40 }] }];
    expect(computeConnectors(strokes, W, H, 26)).toHaveLength(0);
  });
  it("ignores eraser strokes and empty stroke lists", () => {
    expect(computeConnectors([{ erase: true, color: "#fff", points: [{ x: 10, y: 299 }] }], W, H)).toHaveLength(0);
    expect(computeConnectors([], W, H)).toHaveLength(0);
  });
  it("caps the number of connectors", () => {
    const strokes = Array.from({ length: 40 }, (_, i) => ({ color: "#000", points: [{ x: i, y: 295 }] }));
    expect(computeConnectors(strokes, W, H, 26, 14).length).toBeLessThanOrEqual(14);
  });
  it("clamps x into 0..1", () => {
    const strokes = [{ color: "#000", points: [{ x: 500, y: 295 }] }];
    expect(computeConnectors(strokes, W, H)[0].x).toBe(1);
  });
});
