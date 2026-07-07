package com.wardrobe.service.wardrobe;

import com.wardrobe.constants.Enums;
import com.wardrobe.dto.ClothingItemDTO;
import com.wardrobe.entity.ClothingItem;
import com.wardrobe.entity.User;
import com.wardrobe.exception.ForbiddenException;
import com.wardrobe.exception.DuplicateClothingItemException;
import com.wardrobe.exception.ResourceNotFoundException;
import com.wardrobe.repository.ClothingItemRepository;
import com.wardrobe.service.aws.ImageSniffer;
import com.wardrobe.service.aws.S3Service;
import com.wardrobe.service.aws.ImageAccessService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.multipart.MultipartFile;
import com.wardrobe.exception.ValidationException;

import java.util.UUID;
import java.util.HashSet;
import java.util.HexFormat;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.io.IOException;
import javax.imageio.ImageIO;
import java.io.ByteArrayInputStream;
import java.awt.image.BufferedImage;
import com.wardrobe.service.processing.ProcessingRecoveryService;
import com.wardrobe.config.ProcessingQueueConfig;

@Service
@RequiredArgsConstructor
@Slf4j
public class ClothingService {

    private final ClothingItemRepository clothingRepository;
    private final S3Service s3Service;
    private final ImageAccessService imageAccess;
    private final TransactionTemplate transactions;
    private final ProcessingQueueConfig processingConfig;

    public ClothingItemDTO.Response createClothingItem(
            ClothingItemDTO.CreateRequest request,
            MultipartFile image,
            User user) {

        ValidatedImage validated = validateImage(image);
        byte[] imageBytes = validated.bytes();
        Enums.Category category = parseRequiredCategory(request.getCategory());
        String uploadHash = sha256(imageBytes);
        if (clothingRepository.existsByUserIdAndUploadHashAndRemovedAtIsNull(
                user.getId(), uploadHash)) {
            throw new DuplicateClothingItemException();
        }

        if (!processingConfig.isEnabled()) {
            return createReadyClothingItem(category, user, validated, imageBytes, uploadHash);
        }

        ClothingItem newItem = ClothingItem.builder()
                .category(category)
                .status(Enums.ProcessingStatus.PROCESSING)
                .processingDeadlineAt(java.time.LocalDateTime.now()
                        .plusSeconds(processingConfig.getDeadlineSeconds()))
                .uploadHash(uploadHash)
                .tags(normalizeTags(request.getTags()))
                .user(user)
                .build();

        ClothingItem item = transactions.execute(
                status -> clothingRepository.saveAndFlush(newItem));
        if (item == null) {
            throw new IllegalStateException("Unable to create clothing item");
        }
        String sourceKey = stagingKey(user.getId(), item.getId(), item.getProcessingVersion());
        s3Service.uploadBytes(sourceKey, imageBytes, validated.contentType());
        log.info("Created clothing item: {}", item.getId());

        return mapToResponse(item);
    }

    private Enums.Category parseRequiredCategory(String value) {
        if (value == null || value.isBlank()) {
            throw new ValidationException("Choose a category");
        }
        try {
            return Enums.Category.valueOf(value.toUpperCase());
        } catch (IllegalArgumentException exception) {
            throw new ValidationException("Unsupported category");
        }
    }

    @Transactional
    public ClothingItemDTO.Response replaceMissingUpload(
            UUID itemId,
            ClothingItemDTO.ReplacementRequest request,
            MultipartFile image,
            User user) {
        ValidatedImage validated = validateImage(image);
        byte[] imageBytes = validated.bytes();
        String uploadHash = sha256(imageBytes);
        Enums.Category category = parseRequiredCategory(request.getCategory());

        ClothingItem item = clothingRepository.findAndLockById(itemId)
                .orElseThrow(() -> new ResourceNotFoundException("Clothing item not found"));
        if (item.getRemovedAt() != null) {
            throw new ResourceNotFoundException("Clothing item not found");
        }
        if (!item.getUser().getId().equals(user.getId())) {
            throw new ForbiddenException("You can only modify your own items");
        }
        if (clothingRepository.existsByUserIdAndUploadHashAndRemovedAtIsNullAndIdNot(
                user.getId(), uploadHash, itemId)) {
            throw new DuplicateClothingItemException();
        }
        if (item.getStatus() != Enums.ProcessingStatus.NEEDS_INPUT
                || !"ORIGINAL_UNAVAILABLE".equals(item.getProcessingError())) {
            throw new ValidationException("This item does not need a replacement image");
        }

        int nextVersion = item.getProcessingVersion() + 1;
        if (!processingConfig.isEnabled()) {
            String objectKey = originalKey(user.getId(), item.getId(), nextVersion);
            s3Service.uploadBytes(objectKey, imageBytes, validated.contentType());

            item.setCategory(category);
            item.setTags(new java.util.LinkedHashSet<>());
            item.setProcessingVersion(nextVersion);
            item.setProcessingAttempt(1);
            item.setStatus(Enums.ProcessingStatus.READY);
            item.setProcessingError(null);
            item.setImageHash(null);
            item.setUploadHash(uploadHash);
            item.setS3ObjectKey(objectKey);
            item.setProcessingDeadlineAt(null);
            item.setDuplicateOfId(null);
            item = clothingRepository.save(item);
            log.info("Replaced missing upload for clothing item {} with processing disabled", itemId);
            return mapToResponse(item);
        }

        String sourceKey = stagingKey(user.getId(), item.getId(), nextVersion);
        s3Service.uploadBytes(sourceKey, imageBytes, validated.contentType());

        item.setCategory(category);
        item.setTags(normalizeTags(request.getTags()));
        item.setProcessingVersion(nextVersion);
        item.setProcessingAttempt(1);
        item.setStatus(Enums.ProcessingStatus.PROCESSING);
        item.setProcessingError(null);
        item.setImageHash(null);
        item.setUploadHash(uploadHash);
        item.setS3ObjectKey(null);
        item.setProcessingDeadlineAt(java.time.LocalDateTime.now()
                .plusSeconds(processingConfig.getDeadlineSeconds()));
        item = clothingRepository.save(item);
        log.info("Replaced missing upload for clothing item {}", itemId);
        return mapToResponse(item);
    }

    @Transactional(readOnly = true)
    public Page<ClothingItemDTO.Summary> getUserItems(
            User user, int page, int size) {
        return clothingRepository.findByUserIdAndRemovedAtIsNull(
                user.getId(),
                PageRequest.of(page, size, Sort.by("createdAt").descending())
        ).map(this::mapToSummary);
    }

    @Transactional(readOnly = true)
    public Page<ClothingItemDTO.Summary> getUserItemsByCategory(
            User user, String category, int page, int size) {
        Enums.Category cat = Enums.Category.valueOf(category.toUpperCase());
        return clothingRepository.findByUserIdAndCategoryAndRemovedAtIsNull(
                user.getId(), cat,
                PageRequest.of(page, size, Sort.by("createdAt").descending())
        ).map(this::mapToSummary);
    }

    @Transactional(readOnly = true)
    public ClothingItemDTO.Response getClothingItem(UUID itemId, User user) {
        ClothingItem item = findItemAndValidateAccess(itemId, user);
        return mapToResponse(item);
    }

    @Transactional
    public ClothingItemDTO.Response updateClothingItem(
            UUID itemId, ClothingItemDTO.UpdateRequest request, User user) {
        ClothingItem item = findItemAndValidateOwnership(itemId, user);

        Enums.Category category = parseRequiredCategory(request.getCategory());
        item.setCategory(category);
        if (request.getTags() != null) {
            item.setTags(normalizeTags(request.getTags()));
        }
        if (item.getStatus() == Enums.ProcessingStatus.NEEDS_INPUT) {
            String sourceKey = stagingKey(
                    user.getId(), item.getId(), item.getProcessingVersion());
            String permanentKey;
            try {
                permanentKey = s3Service.promoteOriginal(sourceKey, user.getId(), item.getId());
            } catch (IllegalStateException exception) {
                throw new ValidationException("The original image is unavailable; upload it again");
            }
            item.setS3ObjectKey(permanentKey);
            item.setImageHash(null);
            item.setStatus(Enums.ProcessingStatus.READY);
            item.setProcessingError(null);
            item.setProcessingDeadlineAt(null);
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    try {
                        s3Service.deleteFile(sourceKey);
                    } catch (Exception exception) {
                        log.warn("Unable to remove promoted staging image {}", sourceKey, exception);
                    }
                }
            });
        }
        item = clothingRepository.save(item);
        log.info("Updated clothing item: {}", itemId);

        return mapToResponse(item);
    }

    @Transactional
    public void deleteClothingItem(UUID itemId, User user) {
        ClothingItem item = findItemAndValidateOwnership(itemId, user);
        item.setRemovedAt(java.time.LocalDateTime.now());
        for (ClothingItem duplicate : clothingRepository.findByDuplicateOfIdAndStatus(
                itemId, Enums.ProcessingStatus.DUPLICATE_REVIEW)) {
            duplicate.setDuplicateOfId(null);
            duplicate.setStatus(Enums.ProcessingStatus.READY);
        }
        clothingRepository.save(item);
        log.info("Removed clothing item from wardrobe: {}", itemId);
    }

    private ClothingItemDTO.Response createReadyClothingItem(
            Enums.Category category,
            User user,
            ValidatedImage validated,
            byte[] imageBytes,
            String uploadHash) {
        ClothingItem newItem = ClothingItem.builder()
                .category(category)
                .status(Enums.ProcessingStatus.READY)
                .uploadHash(uploadHash)
                .tags(new java.util.LinkedHashSet<>())
                .user(user)
                .build();

        ClothingItem item = transactions.execute(status -> {
            ClothingItem saved = clothingRepository.saveAndFlush(newItem);
            String objectKey = originalKey(user.getId(), saved.getId(), saved.getProcessingVersion());
            s3Service.uploadBytes(objectKey, imageBytes, validated.contentType());
            saved.setS3ObjectKey(objectKey);
            saved.setProcessingDeadlineAt(null);
            saved.setProcessingError(null);
            saved.setImageHash(null);
            saved.setDuplicateOfId(null);
            return clothingRepository.save(saved);
        });
        if (item == null) {
            throw new IllegalStateException("Unable to create clothing item");
        }
        log.info("Created clothing item {} with processing disabled", item.getId());
        return mapToResponse(item);
    }

    @Transactional
    public ClothingItemDTO.Response keepDuplicate(UUID itemId, User user) {
        ClothingItem item = findItemAndValidateOwnership(itemId, user);
        if (item.getStatus() != Enums.ProcessingStatus.DUPLICATE_REVIEW
                || item.getDuplicateOfId() == null) {
            throw new ValidationException("This item is not awaiting duplicate review");
        }
        item.setDuplicateOfId(null);
        item.setStatus(Enums.ProcessingStatus.READY);
        return mapToResponse(clothingRepository.save(item));
    }

    @Transactional(readOnly = true)
    public Page<ClothingItemDTO.Summary> searchItems(
            UUID userId, String query, String category, int page, int size) {
        Enums.Category cat = category != null && !category.isBlank()
                ? Enums.Category.valueOf(category.toUpperCase())
                : null;

        return clothingRepository.searchItems(
                userId, query, cat,
                PageRequest.of(page, size, Sort.by("createdAt").descending())
        ).map(this::mapToSummary);
    }

    private ClothingItem findItemAndValidateAccess(UUID itemId, User user) {
        ClothingItem item = clothingRepository.findById(itemId)
                .orElseThrow(() -> new ResourceNotFoundException("Clothing item not found"));
        if (item.getRemovedAt() != null) {
            throw new ResourceNotFoundException("Clothing item not found");
        }

        // Check if user owns the item or if the owner's wardrobe is public
        if (!item.getUser().getId().equals(user.getId()) &&
                item.getUser().getVisibility() == Enums.Visibility.PRIVATE) {
            throw new ForbiddenException("Access denied");
        }

        return item;
    }

    private ClothingItem findItemAndValidateOwnership(UUID itemId, User user) {
        ClothingItem item = clothingRepository.findById(itemId)
                .orElseThrow(() -> new ResourceNotFoundException("Clothing item not found"));
        if (item.getRemovedAt() != null) {
            throw new ResourceNotFoundException("Clothing item not found");
        }

        if (!item.getUser().getId().equals(user.getId())) {
            throw new ForbiddenException("You can only modify your own items");
        }

        return item;
    }

    private ClothingItemDTO.Response mapToResponse(ClothingItem item) {
        return ClothingItemDTO.Response.builder()
                .id(item.getId())
                .category(item.getCategory().toString())
                .imageUrl(imageAccess.urlFor(item))
                .tags(new java.util.LinkedHashSet<>(item.getTags()))
                .status(item.getStatus().toString())
                .processingError(item.getProcessingError())
                .attempt(item.getProcessingAttempt())
                .maxAttempts(ProcessingRecoveryService.MAX_PROCESSING_ATTEMPTS)
                .needsUserInput(item.getStatus() == Enums.ProcessingStatus.NEEDS_INPUT)
                .removedFromWardrobe(item.getRemovedAt() != null)
                .duplicateOfId(item.getDuplicateOfId())
                .userId(item.getUser().getId())
                .createdAt(item.getCreatedAt())
                .updatedAt(item.getUpdatedAt())
                .build();
    }

    private ClothingItemDTO.Summary mapToSummary(ClothingItem item) {
        return ClothingItemDTO.Summary.builder()
                .id(item.getId())
                .category(item.getCategory().toString())
                .imageUrl(imageAccess.urlFor(item))
                .status(item.getStatus().toString())
                .processingError(item.getProcessingError())
                .attempt(item.getProcessingAttempt())
                .maxAttempts(ProcessingRecoveryService.MAX_PROCESSING_ATTEMPTS)
                .needsUserInput(item.getStatus() == Enums.ProcessingStatus.NEEDS_INPUT)
                .removedFromWardrobe(item.getRemovedAt() != null)
                .duplicateOfId(item.getDuplicateOfId())
                .userId(item.getUser().getId())
                .createdAt(item.getCreatedAt())
                .updatedAt(item.getUpdatedAt())
                .build();
    }

    private String stagingKey(UUID userId, UUID itemId, int version) {
        return String.format("staging/%s/%s/%d/source", userId, itemId, version);
    }

    private String originalKey(UUID userId, UUID itemId, int version) {
        return String.format("users/%s/clothing/%s/%d/original", userId, itemId, version);
    }

    private java.util.Set<String> normalizeTags(java.util.Set<String> tags) {
        if (tags == null) return new java.util.LinkedHashSet<>();
        return tags.stream()
                .filter(tag -> tag != null && !tag.isBlank())
                .map(tag -> tag.trim().toLowerCase())
                .collect(java.util.stream.Collectors.toCollection(java.util.LinkedHashSet::new));
    }

    private String sha256(byte[] bytes) {
        try {
            return HexFormat.of().formatHex(
                    MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }

    private ValidatedImage validateImage(MultipartFile image) {
        if (image == null || image.isEmpty()) throw new ValidationException("Choose an image");
        if (image.getSize() > 10L * 1024 * 1024) throw new ValidationException("Image must be 10 MB or smaller");
        try {
            byte[] bytes = image.getBytes();
            ImageSniffer.DetectedImage detected = ImageSniffer.detect(bytes);
            if (detected == null || (!"image/jpeg".equals(detected.contentType())
                    && !"image/png".equals(detected.contentType()))) {
                throw new ValidationException("Only JPEG and PNG images are supported");
            }
            BufferedImage decoded = ImageIO.read(new ByteArrayInputStream(bytes));
            if (decoded == null) {
                throw new ValidationException("The uploaded file is not a valid image");
            }
            long pixels = (long) decoded.getWidth() * decoded.getHeight();
            if (decoded.getWidth() > 8_000 || decoded.getHeight() > 8_000
                    || pixels > 20_000_000L) {
                throw new ValidationException("Image dimensions are too large");
            }
            return new ValidatedImage(bytes, detected.contentType());
        } catch (IOException ex) {
            throw new ValidationException("Could not read the uploaded image");
        }
    }

    private record ValidatedImage(byte[] bytes, String contentType) {}
}
