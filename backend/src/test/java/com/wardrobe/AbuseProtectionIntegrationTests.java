package com.wardrobe;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wardrobe.constants.Enums;
import com.wardrobe.entity.ClothingItem;
import com.wardrobe.entity.User;
import com.wardrobe.repository.ClothingItemRepository;
import com.wardrobe.repository.UserRepository;
import com.wardrobe.service.aws.S3Service;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Set;
import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = {
        "app.rate-limit.ai-per-minute=2",
        "app.rate-limit.uploads-per-hour=2",
        "app.rate-limit.upload-ip-per-hour=10"
})
@AutoConfigureMockMvc
@Transactional
class AbuseProtectionIntegrationTests {
    @Autowired private MockMvc mockMvc;
    @Autowired private UserRepository users;
    @Autowired private ClothingItemRepository items;
    @MockitoBean private S3Service s3;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void aiSuggestionsAreLimitedPerUser() throws Exception {
        String firstToken = register("ai-first@example.com", "ai-first");

        performAiSuggestion(firstToken).andExpect(status().isBadRequest());
        performAiSuggestion(firstToken).andExpect(status().isBadRequest());
        performAiSuggestion(firstToken)
                .andExpect(status().isTooManyRequests())
                .andExpect(header().string("Retry-After", "60"))
                .andExpect(jsonPath("$.errorCode").value("RATE_LIMITED"));
    }

    @Test
    void uploadAndReplacementShareTheSamePerUserQuota() throws Exception {
        String token = register("upload-owner@example.com", "upload-owner");
        User user = users.findByUsername("upload-owner").orElseThrow();
        ClothingItem missing = items.saveAndFlush(ClothingItem.builder()
                .category(Enums.Category.TOPS)
                .status(Enums.ProcessingStatus.NEEDS_INPUT)
                .processingError("ORIGINAL_UNAVAILABLE")
                .user(user)
                .build());

        performUpload(token, "TOPS").andExpect(status().isAccepted());
        performReplacement(token, missing.getId(), "BOTTOMS").andExpect(status().isAccepted());
        performUpload(token, "DRESSES")
                .andExpect(status().isTooManyRequests())
                .andExpect(header().string("Retry-After", "3600"))
                .andExpect(jsonPath("$.errorCode").value("RATE_LIMITED"));
    }

    private org.springframework.test.web.servlet.ResultActions performAiSuggestion(String token) throws Exception {
        return mockMvc.perform(post("/api/outfits/suggestions")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{}"));
    }

    private org.springframework.test.web.servlet.ResultActions performUpload(String token, String category) throws Exception {
        return mockMvc.perform(multipart("/api/clothing")
                .file(jsonPart("item", "{\"category\":\"" + category + "\"}"))
                .file(imagePart(category.hashCode()))
                .header("Authorization", "Bearer " + token));
    }

    private org.springframework.test.web.servlet.ResultActions performReplacement(String token, UUID itemId, String category)
            throws Exception {
        return mockMvc.perform(multipart("/api/clothing/" + itemId + "/replacement")
                .file(jsonPart("item", "{\"category\":\"" + category + "\"}"))
                .file(imagePart((category + "-replacement").hashCode()))
                .header("Authorization", "Bearer " + token));
    }

    private MockMultipartFile jsonPart(String name, String json) {
        return new MockMultipartFile(
                name, "", MediaType.APPLICATION_JSON_VALUE, json.getBytes(StandardCharsets.UTF_8));
    }

    private MockMultipartFile imagePart(int seed) throws Exception {
        BufferedImage image = new BufferedImage(2, 2, BufferedImage.TYPE_INT_RGB);
        image.setRGB(0, 0, seed);
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        ImageIO.write(image, "png", bytes);
        return new MockMultipartFile("image", "image.png", "image/png", bytes.toByteArray());
    }

    private String register(String email, String username) throws Exception {
        String response = mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"email":"%s","username":"%s","password":"secret123"}
                                """.formatted(email, username)))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString();
        JsonNode auth = objectMapper.readTree(response);
        return auth.get("token").asText();
    }
}
