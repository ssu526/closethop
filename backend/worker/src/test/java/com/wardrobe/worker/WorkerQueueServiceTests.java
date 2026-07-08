package com.wardrobe.worker;

import org.junit.jupiter.api.Test;
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.Message;

import java.io.IOException;
import java.util.List;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class WorkerQueueServiceTests {
    @Test
    void publishesFailedResultAfterMaxReceiveCount() throws IOException {
        WorkerProperties properties = new WorkerProperties();
        properties.setProcessingQueueUrl("http://queue");
        properties.setMaxReceiveCountBeforeFailure(3);

        SqsClient sqsClient = mock(SqsClient.class);
        S3EventParser parser = mock(S3EventParser.class);
        ImageProcessingService imageProcessingService = mock(ImageProcessingService.class);
        ProcessingResultPublisher resultPublisher = mock(ProcessingResultPublisher.class);

        UUID userId = UUID.randomUUID();
        UUID itemId = UUID.randomUUID();
        ProcessingJob job = new ProcessingJob(userId, itemId, 2,
                "staging/%s/%s/2/source".formatted(userId, itemId));
        Message message = Message.builder()
                .messageId("message-1")
                .receiptHandle("receipt-1")
                .body("{\"Records\":[]}")
                .attributesWithStrings(java.util.Map.of("ApproximateReceiveCount", "3"))
                .build();

        when(sqsClient.receiveMessage(any(software.amazon.awssdk.services.sqs.model.ReceiveMessageRequest.class)))
                .thenReturn(software.amazon.awssdk.services.sqs.model.ReceiveMessageResponse.builder()
                        .messages(message)
                        .build());
        when(parser.jobsFromS3Event(message.body())).thenReturn(List.of(job));
        doThrow(new IllegalStateException("boom")).when(imageProcessingService).process(job);

        WorkerQueueService service = new WorkerQueueService(
                properties, sqsClient, parser, imageProcessingService, resultPublisher);

        service.consume();

        verify(resultPublisher).publish(argThat(result ->
                "FAILED".equals(result.getStatus())
                        && "PROCESSING_FAILED".equals(result.getErrorCode())
                        && itemId.equals(result.getItemId())
                        && result.getVersion() == 2));
        verify(sqsClient).deleteMessage(any(java.util.function.Consumer.class));
    }

    @Test
    void leavesMessageInQueueBeforeMaxReceiveCount() throws IOException {
        WorkerProperties properties = new WorkerProperties();
        properties.setProcessingQueueUrl("http://queue");
        properties.setMaxReceiveCountBeforeFailure(3);

        SqsClient sqsClient = mock(SqsClient.class);
        S3EventParser parser = mock(S3EventParser.class);
        ImageProcessingService imageProcessingService = mock(ImageProcessingService.class);
        ProcessingResultPublisher resultPublisher = mock(ProcessingResultPublisher.class);

        UUID userId = UUID.randomUUID();
        UUID itemId = UUID.randomUUID();
        ProcessingJob job = new ProcessingJob(userId, itemId, 2,
                "staging/%s/%s/2/source".formatted(userId, itemId));
        Message message = Message.builder()
                .messageId("message-1")
                .receiptHandle("receipt-1")
                .body("{\"Records\":[]}")
                .attributesWithStrings(java.util.Map.of("ApproximateReceiveCount", "2"))
                .build();

        when(sqsClient.receiveMessage(any(software.amazon.awssdk.services.sqs.model.ReceiveMessageRequest.class)))
                .thenReturn(software.amazon.awssdk.services.sqs.model.ReceiveMessageResponse.builder()
                        .messages(message)
                        .build());
        when(parser.jobsFromS3Event(message.body())).thenReturn(List.of(job));
        doThrow(new IllegalStateException("boom")).when(imageProcessingService).process(job);

        WorkerQueueService service = new WorkerQueueService(
                properties, sqsClient, parser, imageProcessingService, resultPublisher);

        service.consume();

        verify(resultPublisher, never()).publish(any());
        verify(sqsClient, never()).deleteMessage(any(java.util.function.Consumer.class));
    }
}
