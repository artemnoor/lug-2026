"""Add entity versions and explicit upload lifecycle fields."""

from alembic import op

revision = "0002_lifecycle"
down_revision = "0001_normalized_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")
    for table in ("lug_users", "lug_teams", "lug_achievements", "lug_notifications"):
        op.execute(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS entity_version bigint NOT NULL DEFAULT 1")
    op.execute("ALTER TABLE lug_uploads ADD COLUMN IF NOT EXISTS upload_id uuid DEFAULT gen_random_uuid()")
    op.execute("ALTER TABLE lug_uploads ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'uploaded'")
    op.execute("ALTER TABLE lug_uploads ADD COLUMN IF NOT EXISTS scan_status text NOT NULL DEFAULT 'clean'")
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS lug_uploads_upload_id_idx ON lug_uploads (upload_id)")
    op.execute("CREATE INDEX IF NOT EXISTS lug_uploads_status_idx ON lug_uploads (status, scan_status)")
    op.execute("""DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lug_uploads_status_check') THEN
            ALTER TABLE lug_uploads ADD CONSTRAINT lug_uploads_status_check
            CHECK (status IN ('uploading', 'uploaded', 'scanning', 'clean', 'rejected', 'deleted')) NOT VALID;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lug_uploads_scan_status_check') THEN
            ALTER TABLE lug_uploads ADD CONSTRAINT lug_uploads_scan_status_check
            CHECK (scan_status IN ('pending', 'clean', 'rejected', 'error')) NOT VALID;
        END IF;
    END $$;""")


def downgrade() -> None:
    # Forward-fix is preferred for production data migrations.
    pass
