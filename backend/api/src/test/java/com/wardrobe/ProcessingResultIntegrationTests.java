package com.wardrobe;

import com.wardrobe.constants.Enums;
import com.wardrobe.dto.ProcessingMessageDTO;
import com.wardrobe.dto.ClothingItemDTO;
import com.wardrobe.entity.ClothingItem;
import com.wardrobe.entity.User;
import com.wardrobe.repository.ClothingItemRepository;
import com.wardrobe.repository.UserRepository;
import com.wardrobe.service.processing.ProcessingQueueService;
import com.wardrobe.service.wardrobe.ClothingService;
import com.wardrobe.service.aws.S3Service;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import java.util.Set;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.when;

@SpringBootTest
@Transactional
class ProcessingResultIntegrationTests {
    @Autowired private UserRepository users;
    @Autowired private ClothingItemRepository items;
    @Autowired private ProcessingQueueService processing;
    @Autowired private ClothingService clothingService;
    @MockitoBean private S3Service s3Service;

    @Test
    void appliesCurrentSuccessfulResult() {
        User user = users.save(User.builder()
                .email("processing@example.com")
                .username("processing")
                .password("unused")
                .visibility(Enums.Visibility.PRIVATE)
                .build());
        ClothingItem item = items.save(ClothingItem.builder()
                .category(Enums.Category.TOPS)
                .status(Enums.ProcessingStatus.PROCESSING)
                .user(user)
                .build());

        ProcessingMessageDTO.Metadata metadata = new ProcessingMessageDTO.Metadata();
        metadata.setTags(Set.of("navy", "wide leg"));
        ProcessingMessageDTO.Result result = new ProcessingMessageDTO.Result();
        result.setItemId(item.getId());
        result.setVersion(1);
        result.setStatus("READY");
        result.setImageUrl("https://images.example/processed.webp");
        result.setObjectKey("processed.webp");
        result.setImageHash("abc");
        result.setMetadata(metadata);

        processing.applyResult(result);
        ClothingItem saved = items.findById(item.getId()).orElseThrow();
        assertEquals(Enums.ProcessingStatus.READY, saved.getStatus());
        assertEquals(Enums.Category.TOPS, saved.getCategory());
        assertEquals(Set.of("navy", "wide leg"), saved.getTags());
        assertEquals("processed.webp", saved.getS3ObjectKey());
        assertEquals("abc", saved.getImageHash());
    }

    @Test
    void terminalFailurePromotesOriginalAsReadyFallback() {
        User user = users.save(User.builder()
                .email("unknown-processing@example.com")
                .username("unknown-processing")
                .password("unused")
                .visibility(Enums.Visibility.PRIVATE)
                .build());
        ClothingItem item = items.save(ClothingItem.builder()
                .category(Enums.Category.TOPS)
                .status(Enums.ProcessingStatus.PROCESSING)
                .user(user)
                .build());
        ProcessingMessageDTO.Result result = new ProcessingMessageDTO.Result();
        result.setItemId(item.getId());
        result.setVersion(1);
        result.setStatus("FAILED");
        result.setErrorCode("PROCESSING_FAILED");

        String sourceKey = "staging/" + user.getId() + "/" + item.getId() + "/1/source";
        String permanentKey = "users/" + user.getId() + "/clothing/" + item.getId() + "/1/original";
        when(s3Service.promoteOriginal(sourceKey, user.getId(), item.getId(), 1))
                .thenReturn(permanentKey);
        processing.applyResult(result);
        ClothingItem fallback = items.findById(item.getId()).orElseThrow();
        assertEquals(Enums.ProcessingStatus.READY, fallback.getStatus());
        assertEquals("PROCESSING_FAILED_USING_ORIGINAL", fallback.getProcessingError());
        assertEquals(permanentKey, fallback.getS3ObjectKey());
        assertNull(fallback.getImageHash());
    }

    @Test
    void matchingProcessedHashRequiresDuplicateReviewAndCanBeKept() {
        User user = users.save(User.builder()
                .email("duplicate-result@example.com")
                .username("duplicate-result")
                .password("unused")
                .visibility(Enums.Visibility.PRIVATE)
                .build());
        ClothingItem original = items.saveAndFlush(ClothingItem.builder()
                .category(Enums.Category.TOPS)
                .status(Enums.ProcessingStatus.READY)
                .imageHash("same-normalized-hash")
                .s3ObjectKey("original-processed.webp")
                .user(user)
                .build());
        ClothingItem incoming = items.saveAndFlush(ClothingItem.builder()
                .category(Enums.Category.TOPS)
                .status(Enums.ProcessingStatus.PROCESSING)
                .user(user)
                .build());

        ProcessingMessageDTO.Metadata metadata = new ProcessingMessageDTO.Metadata();
        metadata.setTags(Set.of("cotton"));
        ProcessingMessageDTO.Result result = new ProcessingMessageDTO.Result();
        result.setItemId(incoming.getId());
        result.setVersion(1);
        result.setStatus("READY");
        result.setObjectKey("new-processed.webp");
        result.setImageHash("same-normalized-hash");
        result.setMetadata(metadata);

        processing.applyResult(result);

        ClothingItem review = items.findById(incoming.getId()).orElseThrow();
        assertEquals(Enums.ProcessingStatus.DUPLICATE_REVIEW, review.getStatus());
        assertEquals(original.getId(), review.getDuplicateOfId());
        assertEquals("same-normalized-hash", review.getImageHash());
        assertNotNull(review.getS3ObjectKey());

        clothingService.keepDuplicate(review.getId(), user);
        ClothingItem kept = items.findById(review.getId()).orElseThrow();
        assertEquals(Enums.ProcessingStatus.READY, kept.getStatus());
        assertNull(kept.getDuplicateOfId());
    }

    @Test
    void processedHashDoesNotMatchItemsBelongingToAnotherUser() {
        User first = users.save(User.builder()
                .email("hash-first@example.com").username("hash-first")
                .password("unused").visibility(Enums.Visibility.PRIVATE).build());
        User second = users.save(User.builder()
                .email("hash-second@example.com").username("hash-second")
                .password("unused").visibility(Enums.Visibility.PRIVATE).build());
        items.saveAndFlush(ClothingItem.builder()
                .category(Enums.Category.TOPS)
                .status(Enums.ProcessingStatus.READY)
                .imageHash("shared-hash")
                .user(first)
                .build());
        ClothingItem incoming = items.saveAndFlush(ClothingItem.builder()
                .category(Enums.Category.TOPS)
                .status(Enums.ProcessingStatus.PROCESSING)
                .user(second)
                .build());
        ProcessingMessageDTO.Metadata metadata = new ProcessingMessageDTO.Metadata();
        metadata.setTags(Set.of());
        ProcessingMessageDTO.Result result = new ProcessingMessageDTO.Result();
        result.setItemId(incoming.getId());
        result.setVersion(1);
        result.setStatus("READY");
        result.setObjectKey("second.webp");
        result.setImageHash("shared-hash");
        result.setMetadata(metadata);

        processing.applyResult(result);

        assertEquals(Enums.ProcessingStatus.READY,
                items.findById(incoming.getId()).orElseThrow().getStatus());
    }

    @Test
    void editingAnOrdinaryFailureDoesNotMarkItReady() {
        User user = users.save(User.builder()
                .email("failed-processing@example.com")
                .username("failed-processing")
                .password("unused")
                .visibility(Enums.Visibility.PRIVATE)
                .build());
        ClothingItem item = items.save(ClothingItem.builder()
                .category(Enums.Category.TOPS)
                .status(Enums.ProcessingStatus.RETRY)
                .processingError("PROCESSING_FAILED")
                .user(user)
                .build());

        clothingService.updateClothingItem(
                item.getId(),
                ClothingItemDTO.UpdateRequest.builder()
                        .category("BOTTOMS")
                        .tags(Set.of("black"))
                        .build(),
                user);

        assertEquals(Enums.ProcessingStatus.RETRY, items.findById(item.getId()).orElseThrow().getStatus());
    }
}
