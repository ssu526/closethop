package com.wardrobe.constants;

public class Enums {

    public enum Visibility {
        PRIVATE, PUBLIC
    }

    public enum Category {
        TOPS, BOTTOMS, DRESSES, OUTERWEAR, SHOES, ACCESSORIES, BAGS
    }

    public enum ProcessingStatus {
        WAITING_FOR_UPLOAD,
        PROCESSING,
        READY,
        DUPLICATE_REJECTED,
        FAILED
    }

}
