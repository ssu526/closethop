package com.wardrobe.worker;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "worker")
@Data
public class WorkerProperties {
    private boolean enabled = true;
    private String processingQueueUrl;
    private String resultQueueUrl;
    private String region = "us-east-1";
    private String endpoint;
    private String accessKey;
    private String secretKey;
    private String publicUrl = "";
    private int maxMessagesPerPoll = 1;
    private int waitTimeSeconds = 20;
    private String imageProcessorBaseUrl = "http://localhost:8080";
    private long imageProcessorTimeoutMs = 180000;
    private int maxReceiveCountBeforeFailure = 3;
}
