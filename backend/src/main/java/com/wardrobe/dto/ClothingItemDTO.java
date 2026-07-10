package com.wardrobe.dto;

import jakarta.validation.constraints.*;
import lombok.*;
import java.time.LocalDateTime;
import java.util.*;

public class ClothingItemDTO {
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class UpdateRequest {
        @NotBlank(message = "Category is required")
        private String category;
        @Size(max = 20, message = "A clothing item can have at most 20 tags")
        private Set<@Size(max = 30, message = "Tags must be 30 characters or fewer") String> tags;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class UploadUrlRequest {
        @NotBlank(message = "Category is required")
        private String category;
        @NotBlank(message = "Content type is required")
        private String contentType;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class RetryUploadUrlRequest {
        @NotBlank(message = "Content type is required")
        private String contentType;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class UploadUrlResponse {
        private UUID itemId;
        private String uploadUrl;
        private LocalDateTime expiresAt;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class ClothingItemDetail {
        private UUID id;
        private String category;
        private String imageUrl;
        private Set<String> tags;
        private String processingState;
        private String failureReason;
        private String displayNote;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class WardrobeListItem {
        private UUID id;
        private String category;
        private String imageUrl;
        private String processingState;
        private String failureReason;
        private String displayNote;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class OutfitItem {
        private UUID id;
        private String category;
        private String imageUrl;
        private boolean removedFromWardrobe;
    }

}
