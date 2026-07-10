package com.wardrobe;

import com.wardrobe.constants.Enums;
import com.wardrobe.dto.ClothingItemDTO;
import com.wardrobe.dto.OutfitDTO;
import com.wardrobe.entity.ClothingItem;
import com.wardrobe.entity.User;
import com.wardrobe.repository.ClothingItemRepository;
import com.wardrobe.repository.UserRepository;
import com.wardrobe.service.wardrobe.OutfitService;
import com.wardrobe.service.wardrobe.ClothingService;
import com.wardrobe.service.user.UserService;
import com.wardrobe.exception.ForbiddenException;
import com.wardrobe.exception.ResourceNotFoundException;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

@SpringBootTest
@Transactional
class OutfitCreationIntegrationTests {
    @Autowired private UserRepository userRepository;
    @Autowired private ClothingItemRepository clothingRepository;
    @Autowired private OutfitService outfitService;
    @Autowired private ClothingService clothingService;
    @Autowired private UserService userService;

    @Test
    void createsOutfitFromMultipleManagedClothingItems() {
        User user = userRepository.save(User.builder()
                .email("outfit-test@example.com")
                .username("outfit-test")
                .password("unused")
                .visibility(Enums.Visibility.PRIVATE)
                .build());

        ClothingItem shirt = clothingRepository.save(ClothingItem.builder()
                .category(Enums.Category.TOPS)
                .status(Enums.ProcessingStatus.READY)
                .user(user)
                .build());
        ClothingItem pants = clothingRepository.save(ClothingItem.builder()
                .category(Enums.Category.BOTTOMS)
                .status(Enums.ProcessingStatus.READY)
                .user(user)
                .build());

        OutfitDTO.Response response = outfitService.createOutfit(
                OutfitDTO.CreateRequest.builder()
                        .clothingItemIds(Set.of(shirt.getId(), pants.getId()))
                        .build(),
                user
        );

        assertEquals(2, response.getItems().size());
    }

    @Test
    void suggestsAnUnselectedItemFromTheRequestedCategory() {
        User user = userRepository.save(User.builder()
                .email("suggestion-test@example.com")
                .username("suggestion-test")
                .password("unused")
                .visibility(Enums.Visibility.PRIVATE)
                .build());

        ClothingItem shirt = clothingRepository.save(ClothingItem.builder()
                .category(Enums.Category.TOPS)
                .status(Enums.ProcessingStatus.READY)
                .tags(Set.of("casual", "blue"))
                .user(user)
                .build());
        ClothingItem matchingPants = clothingRepository.save(ClothingItem.builder()
                .category(Enums.Category.BOTTOMS)
                .status(Enums.ProcessingStatus.READY)
                .tags(Set.of("casual"))
                .user(user)
                .build());
        ClothingItem otherPants = clothingRepository.save(ClothingItem.builder()
                .category(Enums.Category.BOTTOMS)
                .status(Enums.ProcessingStatus.READY)
                .tags(Set.of("formal"))
                .user(user)
                .build());
        clothingRepository.save(ClothingItem.builder()
                .category(Enums.Category.BOTTOMS)
                .status(Enums.ProcessingStatus.READY)
                .tags(Set.of("sport"))
                .user(user)
                .build());
        clothingRepository.save(ClothingItem.builder()
                .category(Enums.Category.BOTTOMS)
                .status(Enums.ProcessingStatus.READY)
                .tags(Set.of("summer"))
                .user(user)
                .build());

        var suggestions = outfitService.suggestItems(
                OutfitDTO.AiOutfitSuggestionRequest.builder()
                        .clothingItemIds(Set.of(shirt.getId()))
                        .category("BOTTOMS")
                        .build(),
                user
        );

        assertEquals(matchingPants.getId(), suggestions.get(0).getId());
        assertNotEquals(otherPants.getId(), suggestions.get(0).getId());
        assertEquals(3, suggestions.size());
    }

    @Test
    void suggestsTheOnlyAvailableItemFromTheRequestedCategoryWithoutAiRanking() {
        User user = userRepository.save(User.builder()
                .email("single-suggestion-test@example.com")
                .username("single-suggestion-test")
                .password("unused")
                .visibility(Enums.Visibility.PRIVATE)
                .build());

        ClothingItem blouse = clothingRepository.save(ClothingItem.builder()
                .category(Enums.Category.TOPS)
                .status(Enums.ProcessingStatus.READY)
                .tags(Set.of("white", "button front"))
                .user(user)
                .build());
        ClothingItem jeans = clothingRepository.save(ClothingItem.builder()
                .category(Enums.Category.BOTTOMS)
                .status(Enums.ProcessingStatus.READY)
                .tags(Set.of("blue", "denim"))
                .user(user)
                .build());
        clothingRepository.save(ClothingItem.builder()
                .category(Enums.Category.DRESSES)
                .status(Enums.ProcessingStatus.READY)
                .tags(Set.of("floral"))
                .user(user)
                .build());

        var suggestions = outfitService.suggestItems(
                OutfitDTO.AiOutfitSuggestionRequest.builder()
                        .clothingItemIds(Set.of(blouse.getId()))
                        .category("BOTTOMS")
                        .build(),
                user
        );

        assertEquals(1, suggestions.size());
        assertEquals(jeans.getId(), suggestions.get(0).getId());
    }

    @Test
    void returnsNoSuggestionsWhenOnlySelectedItemsExistInRequestedCategory() {
        User user = userRepository.save(User.builder()
                .email("no-suggestion-test@example.com")
                .username("no-suggestion-test")
                .password("unused")
                .visibility(Enums.Visibility.PRIVATE)
                .build());

        ClothingItem selectedTop = clothingRepository.save(ClothingItem.builder()
                .category(Enums.Category.TOPS)
                .status(Enums.ProcessingStatus.READY)
                .tags(Set.of("blue", "cotton"))
                .user(user)
                .build());

        var suggestions = outfitService.suggestItems(
                OutfitDTO.AiOutfitSuggestionRequest.builder()
                        .clothingItemIds(Set.of(selectedTop.getId()))
                        .category("TOPS")
                        .build(),
                user
        );

        assertEquals(List.of(), suggestions);
    }

    @Test
    void personalAllItemsReturnsTopsAndDresses() {
        User user = userRepository.save(User.builder()
                .email("all-personal-items@example.com")
                .username("all-personal-items")
                .password("unused")
                .visibility(Enums.Visibility.PRIVATE)
                .build());
        ClothingItem shirt = clothingRepository.save(ClothingItem.builder()
                .category(Enums.Category.TOPS)
                .status(Enums.ProcessingStatus.READY)
                .user(user)
                .build());
        ClothingItem dress = clothingRepository.save(ClothingItem.builder()
                .category(Enums.Category.DRESSES)
                .status(Enums.ProcessingStatus.READY)
                .user(user)
                .build());

        var ids = clothingService.getUserItems(user, 0, 20)
                .map(ClothingItemDTO.WardrobeListItem::getId)
                .toSet();

        assertEquals(Set.of(shirt.getId(), dress.getId()), ids);
    }

    @Test
    void publicWardrobeAllItemsReturnsTopsAndDressesAndCategoryStillFilters() {
        User owner = userRepository.save(User.builder()
                .email("public-all-items@example.com")
                .username("public-all-items")
                .password("unused")
                .visibility(Enums.Visibility.PUBLIC)
                .build());
        ClothingItem shirt = clothingRepository.save(ClothingItem.builder()
                .category(Enums.Category.TOPS)
                .status(Enums.ProcessingStatus.READY)
                .user(owner)
                .build());
        ClothingItem dress = clothingRepository.save(ClothingItem.builder()
                .category(Enums.Category.DRESSES)
                .status(Enums.ProcessingStatus.READY)
                .user(owner)
                .build());

        var allIds = userService.getPublicWardrobe(owner.getId(), null, null, 0, 20)
                .map(ClothingItemDTO.WardrobeListItem::getId)
                .toSet();
        var dressIds = userService.getPublicWardrobe(owner.getId(), null, "DRESSES", 0, 20)
                .map(ClothingItemDTO.WardrobeListItem::getId)
                .toSet();

        assertEquals(Set.of(shirt.getId(), dress.getId()), allIds);
        assertEquals(Set.of(dress.getId()), dressIds);
    }

    @Test
    void publicWardrobeSearchWithoutCategoryMatchesAcrossCategories() {
        User owner = userRepository.save(User.builder()
                .email("public-search-all@example.com")
                .username("public-search-all")
                .password("unused")
                .visibility(Enums.Visibility.PUBLIC)
                .build());
        ClothingItem shirt = clothingRepository.save(ClothingItem.builder()
                .category(Enums.Category.TOPS)
                .status(Enums.ProcessingStatus.READY)
                .tags(Set.of("linen"))
                .user(owner)
                .build());
        ClothingItem dress = clothingRepository.save(ClothingItem.builder()
                .category(Enums.Category.DRESSES)
                .status(Enums.ProcessingStatus.READY)
                .tags(Set.of("linen"))
                .user(owner)
                .build());

        var ids = userService.getPublicWardrobe(owner.getId(), "linen", null, 0, 20)
                .map(ClothingItemDTO.WardrobeListItem::getId)
                .toSet();

        assertEquals(Set.of(shirt.getId(), dress.getId()), ids);
    }

    @Test
    void createsAndSeparatesAnAttributedCommunitySuggestion() {
        User owner = userRepository.save(User.builder()
                .email("public-owner@example.com")
                .username("public-owner")
                .password("unused")
                .visibility(Enums.Visibility.PUBLIC)
                .build());
        User author = userRepository.save(User.builder()
                .email("suggestion-author@example.com")
                .username("suggestion-author")
                .password("unused")
                .visibility(Enums.Visibility.PRIVATE)
                .build());
        ClothingItem shirt = clothingRepository.save(ClothingItem.builder()
                .category(Enums.Category.TOPS)
                .status(Enums.ProcessingStatus.READY)
                .user(owner)
                .build());

        OutfitDTO.Response response = outfitService.createCommunitySuggestion(
                owner.getId(),
                OutfitDTO.CreateCommunitySuggestionRequest.builder()
                        .clothingItemIds(Set.of(shirt.getId()))
                        .build(),
                author
        );

        assertEquals(owner.getId(), response.getUserId());
        assertEquals(author.getId(), response.getSuggestedBy().getId());
        assertEquals(0, outfitService.getUserOutfits(owner, true, true, 0, 20).getTotalElements());
        assertEquals(1, outfitService.getPendingSuggestions(owner, 0, 20).getTotalElements());

        OutfitDTO.Response accepted = outfitService.acceptSuggestion(response.getId(), owner);
        assertNotNull(accepted.getAcceptedAt());
        assertEquals(0, outfitService.getPendingSuggestions(owner, 0, 20).getTotalElements());
        assertEquals(1, outfitService.getUserOutfits(owner, false, true, 0, 20).getTotalElements());
    }

    @Test
    void rejectsSuggestionsForPrivateWardrobesAndForeignItems() {
        User privateOwner = userRepository.save(User.builder()
                .email("private-owner@example.com")
                .username("private-owner")
                .password("unused")
                .visibility(Enums.Visibility.PRIVATE)
                .build());
        User publicOwner = userRepository.save(User.builder()
                .email("other-public-owner@example.com")
                .username("other-public-owner")
                .password("unused")
                .visibility(Enums.Visibility.PUBLIC)
                .build());
        User author = userRepository.save(User.builder()
                .email("boundary-author@example.com")
                .username("boundary-author")
                .password("unused")
                .visibility(Enums.Visibility.PRIVATE)
                .build());
        ClothingItem privateItem = clothingRepository.save(ClothingItem.builder()
                .category(Enums.Category.TOPS)
                .status(Enums.ProcessingStatus.READY)
                .user(privateOwner)
                .build());

        var request = OutfitDTO.CreateCommunitySuggestionRequest.builder()
                .clothingItemIds(Set.of(privateItem.getId()))
                .build();

        assertThrows(ResourceNotFoundException.class, () ->
                outfitService.createCommunitySuggestion(privateOwner.getId(), request, author));
        assertThrows(ForbiddenException.class, () ->
                outfitService.createCommunitySuggestion(publicOwner.getId(), request, author));
    }

    @Test
    void allowsOnlySuggestionRecipientOrAuthorToDelete() {
        User owner = userRepository.save(User.builder()
                .email("delete-owner@example.com")
                .username("delete-owner")
                .password("unused")
                .visibility(Enums.Visibility.PUBLIC)
                .build());
        User author = userRepository.save(User.builder()
                .email("delete-author@example.com")
                .username("delete-author")
                .password("unused")
                .visibility(Enums.Visibility.PRIVATE)
                .build());
        User stranger = userRepository.save(User.builder()
                .email("delete-stranger@example.com")
                .username("delete-stranger")
                .password("unused")
                .visibility(Enums.Visibility.PRIVATE)
                .build());
        ClothingItem item = clothingRepository.save(ClothingItem.builder()
                .category(Enums.Category.BOTTOMS)
                .status(Enums.ProcessingStatus.READY)
                .user(owner)
                .build());
        OutfitDTO.Response suggestion = outfitService.createCommunitySuggestion(
                owner.getId(),
                OutfitDTO.CreateCommunitySuggestionRequest.builder()
                        .clothingItemIds(Set.of(item.getId()))
                        .build(),
                author
        );

        assertThrows(ForbiddenException.class, () -> outfitService.deleteOutfit(suggestion.getId(), stranger));
        outfitService.deleteOutfit(suggestion.getId(), author);
        assertEquals(0, outfitService.getPendingSuggestions(owner, 0, 20).getTotalElements());
    }

    @Test
    void removingClothingHidesItFromWardrobeButPreservesItInOutfit() {
        User user = userRepository.save(User.builder()
                .email("soft-remove@example.com")
                .username("soft-remove")
                .password("unused")
                .visibility(Enums.Visibility.PRIVATE)
                .build());
        ClothingItem shirt = clothingRepository.save(ClothingItem.builder()
                .category(Enums.Category.TOPS)
                .processedS3Key("shirt.webp")
                .status(Enums.ProcessingStatus.READY)
                .user(user)
                .build());
        OutfitDTO.Response created = outfitService.createOutfit(
                OutfitDTO.CreateRequest.builder()
                        .clothingItemIds(Set.of(shirt.getId()))
                        .build(),
                user);

        clothingService.deleteClothingItem(shirt.getId(), user);

        ClothingItem preserved = clothingRepository.findById(shirt.getId()).orElseThrow();
        assertTrue(preserved.getRemovedAt() != null);
        OutfitDTO.Response outfit = outfitService.getOutfit(created.getId(), user);
        assertEquals(1, outfit.getItems().size());
        assertTrue(outfit.getItems().iterator().next().isRemovedFromWardrobe());

        OutfitDTO.Response updated = outfitService.updateOutfit(
                created.getId(),
                OutfitDTO.UpdateRequest.builder()
                        .clothingItemIds(Set.of(shirt.getId()))
                        .build(),
                user);
        assertEquals(1, updated.getItems().size());
        assertTrue(updated.getItems().iterator().next().isRemovedFromWardrobe());
    }
}
