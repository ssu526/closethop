package com.wardrobe;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.scheduling.annotation.EnableScheduling;
import com.wardrobe.config.OutfitAiConfig;

@SpringBootApplication
@EnableScheduling
@EnableConfigurationProperties(OutfitAiConfig.class)
public class ClosetHopApplication {

    public static void main(String[] args) {
        SpringApplication.run(ClosetHopApplication.class, args);
    }

}
