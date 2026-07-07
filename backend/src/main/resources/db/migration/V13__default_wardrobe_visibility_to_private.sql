UPDATE users
SET wardrobe_visibility = 'PRIVATE'
WHERE wardrobe_visibility IS NULL;

ALTER TABLE users
    ALTER COLUMN wardrobe_visibility SET DEFAULT 'PRIVATE';

ALTER TABLE users
    ALTER COLUMN wardrobe_visibility SET NOT NULL;
