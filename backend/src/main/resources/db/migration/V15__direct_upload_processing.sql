ALTER TABLE clothing_items
    ADD COLUMN IF NOT EXISTS original_s3_key VARCHAR(1024),
    ADD COLUMN IF NOT EXISTS processed_s3_key VARCHAR(1024),
    ADD COLUMN IF NOT EXISTS upload_url_expires_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS uploaded_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS processed_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS original_deleted_at TIMESTAMP;

UPDATE clothing_items
SET processed_s3_key = s3_object_key
WHERE processed_s3_key IS NULL
  AND s3_object_key IS NOT NULL
  AND processing_status = 'READY';

CREATE INDEX IF NOT EXISTS idx_clothing_waiting_upload_expiry
    ON clothing_items (processing_status, upload_url_expires_at)
    WHERE processing_status = 'WAITING_FOR_UPLOAD';

CREATE INDEX IF NOT EXISTS idx_clothing_original_cleanup
    ON clothing_items (processing_status, original_deleted_at)
    WHERE processing_status = 'READY'
      AND processed_s3_key IS NOT NULL
      AND original_s3_key IS NOT NULL
      AND original_deleted_at IS NULL;
