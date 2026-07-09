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
        @Size(max = 20, message = "A clothing item can have at most 20 tags")
        private Set<@Size(max = 30, message = "Tags must be 30 characters or fewer") String> tags;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class UploadUrlResponse {
        private UUID itemId;
        private String uploadUrl;
        private String originalS3Key;
        private LocalDateTime expiresAt;
        private Response item;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class Response {
        private UUID id;
        private String category;
        private String imageUrl;
        private Set<String> tags;
        private String status;
        private String processingError;
        private boolean removedFromWardrobe;
        private UUID duplicateOfId;
        private UUID userId;
        private LocalDateTime createdAt;
        private LocalDateTime updatedAt;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class Summary {
        private UUID id;
        private String category;
        private String imageUrl;
        private String status;
        private String processingError;
        private boolean removedFromWardrobe;
        private UUID duplicateOfId;
        private UUID userId;
        private LocalDateTime createdAt;
        private LocalDateTime updatedAt;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class SearchRequest {
        @Size(max = 100)
        private String query;
        private String category;
        private List<String> tags;
        private int page = 0;
        private int size = 20;
    }
}
