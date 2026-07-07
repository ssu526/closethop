package com.wardrobe.exception;

import lombok.AllArgsConstructor;
import lombok.Data;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.FieldError;
import org.springframework.validation.ObjectError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import jakarta.validation.ConstraintViolationException;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.MDC;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.Map;

@RestControllerAdvice
@Slf4j
public class GlobalExceptionHandler {
    @ExceptionHandler(WardrobeException.class)
    public ResponseEntity<ErrorResponse> handleWardrobeException(
            WardrobeException ex, HttpServletRequest request){
        ErrorResponse error = error(ex.getStatus(), ex.getErrorCode(), ex.getMessage(), request);
        return new ResponseEntity<>(error, ex.getStatus());
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ErrorResponse> handleValidationException(
            MethodArgumentNotValidException ex, HttpServletRequest request){
        Map<String, String> errors = new HashMap<>();
        ex.getBindingResult().getAllErrors().forEach((error) -> {
            String fieldName = error instanceof FieldError fieldError
                    ? fieldError.getField()
                    : error.getObjectName();
            String errorMessage = error.getDefaultMessage();
            errors.put(fieldName, errorMessage);
        });
        ErrorResponse error = error(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR",
                "Validation failed: " + errors, request);
        return new ResponseEntity<>(error, HttpStatus.BAD_REQUEST);
    }

    @ExceptionHandler({
            ConstraintViolationException.class,
            MethodArgumentTypeMismatchException.class,
            IllegalArgumentException.class
    })
    public ResponseEntity<ErrorResponse> handleBadRequest(
            Exception ex, HttpServletRequest request) {
        return ResponseEntity.badRequest().body(error(
                HttpStatus.BAD_REQUEST, "INVALID_REQUEST", "The request is invalid", request));
    }

    @ExceptionHandler(DataIntegrityViolationException.class)
    public ResponseEntity<ErrorResponse> handleConflict(
            DataIntegrityViolationException ex, HttpServletRequest request) {
        log.warn("Database conflict requestId={}", MDC.get("requestId"));
        return ResponseEntity.status(HttpStatus.CONFLICT).body(error(
                HttpStatus.CONFLICT, "RESOURCE_CONFLICT",
                "The request conflicts with existing data", request));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponse> handleGenericException(
            Exception ex, HttpServletRequest request) {
        log.error("Unhandled request failure", ex);
        ErrorResponse error = error(HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR",
                "An unexpected error occurred", request);
        return new ResponseEntity<>(error, HttpStatus.INTERNAL_SERVER_ERROR);
    }

    private ErrorResponse error(
            HttpStatus status, String code, String message, HttpServletRequest request) {
        return new ErrorResponse(
                status.value(), code, message, request.getRequestURI(),
                MDC.get("requestId"), LocalDateTime.now());
    }

    @Data
    @AllArgsConstructor
    public static class ErrorResponse {
        private int status;
        private String errorCode;
        private String message;
        private String path;
        private String traceId;
        private LocalDateTime timestamp;
    }
}
