package com.wardrobe.service.auth;

import com.wardrobe.constants.Enums;
import com.wardrobe.dto.AuthDTO;
import com.wardrobe.entity.User;
import com.wardrobe.exception.UnauthorizedException;
import com.wardrobe.exception.ValidationException;
import com.wardrobe.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.context.annotation.Profile;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@Service
@Profile("local")
@RequiredArgsConstructor
public class SimpleAuthenticationService
        implements AuthCommandService, CurrentUserService, TokenService, CurrentUserContext {
    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final ThreadLocal<User> currentUser = new ThreadLocal<>();
    private final Map<String, UUID> activeTokens = new ConcurrentHashMap<>();

    @Override
    @Transactional
    public AuthDTO.AuthResponse login(AuthDTO.LoginRequest request) {
        User user = userRepository.findByUsername(request.getUsername())
                .orElseThrow(() -> new UnauthorizedException("Invalid username or password"));

        if (!passwordEncoder.matches(request.getPassword(), user.getPassword())) {
            throw new UnauthorizedException("Invalid username or password");
        }

        String token = issueToken(user);

        return AuthDTO.AuthResponse.builder()
                .userId(user.getId())
                .username(user.getUsername())
                .token(token)
                .build();
    }

    @Override
    @Transactional
    public AuthDTO.AuthResponse register(AuthDTO.RegisterRequest request) {
        if (userRepository.existsByUsername(request.getUsername())) {
            throw new ValidationException("Username already exists");
        }
        if (userRepository.existsByEmail(request.getEmail())) {
            throw new ValidationException("Email already exists");
        }

        User user = User.builder()
                .email(request.getEmail())
                .username(request.getUsername())
                .password(passwordEncoder.encode(request.getPassword()))
                .visibility(Enums.Visibility.PRIVATE)
                .build();

        user = userRepository.save(user);

        String token = issueToken(user);

        return AuthDTO.AuthResponse.builder()
                .userId(user.getId())
                .username(user.getUsername())
                .token(token)
                .build();
    }

    @Override
    public User validateToken(String token) {
        UUID userId = activeTokens.get(token);
        if (userId == null) {
            throw new UnauthorizedException("Invalid token");
        }
        return userRepository.findById(userId)
                .orElseThrow(() -> new UnauthorizedException("Invalid token"));
    }

    @Override
    public User getCurrentUser() {
        User user = currentUser.get();
        if (user == null) {
            throw new UnauthorizedException("No authenticated user");
        }
        return user;
    }

    @Override
    public void setCurrentUser(User user) {
        currentUser.set(user);
    }

    @Override
    public void clearCurrentUser() {
        currentUser.remove();
    }

    private String issueToken(User user) {
        String token = UUID.randomUUID().toString();
        activeTokens.put(token, user.getId());
        return token;
    }
}
