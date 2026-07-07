package com.wardrobe.exception;

import org.springframework.http.HttpStatus;

public class WardrobeException extends RuntimeException{
    private final HttpStatus status;
    private final String errorCode;

    public WardrobeException(String message, HttpStatus status, String errorCode){
        super(message);
        this.status = status;
        this.errorCode = errorCode;
    }

    public HttpStatus getStatus(){return this.status;}
    public String getErrorCode(){return this.errorCode;}
}
