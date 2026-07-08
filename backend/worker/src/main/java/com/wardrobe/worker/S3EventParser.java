package com.wardrobe.worker;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Component
@RequiredArgsConstructor
public class S3EventParser {
    private final ObjectMapper objectMapper;

    public List<ProcessingJob> jobsFromS3Event(String body) throws IOException {
        JsonNode event = unwrapEvent(objectMapper.readTree(body));
        if (isTestEvent(event)) {
            return List.of();
        }
        JsonNode records = event.path("Records");
        if (!records.isArray() || records.isEmpty()) {
            throw new IllegalArgumentException("EXPECTED_S3_RECORDS");
        }

        List<ProcessingJob> jobs = new ArrayList<>();
        for (JsonNode record : records) {
            String rawKey = record.path("s3").path("object").path("key").asText();
            if (rawKey == null || rawKey.isBlank()) {
                throw new IllegalArgumentException("MISSING_S3_KEY");
            }
            jobs.add(jobFromSourceKey(URLDecoder.decode(rawKey, StandardCharsets.UTF_8)));
        }
        return jobs;
    }

    private JsonNode unwrapEvent(JsonNode event) throws IOException {
        JsonNode message = event.path("Message");
        if (!message.isTextual()) {
            return event;
        }

        String nested = message.asText();
        if (nested == null || nested.isBlank()) {
            return event;
        }

        JsonNode nestedEvent = objectMapper.readTree(nested);
        return nestedEvent == null ? event : nestedEvent;
    }

    private boolean isTestEvent(JsonNode event) {
        return "s3:TestEvent".equals(event.path("Event").asText(null));
    }

    ProcessingJob jobFromSourceKey(String sourceKey) {
        String[] parts = sourceKey.split("/");
        if (parts.length != 5 || !"staging".equals(parts[0]) || !"source".equals(parts[4])) {
            throw new IllegalArgumentException("INVALID_STAGING_KEY");
        }
        return new ProcessingJob(
                UUID.fromString(parts[1]),
                UUID.fromString(parts[2]),
                Integer.parseInt(parts[3]),
                sourceKey
        );
    }
}
