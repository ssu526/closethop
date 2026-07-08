package com.wardrobe;

import com.wardrobe.constants.Enums;
import com.wardrobe.dto.ProcessingMessageDTO;
import com.wardrobe.entity.ClothingItem;
import com.wardrobe.entity.User;
import com.wardrobe.repository.ClothingItemRepository;
import com.wardrobe.repository.UserRepository;
import com.wardrobe.service.processing.ProcessingQueueService;
import com.wardrobe.service.processing.ProcessingRecoveryService;
import com.wardrobe.service.aws.S3Service;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.annotation.Transactional;
import software.amazon.awssdk.services.s3.model.NoSuchBucketException;

import java.time.LocalDateTime;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.doThrow;

@SpringBootTest
@Transactional
class ProcessingRecoveryIntegrationTests {
    @Autowired private UserRepository users;
    @Autowired private ClothingItemRepository items;
    @Autowired private ProcessingQueueService queue;
    @Autowired private ProcessingRecoveryService recovery;
    @MockitoBean private S3Service s3;

    @Test
    void lateResultFromOlderVersionIsIgnored() {
        ClothingItem item = processingItem("late@example.com");
        item.setProcessingVersion(2);
        items.save(item);

        ProcessingMessageDTO.Result stale = new ProcessingMessageDTO.Result();
        stale.setItemId(item.getId());
        stale.setVersion(1);
        stale.setStatus("FAILED");
        queue.applyResult(stale);

        assertEquals(Enums.ProcessingStatus.PROCESSING,
                items.findById(item.getId()).orElseThrow().getStatus());
    }

    @Test
    void abandonedProcessingItemUsesOriginalFallback() {
        ClothingItem item = processingItem("timeout@example.com");
        item.setProcessingDeadlineAt(LocalDateTime.now().minusSeconds(1));
        items.saveAndFlush(item);
        String source = "staging/" + item.getUser().getId() + "/" + item.getId() + "/1/source";
        String original = "users/" + item.getUser().getId() + "/clothing/" + item.getId() + "/1/original";
        when(s3.promoteOriginal(source, item.getUser().getId(), item.getId(), 1))
                .thenReturn(original);
        when(s3.listStagingObjects()).thenReturn(List.of());

        recovery.recoverTimedOutItems();

        ClothingItem recovered = items.findById(item.getId()).orElseThrow();
        assertEquals(Enums.ProcessingStatus.READY, recovered.getStatus());
        assertEquals("PROCESSING_FAILED_USING_ORIGINAL", recovered.getProcessingError());
        assertEquals(original, recovered.getS3ObjectKey());
    }

    @Test
    void missingStagingOriginalRequestsAReplacementUpload() {
        ClothingItem item = processingItem("missing-original@example.com");
        item.setProcessingDeadlineAt(LocalDateTime.now().minusSeconds(1));
        items.saveAndFlush(item);
        String source = "staging/" + item.getUser().getId() + "/" + item.getId() + "/1/source";
        doThrow(new IllegalStateException("missing"))
                .when(s3).promoteOriginal(source, item.getUser().getId(), item.getId(), 1);

        recovery.recoverTimedOutItems();

        ClothingItem recovered = items.findById(item.getId()).orElseThrow();
        assertEquals(Enums.ProcessingStatus.NEEDS_INPUT, recovered.getStatus());
        assertEquals("ORIGINAL_UNAVAILABLE", recovered.getProcessingError());
        assertNull(recovered.getProcessingDeadlineAt());
    }

    @Test
    void missingBucketDoesNotCrashScheduledStagingReconciliation() {
        when(s3.listStagingObjects())
                .thenThrow(NoSuchBucketException.builder().message("missing bucket").build());

        assertDoesNotThrow(() -> recovery.scheduledStagingReconciliation());
    }

    private ClothingItem processingItem(String email) {
        User user = users.save(User.builder()
                .email(email).username(email).password("unused")
                .visibility(Enums.Visibility.PRIVATE).build());
        return items.save(ClothingItem.builder()
                .category(Enums.Category.TOPS)
                .status(Enums.ProcessingStatus.PROCESSING)
                .processingDeadlineAt(LocalDateTime.now().plusMinutes(1))
                .user(user).build());
    }
}
