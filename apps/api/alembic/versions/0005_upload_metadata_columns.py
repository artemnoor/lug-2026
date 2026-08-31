"""Store upload infrastructure metadata in queryable PostgreSQL columns."""

from alembic import op

revision = "0005_upload_metadata"
down_revision = "0004_domain"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE lug_uploads ADD COLUMN IF NOT EXISTS storage_key text NOT NULL DEFAULT ''")
    op.execute("ALTER TABLE lug_uploads ADD COLUMN IF NOT EXISTS mime_type text NOT NULL DEFAULT ''")
    op.execute("ALTER TABLE lug_uploads ADD COLUMN IF NOT EXISTS size_bytes bigint NOT NULL DEFAULT 0")
    op.execute("ALTER TABLE lug_uploads ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now()")
    op.execute("""
        UPDATE lug_uploads
        SET storage_key = COALESCE(NULLIF(storage_key, ''), payload->>'storageKey', ''),
            mime_type = COALESCE(NULLIF(mime_type, ''), payload->>'type', ''),
            size_bytes = GREATEST(
                size_bytes,
                CASE WHEN payload->>'size' ~ '^[0-9]+$'
                     THEN (payload->>'size')::bigint ELSE 0 END
            )
        WHERE storage_key = '' OR mime_type = '' OR size_bytes = 0
    """)
    op.execute("CREATE INDEX IF NOT EXISTS lug_uploads_storage_key_idx ON lug_uploads (storage_key)")
    op.execute("ALTER TABLE lug_uploads ADD CONSTRAINT lug_uploads_size_nonnegative CHECK (size_bytes >= 0) NOT VALID")


def downgrade() -> None:
    # Forward-only: removing canonical metadata would reintroduce payload-only state.
    pass
