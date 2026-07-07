package com.wardrobe;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
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

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
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

        performUpload(firstToken, "TOPS").andExpect(status().isAccepted());
        performUpload(secondToken, "BOTTOMS").andExpect(status().isAccepted());
        performUpload(firstToken, "DRESSES").andExpect(status().isAccepted());
        performUpload(secondToken, "OUTERWEAR")
                .andExpect(status().isTooManyRequests())
                .andExpect(header().string("Retry-After", "3600"))
                .andExpect(jsonPath("$.errorCode").value("RATE_LIMITED"));
    }

    private org.springframework.test.web.servlet.ResultActions performUpload(String token, String category) throws Exception {
        return mockMvc.perform(multipart("/api/clothing")
                .file(jsonPart("item", "{\"category\":\"" + category + "\"}"))
                .file(imagePart(category.hashCode()))
                .header("Authorization", "Bearer " + token)
                .header("X-Forwarded-For", "203.0.113.10"));
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
