package com.wardrobe.service.ai;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class OutfitSuggestionPromptTests {
    @TempDir
    Path tempDirectory;

    @Test
    void loadsClasspathPromptAndRendersRecommendationInput() {
        OutfitSuggestionPrompt prompt =
                new OutfitSuggestionPrompt("classpath:prompts/outfit_suggestion_prompt.txt");
        String input = "{\"requestedCategory\":\"BOTTOMS\"}";

        assertTrue(prompt.render(input).contains(input));
        assertFalse(prompt.render(input).contains(OutfitSuggestionPrompt.INPUT_PLACEHOLDER));
    }

    @Test
    void rejectsMissingOrDuplicateInputPlaceholders() throws Exception {
        Path missing = tempDirectory.resolve("missing.txt");
        Files.writeString(missing, "No input marker");
        Path duplicate = tempDirectory.resolve("duplicate.txt");
        Files.writeString(duplicate, "{recommendation_input_json} {recommendation_input_json}");

        assertThrows(IllegalStateException.class, () -> new OutfitSuggestionPrompt(missing.toString()));
        assertThrows(IllegalStateException.class, () -> new OutfitSuggestionPrompt(duplicate.toString()));
        assertThrows(IllegalStateException.class, () ->
                new OutfitSuggestionPrompt(tempDirectory.resolve("not-found.txt").toString()));
    }

    @Test
    @SuppressWarnings("unchecked")
    void buildsGeminiGenerateContentStructuredOutputRequest() {
        Map<String, Object> schema = Map.of("type", "object");

        Map<String, Object> request = OutfitSuggestionAiService.geminiRequest("pick one", schema);

        Map<String, Object> generationConfig = (Map<String, Object>) request.get("generationConfig");
        assertEquals(0, generationConfig.get("temperature"));
        assertFalse(generationConfig.containsKey("responseFormat"));
        assertEquals("application/json", generationConfig.get("responseMimeType"));
        assertEquals(schema, generationConfig.get("responseJsonSchema"));
    }

    @Test
    void validatesDeduplicatesCapsAndAllowsEmptyModelSuggestions() throws Exception {
        ObjectMapper mapper = new ObjectMapper();
        UUID first = UUID.randomUUID();
        UUID second = UUID.randomUUID();
        UUID third = UUID.randomUUID();
        UUID fourth = UUID.randomUUID();
        var ids = mapper.readTree(mapper.writeValueAsString(
                List.of(first, first, second, third, fourth)));

        assertEquals(
                List.of(first, second, third),
                OutfitSuggestionAiService.validateSuggestions(
                        ids, Set.of(first, second, third, fourth), 3));

        var empty = mapper.readTree(mapper.writeValueAsString(List.of()));
        assertEquals(List.of(), OutfitSuggestionAiService.validateSuggestions(empty, Set.of(first), 3));

        UUID invented = UUID.randomUUID();
        var invalid = mapper.readTree(mapper.writeValueAsString(List.of(invented)));
        assertThrows(IllegalArgumentException.class, () ->
                OutfitSuggestionAiService.validateSuggestions(invalid, Set.of(first), 3));
    }
}
