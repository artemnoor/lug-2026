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
"""
