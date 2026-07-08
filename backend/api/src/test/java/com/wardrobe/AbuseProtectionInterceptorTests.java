package com.wardrobe;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.wardrobe.config.AbuseProtectionInterceptor;
import com.wardrobe.constants.Enums;
import com.wardrobe.entity.User;
import com.wardrobe.service.auth.CurrentUserService;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class AbuseProtectionInterceptorTests {
    @Test
    void aiSuggestionsUseSeparateBucketsPerUser() throws Exception {
        CurrentUserService currentUserService = mock(CurrentUserService.class);
        AbuseProtectionInterceptor interceptor = new AbuseProtectionInterceptor(
                new ObjectMapper(), currentUserService);
        ReflectionTestUtils.setField(interceptor, "aiPerMinute", 2);
        ReflectionTestUtils.setField(interceptor, "uploadsPerHour", 60);
        ReflectionTestUtils.setField(interceptor, "uploadIpPerHour", 200);

        User first = User.builder()
                .id(UUID.randomUUID())
                .username("first")
                .email("first@example.com")
                .visibility(Enums.Visibility.PRIVATE)
                .build();
        User second = User.builder()
                .id(UUID.randomUUID())
                .username("second")
                .email("second@example.com")
                .visibility(Enums.Visibility.PRIVATE)
                .build();

        when(currentUserService.getCurrentUser())
                .thenReturn(first)
                .thenReturn(first)
                .thenReturn(first)
                .thenReturn(second);

        assertTrue(interceptor.preHandle(aiRequest(), new MockHttpServletResponse(), new Object()));
        assertTrue(interceptor.preHandle(aiRequest(), new MockHttpServletResponse(), new Object()));

        MockHttpServletResponse limited = new MockHttpServletResponse();
        assertFalse(interceptor.preHandle(aiRequest(), limited, new Object()));
        assertTrue(limited.getStatus() == 429);

        assertTrue(interceptor.preHandle(aiRequest(), new MockHttpServletResponse(), new Object()));
    }

    private MockHttpServletRequest aiRequest() {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/outfits/suggestions");
        request.addHeader(RequestIdHeader.NAME, "test-request");
        return request;
    }

    private static final class RequestIdHeader {
        private static final String NAME = "X-Request-ID";
    }
}
