package com.wardrobe.worker;

import java.util.UUID;

public record ProcessingJob(UUID userId, UUID itemId, int version, String sourceKey) {
}
