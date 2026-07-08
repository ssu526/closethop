package com.wardrobe.service.user;

import com.wardrobe.constants.Enums;
import com.wardrobe.entity.User;
import com.wardrobe.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class UserProvisioningService {
    private final UserRepository users;

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public User create(String subject, String email, String username) {
        return users.saveAndFlush(User.builder()
                .cognitoSub(subject)
                .email(email)
                .username(username)
                .visibility(Enums.Visibility.PRIVATE)
                .build());
    }
}
