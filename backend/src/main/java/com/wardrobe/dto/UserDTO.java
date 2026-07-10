package com.wardrobe.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.UUID;
import java.util.List;
import java.util.Map;

public class UserDTO {
    @Data
    @AllArgsConstructor
    public static class Response {
        private UUID id;
        private String username;
        private String visibility;
        private Map<String, Long> categoryCounts;
    }

    @Data
    @AllArgsConstructor
    public static class ExploreResponse {
        private UUID id;
        private String username;
        private long clothingItemCount;
        private UUID featuredOutfitId;
        private List<String> imageUrls;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class VisibilityRequest {
        @NotBlank
        private String visibility;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ProfileNameRequest {
        @NotBlank
        @Size(max = 100)
        private String profileName;
    }
}
