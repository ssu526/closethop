package com.wardrobe;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.scheduling.annotation.EnableScheduling;

import com.wardrobe.config.S3Properties;
import com.wardrobe.worker.WorkerProperties;

@SpringBootApplication
@EnableScheduling
@EnableConfigurationProperties({S3Properties.class, WorkerProperties.class})
public class WorkerApplication {
    public static void main(String[] args) {
        SpringApplication.run(WorkerApplication.class, args);
    }
}
