"""Promote the achievement title to a searchable PostgreSQL column."""

from alembic import op

revision = "0011_achievement_title"
down_revision = "0010_team_workflow"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE lug_achievements ADD COLUMN IF NOT EXISTS title text NOT NULL DEFAULT ''")
    op.execute("UPDATE lug_achievements SET title = COALESCE(payload->>'title', '')")
    op.execute("CREATE INDEX IF NOT EXISTS lug_achievements_title_idx ON lug_achievements (title)")


def downgrade() -> None:
    # Forward-only migration; payload remains the compatibility source during rollout.
    pass
