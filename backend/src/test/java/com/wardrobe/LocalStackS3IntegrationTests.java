package com.wardrobe;

import com.wardrobe.service.aws.S3Service;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.HeadObjectRequest;
import software.amazon.awssdk.services.s3.model.S3Exception;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

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

    @Test
    void uploadsAndDeletesObjectUsingLocalStack() {
        UUID userId = UUID.randomUUID();
        String objectKey = "users/%s/original/%s.jpg".formatted(userId, UUID.randomUUID());
        s3Service.uploadBytes(objectKey, jpegBytes(), "image/jpeg");

        s3Client.headObject(HeadObjectRequest.builder()
                .bucket("closethop-images")
                .key(objectKey)
                .build());
        assertTrue(objectKey.startsWith("users/" + userId + "/original/"));
        assertTrue(objectKey.endsWith(".jpg"));

        s3Service.deleteFile(objectKey);

        assertThrows(S3Exception.class, () ->
                s3Client.headObject(HeadObjectRequest.builder()
                        .bucket("closethop-images")
                        .key(objectKey)
                        .build()));
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
