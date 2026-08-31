"""Strengthen domain values and make upload UUID the stable identity."""

from alembic import op

revision = "0004_domain"
down_revision = "0003_dead_letter"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lug_users_role_check') THEN
        ALTER TABLE lug_users ADD CONSTRAINT lug_users_role_check
          CHECK (role IN ('admin', 'captain', 'participant')) NOT VALID;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lug_achievements_status_check') THEN
        ALTER TABLE lug_achievements ADD CONSTRAINT lug_achievements_status_check
          CHECK (status IN ('pending', 'revision_required', 'approved', 'rejected')) NOT VALID;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lug_teams_invite_status_check') THEN
        ALTER TABLE lug_teams ADD CONSTRAINT lug_teams_invite_status_check
          CHECK (invite_status IN ('active', 'revoked', 'expired')) NOT VALID;
      END IF;
    END $$;
    """)
    # Existing integrations still address an upload by URL, so retain a unique
    # URL index while making the generated UUID the primary identity.
    op.execute("""
    DO $$ DECLARE pk text; BEGIN
      SELECT constraint_name INTO pk
      FROM information_schema.table_constraints
      WHERE table_name = 'lug_uploads' AND constraint_type = 'PRIMARY KEY';
      IF pk IS NOT NULL AND pk <> 'lug_uploads_upload_id_pk' THEN
        EXECUTE format('ALTER TABLE lug_uploads DROP CONSTRAINT %I', pk);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lug_uploads_upload_id_pk') THEN
        ALTER TABLE lug_uploads ALTER COLUMN upload_id SET NOT NULL;
        ALTER TABLE lug_uploads ADD CONSTRAINT lug_uploads_upload_id_pk PRIMARY KEY (upload_id);
      END IF;
    END $$;
    """)
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS lug_uploads_url_unique_idx ON lug_uploads (url)")


def downgrade() -> None:
    # Forward-only: production data must not be made less constrained implicitly.
    pass
