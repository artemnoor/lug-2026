"""PostgreSQL DDL and additive integrity migrations."""

SCHEMA = """
CREATE TABLE IF NOT EXISTS lug_meta (id text PRIMARY KEY CHECK (id = 'primary'), revision bigint NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS lug_settings (id smallint PRIMARY KEY CHECK (id = 1), payload jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS lug_users (id text PRIMARY KEY, email text NOT NULL DEFAULT '', phone text NOT NULL DEFAULT '', role text NOT NULL DEFAULT '', team_id text, email_verified boolean NOT NULL DEFAULT false, payload jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS lug_users_email_idx ON lug_users (lower(email)) WHERE email <> '';
CREATE INDEX IF NOT EXISTS lug_users_team_idx ON lug_users (team_id);
CREATE INDEX IF NOT EXISTS lug_users_role_idx ON lug_users (role);
CREATE TABLE IF NOT EXISTS lug_teams (id text PRIMARY KEY, group_name text NOT NULL DEFAULT '', invite_code text NOT NULL DEFAULT '', captain_id text, invite_status text NOT NULL DEFAULT 'active', payload jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS lug_teams_group_idx ON lug_teams (group_name) WHERE group_name <> '';
CREATE INDEX IF NOT EXISTS lug_teams_invite_idx ON lug_teams (invite_code);
CREATE TABLE IF NOT EXISTS lug_achievements (id text PRIMARY KEY, user_id text NOT NULL DEFAULT '', status text NOT NULL DEFAULT '', payload jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS lug_achievements_user_idx ON lug_achievements (user_id);
CREATE INDEX IF NOT EXISTS lug_achievements_status_idx ON lug_achievements (status);
CREATE TABLE IF NOT EXISTS lug_notifications (id text PRIMARY KEY, target_type text NOT NULL DEFAULT '', target_id text, kind text NOT NULL DEFAULT '', payload jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS lug_notifications_target_idx ON lug_notifications (target_type, target_id);
CREATE TABLE IF NOT EXISTS lug_sessions (id text PRIMARY KEY, token_hash text NOT NULL, user_id text NOT NULL DEFAULT '', expires_at_ms bigint NOT NULL DEFAULT 0, payload jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS lug_sessions_token_idx ON lug_sessions (token_hash);
CREATE INDEX IF NOT EXISTS lug_sessions_user_idx ON lug_sessions (user_id);
CREATE INDEX IF NOT EXISTS lug_sessions_expiry_idx ON lug_sessions (expires_at_ms);
CREATE TABLE IF NOT EXISTS lug_uploads (url text PRIMARY KEY, user_id text NOT NULL DEFAULT '', kind text NOT NULL DEFAULT '', payload jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS lug_uploads_user_idx ON lug_uploads (user_id);
CREATE TABLE IF NOT EXISTS lug_email_verifications (id text PRIMARY KEY, email text NOT NULL DEFAULT '', expires_at_ms bigint NOT NULL DEFAULT 0, payload jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS lug_email_verifications_email_idx ON lug_email_verifications (lower(email));
CREATE INDEX IF NOT EXISTS lug_email_verifications_expiry_idx ON lug_email_verifications (expires_at_ms);
CREATE TABLE IF NOT EXISTS lug_audit_log (id text PRIMARY KEY, actor_id text NOT NULL DEFAULT '', action text NOT NULL DEFAULT '', entity_type text NOT NULL DEFAULT '', entity_id text NOT NULL DEFAULT '', at timestamptz NOT NULL DEFAULT now(), payload jsonb NOT NULL);
CREATE INDEX IF NOT EXISTS lug_audit_log_at_idx ON lug_audit_log (at DESC);
CREATE INDEX IF NOT EXISTS lug_audit_log_entity_idx ON lug_audit_log (entity_type, entity_id);
CREATE TABLE IF NOT EXISTS lug_email_outbox (id uuid PRIMARY KEY, recipient text NOT NULL, purpose text NOT NULL CHECK (purpose IN ('verification', 'password-reset', 'notification')), payload jsonb NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed')), attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0), available_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz, last_error text, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS lug_email_outbox_pending_idx ON lug_email_outbox (available_at, created_at) WHERE status IN ('pending', 'failed');
"""

INTEGRITY_SCHEMA = """
ALTER TABLE lug_users ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false;
ALTER TABLE lug_teams ADD COLUMN IF NOT EXISTS invite_status text NOT NULL DEFAULT 'active';
UPDATE lug_users
SET email_verified = lower(COALESCE(payload->>'emailVerified', 'false')) = 'true';
UPDATE lug_teams
SET invite_status = COALESCE(NULLIF(payload->>'inviteStatus', ''), 'active');
DELETE FROM lug_email_verifications older
USING lug_email_verifications newer
WHERE lower(older.email) = lower(newer.email) AND older.email <> '' AND newer.email <> ''
  AND (older.updated_at, older.id) < (newer.updated_at, newer.id);
CREATE UNIQUE INDEX IF NOT EXISTS lug_email_verifications_email_unique_idx ON lug_email_verifications (lower(email)) WHERE email <> '';
UPDATE lug_users SET team_id = NULL WHERE team_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM lug_teams WHERE lug_teams.id = lug_users.team_id);
DELETE FROM lug_achievements WHERE user_id = '' OR NOT EXISTS (SELECT 1 FROM lug_users WHERE lug_users.id = lug_achievements.user_id);
DELETE FROM lug_sessions WHERE user_id = '' OR NOT EXISTS (SELECT 1 FROM lug_users WHERE lug_users.id = lug_sessions.user_id);
DELETE FROM lug_uploads WHERE user_id = '' OR NOT EXISTS (SELECT 1 FROM lug_users WHERE lug_users.id = lug_uploads.user_id);
UPDATE lug_teams SET captain_id = NULL WHERE captain_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM lug_users WHERE lug_users.id = lug_teams.captain_id);
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lug_users_team_fk') THEN ALTER TABLE lug_users ADD CONSTRAINT lug_users_team_fk FOREIGN KEY (team_id) REFERENCES lug_teams(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lug_teams_captain_fk') THEN ALTER TABLE lug_teams ADD CONSTRAINT lug_teams_captain_fk FOREIGN KEY (captain_id) REFERENCES lug_users(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lug_achievements_user_fk') THEN ALTER TABLE lug_achievements ADD CONSTRAINT lug_achievements_user_fk FOREIGN KEY (user_id) REFERENCES lug_users(id) ON DELETE CASCADE; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lug_sessions_user_fk') THEN ALTER TABLE lug_sessions ADD CONSTRAINT lug_sessions_user_fk FOREIGN KEY (user_id) REFERENCES lug_users(id) ON DELETE CASCADE; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lug_uploads_user_fk') THEN ALTER TABLE lug_uploads ADD CONSTRAINT lug_uploads_user_fk FOREIGN KEY (user_id) REFERENCES lug_users(id) ON DELETE CASCADE; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lug_users_role_check') THEN ALTER TABLE lug_users ADD CONSTRAINT lug_users_role_check CHECK (role IN ('', 'admin', 'captain', 'participant')) NOT VALID; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lug_teams_invite_status_check') THEN ALTER TABLE lug_teams ADD CONSTRAINT lug_teams_invite_status_check CHECK (invite_status IN ('active', 'closed', 'expired', '')) NOT VALID; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lug_achievements_status_check') THEN ALTER TABLE lug_achievements ADD CONSTRAINT lug_achievements_status_check CHECK (status IN ('', 'pending', 'approved', 'rejected')) NOT VALID; END IF;
END $$;
"""

OUTBOX_INTEGRITY_SCHEMA = """
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'lug_email_outbox_payload_encrypted'
    ) THEN
        ALTER TABLE lug_email_outbox ADD CONSTRAINT lug_email_outbox_payload_encrypted
        CHECK (
            payload->>'version' = '1'
            AND (
                payload->>'algorithm' = 'AES-256-GCM'
                OR payload->>'redacted' = 'true'
            )
        ) NOT VALID;
    END IF;
END $$;
ALTER TABLE lug_email_outbox
    VALIDATE CONSTRAINT lug_email_outbox_payload_encrypted;
"""
