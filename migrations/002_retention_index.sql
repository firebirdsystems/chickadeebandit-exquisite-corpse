-- Retention keys on the round so a finished drawing retires whole. The
-- cascade to `segments` carries file_id, which is what actually matters here:
-- each segment is a hub file, and without the cascade reclaiming them the
-- drawings outlive every row that referenced them and stay billed.
CREATE INDEX IF NOT EXISTS app_exquisite_corpse__rounds_retention_idx
  ON app_exquisite_corpse__rounds (created_at);
