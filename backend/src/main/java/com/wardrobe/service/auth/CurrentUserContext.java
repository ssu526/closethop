package com.wardrobe.service.auth;

import com.wardrobe.entity.User;

interface CurrentUserContext {
    void setCurrentUser(User user);
    void clearCurrentUser();
}
