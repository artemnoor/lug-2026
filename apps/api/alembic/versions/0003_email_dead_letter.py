"""Allow permanently failed email deliveries to leave the retry queue."""

from alembic import op

revision = "0003_dead_letter"
down_revision = "0002_lifecycle"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE lug_email_outbox DROP CONSTRAINT IF EXISTS lug_email_outbox_status_check")
    op.execute("ALTER TABLE lug_email_outbox ADD CONSTRAINT lug_email_outbox_status_check CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'dead'))")


def downgrade() -> None:
    # Dead-lettered rows are retained for audit and are not automatically rewritten.
    pass
