package com.wardrobe.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;

@Configuration
@Profile("prod")
@ConfigurationProperties(prefix = "aws.cognito")
@Data
public class CognitoProperties {
    private String clientId;
    private String issuer;
}
