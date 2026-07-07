UPDATE clothing_items
SET processing_status = 'RETRY'
WHERE processing_status = 'FAILED';
