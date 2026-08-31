"""Promote user identity and profile fields to queryable columns."""

from alembic import op

revision = "0008_user_fields"
down_revision = "0007_team_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE lug_users ADD COLUMN IF NOT EXISTS fio text NOT NULL DEFAULT ''")
    op.execute("ALTER TABLE lug_users ADD COLUMN IF NOT EXISTS identity_status text NOT NULL DEFAULT ''")
    op.execute("ALTER TABLE lug_users ADD COLUMN IF NOT EXISTS avatar_url text NOT NULL DEFAULT ''")
    op.execute("ALTER TABLE lug_users ADD COLUMN IF NOT EXISTS student_card_file text NOT NULL DEFAULT ''")
    op.execute("""
        UPDATE lug_users
        SET fio = COALESCE(NULLIF(fio, ''), payload->>'fio', ''),
            identity_status = COALESCE(NULLIF(identity_status, ''), payload->>'identityStatus', ''),
            avatar_url = COALESCE(NULLIF(avatar_url, ''), payload->>'avatarUrl', ''),
            student_card_file = COALESCE(NULLIF(student_card_file, ''), payload->>'studentCardFile', '')
        WHERE fio = '' OR identity_status = '' OR avatar_url = '' OR student_card_file = ''
    """)
    op.execute("CREATE INDEX IF NOT EXISTS lug_users_identity_status_idx ON lug_users (identity_status)")
    op.execute("""
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lug_users_identity_status_check') THEN
            ALTER TABLE lug_users ADD CONSTRAINT lug_users_identity_status_check
              CHECK (identity_status IN ('', 'pending', 'approved', 'rejected')) NOT VALID;
          END IF;
        END $$;
    """)


def downgrade() -> None:
    # Forward-only: canonical profile fields are required by current queries.
    pass
