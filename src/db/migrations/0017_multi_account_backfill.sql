-- 0017 — one primary account per creator and platform among active accounts (connected first, then oldest).
UPDATE creator_social_accounts a
SET is_primary = true
FROM (
  SELECT DISTINCT ON (creator_id, platform) id
  FROM creator_social_accounts
  WHERE connection_status <> 'disconnected'
  ORDER BY creator_id, platform, (connection_status = 'connected') DESC, connected_at NULLS LAST, created_at, id
) p
WHERE a.id = p.id;
