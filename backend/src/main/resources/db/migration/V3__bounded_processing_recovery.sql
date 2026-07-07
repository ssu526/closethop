ALTER TABLE clothing_items
    ADD COLUMN processing_attempt INTEGER NOT NULL DEFAULT 1;
ALTER TABLE clothing_items
    ADD COLUMN processing_deadline_at TIMESTAMP;

ALTER TABLE processing_jobs
    ADD COLUMN next_attempt_at TIMESTAMP;
ALTER TABLE processing_jobs
    ADD COLUMN last_error VARCHAR(255);

CREATE INDEX idx_processing_jobs_due
    ON processing_jobs (status, next_attempt_at);
CREATE INDEX idx_clothing_processing_due
    ON clothing_items (processing_status, processing_deadline_at);
