package com.wardrobe.exception;

import org.springframework.http.HttpStatus;

public class ForbiddenException extends WardrobeException {
    public ForbiddenException(String message) {
        super(message, HttpStatus.FORBIDDEN, "FORBIDDEN");
    }
}