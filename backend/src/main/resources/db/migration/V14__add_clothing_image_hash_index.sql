CREATE INDEX idx_clothing_active_image_hash
    ON clothing_items (image_hash)
    WHERE removed_at IS NULL AND image_hash IS NOT NULL;
