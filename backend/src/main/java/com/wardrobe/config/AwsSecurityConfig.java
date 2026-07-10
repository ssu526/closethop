package com.wardrobe.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.MDC;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtDecoders;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.http.MediaType;

import java.time.Instant;
import java.util.Map;

@Configuration
@Profile("prod")
public class AwsSecurityConfig {
    @Bean
    SecurityFilterChain awsSecurityFilterChain(HttpSecurity http, ObjectMapper objectMapper) throws Exception {
        return http
                .cors(Customizer.withDefaults())
                .csrf(csrf -> csrf.disable())
                .sessionManagement(session ->
                        session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()
                        .requestMatchers(
                                "/actuator/health",
                                "/actuator/health/**",
                                "/favicon.ico",
                                "/api-docs/**",
                                "/swagger-ui/**",
                                "/swagger-ui.html"
                        ).permitAll()
                        .anyRequest().authenticated())
                .oauth2ResourceServer(oauth -> oauth.jwt(jwt -> {}))
                .exceptionHandling(errors -> errors
                        .authenticationEntryPoint((request, response, exception) -> {
                            response.setStatus(401);
                            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
                            objectMapper.writeValue(response.getOutputStream(), error(
                                    401, "AUTHENTICATION_REQUIRED", "Authentication is required",
                                    request.getRequestURI()));
                        })
                        .accessDeniedHandler((request, response, exception) -> {
                            response.setStatus(403);
                            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
                            objectMapper.writeValue(response.getOutputStream(), error(
                                    403, "ACCESS_DENIED", "Access is denied",
                                    request.getRequestURI()));
                        }))
                .build();
    }

    private Map<String, Object> error(int status, String code, String message, String path) {
        return Map.of(
                "status", status,
                "errorCode", code,
                "message", message,
                "path", path,
                "traceId", String.valueOf(MDC.get(RequestIdFilter.MDC_KEY)),
                "timestamp", Instant.now().toString());
    }

    @Bean
    OAuth2TokenValidator<Jwt> cognitoAccessTokenValidator(CognitoProperties properties) {
        OAuth2Error invalidToken = new OAuth2Error(
                "invalid_token",
                "Token must be a Cognito access token for this application",
                null
        );
        return token -> {
            boolean accessToken = "access".equals(token.getClaimAsString("token_use"));
            boolean correctClient = properties.getClientId()
                    .equals(token.getClaimAsString("client_id"));
            return accessToken && correctClient
                    ? OAuth2TokenValidatorResult.success()
                    : OAuth2TokenValidatorResult.failure(invalidToken);
        };
    }

    @Bean
    JwtDecoder cognitoJwtDecoder(
            CognitoProperties properties,
            OAuth2TokenValidator<Jwt> cognitoAccessTokenValidator) {
        return new LazyCognitoJwtDecoder(properties, cognitoAccessTokenValidator);
    }

    private static class LazyCognitoJwtDecoder implements JwtDecoder {
        private final CognitoProperties properties;
        private final OAuth2TokenValidator<Jwt> cognitoAccessTokenValidator;
        private volatile JwtDecoder delegate;

        private LazyCognitoJwtDecoder(
                CognitoProperties properties,
                OAuth2TokenValidator<Jwt> cognitoAccessTokenValidator) {
            this.properties = properties;
            this.cognitoAccessTokenValidator = cognitoAccessTokenValidator;
        }

        @Override
        public Jwt decode(String token) {
            return delegate().decode(token);
        }

        private JwtDecoder delegate() {
            JwtDecoder current = delegate;
            if (current == null) {
                synchronized (this) {
                    current = delegate;
                    if (current == null) {
                        current = createDecoder();
                        delegate = current;
                    }
                }
            }
            return current;
        }

        private JwtDecoder createDecoder() {
            NimbusJwtDecoder decoder = (NimbusJwtDecoder) JwtDecoders.fromIssuerLocation(
                    properties.getIssuer());
            decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(
                    JwtValidators.createDefaultWithIssuer(properties.getIssuer()),
                    cognitoAccessTokenValidator
            ));
            return decoder;
        }
    }
}
