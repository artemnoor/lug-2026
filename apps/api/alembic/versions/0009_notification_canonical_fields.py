"""Promote notification presentation fields to queryable columns."""

from alembic import op

revision = "0009_notification_fields"
down_revision = "0008_user_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE lug_notifications ADD COLUMN IF NOT EXISTS title text NOT NULL DEFAULT ''")
    op.execute("ALTER TABLE lug_notifications ADD COLUMN IF NOT EXISTS message text NOT NULL DEFAULT ''")
    op.execute("ALTER TABLE lug_notifications ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now()")
    op.execute("""
        UPDATE lug_notifications
        SET title = COALESCE(NULLIF(title, ''), payload->>'title', ''),
            message = COALESCE(NULLIF(message, ''), payload->>'message', '')
        WHERE title = '' OR message = ''
    """)
    op.execute("CREATE INDEX IF NOT EXISTS lug_notifications_created_at_idx ON lug_notifications (created_at DESC)")


def downgrade() -> None:
    # Forward-only: notification projections depend on these columns.
    pass
