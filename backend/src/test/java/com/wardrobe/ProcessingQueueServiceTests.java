package com.wardrobe;

import com.wardrobe.config.ProcessingQueueConfig;
import com.wardrobe.service.processing.ProcessingQueueService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import software.amazon.awssdk.core.exception.ApiCallTimeoutException;
import software.amazon.awssdk.services.sqs.model.ReceiveMessageRequest;
import software.amazon.awssdk.services.sqs.model.QueueDoesNotExistException;
import software.amazon.awssdk.services.sqs.SqsClient;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

@SpringBootTest
class ProcessingQueueServiceTests {
    @Autowired private ProcessingQueueService processingQueueService;
    @MockitoBean private ProcessingQueueConfig processingQueueConfig;
    @MockitoBean private SqsClient sqsClient;

    @Test
    void timedOutQueuePollDoesNotCrashTheScheduler() {
        when(processingQueueConfig.isEnabled()).thenReturn(true);
        when(processingQueueConfig.getResultQueueUrl()).thenReturn("https://queue.example/test");
        when(sqsClient.receiveMessage(any(ReceiveMessageRequest.class)))
                .thenThrow(ApiCallTimeoutException.builder().message("timeout").build());

        assertDoesNotThrow(() -> processingQueueService.consumeResults());
    }

    @Test
    void missingQueueDoesNotCrashTheScheduler() {
        when(processingQueueConfig.isEnabled()).thenReturn(true);
        when(processingQueueConfig.getResultQueueUrl()).thenReturn("https://queue.example/missing");
        when(sqsClient.receiveMessage(any(ReceiveMessageRequest.class)))
                .thenThrow(QueueDoesNotExistException.builder().message("missing").build());

        assertDoesNotThrow(() -> processingQueueService.consumeResults());
    }
}
