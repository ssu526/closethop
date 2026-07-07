package com.wardrobe.exception;

import org.springframework.http.HttpStatus;

public class UnauthorizedException extends WardrobeException {
    public UnauthorizedException(String message) {
        super(message, HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
}
