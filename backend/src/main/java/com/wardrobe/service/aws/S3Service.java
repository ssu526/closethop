package com.wardrobe.service.aws;

import com.wardrobe.config.S3Properties;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.PutObjectPresignRequest;

import java.io.ByteArrayInputStream;
import java.time.Duration;

@Service
@RequiredArgsConstructor
@Slf4j
public class S3Service {
    private final S3Client s3Client;
    private final S3Presigner presigner;
    private final S3Properties s3Config;

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

    public String presignedPutUrl(String objectKey, String contentType) {
        PutObjectRequest putRequest = PutObjectRequest.builder()
                .bucket(s3Config.getBucketName())
                .key(objectKey)
                .contentType(contentType)
                .build();
        return presigner.presignPutObject(PutObjectPresignRequest.builder()
                        .signatureDuration(Duration.ofMinutes(s3Config.getSignedUrlMinutes()))
                        .putObjectRequest(putRequest)
                        .build())
                .url()
                .toString();
    }

    public void deleteFile(String objectKey){
        DeleteObjectRequest deleteRequest = DeleteObjectRequest.builder()
                .bucket(s3Config.getBucketName())
                .key(objectKey)
                .build();
        s3Client.deleteObject(deleteRequest);
        log.info("File deleted successfully: {}", objectKey);
    }

}
