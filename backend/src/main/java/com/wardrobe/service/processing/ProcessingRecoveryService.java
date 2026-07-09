package com.wardrobe.service.processing;

import com.wardrobe.constants.Enums;
import com.wardrobe.entity.ClothingItem;
import com.wardrobe.repository.ClothingItemRepository;
import com.wardrobe.service.aws.S3Service;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import io.micrometer.core.instrument.MeterRegistry;

import java.time.LocalDateTime;

@Service
@RequiredArgsConstructor
@Slf4j
public class ProcessingRecoveryService {
    public static final int MAX_PROCESSING_ATTEMPTS = 3;

    private final ClothingItemRepository clothingItems;
    private final S3Service s3;
    private final MeterRegistry meterRegistry;

    // detect clothing items that have been stuck in PROCESSING for too long and recover them
    @Scheduled(fixedDelayString = "${processing.recovery-interval-ms:2000}")
    @Transactional
    public void recoverTimedOutItems() {
        LocalDateTime now = LocalDateTime.now();
        for (ClothingItem item : clothingItems.findAndLockExpiredUploads(
                Enums.ProcessingStatus.WAITING_FOR_UPLOAD, now.minusMinutes(30), PageRequest.of(0, 50))) {
            log.warn("Upload URL expired before upload completed for clothing item {}", item.getId());
            item.setStatus(Enums.ProcessingStatus.FAILED);
            item.setProcessingError("ORIGINAL_UPLOAD_NOT_COMPLETED");
            item.setProcessingDeadlineAt(null);
            item.setOriginalS3Key(null);
            item.setProcessedS3Key(null);
            meterRegistry.counter("wardrobe.processing.abandoned_uploads").increment();
        }
        for (ClothingItem item : clothingItems.findAndLockOverdue(
                Enums.ProcessingStatus.PROCESSING, now, PageRequest.of(0, 50))) {
            log.warn("Processing timed out for clothing item {}", item.getId());
            meterRegistry.counter("wardrobe.processing.timeouts").increment();
            promoteFallback(item);
        }
    }

    private void promoteFallback(ClothingItem item) {
        if (item.getOriginalS3Key() != null && !item.getOriginalS3Key().isBlank()) {
            item.setProcessedS3Key(null);
            item.setImageHash(null);
            item.setStatus(Enums.ProcessingStatus.READY);
            item.setProcessingError("PROCESSING_FAILED_USING_ORIGINAL");
            item.setProcessingDeadlineAt(null);
            meterRegistry.counter("wardrobe.processing.fallbacks").increment();
            return;
        }
        log.warn("Timed-out item {} has no original image", item.getId());
        item.setStatus(Enums.ProcessingStatus.FAILED);
        item.setProcessingError("ORIGINAL_UNAVAILABLE");
        item.setProcessingDeadlineAt(null);
    }

    @Scheduled(fixedDelayString = "${processing.original-cleanup-interval-ms:60000}")
    @Transactional
    public void cleanupProcessedOriginals() {
        for (ClothingItem item : clothingItems.findAndLockReadyItemsWithOriginalsToDelete(
                Enums.ProcessingStatus.READY, PageRequest.of(0, 50))) {
            try {
                s3.deleteFile(item.getOriginalS3Key());
                item.setOriginalDeletedAt(LocalDateTime.now());
                meterRegistry.counter("wardrobe.processing.originals_deleted").increment();
            } catch (Exception exception) {
                log.warn("Unable to delete original image {} for item {}",
                        item.getOriginalS3Key(), item.getId(), exception);
            }
        }
    }

}
