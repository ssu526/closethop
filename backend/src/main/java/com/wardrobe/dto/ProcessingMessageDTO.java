package com.wardrobe.dto;

import lombok.Data;

import java.util.HashSet;
import java.util.Set;
import java.util.UUID;

public class ProcessingMessageDTO {
    @Data
    public static class Result {
        private UUID itemId;
        private int version;
        private String status;
        private String errorCode;
        private Boolean retryable;
        private String imageUrl;
        private String objectKey;
        private String imageHash;
        private Metadata metadata;
    }

    @Data
    public static class Metadata {
        private Set<String> tags = new HashSet<>();
    }
}
