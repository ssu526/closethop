package com.wardrobe.service.wardrobe;

import com.wardrobe.constants.Enums;
import com.wardrobe.dto.ClothingItemDTO;
import com.wardrobe.entity.ClothingItem;
import com.wardrobe.service.aws.ImageAccessService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.LinkedHashSet;

@Component
@RequiredArgsConstructor
public class ClothingItemViewMapper {
    private final ImageAccessService imageAccess;

    public ClothingItemDTO.ClothingItemDetail toDetail(ClothingItem item) {
        return ClothingItemDTO.ClothingItemDetail.builder()
                .id(item.getId())
                .category(item.getCategory().toString())
                .imageUrl(imageAccess.urlFor(item))
                .tags(new LinkedHashSet<>(item.getTags()))
                .processingState(toProcessingState(item))
                .failureReason(toFailureReason(item))
                .displayNote(toDisplayNote(item))
                .build();
    }

    public ClothingItemDTO.WardrobeListItem toWardrobeListItem(ClothingItem item) {
        return ClothingItemDTO.WardrobeListItem.builder()
                .id(item.getId())
                .category(item.getCategory().toString())
                .imageUrl(imageAccess.urlFor(item))
                .processingState(toProcessingState(item))
                .failureReason(toFailureReason(item))
                .displayNote(toDisplayNote(item))
                .build();
    }

    public ClothingItemDTO.OutfitItem toOutfitItem(ClothingItem item) {
        return ClothingItemDTO.OutfitItem.builder()
                .id(item.getId())
                .category(item.getCategory().toString())
                .imageUrl(imageAccess.urlFor(item))
                .removedFromWardrobe(item.getRemovedAt() != null)
                .build();
    }

    private String toProcessingState(ClothingItem item) {
        if (item.getStatus() == Enums.ProcessingStatus.DUPLICATE_REJECTED) {
            return Enums.ProcessingStatus.FAILED.toString();
        }
        return item.getStatus().toString();
    }

    private String toFailureReason(ClothingItem item) {
        return switch (item.getStatus()) {
            case DUPLICATE_REJECTED -> "DUPLICATE";
            case FAILED -> isUploadFailure(item) ? "UPLOAD" : "PROCESSING";
            default -> null;
        };
    }

    private String toDisplayNote(ClothingItem item) {
        if (item.getStatus() == Enums.ProcessingStatus.FAILED
                && hasUsableOriginal(item)
                && !isUploadFailure(item)) {
            return "Processing failed, using original image";
        }
        return null;
    }

    private boolean hasUsableOriginal(ClothingItem item) {
        return item.getOriginalS3Key() != null
                && !item.getOriginalS3Key().isBlank()
                && item.getOriginalDeletedAt() == null;
    }

    private boolean isUploadFailure(ClothingItem item) {
        String error = item.getProcessingError();
        return "ORIGINAL_UPLOAD_FAILED".equals(error)
                || "ORIGINAL_UPLOAD_NOT_COMPLETED".equals(error)
                || "ORIGINAL_UNAVAILABLE".equals(error);
    }
}
