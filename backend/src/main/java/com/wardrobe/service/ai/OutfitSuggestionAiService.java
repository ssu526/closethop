package com.wardrobe.service.ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wardrobe.config.OutfitAiConfig;
import com.wardrobe.entity.ClothingItem;
import com.wardrobe.exception.WardrobeException;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.nio.charset.StandardCharsets;

@Service
@Slf4j
public class OutfitSuggestionAiService {
    private final ObjectMapper objectMapper;
    private final OutfitSuggestionPrompt outfitSuggestionPrompt;
    private final RestClient geminiRestClient;
    private final MeterRegistry meterRegistry;
    private final AtomicInteger consecutiveFailures = new AtomicInteger();
    private final AtomicLong circuitOpenUntil = new AtomicLong();
    private final OutfitAiConfig config;
    private final Semaphore permits;

    public OutfitSuggestionAiService(
            ObjectMapper objectMapper,
            OutfitSuggestionPrompt outfitSuggestionPrompt,
            RestClient geminiRestClient,
            MeterRegistry meterRegistry,
            OutfitAiConfig config
    ) {
        this.objectMapper = objectMapper;
        this.outfitSuggestionPrompt = outfitSuggestionPrompt;
        this.geminiRestClient = geminiRestClient;
        this.meterRegistry = meterRegistry;
        this.config = config;
        this.permits = new Semaphore(config.getBulkhead().getMaxConcurrentRequests());
    }

    public List<UUID> select(
            List<ClothingItem> outfitItems,
            List<ClothingItem> candidates,
            String requestedCategory) {
        if (candidates.size() <= config.getMaxSuggestions()) {
            return candidates.stream()
                    .map(ClothingItem::getId)
                    .toList();
        }

        // fake ai for local development, select the candidate with most overlapping tags
        if ("fake".equalsIgnoreCase(config.getProvider())) {
            Set<String> outfitTags = outfitItems.stream()
                    .flatMap(item -> item.getTags().stream())
                    .map(String::toLowerCase)
                    .collect(java.util.stream.Collectors.toSet());
            return candidates.stream()
                    .sorted(Comparator
                            .comparingLong((ClothingItem item) -> item.getTags().stream()
                                    .map(String::toLowerCase)
                                    .filter(outfitTags::contains)
                                    .count())
                            .reversed()
                            .thenComparing(item -> item.getId().toString()))
                    .limit(config.getMaxSuggestions())
                    .map(ClothingItem::getId)
                    .toList();
        }
        if (!"gemini".equalsIgnoreCase(config.getProvider()) || config.getApiKey().isBlank()) {
            throw unavailable("Outfit suggestion AI is not configured");
        }

        try {
            Map<String, Object> recommendationInput = Map.of(
                    "outfitItems", outfitItems.stream().map(this::itemMetadata).toList(),
                    "requestedCategory", requestedCategory,
                    "candidates", candidates.stream().map(this::itemMetadata).toList()
            );
            if (candidates.size() > config.getMaxCandidates()) {
                throw new WardrobeException(
                        "Too many candidate items for one AI request",
                        HttpStatus.UNPROCESSABLE_ENTITY,
                        "AI_CANDIDATE_LIMIT");
            }
            String recommendationJson = objectMapper.writeValueAsString(recommendationInput);
            String prompt = outfitSuggestionPrompt.render(recommendationJson);
            if (prompt.getBytes(StandardCharsets.UTF_8).length > config.getMaxPromptBytes()) {
                throw new WardrobeException(
                        "Outfit metadata is too large for one AI request",
                        HttpStatus.UNPROCESSABLE_ENTITY,
                        "AI_PROMPT_TOO_LARGE");
            }

            Map<String, Object> schema = Map.of(
                    "type", "object",
                    "properties", Map.of(
                            "clothingItemIds", Map.of(
                                    "type", "array",
                                    "items", Map.of("type", "string"),
                                    "maxItems", config.getMaxSuggestions()
                            )
                    ),
                    "required", List.of("clothingItemIds")
            );
            Map<String, Object> request = geminiRequest(prompt, schema);

            String response = callGemini(request);
            JsonNode root = objectMapper.readTree(response);
            String json = root.path("candidates").path(0).path("content").path("parts").path(0).path("text").asText();
            JsonNode ids = objectMapper.readTree(json).path("clothingItemIds");
            Set<UUID> candidateIds = candidates.stream()
                    .map(ClothingItem::getId)
                    .collect(java.util.stream.Collectors.toSet());
            return validateSuggestions(ids, candidateIds, config.getMaxSuggestions());
        } catch (WardrobeException exception) {
            throw exception;
        } catch (Exception exception) {
            log.warn("Outfit AI suggestion failed model={} requestedCategory={} candidates={}",
                    config.getModel(), requestedCategory, candidates.size(), exception);
            throw unavailable("AI could not generate outfit suggestions");
        }
    }

    private Map<String, Object> itemMetadata(ClothingItem item) {
        return Map.of(
                "id", item.getId().toString(),
                "category", item.getCategory().toString(),
                "tags", item.getTags()
        );
    }

    static Map<String, Object> geminiRequest(String prompt, Map<String, Object> schema) {
        return Map.of(
                "contents", List.of(Map.of("parts", List.of(Map.of("text", prompt)))),
                "generationConfig", Map.of(
                        "temperature", 0,
                        "responseMimeType", "application/json",
                        "responseJsonSchema", schema
                )
        );
    }

    static List<UUID> validateSuggestions(JsonNode ids, Set<UUID> candidateIds, int maxSuggestions) {
        LinkedHashSet<UUID> validated = new LinkedHashSet<>();
        if (ids.isArray()) {
            for (JsonNode id : ids) {
                UUID value = UUID.fromString(id.asText());
                if (!candidateIds.contains(value)) {
                    throw new IllegalArgumentException("AI returned an invalid clothing item");
                }
                validated.add(value);
                if (validated.size() == maxSuggestions) break;
            }
        }
        return List.copyOf(validated);
    }

    private WardrobeException unavailable(String message) {
        return new WardrobeException(message, HttpStatus.BAD_GATEWAY, "OUTFIT_AI_UNAVAILABLE");
    }

    private String callGemini(Map<String, Object> request) {
        long now = System.currentTimeMillis();
        if (circuitOpenUntil.get() > now) {
            meterRegistry.counter("wardrobe.ai.requests", "outcome", "circuit_open").increment();
            throw new WardrobeException(
                    "Outfit suggestion AI is temporarily unavailable",
                    HttpStatus.SERVICE_UNAVAILABLE,
                    "OUTFIT_AI_CIRCUIT_OPEN");
        }
        boolean acquired;
        try {
            acquired = permits.tryAcquire(config.getBulkhead().getAcquireTimeoutMs(), TimeUnit.MILLISECONDS);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw unavailable("AI request was interrupted");
        }
        if (!acquired) {
            meterRegistry.counter("wardrobe.ai.requests", "outcome", "bulkhead_rejected").increment();
            throw new WardrobeException(
                    "Too many outfit suggestion requests",
                    HttpStatus.TOO_MANY_REQUESTS,
                    "OUTFIT_AI_BUSY");
        }
        Timer.Sample sample = Timer.start(meterRegistry);
        try {
            for (int attempt = 0; attempt < config.getRetry().getMaxAttempts(); attempt++) {
                try {
                    String response = geminiRestClient.post()
                            .uri("/v1beta/models/{model}:generateContent", config.getModel())
                            .header("x-goog-api-key", config.getApiKey())
                            .body(request)
                            .retrieve()
                            .body(String.class);
                    consecutiveFailures.set(0);
                    meterRegistry.counter("wardrobe.ai.requests", "outcome", "success").increment();
                    return response;
                } catch (RestClientException exception) {
                    log.warn("Gemini outfit suggestion request failed attempt={} model={}",
                            attempt + 1, config.getModel(), exception);
                    if (attempt < config.getRetry().getMaxAttempts() - 1)  {
                        try {
                            Thread.sleep(config.getRetry().getBackoffMinMs() + (long) (Math.random() * config.getRetry().getBackoffJitterMs()));
                        } catch (InterruptedException interrupted) {
                            Thread.currentThread().interrupt();
                            break;
                        }
                    }
                }
            }
            if (consecutiveFailures.incrementAndGet() >= config.getCircuitBreaker().getFailureThreshold()) {
                circuitOpenUntil.set(System.currentTimeMillis() + config.getCircuitBreaker().getOpenDurationMs());
                consecutiveFailures.set(0);
            }
            meterRegistry.counter("wardrobe.ai.requests", "outcome", "failure").increment();
            throw unavailable("AI could not generate outfit suggestions");
        } finally {
            permits.release();
            sample.stop(meterRegistry.timer("wardrobe.ai.latency"));
        }
    }
}
