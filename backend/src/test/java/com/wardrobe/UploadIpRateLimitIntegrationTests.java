package com.wardrobe;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wardrobe.service.aws.S3Service;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = {
        "app.rate-limit.ai-per-minute=5",
        "app.rate-limit.uploads-per-hour=10",
        "app.rate-limit.upload-ip-per-hour=3"
})
@AutoConfigureMockMvc
@Transactional
class UploadIpRateLimitIntegrationTests {
    @Autowired private MockMvc mockMvc;
    @MockitoBean private S3Service s3;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void uploadIpGuardBlocksAfterSharedIpCapAcrossUsers() throws Exception {
        String firstToken = register("ip-first@example.com", "ip-first");
        String secondToken = register("ip-second@example.com", "ip-second");
        when(s3.presignedPutUrl(anyString(), anyString())).thenReturn("https://s3.example/upload");

        performUpload(firstToken, "TOPS").andExpect(status().isCreated());
        performUpload(secondToken, "BOTTOMS").andExpect(status().isCreated());
        performUpload(firstToken, "DRESSES").andExpect(status().isCreated());
        performUpload(secondToken, "OUTERWEAR")
                .andExpect(status().isTooManyRequests())
                .andExpect(header().string("Retry-After", "3600"))
                .andExpect(jsonPath("$.errorCode").value("RATE_LIMITED"));
    }

    private org.springframework.test.web.servlet.ResultActions performUpload(String token, String category) throws Exception {
        return mockMvc.perform(post("/api/clothing/upload-url")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {"category":"%s","contentType":"image/png"}
                        """.formatted(category))
                .header("Authorization", "Bearer " + token)
                .header("X-Forwarded-For", "203.0.113.10"));
    }

    private String register(String email, String username) throws Exception {
        String response = mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post("/api/auth/register")
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
