"""PostgreSQL schema for one-time password recovery challenges."""

PASSWORD_RESET_SCHEMA = """
CREATE TABLE IF NOT EXISTS lug_password_resets (
    id text PRIMARY KEY,
    email text NOT NULL DEFAULT '',
    expires_at_ms bigint NOT NULL DEFAULT 0,
    payload jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lug_password_resets_email_idx
    ON lug_password_resets (lower(email));
CREATE INDEX IF NOT EXISTS lug_password_resets_expiry_idx
    ON lug_password_resets (expires_at_ms);
DELETE FROM lug_password_resets older
USING lug_password_resets newer
WHERE lower(older.email) = lower(newer.email) AND older.email <> '' AND newer.email <> ''
  AND (older.updated_at, older.id) < (newer.updated_at, newer.id);
CREATE UNIQUE INDEX IF NOT EXISTS lug_password_resets_email_unique_idx
    ON lug_password_resets (lower(email)) WHERE email <> '';
"""
