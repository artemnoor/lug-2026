"""Move team workflow flags and review statuses out of the JSON payload."""

from alembic import op

revision = "0010_team_workflow"
down_revision = "0009_notification_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE lug_teams ADD COLUMN IF NOT EXISTS quota_confirmed boolean NOT NULL DEFAULT false")
    for field in ("name", "group", "flag", "description"):
        op.execute(f"ALTER TABLE lug_teams ADD COLUMN IF NOT EXISTS review_{field}_status text NOT NULL DEFAULT ''")
    op.execute("""
        UPDATE lug_teams
        SET quota_confirmed = COALESCE((payload->>'isQuotaConfirmed')::boolean, false),
            review_name_status = COALESCE(payload->'review'->'name'->>'status', ''),
            review_group_status = COALESCE(payload->'review'->'group'->>'status', ''),
            review_flag_status = COALESCE(payload->'review'->'flag'->>'status', ''),
            review_description_status = COALESCE(payload->'review'->'description'->>'status', '')
    """)
    for field in ("name", "group", "flag", "description"):
        op.execute(f"""
            ALTER TABLE lug_teams ADD CONSTRAINT lug_teams_review_{field}_status_check
            CHECK (review_{field}_status IN ('', 'pending', 'approved', 'rejected')) NOT VALID
        """)
    op.execute("CREATE INDEX IF NOT EXISTS lug_teams_workflow_idx ON lug_teams (quota_confirmed, invite_status, video_status)")


def downgrade() -> None:
    # Forward-only migration: JSON payload remains available during compatibility window.
    pass
