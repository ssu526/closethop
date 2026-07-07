package com.wardrobe.service.aws;

import com.wardrobe.config.S3Config;
import com.wardrobe.exception.ValidationException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest;
import software.amazon.awssdk.services.s3.model.CopyObjectRequest;
import software.amazon.awssdk.services.s3.model.HeadObjectRequest;
import software.amazon.awssdk.services.s3.model.S3Exception;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.model.ListObjectsV2Request;

import java.io.IOException;
import java.io.ByteArrayInputStream;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Slf4j
public class S3Service {
    private final S3Client s3Client;
    private final S3Config s3Config;

    public String uploadFile(MultipartFile file, UUID userId){
        byte[] bytes = readBytes(file);
        ImageSniffer.DetectedImage detected = ImageSniffer.detect(bytes);
        if (detected == null) {
            throw new ValidationException("Only JPEG, PNG, GIF, and WebP images are supported");
        }
        String extension = detected.extension();
        String objectKey = String.format("users/%s/clothing/%s%s",
                userId, UUID.randomUUID(), extension);

        try{
            PutObjectRequest putRequest = PutObjectRequest.builder()
                    .bucket(s3Config.getBucketName())
                    .key(objectKey)
                    .contentType(detected.contentType())
                    .build();

            s3Client.putObject(putRequest, RequestBody.fromBytes(bytes));
            log.info("File uploaded successfully: {}", objectKey);
            return objectKey;
        } catch (S3Exception exception) {
            log.error("Failed to upload file to S3", exception);
            throw exception;
        }
    }

    public void uploadBytes(String objectKey, byte[] bytes, String contentType) {
        PutObjectRequest putRequest = PutObjectRequest.builder()
                .bucket(s3Config.getBucketName())
                .key(objectKey)
                .contentType(contentType)
                .build();
        s3Client.putObject(putRequest, RequestBody.fromInputStream(
                new ByteArrayInputStream(bytes), bytes.length));
        log.info("File uploaded successfully: {}", objectKey);
    }

    public void deleteFile(String objectKey){
        DeleteObjectRequest deleteRequest = DeleteObjectRequest.builder()
                .bucket(s3Config.getBucketName())
                .key(objectKey)
                .build();
        s3Client.deleteObject(deleteRequest);
        log.info("File deleted successfully: {}", objectKey);
    }

    public String promoteOriginal(String sourceKey, UUID userId, UUID itemId) {
        return promoteOriginal(sourceKey, userId, itemId, 1);
    }

    public String promoteOriginal(String sourceKey, UUID userId, UUID itemId, int version) {
        String destinationKey = String.format(
                "users/%s/clothing/%s/%d/original", userId, itemId, version);
        try {
            s3Client.headObject(HeadObjectRequest.builder()
                    .bucket(s3Config.getBucketName())
                    .key(sourceKey)
                    .build());
            s3Client.copyObject(CopyObjectRequest.builder()
                    .sourceBucket(s3Config.getBucketName())
                    .sourceKey(sourceKey)
                    .destinationBucket(s3Config.getBucketName())
                    .destinationKey(destinationKey)
                    .build());
            return destinationKey;
        } catch (S3Exception exception) {
            if (exception.statusCode() == 404) {
                throw new IllegalStateException("The original image is unavailable", exception);
            }
            throw exception;
        }
    }

    public List<StoredObject> listStagingObjects() {
        return s3Client.listObjectsV2Paginator(ListObjectsV2Request.builder()
                        .bucket(s3Config.getBucketName())
                        .prefix("staging/")
                        .build())
                .contents().stream()
                .map(object -> new StoredObject(object.key(), object.lastModified()))
                .toList();
    }

    public record StoredObject(String key, Instant lastModified) {}

    private byte[] readBytes(MultipartFile file) {
        try {
            return file.getBytes();
        } catch (IOException exception) {
            log.error("Failed to read uploaded file", exception);
            throw new RuntimeException("Failed to read uploaded file", exception);
        }
    }
}
