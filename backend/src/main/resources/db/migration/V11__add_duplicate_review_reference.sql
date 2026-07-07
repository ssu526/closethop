ALTER TABLE clothing_items
    ADD COLUMN duplicate_of_id UUID;

ALTER TABLE clothing_items
    ADD CONSTRAINT fk_clothing_duplicate_of
    FOREIGN KEY (duplicate_of_id) REFERENCES clothing_items(id);
