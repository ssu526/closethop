package com.wardrobe.service.aws;

import com.wardrobe.config.S3Properties;
import com.wardrobe.entity.ClothingItem;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.GetObjectPresignRequest;

import java.time.Duration;

@Service
@RequiredArgsConstructor
public class ImageAccessService {
    private final S3Presigner presigner;
    private final S3Properties config;

    // generating a pre-signed S3 URL
    public String urlFor(ClothingItem item) {
        if (item.getS3ObjectKey() == null || item.getS3ObjectKey().isBlank()) {
            return null;
        }
        GetObjectRequest getObject = GetObjectRequest.builder()
                .bucket(config.getBucketName())
                .key(item.getS3ObjectKey())
                .build();
        return presigner.presignGetObject(GetObjectPresignRequest.builder()
                        .signatureDuration(Duration.ofMinutes(config.getSignedUrlMinutes()))
                        .getObjectRequest(getObject)
                        .build())
                .url()
                .toString();
    }
}
