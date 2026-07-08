package com.wardrobe.worker;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wardrobe.dto.ProcessingMessageDTO;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

@Service
public class ImageProcessingService {
    private final WorkerProperties workerProperties;
    private final ProcessingResultPublisher resultPublisher;
    private final ObjectMapper objectMapper;
    private final HttpClient httpClient;

    @Autowired
    public ImageProcessingService(
            WorkerProperties workerProperties,
            ProcessingResultPublisher resultPublisher,
            ObjectMapper objectMapper) {
        this(workerProperties, resultPublisher, objectMapper, HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(5))
                .build());
    }

    ImageProcessingService(
            WorkerProperties workerProperties,
            ProcessingResultPublisher resultPublisher,
            ObjectMapper objectMapper,
            HttpClient httpClient) {
        this.workerProperties = workerProperties;
        this.resultPublisher = resultPublisher;
        this.objectMapper = objectMapper;
        this.httpClient = httpClient;
    }

    public void process(ProcessingJob job) {
        ProcessingMessageDTO.Result result = invokeProcessor(job);
        result.setItemId(job.itemId());
        result.setVersion(job.version());
        if (result.getStatus() == null || result.getStatus().isBlank()) {
            throw new IllegalStateException("Image processor returned no status");
        }
        resultPublisher.publish(result);
    }

    private ProcessingMessageDTO.Result invokeProcessor(ProcessingJob job) {
        URI endpoint = URI.create(workerProperties.getImageProcessorBaseUrl().replaceAll("/+$", "") + "/process");
        HttpRequest request;
        try {
            request = HttpRequest.newBuilder(endpoint)
                    .header("Content-Type", "application/json")
                    .timeout(Duration.ofMillis(workerProperties.getImageProcessorTimeoutMs()))
                    .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(job)))
                    .build();
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Unable to serialize processing job", exception);
        }

        HttpResponse<String> response;
        try {
            response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Interrupted while calling image processor", exception);
        } catch (IOException exception) {
            throw new IllegalStateException("Unable to call image processor", exception);
        }

        if (response.statusCode() / 100 != 2) {
            throw new IllegalStateException("Image processor returned HTTP " + response.statusCode());
        }

        try {
            return objectMapper.readValue(response.body(), ProcessingMessageDTO.Result.class);
        } catch (IOException exception) {
            throw new IllegalStateException("Unable to parse image processor response", exception);
        }
    }
}
