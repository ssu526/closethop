ALTER TABLE clothing_items
    ADD COLUMN upload_hash VARCHAR(64);

CREATE UNIQUE INDEX uk_active_clothing_upload_hash
    ON clothing_items (user_id, upload_hash)
    WHERE removed_at IS NULL AND upload_hash IS NOT NULL;
