package com.wardrobe.service.processing;

import com.wardrobe.constants.Enums;
import com.wardrobe.dto.ProcessingMessageDTO;
import com.wardrobe.entity.ClothingItem;
import com.wardrobe.repository.ClothingItemRepository;
import com.wardrobe.repository.UserRepository;
import com.wardrobe.service.aws.S3Service;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.HashSet;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import lombok.extern.slf4j.Slf4j;

@Service
@RequiredArgsConstructor
@Slf4j
public class ProcessingResultService {
    private final ClothingItemRepository clothingItems;
    private final UserRepository users;
    private final S3Service s3;

    @Transactional
    public void apply(ProcessingMessageDTO.Result result) {
        ClothingItem item = clothingItems.findAndLockById(result.getItemId()).orElse(null);
        // ignore result if item doesn't exist or result version is old or item is no longer processing
        // protects against stale async messages
        if (item == null || item.getProcessingVersion() != result.getVersion()
                || item.getStatus() != Enums.ProcessingStatus.PROCESSING) {
            return;
        }
        // temporary source image used during processing
        String sourceKey = String.format(
                "staging/%s/%s/%d/source",
                item.getUser().getId(), item.getId(), item.getProcessingVersion());
        // if status in process result is not ready, that means processing failed, falls back to original image
        // promotes original image from staging to permanent storage
        // use original, no processed image hash clear processing timeout/deadline, mark ready
        // schedules staging cleanup only after the DB transaction commits successfully
        if (!"READY".equals(result.getStatus())) {
            String permanentKey = s3.promoteOriginal(
                    sourceKey, item.getUser().getId(), item.getId(), item.getProcessingVersion());
            item.setS3ObjectKey(permanentKey);
            item.setImageHash(null);
            item.setProcessingError("PROCESSING_FAILED_USING_ORIGINAL");
            item.setProcessingDeadlineAt(null);
            item.setStatus(Enums.ProcessingStatus.READY);
            deleteStagingAfterCommit(sourceKey);
            return;
        }
        // if result status is ready, then the service expects metadata and image hash.
        ProcessingMessageDTO.Metadata metadata = result.getMetadata();
        if (metadata == null) throw new IllegalArgumentException("READY result has no metadata");
        if (result.getImageHash() == null || result.getImageHash().isBlank()) {
            throw new IllegalArgumentException("READY result has no image hash");
        }
        item.setTags(new HashSet<>(metadata.getTags() == null ? java.util.Set.of() : metadata.getTags()));
        item.setS3ObjectKey(result.getObjectKey());
        item.setImageHash(result.getImageHash());
        item.setProcessingError(null);
        item.setProcessingDeadlineAt(null);
        users.findAndLockById(item.getUser().getId())
                .orElseThrow(() -> new IllegalStateException("Clothing owner no longer exists"));
        ClothingItem duplicate = clothingItems
                .findFirstByUserIdAndImageHashAndStatusAndRemovedAtIsNullAndIdNotOrderByCreatedAtAsc(
                        item.getUser().getId(),
                        result.getImageHash(),
                        Enums.ProcessingStatus.READY,
                        item.getId())
                .orElse(null);
        item.setDuplicateOfId(duplicate == null ? null : duplicate.getId());
        item.setStatus(duplicate == null
                ? Enums.ProcessingStatus.READY
                : Enums.ProcessingStatus.DUPLICATE_REVIEW);
        deleteStagingAfterCommit(sourceKey);
    }

    private void deleteStagingAfterCommit(String sourceKey) {
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                try {
                    s3.deleteFile(sourceKey);
                } catch (Exception exception) {
                    log.warn("Unable to remove processed staging image {}", sourceKey, exception);
                }
            }
        });
    }
}
