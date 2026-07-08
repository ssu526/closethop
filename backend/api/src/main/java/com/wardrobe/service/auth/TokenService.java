package com.wardrobe.service.auth;

import com.wardrobe.entity.User;

public interface TokenService {
    User validateToken(String token);
}
