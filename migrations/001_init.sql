-- Exquisite Corpse — initial schema
--
-- rounds:   the collaborative canvas. owner_or_visibility (write_owner_only) so
--           everyone reads but only the host writes — the host is the only one
--           who can flip status to 'revealed'. Adults get no bypass, by design:
--           dropping write_owner_only would let any adult reveal a drawing they
--           had no part in, releasing every artist's sealed panel. The cost is
--           that a host who LEAVES the household leaves a round nobody can ever
--           reveal — member_references empties created_by_id, the app then names
--           that state and stops inviting panels into it, and retention retires
--           the row on the normal schedule.
--
--           turn_order is DEAD. It held a fixed A-then-B-then-C order and the
--           app derived "whose turn is it" from how many segments had been
--           submitted — which is the bug this app was built with. A member's
--           SELECT on `segments` returns only their OWN row while the round is
--           open (sealed_until), so that count read 0-or-1 for everyone and the
--           Glance and the app disagreed about whose turn it was. There is no
--           turn any more: anyone who hasn't drawn may draw, and round state is
--           read from `handoffs`, which every participant can see. The column
--           survives only because the hub does not permit removing a column;
--           nothing writes or reads it, and its DEFAULT '[]' keeps the
--           omitting INSERT legal.
-- segments: each artist's hidden panel. sealed_until keeps a segment visible only
--           to its own author until the parent round.status = 'revealed', at which
--           point every member sees all of them. max_per_member enforces one
--           panel per member per round; frozen_when locks panels once revealed.
--           NOTE: sealed_until has no server-side ordering gate, and needs none:
--           a panel is sealed and one-per-member, so a submit issued straight at
--           the DB leaks nothing and cannot double-submit.
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
