package com.wardrobe;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wardrobe.repository.UserRepository;
import com.wardrobe.service.aws.S3Service;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;
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
    void uploadUrlsAreLimitedPerUser() throws Exception {
        String token = register("upload-owner@example.com", "upload-owner");
        when(s3.presignedPutUrl(anyString(), anyString())).thenReturn("https://s3.example/upload");

        performUpload(token, "TOPS").andExpect(status().isCreated());
        performUpload(token, "BOTTOMS").andExpect(status().isCreated());
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
        return mockMvc.perform(post("/api/clothing/upload-url")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {"category":"%s","contentType":"image/png"}
                        """.formatted(category))
                .header("Authorization", "Bearer " + token));
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
