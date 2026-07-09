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
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.validation.annotation.Validated;

import java.util.UUID;

@RestController
@RequestMapping("/api/clothing")
@RequiredArgsConstructor
@Validated
public class ClothingController {
    private final ClothingService clothingService;
    private final CurrentUserService currentUserService;

    @PostMapping("/upload-url")
    public ResponseEntity<ClothingItemDTO.UploadUrlResponse> createUploadUrl(
            @Valid @RequestBody ClothingItemDTO.UploadUrlRequest request) {
        User user = currentUserService.getCurrentUser();
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(clothingService.createUploadUrl(request, user));
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

    @PostMapping("/{itemId}/upload-failed")
    public ResponseEntity<ClothingItemDTO.Response> markUploadFailed(@PathVariable UUID itemId) {
        User user = currentUserService.getCurrentUser();
        return ResponseEntity.ok(clothingService.markUploadFailed(itemId, user));
    }

    @DeleteMapping("/{itemId}")
    public ResponseEntity<Void> deleteClothingItem(@PathVariable UUID itemId) {
        User user = currentUserService.getCurrentUser();
        clothingService.deleteClothingItem(itemId, user);
        return ResponseEntity.noContent().build();
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
