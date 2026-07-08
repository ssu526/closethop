package com.wardrobe.worker;

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
public class WorkerQueueService {
    private final WorkerProperties workerProperties;
    private final SqsClient sqsClient;
    private final S3EventParser parser;
    private final ImageProcessingService processingService;
    private final ProcessingResultPublisher resultPublisher;
    private volatile boolean missingQueueWarningLogged;

    @Scheduled(fixedDelayString = "${worker.poll-interval-ms:1000}")
    public void consume() {
        if (!workerProperties.isEnabled()
                || workerProperties.getProcessingQueueUrl() == null
                || workerProperties.getProcessingQueueUrl().isBlank()) {
            return;
        }

        List<Message> messages;
        try {
            messages = sqsClient.receiveMessage(ReceiveMessageRequest.builder()
                    .queueUrl(workerProperties.getProcessingQueueUrl())
                    .maxNumberOfMessages(workerProperties.getMaxMessagesPerPoll())
                    .waitTimeSeconds(workerProperties.getWaitTimeSeconds())
                    .attributeNamesWithStrings("ApproximateReceiveCount")
                    .build()).messages();
        } catch (ApiCallTimeoutException exception) {
            log.debug("Timed out polling the processing queue; retrying on the next schedule");
            return;
        } catch (QueueDoesNotExistException exception) {
            if (!missingQueueWarningLogged) {
                log.warn("Processing queue does not exist for configured URL {}; "
                                + "skipping processing until the queue is available or configuration is fixed",
                        workerProperties.getProcessingQueueUrl(), exception);
                missingQueueWarningLogged = true;
            }
            return;
        } catch (RuntimeException exception) {
            log.error("Unable to poll processing queue {}", workerProperties.getProcessingQueueUrl(), exception);
            return;
        }

        missingQueueWarningLogged = false;
        for (Message message : messages) {
            ProcessingJob currentJob = null;
            try {
                List<ProcessingJob> jobs = parser.jobsFromS3Event(message.body());
                if (jobs.isEmpty()) {
                    log.debug("Ignoring non-processing S3 notification {}", message.messageId());
                    delete(message);
                    continue;
                }
                for (ProcessingJob job : jobs) {
                    currentJob = job;
                    processingService.process(job);
                }
                delete(message);
            } catch (IllegalArgumentException malformed) {
                log.warn("Discarding malformed S3 notification {}", message.messageId(), malformed);
                delete(message);
            } catch (Exception exception) {
                if (currentJob != null && receiveCount(message) >= workerProperties.getMaxReceiveCountBeforeFailure()) {
                    log.error("Processing failed permanently for queue message {}", message.messageId(), exception);
                    resultPublisher.publish(failureResult(currentJob));
                    delete(message);
                    continue;
                }
                log.error("Unable to process queue message {}", message.messageId(), exception);
            }
        }
    }

    private ProcessingMessageDTO.Result failureResult(ProcessingJob job) {
        ProcessingMessageDTO.Metadata metadata = new ProcessingMessageDTO.Metadata();
        ProcessingMessageDTO.Result result = new ProcessingMessageDTO.Result();
        result.setItemId(job.itemId());
        result.setVersion(job.version());
        result.setStatus("FAILED");
        result.setErrorCode("PROCESSING_FAILED");
        result.setObjectKey(job.sourceKey());
        result.setMetadata(metadata);
        return result;
    }

    private int receiveCount(Message message) {
        try {
            return Integer.parseInt(message.attributesAsStrings().getOrDefault("ApproximateReceiveCount", "1"));
        } catch (NumberFormatException exception) {
            return 1;
        }
    }

    private void delete(Message message) {
        sqsClient.deleteMessage(request -> request
                .queueUrl(workerProperties.getProcessingQueueUrl())
                .receiptHandle(message.receiptHandle()));
    }
}
