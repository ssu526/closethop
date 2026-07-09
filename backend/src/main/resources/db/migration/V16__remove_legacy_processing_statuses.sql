UPDATE clothing_items
SET processing_status = 'FAILED',
    processing_error = COALESCE(processing_error, 'LEGACY_PROCESSING_STATUS_REMOVED')
WHERE processing_status IN ('RETRY', 'NEEDS_INPUT', 'DUPLICATE_REVIEW');

ALTER TABLE clothing_items
    ALTER COLUMN processing_status SET DEFAULT 'WAITING_FOR_UPLOAD';
