-- Exquisite Corpse — initial schema
--
-- rounds:   the collaborative canvas. owner_or_visibility (write_owner_only) so
--           everyone reads but only the host writes — the host is the only one
--           who can flip status to 'revealed'. turn_order is an immutable JSON
--           array of member ids set at creation; the current turn is derived
--           from how many segments have been submitted (never a mutable pointer).
-- segments: each artist's hidden panel. sealed_until keeps a segment visible only
--           to its own author until the parent round.status = 'revealed', at which
--           point every member sees all of them. max_per_member enforces one
--           panel per member per round; frozen_when locks panels once revealed.
--           NOTE: sealed_until has no turn gate (only inherit_visibility does), so
--           turn *order* is a client-side UX guard. That is safe: a panel is sealed
--           and one-per-member, so an out-of-turn submit leaks nothing and cannot
--           double-submit.
-- handoffs: the "edge peek" hand-off. Holds only low-information connector marks
--           (x positions + colors where the previous artist's strokes cross the
--           bottom edge) so the next artist can continue the lines. inherit_visibility
--           from rounds — these ticks are intentionally shared, never the drawing.

CREATE TABLE IF NOT EXISTS app_exquisite_corpse__rounds (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  theme           TEXT DEFAULT '',
  visibility      TEXT NOT NULL DEFAULT 'everyone',
  status          TEXT NOT NULL DEFAULT 'open',
  turn_order      TEXT NOT NULL DEFAULT '[]',
  panel_height    INTEGER NOT NULL DEFAULT 320 CHECK (panel_height > 0),
  created_by_id   TEXT NOT NULL,
  created_by_name TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  revealed_at     TEXT,
  archived        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS app_exquisite_corpse__segments (
  id          TEXT PRIMARY KEY,
  round_id    TEXT NOT NULL,
  member_id   TEXT NOT NULL,
  member_name TEXT NOT NULL,
  position    INTEGER NOT NULL DEFAULT 0,
  file_id     TEXT DEFAULT '',
  file_url    TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  FOREIGN KEY (round_id) REFERENCES app_exquisite_corpse__rounds(id) ON DELETE CASCADE,
  UNIQUE (round_id, member_id)
);

CREATE TABLE IF NOT EXISTS app_exquisite_corpse__handoffs (
  id          TEXT PRIMARY KEY,
  round_id    TEXT NOT NULL,
  member_id   TEXT NOT NULL,
  position    INTEGER NOT NULL DEFAULT 0,
  connectors  TEXT NOT NULL DEFAULT '[]',
  created_at  TEXT NOT NULL,
  FOREIGN KEY (round_id) REFERENCES app_exquisite_corpse__rounds(id) ON DELETE CASCADE,
  UNIQUE (round_id, member_id)
);

CREATE INDEX IF NOT EXISTS ec_rounds_active_idx
  ON app_exquisite_corpse__rounds(archived, created_at);

CREATE INDEX IF NOT EXISTS ec_segments_round_idx
  ON app_exquisite_corpse__segments(round_id, position);

CREATE INDEX IF NOT EXISTS ec_handoffs_round_idx
  ON app_exquisite_corpse__handoffs(round_id, position);
