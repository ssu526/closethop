## Flow Notes

### Normal Success

1. The frontend calls `POST /api/clothing/upload-url` with category and content type.
2. Spring creates a `clothing_items` row in `WAITING_FOR_UPLOAD`, sets `original_s3_key`, and returns a presigned S3 PUT URL.
3. The browser uploads the original image directly to S3 under `users/{userId}/original/{itemId}.{jpg|png}`.
4. S3 sends an ObjectCreated notification to SQS.
5. The worker parses only `users/*/original/*` keys and atomically claims the row by changing `WAITING_FOR_UPLOAD` to `PROCESSING`.
6. The worker downloads the original, removes the background with rembg, normalizes to WebP, computes a SHA-256 hash, reuses metadata if the same hash already exists, otherwise calls Gemini.
7. The worker writes `users/{userId}/processed/{itemId}.webp` to S3.
8. The worker updates the row to `READY`, sets `processed_s3_key` to the processed object, stores `image_hash`, replaces tags, clears `processing_error`, then deletes the original image and records `original_deleted_at`.
9. The worker deletes the SQS message after successful handling.

### Original Upload Fails

1. The browser receives a non-2xx response from the direct S3 PUT.
2. The frontend calls `POST /api/clothing/{itemId}/upload-failed`.
3. Spring only accepts that call while the item is still `WAITING_FOR_UPLOAD`.
4. The item becomes `FAILED` with `processing_error = ORIGINAL_UPLOAD_FAILED`, and all S3 key fields are cleared.
5. If the frontend cannot report the failure, `ProcessingRecoveryService.recoverTimedOutItems` later marks expired `WAITING_FOR_UPLOAD` rows as `FAILED` with `processing_error = ORIGINAL_UPLOAD_NOT_COMPLETED`.

### Duplicate SQS Message

1. S3/SQS can deliver the same original upload event more than once.
2. The worker attempts to claim the item with a conditional update that only matches `WAITING_FOR_UPLOAD`.
3. If another worker or earlier delivery already claimed or completed it, the update returns no row.
4. The worker logs the message as duplicate or stale, performs no image processing, and lets the queue message be deleted.

### Duplicate Image

1. The worker still normalizes the uploaded image and computes its content hash.
2. Before finalizing, it searches for another non-removed `READY` item for the same user with the same `image_hash`.
3. If a match exists, the new item becomes `DUPLICATE_REJECTED` with `processing_error = DUPLICATE_UPLOAD` and `duplicate_of_id` pointing at the existing item.
4. The worker deletes both the new original and the newly written processed object, leaving the existing item as the canonical image.

### rembg Failure

1. The worker first tries rembg `isnet-general-use`, then falls back to rembg `u2net` if the cutout quality check fails.
2. If both rembg cutouts are low confidence, the worker tries the local light-background remover.
3. If normalization still raises a `ValueError`, finalization marks the item `READY` with the original image and `processing_error = BACKGROUND_REMOVAL_FAILED_USING_ORIGINAL`.
4. No processed image is required in this fallback path.

### Gemini Failure

1. The worker calls Gemini only when no existing image hash metadata can be reused.
2. Gemini extraction retries according to `GEMINI_RETRY_ATTEMPTS`.
3. If all attempts fail, processing continues with empty tags instead of failing the upload.
4. The item can still become `READY` with a processed image; the failure only affects generated metadata.

### Processed Image S3 Upload Failed

1. The worker retries `put_object` for the processed WebP according to `PROCESSED_UPLOAD_RETRY_ATTEMPTS`.
2. If all attempts fail, it raises `PROCESSED_UPLOAD_FAILED`.
3. Finalization catches that error and marks the item `READY` with `processed_s3_key = NULL` and `processing_error = PROCESSED_UPLOAD_FAILED_USING_ORIGINAL`; the original remains displayable through `original_s3_key`.
4. The user still sees the original image rather than a failed item.

### DB Update Failure

1. The worker can fail while updating Postgres after it has already claimed the row or uploaded a processed object.
2. The worker logs the exception and does not delete the SQS message on that failed attempt.
3. On redelivery, the claim query no longer matches because the row is already `PROCESSING`, so the duplicate/stale message path skips processing and deletes the queue message.
4. `ProcessingRecoveryService.recoverTimedOutItems` later handles the overdue `PROCESSING` row. If `original_s3_key` is still present, it promotes the item to `READY` using the original and `processing_error = PROCESSING_FAILED_USING_ORIGINAL`; if not, it marks the item `FAILED` with `processing_error = ORIGINAL_UNAVAILABLE`.
5. If the processed object was uploaded before the DB failure, the worker deletes that just-uploaded processed object before re-raising the failure so it does not become an orphan.

## Display Image Selection

The API derives `imageUrl` from explicit lifecycle fields instead of storing a generic current image key:

1. Use `processed_s3_key` when it is present.
2. Otherwise use `original_s3_key` only when it is present and `original_deleted_at` is null.
3. Otherwise return no image URL.

## Cleanup Jobs

### Worker Recovery for Missed S3/SQS Events

The Python worker periodically scans `WAITING_FOR_UPLOAD` rows with an `original_s3_key`, checks whether the original exists in S3, claims the row, and finalizes processing. This covers cases where the browser upload succeeded but the S3-to-SQS event was missed or delayed.

### Spring Processing Recovery

`ProcessingRecoveryService.recoverTimedOutItems` runs on `processing.recovery-interval-ms` and handles two stale states:

- Expired `WAITING_FOR_UPLOAD` rows become `FAILED` with `ORIGINAL_UPLOAD_NOT_COMPLETED`.
- Overdue `PROCESSING` rows are promoted to `READY` using the original image, or marked `FAILED` if the original is unavailable.

### Processed Original Cleanup

`ProcessingRecoveryService.cleanupProcessedOriginals` runs on `processing.original-cleanup-interval-ms`. It finds `READY` items that have both `processed_s3_key` and `original_s3_key` and no `original_deleted_at`, deletes the original S3 object, and records `original_deleted_at`. Failed deletes are logged and retried on a later run.

### Removed Clothing Cleanup

`RemovedClothingCleanupService` is enabled with `app.removed-clothing-cleanup-enabled=true`. On `app.removed-clothing-cleanup-cron`, it purges soft-deleted clothing items older than `app.removed-clothing-retention-days` that are not attached to outfits, deletes their processed object and any still-available original object, and removes the DB row.

### Postgres Backup Job

The `backup` container in `deploy/ec2/compose.prod.yml` runs `pg_dump` and writes dumps to the separate S3 backup bucket under `BACKUP_PREFIX`, preserving database recovery points independently from the image bucket.
