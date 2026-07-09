package com.wardrobe.service.wardrobe;

import com.wardrobe.entity.ClothingItem;
import com.wardrobe.repository.ClothingItemRepository;
import com.wardrobe.service.aws.S3Service;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;

@Service
@ConditionalOnProperty(name = "app.removed-clothing-cleanup-enabled", havingValue = "true")
@RequiredArgsConstructor
@Slf4j
public class RemovedClothingCleanupService {
    private final ClothingItemRepository clothing;
    private final S3Service s3;

    @Value("${app.removed-clothing-retention-days:30}")
    private int retentionDays;

    /**
     * Scheduled batch cleanup that removes expired soft-deleted clothing items
     * and their associated S3 objects.
     */
    @Scheduled(cron = "${app.removed-clothing-cleanup-cron:0 30 3 * * *}")
    @Transactional
    public void purgeBatch() {
        List<ClothingItem> purgeable = clothing.findPurgeableRemovedItems(
                LocalDateTime.now().minusDays(retentionDays), PageRequest.of(0, 100));
        for (ClothingItem item : purgeable) {
            if (item.getProcessedS3Key() != null) {
                s3.deleteFile(item.getProcessedS3Key());
            }
            if (item.getOriginalS3Key() != null && item.getOriginalDeletedAt() == null) {
                s3.deleteFile(item.getOriginalS3Key());
            }
            clothing.delete(item);
            log.info("Purged unreferenced removed clothing item {}", item.getId());
        }
    }
}
