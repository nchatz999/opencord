-- Make sessions.expires_at non-nullable
-- All sessions should have an expiration time for security

-- First, update any existing NULL values to a reasonable default
UPDATE sessions
SET expires_at = created_at + INTERVAL '30 days'
WHERE expires_at IS NULL;

-- Then add the NOT NULL constraint
ALTER TABLE sessions ALTER COLUMN expires_at SET NOT NULL;
