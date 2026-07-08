package com.wardrobe;

import com.wardrobe.service.aws.S3Service;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.mock.web.MockMultipartFile;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.HeadObjectRequest;
import software.amazon.awssdk.services.s3.model.S3Exception;
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.Message;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.assertFalse;

@SpringBootTest(properties = {
        "aws.s3.bucket-name=closethop-images",
        "aws.s3.endpoint=http://localhost:4566"
})
@EnabledIfEnvironmentVariable(named = "RUN_LOCALSTACK_TESTS", matches = "true")
class LocalStackS3IntegrationTests {
    @Autowired
    private S3Service s3Service;

    @Autowired
    private S3Client s3Client;

    @Autowired
    private SqsClient sqsClient;

    @Test
    void uploadsAndDeletesObjectUsingLocalStack() {
        MockMultipartFile file = new MockMultipartFile(
                "image",
                "closethop-image",
                "image/jpeg",
                jpegBytes()
        );

        UUID userId = UUID.randomUUID();
        String objectKey = s3Service.uploadFile(file, userId);

        s3Client.headObject(HeadObjectRequest.builder()
                .bucket("closethop-images")
                .key(objectKey)
                .build());
        assertTrue(objectKey.startsWith("users/" + userId + "/clothing/"));
        assertTrue(objectKey.endsWith(".jpg"));

        s3Service.deleteFile(objectKey);

        assertThrows(S3Exception.class, () ->
                s3Client.headObject(HeadObjectRequest.builder()
                        .bucket("closethop-images")
                        .key(objectKey)
                        .build()));
    }

    @Test
    void stagingUploadPublishesS3NotificationToProcessingQueue() {
        String queueUrl = sqsClient.getQueueUrl(request ->
                request.queueName("closethop-image-processing")).queueUrl();
        String key = "staging/" + UUID.randomUUID() + "/" + UUID.randomUUID() + "/1/source";
        s3Service.uploadBytes(key, "image data".getBytes(StandardCharsets.UTF_8), "image/jpeg");

        java.util.List<Message> messages = sqsClient.receiveMessage(request -> request
                .queueUrl(queueUrl)
                .maxNumberOfMessages(10)
                .waitTimeSeconds(5)).messages();

        Message notification = messages.stream()
                .filter(message -> message.body().contains(key))
                .findFirst().orElse(null);
        assertFalse(messages.isEmpty());
        assertTrue(notification != null);
        sqsClient.deleteMessage(request -> request.queueUrl(queueUrl)
                .receiptHandle(notification.receiptHandle()));
        s3Service.deleteFile(key);
    }

    private byte[] jpegBytes() {
        try {
            BufferedImage image = new BufferedImage(2, 2, BufferedImage.TYPE_INT_RGB);
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            ImageIO.write(image, "jpg", bytes);
            return bytes.toByteArray();
        } catch (Exception exception) {
            throw new IllegalStateException("Unable to create test image", exception);
        }
    }
}
