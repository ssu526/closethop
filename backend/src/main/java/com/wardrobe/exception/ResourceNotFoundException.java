package com.wardrobe.exception;

import org.springframework.http.HttpStatus;

public class ResourceNotFoundException extends WardrobeException {
    public ResourceNotFoundException(String message) {
        super(message, HttpStatus.NOT_FOUND, "RESOURCE_NOT_FOUND");
    }
}

