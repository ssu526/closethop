package com.wardrobe.controller;

import com.wardrobe.dto.ClothingItemDTO;
import com.wardrobe.entity.User;
import com.wardrobe.service.auth.CurrentUserService;
import com.wardrobe.service.wardrobe.ClothingService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.http.MediaType;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.multipart.MultipartFile;

import java.util.UUID;

@RestController
@RequestMapping("/api/clothing")
@RequiredArgsConstructor
@Validated
public class ClothingController {
    private final ClothingService clothingService;
    private final CurrentUserService currentUserService;

    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<ClothingItemDTO.Response> createClothingItem(
            @RequestPart("item") @Valid ClothingItemDTO.CreateRequest request,
            @RequestPart("image") MultipartFile image) {
        User user = currentUserService.getCurrentUser();
        return ResponseEntity.status(HttpStatus.ACCEPTED)
                .body(clothingService.createClothingItem(request, image, user));
    }

    @GetMapping
    public ResponseEntity<Page<ClothingItemDTO.Summary>> getUserItems(
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size) {
        User user = currentUserService.getCurrentUser();
        return ResponseEntity.ok(clothingService.getUserItems(user, page, size));
    }

    @GetMapping("/category/{category}")
    public ResponseEntity<Page<ClothingItemDTO.Summary>> getItemsByCategory(
            @PathVariable String category,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size) {
        User user = currentUserService.getCurrentUser();
        return ResponseEntity.ok(clothingService.getUserItemsByCategory(user, category, page, size));
    }

    @GetMapping("/{itemId}")
    public ResponseEntity<ClothingItemDTO.Response> getClothingItem(@PathVariable UUID itemId) {
        User user = currentUserService.getCurrentUser();
        return ResponseEntity.ok(clothingService.getClothingItem(itemId, user));
    }

    @PutMapping("/{itemId}")
    public ResponseEntity<ClothingItemDTO.Response> updateClothingItem(
            @PathVariable UUID itemId,
            @Valid @RequestBody ClothingItemDTO.UpdateRequest request) {
        User user = currentUserService.getCurrentUser();
        return ResponseEntity.ok(clothingService.updateClothingItem(itemId, request, user));
    }

    @PostMapping(path = "/{itemId}/replacement", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<ClothingItemDTO.Response> replaceMissingUpload(
            @PathVariable UUID itemId,
            @RequestPart("item") @Valid ClothingItemDTO.ReplacementRequest request,
            @RequestPart("image") MultipartFile image) {
        User user = currentUserService.getCurrentUser();
        return ResponseEntity.status(HttpStatus.ACCEPTED)
                .body(clothingService.replaceMissingUpload(itemId, request, image, user));
    }

    @DeleteMapping("/{itemId}")
    public ResponseEntity<Void> deleteClothingItem(@PathVariable UUID itemId) {
        User user = currentUserService.getCurrentUser();
        clothingService.deleteClothingItem(itemId, user);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/{itemId}/duplicate/keep")
    public ResponseEntity<ClothingItemDTO.Response> keepDuplicate(@PathVariable UUID itemId) {
        User user = currentUserService.getCurrentUser();
        return ResponseEntity.ok(clothingService.keepDuplicate(itemId, user));
    }

    @GetMapping("/search")
    public ResponseEntity<Page<ClothingItemDTO.Summary>> searchItems(
            @RequestParam @Size(max = 100) String query,
            @RequestParam(required = false) String category,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size) {
        User user = currentUserService.getCurrentUser();
        return ResponseEntity.ok(clothingService.searchItems(user.getId(), query, category, page, size));
    }
}
