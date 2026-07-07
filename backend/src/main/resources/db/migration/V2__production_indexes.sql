ALTER TABLE processing_jobs ADD COLUMN IF NOT EXISTS claimed_until TIMESTAMP;
ALTER TABLE clothing_items ADD COLUMN IF NOT EXISTS removed_at TIMESTAMP;
ALTER TABLE outfits ADD COLUMN IF NOT EXISTS suggested_by_user_id UUID REFERENCES users(id);

DELETE FROM processing_jobs duplicate
USING processing_jobs retained
WHERE duplicate.item_id = retained.item_id
  AND duplicate.version = retained.version
  AND (duplicate.created_at, duplicate.id) > (retained.created_at, retained.id);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uk_processing_item_version'
    ) THEN
        ALTER TABLE processing_jobs
            ADD CONSTRAINT uk_processing_item_version UNIQUE (item_id, version);
    END IF;
END $$;

CREATE INDEX idx_clothing_user_category_active
    ON clothing_items (user_id, category, removed_at, created_at DESC);
CREATE INDEX idx_clothing_user_status_active
    ON clothing_items (user_id, processing_status, removed_at);
CREATE INDEX idx_clothing_tags_item ON clothing_tags (clothing_item_id);
CREATE INDEX idx_clothing_tags_lower ON clothing_tags (LOWER(tag));
CREATE INDEX idx_outfits_user_created ON outfits (user_id, created_at DESC);
CREATE INDEX idx_outfits_suggested_by ON outfits (suggested_by_user_id);
CREATE INDEX idx_processing_status_created ON processing_jobs (status, created_at);
CREATE INDEX idx_processing_claimed_until ON processing_jobs (claimed_until);
