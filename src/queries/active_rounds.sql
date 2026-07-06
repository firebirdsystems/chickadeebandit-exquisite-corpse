SELECT
  id,
  title,
  theme,
  status,
  panel_height,
  created_by_name,
  created_at,
  revealed_at
FROM app_exquisite_corpse__rounds
WHERE archived = 0
ORDER BY created_at DESC
LIMIT 100
