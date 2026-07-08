package com.wardrobe.worker;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wardrobe.dto.ProcessingMessageDTO;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.services.sqs.SqsClient;

@Component
@RequiredArgsConstructor
public class ProcessingResultPublisher {
    private final SqsClient sqsClient;
    private final WorkerProperties workerProperties;
    private final ObjectMapper objectMapper;

    public void publish(ProcessingMessageDTO.Result result) {
        try {
            String messageBody = objectMapper.writeValueAsString(result);
            sqsClient.sendMessage(request -> request
                    .queueUrl(workerProperties.getResultQueueUrl())
                    .messageBody(messageBody));
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Unable to serialize processing result", exception);
        }
    }
}
