package com.wardrobe.service.user;

import com.wardrobe.constants.Enums;
import com.wardrobe.dto.ClothingItemDTO;
import com.wardrobe.dto.UserDTO;
import com.wardrobe.dto.OutfitDTO;
import com.wardrobe.entity.ClothingItem;
import com.wardrobe.entity.Outfit;
import com.wardrobe.entity.User;
import com.wardrobe.exception.ResourceNotFoundException;
import com.wardrobe.exception.ValidationException;
import com.wardrobe.repository.ClothingItemRepository;
import com.wardrobe.repository.UserRepository;
import com.wardrobe.repository.OutfitRepository;
import com.wardrobe.service.aws.ImageAccessService;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class UserService {
    private final UserRepository userRepository;
    private final ClothingItemRepository clothingRepository;
    private final OutfitRepository outfitRepository;
    private final ImageAccessService imageAccess;


    @Transactional(readOnly = true)
    public UserDTO.Response getProfile(User user) {
        return toResponse(user);
    }

    @Transactional
    public UserDTO.Response updateVisibility(User user, String value) {
        try {
            user.setVisibility(Enums.Visibility.valueOf(value.toUpperCase()));
        } catch (IllegalArgumentException exception) {
            throw new ValidationException("Visibility must be PRIVATE or PUBLIC");
        }
        return toResponse(userRepository.save(user));
    }

    @Transactional(readOnly = true)
    public List<UserDTO.ExploreResponse> getPublicUsers(User currentUser) {
        return userRepository.findExploreUsers(Enums.Visibility.PUBLIC, currentUser.getId())
                .stream().map(this::toExploreResponse).toList();
    }

    @Transactional(readOnly = true)
    public UserDTO.Response getPublicProfile(UUID userId) {
        return toResponse(findPublicUser(userId));
    }

    @Transactional(readOnly = true)
    public Page<ClothingItemDTO.Summary> getPublicWardrobe(
            UUID userId, String query, String category, int page, int size) {
        User owner = findPublicUser(userId);
        PageRequest pageable = PageRequest.of(page, size, Sort.by("createdAt").descending());
        Page<ClothingItem> items;
        Enums.Category selectedCategory = null;
        if (category != null && !category.isBlank()) {
            try {
                selectedCategory = Enums.Category.valueOf(category.toUpperCase());
            } catch (IllegalArgumentException exception) {
                throw new ValidationException("Unknown clothing category");
            }
        }
        if (query != null && !query.isBlank()) {
            items = clothingRepository.searchItems(owner.getId(), query, selectedCategory, pageable);
        } else if (selectedCategory == null) {
            items = clothingRepository.findByUserIdAndRemovedAtIsNull(owner.getId(), pageable);
        } else {
            items = clothingRepository.findByUserIdAndCategoryAndRemovedAtIsNull(owner.getId(), selectedCategory, pageable);
        }
        return items.map(item -> ClothingItemDTO.Summary.builder()
                .id(item.getId())
                .category(item.getCategory().toString())
                .imageUrl(imageAccess.urlFor(item))
                .status(item.getStatus().toString())
                .processingError(item.getProcessingError())
                .removedFromWardrobe(item.getRemovedAt() != null)
                .duplicateOfId(item.getDuplicateOfId())
                .userId(owner.getId())
                .createdAt(item.getCreatedAt())
                .updatedAt(item.getUpdatedAt())
                .build());
    }


    @Transactional(readOnly = true)
    public Page<OutfitDTO.Response> getPublicOutfits(
            UUID userId, boolean includeCreated, boolean includeAccepted, int page, int size) {
        User owner = findPublicUser(userId);
        return outfitRepository.findVisibleOutfits(
                owner.getId(),
                includeCreated,
                includeAccepted,
                PageRequest.of(page, size, Sort.by("createdAt").descending())
        ).map(this::toOutfitResponse);
    }

    private UserDTO.Response toResponse(User user) {
        return new UserDTO.Response(
                user.getId(),
                user.getUsername(),
                user.getVisibility().toString(),
                getCategoryCounts(user)
        );
    }

    private UserDTO.ExploreResponse toExploreResponse(User user) {
        com.wardrobe.entity.Outfit featuredOutfit = outfitRepository
                .findFirstByUserIdAndSuggestedByIsNullOrderByCreatedAtDesc(user.getId())
                .orElse(null);
        return new UserDTO.ExploreResponse(
                user.getId(),
                user.getUsername(),
                clothingRepository.countByUserIdAndRemovedAtIsNull(user.getId()),
                featuredOutfit == null ? null : featuredOutfit.getId(),
                featuredOutfit == null
                        ? List.of()
                        : featuredOutfit.getItems().stream()
                                .map(imageAccess::urlFor)
                                .limit(4)
                                .toList()
        );
    }

    private Map<String, Long> getCategoryCounts(User user) {
        return clothingRepository.countActiveByCategory(user.getId()).stream()
                .collect(Collectors.toMap(
                        row -> row[0].toString(),
                        row -> (Long) row[1]));
    }

    private OutfitDTO.Response toOutfitResponse(Outfit outfit) {
        return OutfitDTO.Response.builder()
                .id(outfit.getId())
                .items(outfit.getItems().stream()
                        .map(item -> ClothingItemDTO.Response.builder()
                                .id(item.getId())
                                .category(item.getCategory().toString())
                                .imageUrl(imageAccess.urlFor(item))
                                .tags(new java.util.LinkedHashSet<>(item.getTags()))
                                .status(item.getStatus().toString())
                                .removedFromWardrobe(item.getRemovedAt() != null)
                                .userId(item.getUser().getId())
                                .build())
                        .collect(java.util.stream.Collectors.toSet()))
                .userId(outfit.getUser().getId())
                .suggestedBy(outfit.getSuggestedBy() == null ? null : new OutfitDTO.SuggestedBySummary(
                        outfit.getSuggestedBy().getId(),
                        outfit.getSuggestedBy().getUsername()))
                .acceptedAt(outfit.getAcceptedAt())
                .createdAt(outfit.getCreatedAt())
                .updatedAt(outfit.getUpdatedAt())
                .build();
    }

    private User findPublicUser(UUID userId) {
        return userRepository.findByIdAndVisibility(userId, Enums.Visibility.PUBLIC)
                .orElseThrow(() -> new ResourceNotFoundException("Public wardrobe not found"));
    }
}
