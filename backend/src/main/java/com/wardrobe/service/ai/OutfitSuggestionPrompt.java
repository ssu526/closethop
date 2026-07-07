package com.wardrobe.service.ai;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

@Component
public class OutfitSuggestionPrompt {
    static final String INPUT_PLACEHOLDER = "{recommendation_input_json}";

    private final String template;

    public OutfitSuggestionPrompt(
            @Value("${ai.outfit.prompt-path:classpath:prompts/outfit_suggestion_prompt.txt}") String promptPath) {
        try {
            template = readTemplate(promptPath).strip();
        } catch (IOException exception) {
            throw new IllegalStateException(
                    "Unable to read outfit suggestion prompt: " + promptPath,
                    exception);
        }

        int first = template.indexOf(INPUT_PLACEHOLDER);
        int last = template.lastIndexOf(INPUT_PLACEHOLDER);
        if (first < 0 || first != last) {
            throw new IllegalStateException(
                    "Outfit suggestion prompt must contain exactly one "
                            + INPUT_PLACEHOLDER + " placeholder");
        }
    }

    private static String readTemplate(String promptPath) throws IOException {
        String classpathPrefix = "classpath:";
        if (promptPath.startsWith(classpathPrefix)) {
            String resourcePath = promptPath.substring(classpathPrefix.length());
            return new ClassPathResource(resourcePath)
                    .getContentAsString(StandardCharsets.UTF_8);
        }
        return Files.readString(Path.of(promptPath));
    }

    public String render(String recommendationInputJson) {
        return template.replace(INPUT_PLACEHOLDER, recommendationInputJson);
    }
}
