package com.wardrobe.service.auth;

import com.wardrobe.entity.User;
import com.wardrobe.exception.UnauthorizedException;
import com.wardrobe.repository.UserRepository;
import com.wardrobe.service.user.UserProvisioningService;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.context.annotation.Profile;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Profile("prod")
@RequiredArgsConstructor
public class CognitoAuthenticationService implements CurrentUserService {
    private final UserRepository userRepository;
    private final UserProvisioningService provisioning;

    @Override
    @Transactional
    public User getCurrentUser() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !(authentication.getPrincipal() instanceof Jwt jwt)) {
            throw new UnauthorizedException("No authenticated user");
        }

        String subject = jwt.getSubject();
        return userRepository.findByCognitoSub(subject)
                .map(user -> updateClaims(user, jwt))
                .orElseGet(() -> provisionUser(jwt));
    }

    private User provisionUser(Jwt jwt) {
        try {
            return provisioning.create(
                    jwt.getSubject(), jwt.getClaimAsString("email"), resolveUsername(jwt));
        } catch (DataIntegrityViolationException collision) {
            return userRepository.findByCognitoSub(jwt.getSubject())
                    .orElseThrow(() -> collision);
        }
    }

    private User updateClaims(User user, Jwt jwt) {
        String email = jwt.getClaimAsString("email");
        if (email != null) {
            user.setEmail(email);
        }
        String username = resolveUsername(jwt);
        if (shouldReplaceUsername(user.getUsername(), username)) {
            user.setUsername(username);
        }
        return user;
    }

    private String resolveUsername(Jwt jwt) {
        for (String claim : new String[]{"preferred_username", "name", "username"}) {
            String value = jwt.getClaimAsString(claim);
            if (value != null && !value.isBlank()) {
                return value;
            }
        }
        String email = jwt.getClaimAsString("email");
        if (email != null && !email.isBlank()) {
            return email.split("@", 2)[0];
        }
        String cognitoUsername = jwt.getClaimAsString("cognito:username");
        if (isDisplayableUsername(cognitoUsername)) {
            return cognitoUsername.trim();
        }
        return jwt.getSubject();
    }

    private boolean shouldReplaceUsername(String currentUsername, String nextUsername) {
        if (!isDisplayableUsername(nextUsername)) {
            return isOpaqueUsername(currentUsername);
        }
        return isOpaqueUsername(currentUsername) || !isUserChosenUsername(currentUsername);
    }

    private boolean isUserChosenUsername(String username) {
        return username != null && !username.isBlank() && !isOpaqueUsername(username);
    }

    private boolean isDisplayableUsername(String username) {
        return username != null && !username.isBlank() && !isOpaqueUsername(username);
    }

    private boolean isOpaqueUsername(String username) {
        if (username == null) {
            return true;
        }
        String normalized = username.trim();
        if (normalized.isBlank()) {
            return true;
        }
        return normalized.matches("(?i)google_[a-z0-9_-]+")
                || normalized.matches("(?i)[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")
                || normalized.matches("(?i)[0-9a-f]{32}")
                || normalized.matches("(?i)[0-9a-f]{40}")
                || normalized.matches("(?i)[0-9a-f]{64}");
    }
}
