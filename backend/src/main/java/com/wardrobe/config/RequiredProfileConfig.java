package com.wardrobe.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;

@Configuration
@Profile("!local & !prod")
public class RequiredProfileConfig {
    public RequiredProfileConfig() {
        throw new IllegalStateException(
                "Set SPRING_PROFILES_ACTIVE to 'local' or 'prod'; refusing to start without an explicit security profile");
    }
}
