"""Promote achievement fields used for filtering and scoring to columns."""

from alembic import op

revision = "0006_achievement_fields"
down_revision = "0005_upload_metadata"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE lug_achievements ADD COLUMN IF NOT EXISTS direction text NOT NULL DEFAULT ''")
    op.execute("ALTER TABLE lug_achievements ADD COLUMN IF NOT EXISTS points numeric NOT NULL DEFAULT 0")
    op.execute("ALTER TABLE lug_achievements ADD COLUMN IF NOT EXISTS file_url text NOT NULL DEFAULT ''")
    op.execute("""
        UPDATE lug_achievements
        SET direction = COALESCE(NULLIF(direction, ''), payload->>'direction', ''),
            file_url = COALESCE(NULLIF(file_url, ''), payload->>'fileUrl', ''),
            points = CASE WHEN payload->>'points' ~ '^-?[0-9]+(\\.[0-9]+)?$'
                          THEN (payload->>'points')::numeric ELSE points END
        WHERE direction = '' OR file_url = '' OR points = 0
    """)
    op.execute("CREATE INDEX IF NOT EXISTS lug_achievements_direction_idx ON lug_achievements (direction)")
    op.execute("CREATE INDEX IF NOT EXISTS lug_achievements_file_url_idx ON lug_achievements (file_url)")
    op.execute("""
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lug_achievements_points_check') THEN
            ALTER TABLE lug_achievements ADD CONSTRAINT lug_achievements_points_check
              CHECK (points >= 0 AND points <= 100) NOT VALID;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lug_achievements_direction_check') THEN
            ALTER TABLE lug_achievements ADD CONSTRAINT lug_achievements_direction_check
              CHECK (direction IN ('', 'science', 'public', 'sport', 'culture')) NOT VALID;
          END IF;
        END $$;
    """)


def downgrade() -> None:
    # Forward-only: canonical columns are required by current repositories.
    pass
