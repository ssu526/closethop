CREATE TABLE users (
    id UUID PRIMARY KEY,
    cognito_sub VARCHAR(255) UNIQUE,
    email VARCHAR(255) UNIQUE,
    username VARCHAR(255) NOT NULL,
    password VARCHAR(255),
    avatar_url VARCHAR(2048),
    s3_object_key VARCHAR(1024),
    wardrobe_visibility VARCHAR(32),
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

CREATE TABLE clothing_items (
    id UUID PRIMARY KEY,
    category VARCHAR(32) NOT NULL,
    image_url VARCHAR(2048),
    s3_object_key VARCHAR(1024),
    processing_status VARCHAR(32) NOT NULL DEFAULT 'READY',
    processing_error VARCHAR(255),
    processing_version INTEGER NOT NULL DEFAULT 1,
    image_hash VARCHAR(128),
    user_id UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    removed_at TIMESTAMP
);

CREATE TABLE clothing_tags (
    clothing_item_id UUID NOT NULL REFERENCES clothing_items(id),
    tag VARCHAR(80)
);

CREATE TABLE outfits (
    id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id),
    suggested_by_user_id UUID REFERENCES users(id),
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

CREATE TABLE outfit_items (
    outfit_id UUID NOT NULL REFERENCES outfits(id),
    clothing_item_id UUID NOT NULL REFERENCES clothing_items(id),
    PRIMARY KEY (outfit_id, clothing_item_id)
);

CREATE TABLE processing_jobs (
    id UUID PRIMARY KEY,
    item_id UUID NOT NULL,
    user_id UUID NOT NULL,
    source_key VARCHAR(1024) NOT NULL,
    version INTEGER NOT NULL,
    status VARCHAR(32) NOT NULL,
    publish_attempts INTEGER NOT NULL DEFAULT 0,
    claimed_until TIMESTAMP,
    created_at TIMESTAMP,
    CONSTRAINT uk_processing_item_version UNIQUE (item_id, version)
);
