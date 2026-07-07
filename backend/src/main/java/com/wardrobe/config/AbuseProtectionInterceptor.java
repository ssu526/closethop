package com.wardrobe.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.wardrobe.entity.User;
import com.wardrobe.exception.UnauthorizedException;
import com.wardrobe.service.auth.CurrentUserService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.slf4j.MDC;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

import java.io.IOException;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

@Component
@RequiredArgsConstructor
public class AbuseProtectionInterceptor implements HandlerInterceptor {
    private final ObjectMapper objectMapper;
    private final CurrentUserService currentUserService;
    private final ConcurrentHashMap<String, Window> windows = new ConcurrentHashMap<>();

    @Value("${app.rate-limit.ai-per-minute:20}")
    private int aiPerMinute;

    @Value("${app.rate-limit.uploads-per-hour:60}")
    private int uploadsPerHour;

    @Value("${app.rate-limit.upload-ip-per-hour:200}")
    private int uploadIpPerHour;

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler)
            throws Exception {
        LimitDecision decision = limitFor(request);
        if (decision == null) {
            return true;
        }

        for (LimitCheck check : decision.checks()) {
            if (!allow(check.key(), check.limit())) {
                writeRateLimitedResponse(request, response, check.limit());
                return false;
            }
        }
        return true;
    }

    private LimitDecision limitFor(HttpServletRequest request) {
        if (!"POST".equals(request.getMethod())) {
            return null;
        }

        String path = request.getRequestURI();
        if ("/api/outfits/suggestions".equals(path)) {
            User user = currentUser();
            if (user == null) {
                return null;
            }
            return new LimitDecision(new LimitCheck[] {
                    new LimitCheck("user:" + user.getId() + ":ai", new Limit("ai", aiPerMinute, 60))
            });
        }

        if ("/api/clothing".equals(path) || isReplacementUpload(path)) {
            User user = currentUser();
            if (user == null) {
                return null;
            }
            return new LimitDecision(new LimitCheck[] {
                    new LimitCheck("user:" + user.getId() + ":upload", new Limit("upload", uploadsPerHour, 3600)),
                    new LimitCheck("ip:" + clientKey(request) + ":upload-ip", new Limit("upload-ip", uploadIpPerHour, 3600))
            });
        }

        return null;
    }

    private User currentUser() {
        try {
            return currentUserService.getCurrentUser();
        } catch (UnauthorizedException exception) {
            return null;
        }
    }

    private boolean isReplacementUpload(String path) {
        return path.startsWith("/api/clothing/") && path.endsWith("/replacement");
    }

    private boolean allow(String key, Limit limit) {
        long currentWindow = Instant.now().getEpochSecond() / limit.windowSeconds();
        Window value = windows.compute(key, (ignored, existing) -> {
            if (existing == null || existing.number != currentWindow) {
                return new Window(currentWindow, new AtomicInteger(1));
            }
            existing.count.incrementAndGet();
            return existing;
        });
        if (windows.size() > 10_000) {
            windows.entrySet().removeIf(entry -> entry.getValue().number < currentWindow - 1);
        }
        return value.count.get() <= limit.requests();
    }

    private void writeRateLimitedResponse(HttpServletRequest request, HttpServletResponse response, Limit limit)
            throws IOException {
        response.setStatus(429);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setHeader("Retry-After", Long.toString(limit.windowSeconds()));
        objectMapper.writeValue(response.getOutputStream(), Map.of(
                "status", 429,
                "errorCode", "RATE_LIMITED",
                "message", "Too many requests",
                "path", request.getRequestURI(),
                "traceId", String.valueOf(MDC.get(RequestIdFilter.MDC_KEY)),
                "timestamp", Instant.now().toString()));
    }

    private String clientKey(HttpServletRequest request) {
        String forwarded = request.getHeader("X-Forwarded-For");
        return forwarded == null || forwarded.isBlank()
                ? request.getRemoteAddr()
                : forwarded.split(",", 2)[0].trim();
    }

    private record Limit(String name, int requests, long windowSeconds) {}
    private record Window(long number, AtomicInteger count) {}
    private record LimitCheck(String key, Limit limit) {}
    private record LimitDecision(LimitCheck[] checks) {}
}
