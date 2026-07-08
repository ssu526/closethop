package com.wardrobe;

import com.wardrobe.constants.Enums;
import com.wardrobe.dto.ClothingItemDTO;
import com.wardrobe.entity.ClothingItem;
import com.wardrobe.entity.User;
import com.wardrobe.exception.ForbiddenException;
import com.wardrobe.exception.DuplicateClothingItemException;
import com.wardrobe.exception.ValidationException;
import com.wardrobe.repository.ClothingItemRepository;
import com.wardrobe.repository.UserRepository;
import com.wardrobe.service.aws.S3Service;
import com.wardrobe.service.wardrobe.ClothingService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.annotation.Transactional;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.times;

@SpringBootTest
@Transactional
class ClothingReplacementIntegrationTests {
    @Autowired private UserRepository users;
    @Autowired private ClothingItemRepository items;
    @Autowired private ClothingService clothing;
    @MockitoBean private S3Service s3;

    @Test
    void replacementKeepsIdIncrementsVersionAndBecomesReadyWhenProcessingIsDisabled() throws Exception {
        User owner = user("replacement-owner@example.com");
        ClothingItem item = missingUpload(owner);

        ClothingItemDTO.Response response = clothing.replaceMissingUpload(
                item.getId(),
                ClothingItemDTO.ReplacementRequest.builder()
                        .category("BOTTOMS")
                        .tags(Set.of(" Navy ", "casual"))
                        .build(),
                image(),
                owner);

        ClothingItem saved = items.findById(item.getId()).orElseThrow();
        assertEquals(item.getId(), response.getId());
        assertEquals(2, saved.getProcessingVersion());
        assertEquals(1, saved.getProcessingAttempt());
        assertEquals(Enums.ProcessingStatus.READY, saved.getStatus());
        assertEquals(Enums.Category.BOTTOMS, saved.getCategory());
        assertEquals(Set.of(), saved.getTags());
        assertEquals(null, saved.getProcessingError());
        assertEquals(null, saved.getProcessingDeadlineAt());
        assertEquals("users/" + owner.getId() + "/clothing/" + item.getId() + "/2/original", saved.getS3ObjectKey());
        verify(s3).uploadBytes(
                eq("users/" + owner.getId() + "/clothing/" + item.getId() + "/2/original"),
                any(byte[].class),
                eq("image/png"));
    }

    @Test
    void newUploadRequiresCategory() throws Exception {
        User owner = user("new-upload-category-required@example.com");

        assertThrows(ValidationException.class, () -> clothing.createClothingItem(
                ClothingItemDTO.CreateRequest.builder().build(),
                image(),
                owner));
    }

    @Test
    void newUploadUsesSelectedCategoryAndBecomesReadyWithoutTagsWhenProcessingIsDisabled() throws Exception {
        User owner = user("new-upload-deadline@example.com");

        ClothingItemDTO.Response response = clothing.createClothingItem(
                ClothingItemDTO.CreateRequest.builder()
                        .category("DRESSES")
                        .tags(Set.of("Party", "summer"))
                        .build(),
                image(),
                owner);

        ClothingItem saved = items.findById(response.getId()).orElseThrow();
        assertEquals(Enums.Category.DRESSES, saved.getCategory());
        assertEquals(Enums.ProcessingStatus.READY, saved.getStatus());
        assertEquals(Set.of(), saved.getTags());
        assertEquals(null, saved.getProcessingDeadlineAt());
        assertEquals("users/" + owner.getId() + "/clothing/" + saved.getId() + "/1/original", saved.getS3ObjectKey());
    }

    @Test
    void newUploadUsesDetectedImageTypeInsteadOfClientProvidedMetadata() throws Exception {
        User owner = user("spoofed-metadata@example.com");

        clothing.createClothingItem(
                ClothingItemDTO.CreateRequest.builder().category("TOPS").build(),
                image("png", "misleading.jpg", "image/jpeg"),
                owner);

        verify(s3).uploadBytes(any(String.class), any(byte[].class), eq("image/png"));
    }

    @Test
    void rejectsAnExactDuplicateUploadForTheSameUser() throws Exception {
        User owner = user("duplicate-owner@example.com");
        MockMultipartFile first = image();
        clothing.createClothingItem(
                ClothingItemDTO.CreateRequest.builder().category("TOPS").build(),
                first,
                owner);

        assertThrows(DuplicateClothingItemException.class, () ->
                clothing.createClothingItem(
                        ClothingItemDTO.CreateRequest.builder().category("TOPS").build(),
                        image(),
                        owner));
        assertEquals(1, items.countByUserIdAndRemovedAtIsNull(owner.getId()));
        verify(s3, times(1)).uploadBytes(any(String.class), any(byte[].class), eq("image/png"));
    }

    @Test
    void allowsTheSameImageForDifferentUsers() throws Exception {
        User firstOwner = user("duplicate-first@example.com");
        User secondOwner = user("duplicate-second@example.com");
        clothing.createClothingItem(
                ClothingItemDTO.CreateRequest.builder().category("TOPS").build(),
                image(),
                firstOwner);

        ClothingItemDTO.Response response = clothing.createClothingItem(
                ClothingItemDTO.CreateRequest.builder().category("TOPS").build(),
                image(),
                secondOwner);

        assertNotNull(response.getId());
    }

    @Test
    void anotherUserCannotReplaceTheUpload() throws Exception {
        User owner = user("replacement-private@example.com");
        User other = user("replacement-other@example.com");
        ClothingItem item = missingUpload(owner);

        assertThrows(ForbiddenException.class, () -> clothing.replaceMissingUpload(
                item.getId(),
                ClothingItemDTO.ReplacementRequest.builder().category("TOPS").build(),
                image(),
                other));
    }

    private User user(String email) {
        return users.save(User.builder()
                .email(email)
                .username(email)
                .password("unused")
                .visibility(Enums.Visibility.PRIVATE)
                .build());
    }

    private ClothingItem missingUpload(User owner) {
        return items.saveAndFlush(ClothingItem.builder()
                .category(Enums.Category.TOPS)
                .status(Enums.ProcessingStatus.NEEDS_INPUT)
                .processingError("ORIGINAL_UNAVAILABLE")
                .processingDeadlineAt(null)
                .user(owner)
                .build());
    }

    private MockMultipartFile image() throws Exception {
        return image("png", "replacement.png", "image/png");
    }

    private MockMultipartFile image(String format, String filename, String contentType) throws Exception {
        BufferedImage image = new BufferedImage(2, 2, BufferedImage.TYPE_INT_RGB);
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        ImageIO.write(image, format, bytes);
        return new MockMultipartFile("image", filename, contentType, bytes.toByteArray());
    }
}
