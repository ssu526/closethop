package com.wardrobe.exception;

import org.springframework.http.HttpStatus;

public class DuplicateClothingItemException extends WardrobeException {
    public DuplicateClothingItemException() {
        super("This image is already in your wardrobe", HttpStatus.CONFLICT, "DUPLICATE_IMAGE");
    }
}
