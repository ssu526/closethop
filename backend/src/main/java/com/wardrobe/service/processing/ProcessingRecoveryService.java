package com.wardrobe.service.processing;

import com.wardrobe.constants.Enums;
import com.wardrobe.config.ProcessingQueueConfig;
import com.wardrobe.entity.ClothingItem;
import com.wardrobe.repository.ClothingItemRepository;
import com.wardrobe.service.aws.S3Service;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import io.micrometer.core.instrument.MeterRegistry;
import software.amazon.awssdk.services.s3.model.NoSuchBucketException;

import java.time.LocalDateTime;
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Slf4j
public class ProcessingRecoveryService {
    public static final int MAX_PROCESSING_ATTEMPTS = 3;

    private final ClothingItemRepository clothingItems;
    private final S3Service s3;
    private final MeterRegistry meterRegistry;
    private final ProcessingQueueConfig processingConfig;
    private volatile boolean missingBucketWarningLogged;

    // detect clothing items that have been stuck in PROCESSING for too long and recover them
    @Scheduled(fixedDelayString = "${processing.recovery-interval-ms:2000}")
    @Transactional
    public void recoverTimedOutItems() {
        LocalDateTime now = LocalDateTime.now();
        for (ClothingItem item : clothingItems.findAndLockOverdue(
                Enums.ProcessingStatus.PROCESSING, now, PageRequest.of(0, 50))) {
            log.warn("Processing timed out for clothing item {}", item.getId());
            meterRegistry.counter("wardrobe.processing.timeouts").increment();
            promoteFallback(item);
        }
    }

    private void promoteFallback(ClothingItem item) {
        String sourceKey = stagingKey(item);
        String permanentKey;
        try {
            permanentKey = s3.promoteOriginal(
                    sourceKey, item.getUser().getId(), item.getId(), item.getProcessingVersion());
        } catch (IllegalStateException exception) {
            log.warn("Timed-out item {} has no staging original", item.getId());
            item.setStatus(Enums.ProcessingStatus.NEEDS_INPUT);
            item.setProcessingError("ORIGINAL_UNAVAILABLE");
            item.setProcessingDeadlineAt(null);
            return;
        }
        item.setS3ObjectKey(permanentKey);
        item.setImageHash(null);
        item.setStatus(Enums.ProcessingStatus.READY);
        item.setProcessingError("PROCESSING_FAILED_USING_ORIGINAL");
        item.setProcessingDeadlineAt(null);
        meterRegistry.counter("wardrobe.processing.fallbacks").increment();
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                try {
                    s3.deleteFile(sourceKey);
                } catch (Exception exception) {
                    log.warn("Unable to remove reconciled staging image {}", sourceKey, exception);
                }
            }
        });
    }

    private String stagingKey(ClothingItem item) {
        return String.format("staging/%s/%s/%d/source",
                item.getUser().getId(), item.getId(), item.getProcessingVersion());
    }

    @Scheduled(fixedDelayString = "${processing.staging-reconciliation-interval-ms:60000}")
    public void scheduledStagingReconciliation() {
        if (!processingConfig.isEnabled()) return;
        try {
            reconcileStagingObjects();
            missingBucketWarningLogged = false;
        } catch (NoSuchBucketException exception) {
            if (!missingBucketWarningLogged) {
                log.warn("Processing staging bucket does not exist; skipping staging reconciliation until "
                                + "the bucket is available or configuration is fixed",
                        exception);
                missingBucketWarningLogged = true;
            } else {
                log.debug("Processing staging bucket is still unavailable; skipping staging reconciliation");
            }
        } catch (RuntimeException exception) {
            log.error("Unable to reconcile processing staging objects", exception);
        }
    }

    // scans S3 staging storage and deletes staging files that are safe to remove.
    // delete is clothing item not exist or items status is ready/permanent s3 key exists and key is under users/
    public void reconcileStagingObjects() {
        for (S3Service.StoredObject object : s3.listStagingObjects()) {
            String[] parts = object.key().split("/");
            if (parts.length != 5 || !"source".equals(parts[4])) {
                continue;
            }
            UUID itemId;
            try {
                itemId = UUID.fromString(parts[2]);
            } catch (IllegalArgumentException exception) {
                continue;
            }
            ClothingItem item = clothingItems.findById(itemId).orElse(null);
            boolean confirmedOrphan = item == null;
            boolean durablyFinal = item != null
                    && item.getStatus() == Enums.ProcessingStatus.READY
                    && item.getS3ObjectKey() != null
                    && item.getS3ObjectKey().startsWith("users/");
            if (confirmedOrphan || durablyFinal) {
                try {
                    s3.deleteFile(object.key());
                } catch (Exception exception) {
                    log.warn("Unable to clean reconciled staging object {}", object.key(), exception);
                }
            }
        }
    }
}
