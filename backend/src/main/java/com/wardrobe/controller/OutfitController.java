package com.wardrobe.controller;

import com.wardrobe.dto.OutfitDTO;
import com.wardrobe.dto.ClothingItemDTO;
import com.wardrobe.entity.User;
import com.wardrobe.service.auth.CurrentUserService;
import com.wardrobe.service.wardrobe.OutfitService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.validation.annotation.Validated;

import java.util.UUID;

@RestController
@RequestMapping("/api/outfits")
@RequiredArgsConstructor
@Validated
public class OutfitController {

    private final OutfitService outfitService;
    private final CurrentUserService currentUserService;

    @PostMapping
    public ResponseEntity<OutfitDTO.Response> createOutfit(
            @Valid @RequestBody OutfitDTO.CreateRequest request) {
        User user = currentUserService.getCurrentUser();
        return ResponseEntity.ok(outfitService.createOutfit(request, user));
    }

    @GetMapping
    public ResponseEntity<Page<OutfitDTO.Response>> getUserOutfits(
            @RequestParam(defaultValue = "true") boolean includeCreated,
            @RequestParam(defaultValue = "true") boolean includeAccepted,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size) {
        User user = currentUserService.getCurrentUser();
        return ResponseEntity.ok(outfitService.getUserOutfits(
                user, includeCreated, includeAccepted, page, size));
    }

    @GetMapping("/pending-suggestions")
    public ResponseEntity<Page<OutfitDTO.Response>> getPendingSuggestions(
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size) {
        User user = currentUserService.getCurrentUser();
        return ResponseEntity.ok(outfitService.getPendingSuggestions(user, page, size));
    }

    @PostMapping("/{outfitId}/accept")
    public ResponseEntity<OutfitDTO.Response> acceptSuggestion(@PathVariable UUID outfitId) {
        User user = currentUserService.getCurrentUser();
        return ResponseEntity.ok(outfitService.acceptSuggestion(outfitId, user));
    }

    @PostMapping("/suggestions")
    public ResponseEntity<java.util.List<ClothingItemDTO.ClothingItemDetail>> suggestItem(
            @Valid @RequestBody OutfitDTO.AiOutfitSuggestionRequest request) {
        User user = currentUserService.getCurrentUser();
        return ResponseEntity.ok(outfitService.suggestItems(request, user));
    }

    @GetMapping("/{outfitId}")
    public ResponseEntity<OutfitDTO.Response> getOutfit(@PathVariable UUID outfitId) {
        User user = currentUserService.getCurrentUser();
        return ResponseEntity.ok(outfitService.getOutfit(outfitId, user));
    }

    @PutMapping("/{outfitId}")
    public ResponseEntity<OutfitDTO.Response> updateOutfit(
            @PathVariable UUID outfitId,
            @Valid @RequestBody OutfitDTO.UpdateRequest request) {
        User user = currentUserService.getCurrentUser();
        return ResponseEntity.ok(outfitService.updateOutfit(outfitId, request, user));
    }

    @DeleteMapping("/{outfitId}")
    public ResponseEntity<Void> deleteOutfit(@PathVariable UUID outfitId) {
        User user = currentUserService.getCurrentUser();
        outfitService.deleteOutfit(outfitId, user);
        return ResponseEntity.noContent().build();
    }
}
