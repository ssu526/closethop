package com.wardrobe.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "ai.outfit")
@Data
public class OutfitAiConfig {
    private String provider;
    private String apiKey;
    private String model;
    private int maxCandidates;
    private int maxPromptBytes;
    private int maxSuggestions;
    private Bulkhead bulkhead;
    private Retry retry;
    private CircuitBreaker circuitBreaker;

    @Data
    public static class Bulkhead {
        private int maxConcurrentRequests;
        private long acquireTimeoutMs;
    }

    @Data
    public static class Retry {
        private int maxAttempts;
        private long backoffMinMs;
        private long backoffJitterMs;
    }

    @Data
    public static class CircuitBreaker {
        private int failureThreshold;
        private long openDurationMs;
    }
}
