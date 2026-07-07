package com.wardrobe.service.aws;

public final class ImageSniffer {
    private static final byte[] PNG_SIGNATURE = new byte[] {
            (byte) 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A
    };
    private static final byte[] JPEG_SIGNATURE = new byte[] {
            (byte) 0xFF, (byte) 0xD8, (byte) 0xFF
    };
    private static final byte[] GIF87A_SIGNATURE = "GIF87a".getBytes(java.nio.charset.StandardCharsets.US_ASCII);
    private static final byte[] GIF89A_SIGNATURE = "GIF89a".getBytes(java.nio.charset.StandardCharsets.US_ASCII);
    private static final byte[] RIFF_SIGNATURE = "RIFF".getBytes(java.nio.charset.StandardCharsets.US_ASCII);
    private static final byte[] WEBP_SIGNATURE = "WEBP".getBytes(java.nio.charset.StandardCharsets.US_ASCII);

    private ImageSniffer() {
    }

    public static DetectedImage detect(byte[] bytes) {
        if (startsWith(bytes, PNG_SIGNATURE)) {
            return new DetectedImage("image/png", ".png");
        }
        if (startsWith(bytes, JPEG_SIGNATURE)) {
            return new DetectedImage("image/jpeg", ".jpg");
        }
        if (startsWith(bytes, GIF87A_SIGNATURE) || startsWith(bytes, GIF89A_SIGNATURE)) {
            return new DetectedImage("image/gif", ".gif");
        }
        if (startsWith(bytes, RIFF_SIGNATURE) && hasBytesAt(bytes, 8, WEBP_SIGNATURE)) {
            return new DetectedImage("image/webp", ".webp");
        }
        return null;
    }

    private static boolean startsWith(byte[] bytes, byte[] signature) {
        return hasBytesAt(bytes, 0, signature);
    }

    private static boolean hasBytesAt(byte[] bytes, int offset, byte[] signature) {
        if (bytes == null || bytes.length < offset + signature.length) {
            return false;
        }
        for (int index = 0; index < signature.length; index++) {
            if (bytes[offset + index] != signature[index]) {
                return false;
            }
        }
        return true;
    }

    public record DetectedImage(String contentType, String extension) {}
}
