package com.wardrobe.service.wardrobe;

import com.wardrobe.constants.Enums;
import com.wardrobe.dto.ClothingItemDTO;
import com.wardrobe.entity.ClothingItem;
import com.wardrobe.entity.User;
import com.wardrobe.exception.ForbiddenException;
import com.wardrobe.exception.ResourceNotFoundException;
import com.wardrobe.repository.ClothingItemRepository;
import com.wardrobe.service.aws.S3Service;
import com.wardrobe.service.aws.ImageAccessService;
import com.wardrobe.config.S3Properties;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.wardrobe.exception.ValidationException;

import java.util.UUID;
import java.time.LocalDateTime;

@Service
@RequiredArgsConstructor
@Slf4j
public class ClothingService {

    private final ClothingItemRepository clothingRepository;
    private final S3Service s3Service;
    private final ImageAccessService imageAccess;
    private final S3Properties s3Properties;

    @Transactional
    public ClothingItemDTO.UploadUrlResponse createUploadUrl(
            ClothingItemDTO.UploadUrlRequest request,
            User user) {
        Enums.Category category = parseRequiredCategory(request.getCategory());
        String contentType = normalizeUploadContentType(request.getContentType());

        ClothingItem item = ClothingItem.builder()
                .category(category)
                .status(Enums.ProcessingStatus.WAITING_FOR_UPLOAD)
                .processingAttempt(1)
                .processingError(null)
                .uploadUrlExpiresAt(LocalDateTime.now().plusMinutes(s3Properties.getSignedUrlMinutes()))
                .tags(normalizeTags(request.getTags()))
                .user(user)
                .build();
        item = clothingRepository.saveAndFlush(item);
        String originalKey = originalUploadKey(user.getId(), item.getId(), contentType);
        item.setOriginalS3Key(originalKey);
        item = clothingRepository.save(item);

        return ClothingItemDTO.UploadUrlResponse.builder()
                .itemId(item.getId())
                .uploadUrl(s3Service.presignedPutUrl(originalKey, contentType))
                .originalS3Key(originalKey)
                .expiresAt(item.getUploadUrlExpiresAt())
                .item(mapToResponse(item))
                .build();
    }

    @Transactional
    public ClothingItemDTO.Response markUploadFailed(UUID itemId, User user) {
        ClothingItem item = findItemAndValidateOwnership(itemId, user);
        if (item.getStatus() != Enums.ProcessingStatus.WAITING_FOR_UPLOAD) {
            throw new ValidationException("This upload can no longer be canceled");
        }
        item.setStatus(Enums.ProcessingStatus.FAILED);
        item.setProcessingError("ORIGINAL_UPLOAD_FAILED");
        item.setProcessingDeadlineAt(null);
        item.setOriginalS3Key(null);
        item.setProcessedS3Key(null);
        return mapToResponse(clothingRepository.save(item));
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
        item = clothingRepository.save(item);
        log.info("Updated clothing item: {}", itemId);

        return mapToResponse(item);
    }

    @Transactional
    public void deleteClothingItem(UUID itemId, User user) {
        ClothingItem item = findItemAndValidateOwnership(itemId, user);
        item.setRemovedAt(java.time.LocalDateTime.now());
        clothingRepository.save(item);
        log.info("Removed clothing item from wardrobe: {}", itemId);
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
                .removedFromWardrobe(item.getRemovedAt() != null)
                .duplicateOfId(item.getDuplicateOfId())
                .userId(item.getUser().getId())
                .createdAt(item.getCreatedAt())
                .updatedAt(item.getUpdatedAt())
                .build();
    }

    private String originalUploadKey(UUID userId, UUID itemId, String contentType) {
        return String.format("users/%s/original/%s.%s",
                userId, itemId, extensionForContentType(contentType));
    }

    private String normalizeUploadContentType(String contentType) {
        if (contentType == null) {
            throw new ValidationException("Content type is required");
        }
        String normalized = contentType.trim().toLowerCase();
        if (!"image/jpeg".equals(normalized) && !"image/png".equals(normalized)) {
            throw new ValidationException("Only JPEG and PNG images are supported");
        }
        return normalized;
    }

    private String extensionForContentType(String contentType) {
        return "image/png".equals(contentType) ? "png" : "jpg";
    }

    private java.util.Set<String> normalizeTags(java.util.Set<String> tags) {
        if (tags == null) return new java.util.LinkedHashSet<>();
        return tags.stream()
                .filter(tag -> tag != null && !tag.isBlank())
                .map(tag -> tag.trim().toLowerCase())
                .collect(java.util.stream.Collectors.toCollection(java.util.LinkedHashSet::new));
    }

}
