package com.wardrobe.controller;

import com.wardrobe.dto.ClothingItemDTO;
import com.wardrobe.dto.UserDTO;
import com.wardrobe.dto.OutfitDTO;
import com.wardrobe.entity.User;
import com.wardrobe.service.auth.CurrentUserService;
import com.wardrobe.service.user.UserService;
import com.wardrobe.service.wardrobe.OutfitService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.validation.annotation.Validated;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/users")
@RequiredArgsConstructor
@Validated
public class UserController {
    private final UserService userService;
    private final CurrentUserService currentUserService;
    private final OutfitService outfitService;

    @GetMapping("/me")
    public ResponseEntity<UserDTO.Response> me() {
        return ResponseEntity.ok(userService.getProfile(currentUserService.getCurrentUser()));
    }

    @PutMapping("/me/visibility")
    public ResponseEntity<UserDTO.Response> updateVisibility(
            @Valid @RequestBody UserDTO.VisibilityRequest request) {
        User user = currentUserService.getCurrentUser();
        return ResponseEntity.ok(userService.updateVisibility(user, request.getVisibility()));
    }

    @GetMapping("/public")
    public ResponseEntity<List<UserDTO.ExploreResponse>> publicUsers() {
        return ResponseEntity.ok(userService.getPublicUsers(currentUserService.getCurrentUser()));
    }

    @GetMapping("/{userId}/clothing")
    public ResponseEntity<Page<ClothingItemDTO.Summary>> publicWardrobe(
            @PathVariable UUID userId,
            @RequestParam(required = false) @Size(max = 100) String query,
            @RequestParam(required = false) String category,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size) {
        return ResponseEntity.ok(userService.getPublicWardrobe(userId, query, category, page, size));
    }

    @GetMapping("/{userId}/profile")
    public ResponseEntity<UserDTO.Response> publicProfile(@PathVariable UUID userId) {
        return ResponseEntity.ok(userService.getPublicProfile(userId));
    }

    @GetMapping("/{userId}/outfits")
    public ResponseEntity<Page<OutfitDTO.Response>> publicOutfits(
            @PathVariable UUID userId,
            @RequestParam(defaultValue = "true") boolean includeCreated,
            @RequestParam(defaultValue = "true") boolean includeAccepted,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size) {
        return ResponseEntity.ok(userService.getPublicOutfits(
                userId, includeCreated, includeAccepted, page, size));
    }

    @PostMapping("/{userId}/outfit-suggestions")
    public ResponseEntity<OutfitDTO.Response> createOutfitSuggestion(
            @PathVariable UUID userId,
            @Valid @RequestBody OutfitDTO.CreateCommunitySuggestionRequest request) {
        User suggestingUser = currentUserService.getCurrentUser();
        return ResponseEntity.ok(outfitService.createCommunitySuggestion(userId, request, suggestingUser));
    }
}
