"""Link achievements to upload UUIDs instead of using URLs as identity."""

from alembic import op

revision = "0012_achievement_upload_fk"
down_revision = "0011_achievement_title"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE lug_achievements ADD COLUMN IF NOT EXISTS file_upload_id uuid")
    op.execute("""
        UPDATE lug_achievements a
        SET file_upload_id = u.upload_id
        FROM lug_uploads u
        WHERE a.file_upload_id IS NULL
          AND a.file_url <> ''
          AND u.url = a.file_url
    """)
    op.execute("""
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lug_achievements_upload_fk') THEN
            ALTER TABLE lug_achievements
              ADD CONSTRAINT lug_achievements_upload_fk
              FOREIGN KEY (file_upload_id) REFERENCES lug_uploads(upload_id)
              ON DELETE SET NULL NOT VALID;
          END IF;
        END $$;
    """)
    op.execute("CREATE INDEX IF NOT EXISTS lug_achievements_file_upload_idx ON lug_achievements (file_upload_id)")


def downgrade() -> None:
    # Forward-only: removing the relation would discard normalized ownership data.
    pass
