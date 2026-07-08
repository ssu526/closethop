package com.wardrobe.worker;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class S3EventParserTests {
    private final S3EventParser parser = new S3EventParser(new ObjectMapper());

    @Test
    void parsesSingleS3Record() throws IOException {
        String userId = UUID.randomUUID().toString();
        String itemId = UUID.randomUUID().toString();
        String body = """
                {"Records":[{"s3":{"object":{"key":"staging/%s/%s/2/source"}}}]}
                """.formatted(userId, itemId);

        List<ProcessingJob> jobs = parser.jobsFromS3Event(body);

        assertEquals(1, jobs.size());
        assertEquals(UUID.fromString(userId), jobs.get(0).userId());
        assertEquals(UUID.fromString(itemId), jobs.get(0).itemId());
        assertEquals(2, jobs.get(0).version());
    }

    @Test
    void rejectsInvalidStagingKey() {
        assertThrows(IllegalArgumentException.class,
                () -> parser.jobFromSourceKey("users/not-a-staging-key"));
    }

    @Test
    void unwrapsNestedMessagePayload() throws IOException {
        String userId = UUID.randomUUID().toString();
        String itemId = UUID.randomUUID().toString();
        String body = """
                {"Message":"{\\"Records\\":[{\\"s3\\":{\\"object\\":{\\"key\\":\\"staging/%s/%s/2/source\\"}}}]}"}
                """.formatted(userId, itemId);

        List<ProcessingJob> jobs = parser.jobsFromS3Event(body);

        assertEquals(1, jobs.size());
        assertEquals(UUID.fromString(userId), jobs.get(0).userId());
    }

    @Test
    void ignoresS3TestEvent() throws IOException {
        List<ProcessingJob> jobs = parser.jobsFromS3Event("""
                {"Service":"Amazon S3","Event":"s3:TestEvent"}
                """);

        assertEquals(0, jobs.size());
    }
}
