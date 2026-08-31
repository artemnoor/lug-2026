"""Promote team capacity and media fields to queryable columns."""

from alembic import op

revision = "0007_team_fields"
down_revision = "0006_achievement_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE lug_teams ADD COLUMN IF NOT EXISTS name text NOT NULL DEFAULT ''")
    op.execute("ALTER TABLE lug_teams ADD COLUMN IF NOT EXISTS member_limit integer NOT NULL DEFAULT 1")
    op.execute("ALTER TABLE lug_teams ADD COLUMN IF NOT EXISTS flag_url text NOT NULL DEFAULT ''")
    op.execute("ALTER TABLE lug_teams ADD COLUMN IF NOT EXISTS video_url text NOT NULL DEFAULT ''")
    op.execute("ALTER TABLE lug_teams ADD COLUMN IF NOT EXISTS video_status text NOT NULL DEFAULT ''")
    op.execute("ALTER TABLE lug_teams ADD COLUMN IF NOT EXISTS video_score numeric NOT NULL DEFAULT 0")
    op.execute("""
        UPDATE lug_teams
        SET name = COALESCE(NULLIF(name, ''), payload->>'name', ''),
            member_limit = CASE WHEN payload->>'totalStudentsInGroup' ~ '^[1-9][0-9]*$'
                                THEN (payload->>'totalStudentsInGroup')::integer
                                ELSE member_limit END,
            flag_url = COALESCE(NULLIF(flag_url, ''), payload->>'flagUrl', ''),
            video_url = COALESCE(NULLIF(video_url, ''), payload->'videoCard'->>'url', ''),
            video_status = COALESCE(NULLIF(video_status, ''), payload->'videoCard'->>'status', ''),
            video_score = CASE WHEN payload->'videoCard'->>'score' ~ '^[0-9]+(\\.[0-9]+)?$'
                               THEN (payload->'videoCard'->>'score')::numeric ELSE video_score END
        WHERE name = '' OR flag_url = '' OR video_url = '' OR video_status = '' OR member_limit = 1
    """)
    op.execute("CREATE INDEX IF NOT EXISTS lug_teams_video_status_idx ON lug_teams (video_status)")
    op.execute("""
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lug_teams_member_limit_check') THEN
            ALTER TABLE lug_teams ADD CONSTRAINT lug_teams_member_limit_check
              CHECK (member_limit > 0) NOT VALID;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lug_teams_video_status_check') THEN
            ALTER TABLE lug_teams ADD CONSTRAINT lug_teams_video_status_check
              CHECK (video_status IN ('', 'pending', 'approved', 'rejected')) NOT VALID;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lug_teams_video_score_check') THEN
            ALTER TABLE lug_teams ADD CONSTRAINT lug_teams_video_score_check
              CHECK (video_score >= 0 AND video_score <= 23) NOT VALID;
          END IF;
        END $$;
    """)


def downgrade() -> None:
    # Forward-only: canonical team fields are required by current queries.
    pass
