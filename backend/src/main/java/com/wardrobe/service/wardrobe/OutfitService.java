package com.wardrobe.service.wardrobe;

import com.wardrobe.constants.Enums;
import com.wardrobe.dto.ClothingItemDTO;
import com.wardrobe.dto.OutfitDTO;
import com.wardrobe.entity.ClothingItem;
import com.wardrobe.entity.Outfit;
import com.wardrobe.entity.User;
import com.wardrobe.exception.ForbiddenException;
import com.wardrobe.exception.ResourceNotFoundException;
import com.wardrobe.exception.ValidationException;
import com.wardrobe.repository.ClothingItemRepository;
import com.wardrobe.repository.OutfitRepository;
import com.wardrobe.repository.UserRepository;
import com.wardrobe.service.ai.OutfitSuggestionAiService;
import org.springframework.transaction.annotation.Transactional;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;

import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@Slf4j
public class OutfitService {

    private final OutfitRepository outfitRepository;
    private final ClothingItemRepository clothingRepository;
    private final UserRepository userRepository;
    private final OutfitSuggestionAiService outfitSuggestionAiService;
    private final ClothingItemViewMapper clothingItemViewMapper;

    @Transactional
    public OutfitDTO.Response createOutfit(OutfitDTO.CreateRequest request, User user) {
        // Validate all clothing items belong to the user
        Set<ClothingItem> items = new HashSet<>();
        for (UUID itemId : request.getClothingItemIds()) {
            ClothingItem item = clothingRepository.findById(itemId)
                    .orElseThrow(() -> new ResourceNotFoundException("Clothing item not found: " + itemId));
            if (!item.getUser().getId().equals(user.getId())) {
                throw new ForbiddenException("Can only add your own items to outfits");
            }
            if (item.getStatus() != Enums.ProcessingStatus.READY) {
                throw new com.wardrobe.exception.ValidationException(
                        "Only processed clothing items can be added to outfits");
            }
            if (item.getRemovedAt() != null) {
                throw new ValidationException("Removed clothing items cannot be added to outfits");
            }
            items.add(item);
        }

        Outfit outfit = Outfit.builder()
                .items(items)
                .user(user)
                .build();

        outfit = outfitRepository.save(outfit);
        log.info("Created outfit: {}", outfit.getId());

        return mapToResponse(outfit);
    }

    @Transactional(readOnly = true)
    public Page<OutfitDTO.Response> getUserOutfits(
            User user, boolean includeCreated, boolean includeAccepted, int page, int size) {
        return outfitRepository.findVisibleOutfits(
                user.getId(),
                includeCreated,
                includeAccepted,
                PageRequest.of(page, size, Sort.by("createdAt").descending())
        ).map(this::mapToResponse);
    }

    @Transactional
    public OutfitDTO.Response createCommunitySuggestion(
            UUID ownerId,
            OutfitDTO.CreateCommunitySuggestionRequest request,
            User suggestingUser) {
        User owner = userRepository.findById(ownerId)
                .filter(user -> user.getVisibility() == Enums.Visibility.PUBLIC)
                .orElseThrow(() -> new ResourceNotFoundException("Public wardrobe not found"));
        if (owner.getId().equals(suggestingUser.getId())) {
            throw new ValidationException("Use the personal outfit composer for your own wardrobe");
        }

        Set<ClothingItem> items = new HashSet<>();
        for (UUID itemId : request.getClothingItemIds()) {
            ClothingItem item = clothingRepository.findById(itemId)
                    .orElseThrow(() -> new ResourceNotFoundException("Clothing item not found: " + itemId));
            if (!item.getUser().getId().equals(owner.getId())) {
                throw new ForbiddenException("Suggestions can only use items from this wardrobe");
            }
            if (item.getStatus() != Enums.ProcessingStatus.READY) {
                throw new ValidationException("Only processed clothing items can be suggested");
            }
            if (item.getRemovedAt() != null) {
                throw new ValidationException("Removed clothing items cannot be suggested");
            }
            items.add(item);
        }

        Outfit outfit = outfitRepository.save(Outfit.builder()
                .items(items)
                .user(owner)
                .suggestedBy(suggestingUser)
                .build());
        log.info("Created outfit suggestion {} for user {}", outfit.getId(), ownerId);
        return mapToResponse(outfit);
    }

    @Transactional(readOnly = true)
    public Page<OutfitDTO.Response> getPendingSuggestions(User user, int page, int size) {
        return outfitRepository.findByUserIdAndSuggestedByIsNotNullAndAcceptedAtIsNull(
                user.getId(),
                PageRequest.of(page, size, Sort.by("createdAt").descending())
        ).map(this::mapToResponse);
    }

    @Transactional
    public OutfitDTO.Response acceptSuggestion(UUID outfitId, User user) {
        Outfit outfit = findOutfitAndValidateOwnership(outfitId, user);
        if (outfit.getSuggestedBy() == null) {
            throw new ValidationException("This outfit is not a community suggestion");
        }
        if (outfit.getAcceptedAt() != null) {
            throw new ValidationException("This suggestion has already been accepted");
        }
        outfit.setAcceptedAt(java.time.LocalDateTime.now());
        return mapToResponse(outfitRepository.save(outfit));
    }

    @Transactional(readOnly = true)
    public OutfitDTO.Response getOutfit(UUID outfitId, User user) {
        Outfit outfit = findOutfitAndValidateAccess(outfitId, user);
        return mapToResponse(outfit);
    }

    @Transactional(readOnly = true)
    public List<ClothingItemDTO.ClothingItemDetail> suggestItems(OutfitDTO.AiOutfitSuggestionRequest request, User user) {
        Set<ClothingItem> selectedItems = new HashSet<>();
        for (UUID itemId : request.getClothingItemIds()) {
            ClothingItem item = clothingRepository.findById(itemId)
                    .orElseThrow(() -> new ResourceNotFoundException("Clothing item not found: " + itemId));
            if (!item.getUser().getId().equals(user.getId())) {
                throw new ForbiddenException("Can only use your own items for outfit suggestions");
            }
            if (item.getStatus() != Enums.ProcessingStatus.READY) {
                throw new ValidationException("Only processed clothing items can be used for outfit suggestions");
            }
            selectedItems.add(item);
        }

        Enums.Category category;
        try {
            category = Enums.Category.valueOf(request.getCategory().toUpperCase());
        } catch (IllegalArgumentException exception) {
            throw new ValidationException("Unknown clothing category: " + request.getCategory());
        }

        Set<UUID> selectedIds = selectedItems.stream().map(ClothingItem::getId).collect(Collectors.toSet());
        List<ClothingItem> candidates = clothingRepository.findByUserIdAndCategoryAndStatusAndRemovedAtIsNull(
                user.getId(), category, Enums.ProcessingStatus.READY).stream()
                .filter(item -> !selectedIds.contains(item.getId()))
                .toList();
        if (candidates.isEmpty()) {
            return List.of();
        }

        Map<UUID, ClothingItem> candidatesById = candidates.stream()
                .collect(Collectors.toMap(ClothingItem::getId, item -> item));
        return outfitSuggestionAiService.select(
                        List.copyOf(selectedItems), candidates, category.toString()).stream()
                .map(candidatesById::get)
                .map(clothingItemViewMapper::toDetail)
                .toList();
    }

    @Transactional
    public OutfitDTO.Response updateOutfit(UUID outfitId, OutfitDTO.UpdateRequest request, User user) {
        Outfit outfit = findOutfitAndValidateOwnership(outfitId, user);
        if (outfit.getSuggestedBy() != null) {
            throw new ForbiddenException("Community suggestions cannot be edited");
        }

        if (request.getClothingItemIds() != null) {
            Set<UUID> existingItemIds = outfit.getItems().stream()
                    .map(ClothingItem::getId)
                    .collect(Collectors.toSet());
            Set<ClothingItem> items = new HashSet<>();
            for (UUID itemId : request.getClothingItemIds()) {
                ClothingItem item = clothingRepository.findById(itemId)
                        .orElseThrow(() -> new ResourceNotFoundException("Clothing item not found: " + itemId));
                if (!item.getUser().getId().equals(user.getId())) {
                    throw new ForbiddenException("Can only add your own items to outfits");
                }
                if (item.getStatus() != Enums.ProcessingStatus.READY) {
                    throw new com.wardrobe.exception.ValidationException(
                            "Only processed clothing items can be added to outfits");
                }
                if (item.getRemovedAt() != null && !existingItemIds.contains(item.getId())) {
                    throw new ValidationException("Removed clothing items cannot be added to outfits");
                }
                items.add(item);
            }
            outfit.setItems(items);
        }

        outfit = outfitRepository.save(outfit);
        log.info("Updated outfit: {}", outfitId);

        return mapToResponse(outfit);
    }

    @Transactional
    public void deleteOutfit(UUID outfitId, User user) {
        Outfit outfit = outfitRepository.findById(outfitId)
                .orElseThrow(() -> new ResourceNotFoundException("Outfit not found"));
        boolean owner = outfit.getUser().getId().equals(user.getId());
        boolean author = outfit.getSuggestedBy() != null
                && outfit.getSuggestedBy().getId().equals(user.getId());
        if (!owner && !author) {
            throw new ForbiddenException("You cannot delete this outfit");
        }
        outfitRepository.delete(outfit);
        log.info("Deleted outfit: {}", outfitId);
    }

    private Outfit findOutfitAndValidateAccess(UUID outfitId, User user) {
        Outfit outfit = outfitRepository.findById(outfitId)
                .orElseThrow(() -> new ResourceNotFoundException("Outfit not found"));

        if (!outfit.getUser().getId().equals(user.getId()) &&
                outfit.getUser().getVisibility() == Enums.Visibility.PRIVATE) {
            throw new ForbiddenException("Access denied");
        }

        return outfit;
    }

    private Outfit findOutfitAndValidateOwnership(UUID outfitId, User user) {
        Outfit outfit = outfitRepository.findById(outfitId)
                .orElseThrow(() -> new ResourceNotFoundException("Outfit not found"));

        if (!outfit.getUser().getId().equals(user.getId())) {
            throw new ForbiddenException("You can only modify your own outfits");
        }

        return outfit;
    }

    private OutfitDTO.Response mapToResponse(Outfit outfit) {
        Set<ClothingItemDTO.OutfitItem> itemResponses = outfit.getItems().stream()
                .map(clothingItemViewMapper::toOutfitItem)
                .collect(Collectors.toSet());

        return OutfitDTO.Response.builder()
                .id(outfit.getId())
                .items(itemResponses)
                .userId(outfit.getUser().getId())
                .suggestedBy(outfit.getSuggestedBy() == null ? null : new OutfitDTO.SuggestedBySummary(
                        outfit.getSuggestedBy().getId(),
                        outfit.getSuggestedBy().getUsername()))
                .acceptedAt(outfit.getAcceptedAt())
                .createdAt(outfit.getCreatedAt())
                .updatedAt(outfit.getUpdatedAt())
                .build();
    }

}
