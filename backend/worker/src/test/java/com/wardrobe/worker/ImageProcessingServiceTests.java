package com.wardrobe.worker;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.wardrobe.dto.ProcessingMessageDTO;
import org.junit.jupiter.api.Test;

import java.net.http.HttpClient;
import java.net.http.HttpResponse;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ImageProcessingServiceTests {
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void publishesReadyResultFromPythonProcessor() throws Exception {
        ProcessingResultPublisher publisher = mock(ProcessingResultPublisher.class);
        WorkerProperties properties = new WorkerProperties();
        properties.setImageProcessorBaseUrl("http://image-processor:8080");
        properties.setImageProcessorTimeoutMs(5_000);
        HttpClient httpClient = mock(HttpClient.class);
        @SuppressWarnings("unchecked")
        HttpResponse<String> response = mock(HttpResponse.class);
        when(response.statusCode()).thenReturn(200);
        when(response.body()).thenReturn("""
                {"status":"READY","objectKey":"users/output.webp","imageHash":"abc123","metadata":{"tags":["blue"]}}
                """);
        when(httpClient.send(any(), any(HttpResponse.BodyHandler.class))).thenReturn(response);

        ImageProcessingService service = new ImageProcessingService(properties, publisher, objectMapper, httpClient);
        UUID userId = UUID.randomUUID();
        UUID itemId = UUID.randomUUID();

        service.process(new ProcessingJob(userId, itemId, 3, "staging/%s/%s/3/source".formatted(userId, itemId)));

        var resultCaptor = org.mockito.ArgumentCaptor.forClass(ProcessingMessageDTO.Result.class);
        verify(publisher).publish(resultCaptor.capture());
        ProcessingMessageDTO.Result result = resultCaptor.getValue();
        org.junit.jupiter.api.Assertions.assertEquals("READY", result.getStatus());
        org.junit.jupiter.api.Assertions.assertEquals(itemId, result.getItemId());
        org.junit.jupiter.api.Assertions.assertEquals(3, result.getVersion());
        org.junit.jupiter.api.Assertions.assertEquals("users/output.webp", result.getObjectKey());
    }

    @Test
    void throwsWhenPythonProcessorReturnsServerError() throws Exception {
        ProcessingResultPublisher publisher = mock(ProcessingResultPublisher.class);
        WorkerProperties properties = new WorkerProperties();
        properties.setImageProcessorBaseUrl("http://image-processor:8080");
        properties.setImageProcessorTimeoutMs(5_000);
        HttpClient httpClient = mock(HttpClient.class);
        @SuppressWarnings("unchecked")
        HttpResponse<String> response = mock(HttpResponse.class);
        when(response.statusCode()).thenReturn(500);
        when(response.body()).thenReturn("""
                {"error":"PROCESSING_UNAVAILABLE"}
                """);
        when(httpClient.send(any(), any(HttpResponse.BodyHandler.class))).thenReturn(response);

        ImageProcessingService service = new ImageProcessingService(properties, publisher, objectMapper, httpClient);
        UUID userId = UUID.randomUUID();
        UUID itemId = UUID.randomUUID();

        assertThrows(IllegalStateException.class,
                () -> service.process(new ProcessingJob(userId, itemId, 3,
                        "staging/%s/%s/3/source".formatted(userId, itemId))));
    }
}
