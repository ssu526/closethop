DROP INDEX IF EXISTS uk_active_clothing_upload_hash;

ALTER TABLE clothing_items
    DROP COLUMN IF EXISTS processing_version,
    DROP COLUMN IF EXISTS upload_hash;
