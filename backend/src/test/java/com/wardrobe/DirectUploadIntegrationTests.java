package com.wardrobe;

import com.wardrobe.constants.Enums;
import com.wardrobe.dto.ClothingItemDTO;
import com.wardrobe.entity.ClothingItem;
import com.wardrobe.entity.User;
import com.wardrobe.repository.ClothingItemRepository;
import com.wardrobe.repository.UserRepository;
import com.wardrobe.service.aws.S3Service;
import com.wardrobe.service.processing.ProcessingRecoveryService;
import com.wardrobe.service.wardrobe.ClothingService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@SpringBootTest
@Transactional
class DirectUploadIntegrationTests {
    @Autowired private UserRepository users;
    @Autowired private ClothingItemRepository items;
    @Autowired private ClothingService clothingService;
    @Autowired private ProcessingRecoveryService recoveryService;
    @MockitoBean private S3Service s3Service;

    @Test
    void createsWaitingItemAndPresignedUploadUrl() {
        User user = users.save(User.builder()
                .email("direct-upload@example.com")
                .username("direct-upload")
                .password("unused")
                .visibility(Enums.Visibility.PRIVATE)
                .build());
        when(s3Service.presignedPutUrl(
                org.mockito.ArgumentMatchers.startsWith("users/" + user.getId() + "/original/"),
                eq("image/jpeg")))
                .thenReturn("https://s3.example/upload");

        ClothingItemDTO.UploadUrlResponse response = clothingService.createUploadUrl(
                ClothingItemDTO.UploadUrlRequest.builder()
                        .category("TOPS")
                        .contentType("image/jpeg")
                        .build(),
                user);

        ClothingItem saved = items.findById(response.getItemId()).orElseThrow();
        assertEquals(Enums.ProcessingStatus.WAITING_FOR_UPLOAD, saved.getStatus());
        assertEquals("https://s3.example/upload", response.getUploadUrl());
        assertEquals(saved.getOriginalS3Key(), response.getOriginalS3Key());
        assertNotNull(saved.getUploadUrlExpiresAt());
    }

    @Test
    void marksPendingUploadAsFailedWhenBrowserUploadFails() {
        User user = users.save(User.builder()
                .email("direct-upload-failed@example.com")
                .username("direct-upload-failed")
                .password("unused")
                .visibility(Enums.Visibility.PRIVATE)
                .build());
        ClothingItem item = items.saveAndFlush(ClothingItem.builder()
                .category(Enums.Category.TOPS)
                .status(Enums.ProcessingStatus.WAITING_FOR_UPLOAD)
                .originalS3Key("users/%s/original/item.jpg".formatted(user.getId()))
                .user(user)
                .build());

        clothingService.markUploadFailed(item.getId(), user);

        ClothingItem failed = items.findById(item.getId()).orElseThrow();
        assertEquals(Enums.ProcessingStatus.FAILED, failed.getStatus());
        assertEquals("ORIGINAL_UPLOAD_FAILED", failed.getProcessingError());
        assertNull(failed.getOriginalS3Key());
        assertNull(failed.getProcessedS3Key());
    }

    @Test
    void cleanupMarksAbandonedUploadAsFailed() {
        User user = users.save(User.builder()
                .email("abandoned-upload@example.com")
                .username("abandoned-upload")
                .password("unused")
                .visibility(Enums.Visibility.PRIVATE)
                .build());
        ClothingItem item = items.saveAndFlush(ClothingItem.builder()
                .category(Enums.Category.TOPS)
                .status(Enums.ProcessingStatus.WAITING_FOR_UPLOAD)
                .originalS3Key("users/%s/original/item.jpg".formatted(user.getId()))
                .uploadUrlExpiresAt(LocalDateTime.now().minusHours(2))
                .user(user)
                .build());

        recoveryService.recoverTimedOutItems();

        ClothingItem failed = items.findById(item.getId()).orElseThrow();
        assertEquals(Enums.ProcessingStatus.FAILED, failed.getStatus());
        assertEquals("ORIGINAL_UPLOAD_NOT_COMPLETED", failed.getProcessingError());
        assertNull(failed.getOriginalS3Key());
        assertNull(failed.getProcessedS3Key());
    }

    @Test
    void cleanupPromotesTimedOutProcessingItemToOriginalFallback() {
        User user = users.save(User.builder()
                .email("processing-timeout@example.com")
                .username("processing-timeout")
                .password("unused")
                .visibility(Enums.Visibility.PRIVATE)
                .build());
        ClothingItem item = items.saveAndFlush(ClothingItem.builder()
                .category(Enums.Category.TOPS)
                .status(Enums.ProcessingStatus.PROCESSING)
                .originalS3Key("users/%s/original/item.jpg".formatted(user.getId()))
                .processedS3Key("users/%s/processed/item.webp".formatted(user.getId()))
                .processingDeadlineAt(LocalDateTime.now().minusMinutes(1))
                .user(user)
                .build());

        recoveryService.recoverTimedOutItems();

        ClothingItem ready = items.findById(item.getId()).orElseThrow();
        assertEquals(Enums.ProcessingStatus.READY, ready.getStatus());
        assertEquals("PROCESSING_FAILED_USING_ORIGINAL", ready.getProcessingError());
        assertEquals("users/%s/original/item.jpg".formatted(user.getId()), ready.getOriginalS3Key());
        assertNull(ready.getProcessedS3Key());
    }

    @Test
    void cleanupDeletesOriginalAfterProcessedItemIsReady() {
        User user = users.save(User.builder()
                .email("delete-original@example.com")
                .username("delete-original")
                .password("unused")
                .visibility(Enums.Visibility.PRIVATE)
                .build());
        ClothingItem item = items.saveAndFlush(ClothingItem.builder()
                .category(Enums.Category.TOPS)
                .status(Enums.ProcessingStatus.READY)
                .originalS3Key("users/%s/original/item.jpg".formatted(user.getId()))
                .processedS3Key("users/%s/processed/item.webp".formatted(user.getId()))
                .processedAt(LocalDateTime.now())
                .user(user)
                .build());

        recoveryService.cleanupProcessedOriginals();

        ClothingItem ready = items.findById(item.getId()).orElseThrow();
        verify(s3Service).deleteFile("users/%s/original/item.jpg".formatted(user.getId()));
        assertNotNull(ready.getOriginalDeletedAt());
    }
}
