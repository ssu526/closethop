package com.wardrobe;

import com.wardrobe.entity.User;
import com.wardrobe.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.BadJwtException;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = {
        "spring.datasource.url=${TEST_DATASOURCE_URL:jdbc:postgresql://localhost:5432/closethop_test}",
        "spring.datasource.username=${TEST_DATASOURCE_USERNAME:closethop}",
        "spring.datasource.password=${TEST_DATASOURCE_PASSWORD:closethop}",
        "spring.datasource.driver-class-name=org.postgresql.Driver",
        "spring.jpa.hibernate.ddl-auto=create-drop",
        "spring.jpa.properties.hibernate.dialect=org.hibernate.dialect.PostgreSQLDialect",
        "aws.cognito.client-id=test-client",
        "aws.cognito.issuer=https://cognito-idp.us-east-1.amazonaws.com/test-pool",
        "spring.security.oauth2.resourceserver.jwt.issuer-uri=https://cognito-idp.us-east-1.amazonaws.com/test-pool",
        "aws.s3.bucket-name=test-bucket",
        "aws.s3.region=us-east-1",
        "aws.s3.access-key=dummy",
        "aws.s3.secret-key=dummy",
        "app.cors.allowed-origins=https://wardrobe.example"
})
@ActiveProfiles("prod")
@AutoConfigureMockMvc
class CognitoSecurityIntegrationTests {
    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private OAuth2TokenValidator<Jwt> cognitoAccessTokenValidator;

    @MockitoBean
    private JwtDecoder jwtDecoder;

    @BeforeEach
    void setUp() {
        userRepository.deleteAll();
        reset(jwtDecoder);
    }

    @Test
    void createsOneInternalUserForRepeatedAuthenticatedRequests() throws Exception {
        when(jwtDecoder.decode("valid-token")).thenReturn(validJwt());

        authenticatedRequest("valid-token", 200);
        authenticatedRequest("valid-token", 200);

        List<User> users = userRepository.findAll();
        assertEquals(1, users.size());
        assertEquals("cognito-user-1", users.get(0).getCognitoSub());
        assertEquals("person@example.com", users.get(0).getEmail());
        assertEquals("Test Person", users.get(0).getUsername());
        assertNull(users.get(0).getPassword());
    }

    @Test
    void usesEmailPrefixForOtpUsersWithoutDisplayNameClaims() throws Exception {
        when(jwtDecoder.decode("otp-token")).thenReturn(jwt("otp-token", "otp-subject")
                .claim("email", "otp.user@example.com")
                .build());

        authenticatedRequest("otp-token", 200);

        User user = userRepository.findByCognitoSub("otp-subject").orElseThrow();
        assertEquals("otp.user", user.getUsername());
    }

    @Test
    void upgradesOpaqueStoredUsernameWhenReadableClaimsArrive() throws Exception {
        userRepository.saveAndFlush(User.builder()
                .id(UUID.randomUUID())
                .cognitoSub("cognito-user-1")
                .email("before@example.com")
                .username("550e8400-e29b-41d4-a716-446655440000")
                .visibility(com.wardrobe.constants.Enums.Visibility.PRIVATE)
                .build());
        when(jwtDecoder.decode("updated-token")).thenReturn(jwt("updated-token", "cognito-user-1")
                .claim("email", "after@example.com")
                .claim("name", "Readable Name")
                .build());

        authenticatedRequest("updated-token", 200);

        User user = userRepository.findByCognitoSub("cognito-user-1").orElseThrow();
        assertEquals("Readable Name", user.getUsername());
        assertEquals("after@example.com", user.getEmail());
    }

    @Test
    void preservesManualUsernameWhenClaimsRemainOpaque() throws Exception {
        userRepository.saveAndFlush(User.builder()
                .id(UUID.randomUUID())
                .cognitoSub("manual-user")
                .email("manual@example.com")
                .username("Closet Fan")
                .visibility(com.wardrobe.constants.Enums.Visibility.PRIVATE)
                .build());
        when(jwtDecoder.decode("manual-token")).thenReturn(jwt("manual-token", "manual-user")
                .claim("email", "manual@example.com")
                .claim("cognito:username", "google_1234567890abcdef")
                .build());

        authenticatedRequest("manual-token", 200);

        User user = userRepository.findByCognitoSub("manual-user").orElseThrow();
        assertEquals("Closet Fan", user.getUsername());
    }

    @Test
    void rejectsMissingMalformedExpiredAndWrongAudienceTokens() throws Exception {
        mockMvc.perform(get("/api/outfits"))
                .andExpect(status().isUnauthorized());

        when(jwtDecoder.decode(anyString()))
                .thenThrow(new BadJwtException("invalid issuer, audience, signature, or expiry"));

        authenticatedRequest("malformed-token", 401);
        authenticatedRequest("expired-token", 401);
        authenticatedRequest("wrong-audience-token", 401);
        assertEquals(0, userRepository.count());
    }

    @Test
    void allowsRenderLivenessHealthCheckWithoutAuthentication() throws Exception {
        mockMvc.perform(get("/actuator/health/liveness"))
                .andExpect(status().isOk());
    }

    @Test
    void allowsPreflightForConfiguredOrigin() throws Exception {
        mockMvc.perform(options("/api/users/me")
                        .header("Origin", "https://wardrobe.example")
                        .header("Access-Control-Request-Method", "GET"))
                .andExpect(status().isOk())
                .andExpect(header().string("Access-Control-Allow-Origin", "https://wardrobe.example"))
                .andExpect(header().string("Vary", org.hamcrest.Matchers.containsString("Origin")));
    }

    @Test
    void rejectsPreflightForUnconfiguredOrigin() throws Exception {
        mockMvc.perform(options("/api/users/me")
                        .header("Origin", "https://not-allowed.example")
                        .header("Access-Control-Request-Method", "GET"))
                .andExpect(status().isForbidden());
    }

    @Test
    void requiresAccessTokenUseAndConfiguredClientId() {
        Jwt wrongClient = Jwt.withTokenValue("wrong-client")
                .header("alg", "RS256")
                .subject("subject")
                .claim("token_use", "access")
                .claim("client_id", "different-client")
                .build();
        Jwt idToken = Jwt.withTokenValue("id-token")
                .header("alg", "RS256")
                .subject("subject")
                .claim("token_use", "id")
                .claim("client_id", "test-client")
                .build();

        assertEquals(true, cognitoAccessTokenValidator.validate(wrongClient).hasErrors());
        assertEquals(true, cognitoAccessTokenValidator.validate(idToken).hasErrors());
        assertEquals(false, cognitoAccessTokenValidator.validate(validJwt()).hasErrors());
    }

    private void authenticatedRequest(String token, int expectedStatus) throws Exception {
        mockMvc.perform(get("/api/outfits")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().is(expectedStatus));
    }

    private Jwt validJwt() {
        return jwt("valid-token", "cognito-user-1")
                .claim("token_use", "access")
                .claim("client_id", "test-client")
                .claim("email", "person@example.com")
                .claim("name", "Test Person")
                .build();
    }

    private Jwt.Builder jwt(String tokenValue, String subject) {
        Instant now = Instant.now();
        return Jwt.withTokenValue(tokenValue)
                .header("alg", "RS256")
                .subject(subject)
                .issuedAt(now.minusSeconds(10))
                .expiresAt(now.plusSeconds(300))
                .claim("token_use", "access")
                .claim("client_id", "test-client");
    }
}
