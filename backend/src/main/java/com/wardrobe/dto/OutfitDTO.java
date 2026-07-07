package com.wardrobe.dto;

import jakarta.validation.constraints.*;
import lombok.*;
import java.time.LocalDateTime;
import java.util.*;

public class OutfitDTO {

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class CreateRequest {
        @NotEmpty(message = "At least one clothing item is required")
        @Size(max = 20, message = "An outfit can contain at most 20 clothing items")
        private Set<UUID> clothingItemIds = new HashSet<>();
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class UpdateRequest {
        @Size(max = 20, message = "An outfit can contain at most 20 clothing items")
        private Set<UUID> clothingItemIds;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class AiOutfitSuggestionRequest {
        @NotEmpty(message = "Add at least one clothing item before asking for a suggestion")
        @Size(max = 20, message = "An outfit can contain at most 20 clothing items")
        private Set<UUID> clothingItemIds = new HashSet<>();

        @NotBlank(message = "A category is required")
        private String category;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class CreateCommunitySuggestionRequest {
        @NotEmpty(message = "At least one clothing item is required")
        @Size(max = 20, message = "An outfit can contain at most 20 clothing items")
        private Set<UUID> clothingItemIds = new HashSet<>();
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class SuggestedBySummary {
        private UUID id;
        private String username;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class Response {
        private UUID id;
        private Set<ClothingItemDTO.Response> items;
        private UUID userId;
        private SuggestedBySummary suggestedBy;
        private LocalDateTime acceptedAt;
        private LocalDateTime createdAt;
        private LocalDateTime updatedAt;
    }
}
