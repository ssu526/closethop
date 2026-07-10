package com.wardrobe.service.auth;

import com.wardrobe.entity.User;
import com.wardrobe.exception.UnauthorizedException;
import com.wardrobe.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Profile;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.dao.DataIntegrityViolationException;
import com.wardrobe.service.user.UserProvisioningService;

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
        if (!isProviderGeneratedUsername(username) || isProviderGeneratedUsername(user.getUsername())) {
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
        return cognitoUsername != null && !cognitoUsername.isBlank()
                ? cognitoUsername
                : jwt.getSubject();
    }

    private boolean isProviderGeneratedUsername(String username) {
        return username != null && username.matches("(?i)google_[a-z0-9_-]+");
    }
}
