package com.wardrobe.service.processing;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.wardrobe.config.ProcessingQueueConfig;
import com.wardrobe.dto.ProcessingMessageDTO;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import software.amazon.awssdk.core.exception.ApiCallTimeoutException;
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.Message;
import software.amazon.awssdk.services.sqs.model.QueueDoesNotExistException;
import software.amazon.awssdk.services.sqs.model.ReceiveMessageRequest;

import java.util.List;

@Service
@RequiredArgsConstructor
@Slf4j
public class ProcessingQueueService {
    private final ProcessingQueueConfig config;
    private final SqsClient sqs;
    private final ObjectMapper objectMapper;
    private final ProcessingResultService processingResults;
    private volatile boolean missingQueueWarningLogged;

    /**
     * Long polls the processing result SQS queue, applies each completed result,
     * and deletes successfully processed messages.
     */
    @Scheduled(fixedDelayString = "${processing.result-poll-interval-ms:1000}")
    public void consumeResults() {
        if (!config.isEnabled() || isBlank(config.getResultQueueUrl())) return;
        List<Message> messages;
        try {
            messages = sqs.receiveMessage(ReceiveMessageRequest.builder()
                    .queueUrl(config.getResultQueueUrl())
                    .maxNumberOfMessages(10)
                    .waitTimeSeconds(20)
                    .build()).messages();
        } catch (ApiCallTimeoutException exception) {
            log.debug("Timed out polling the processing result queue; retrying on the next schedule");
            return;
        } catch (QueueDoesNotExistException exception) {
            if (!missingQueueWarningLogged) {
                log.warn("Processing result queue does not exist for configured URL {}; "
                                + "skipping result polling until the queue is available or configuration is fixed",
                        config.getResultQueueUrl(), exception);
                missingQueueWarningLogged = true;
            } else {
                log.debug("Processing result queue is still unavailable at {}", config.getResultQueueUrl());
            }
            return;
        } catch (RuntimeException exception) {
            log.error("Unable to poll processing result queue {}", config.getResultQueueUrl(), exception);
            return;
        }
        missingQueueWarningLogged = false;
        for (Message message : messages) {
            try {
                applyResult(objectMapper.readValue(message.body(), ProcessingMessageDTO.Result.class));
                sqs.deleteMessage(request -> request.queueUrl(config.getResultQueueUrl())
                        .receiptHandle(message.receiptHandle()));
            } catch (Exception ex) {
                log.error("Unable to consume processing result {}", message.messageId(), ex);
            }
        }
    }

    /**
     * Applies a completed processing result to the application.
     */
    public void applyResult(ProcessingMessageDTO.Result result) {
        processingResults.apply(result);
    }

    private boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
/*

Upload image
        ↓
PROCESSING
        ↓
Worker finishes
        ↓
Result sent to SQS
        ↓
ProcessingQueueService consumes result and delete message
        ↓
ProcessingResultService.apply(result)

Success: Status = READY
Failure: Status = FAILED, use original image, Stats = READY, processing error recorded
If no result, then SQS message, item stays processing, deadline expires, ProcessingRecoveryService recovers it
 */
