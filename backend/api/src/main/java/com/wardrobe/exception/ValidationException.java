package com.wardrobe.exception;

import org.springframework.http.HttpStatus;

public class ValidationException extends WardrobeException {
    public ValidationException(String message) {
        super(message, HttpStatus.BAD_REQUEST, "VALIDATION_ERROR");
    }
}
