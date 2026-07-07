package com.wardrobe.service.auth;

import com.wardrobe.dto.AuthDTO;

public interface AuthCommandService {
    AuthDTO.AuthResponse login(AuthDTO.LoginRequest request);
    AuthDTO.AuthResponse register(AuthDTO.RegisterRequest request);
}
