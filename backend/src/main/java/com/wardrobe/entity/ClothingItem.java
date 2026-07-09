package com.wardrobe.entity;

import com.wardrobe.constants.Enums;
import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.NoArgsConstructor;
import lombok.ToString;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;

@Entity
@Table(name = "clothing_items")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@EqualsAndHashCode(onlyExplicitlyIncluded = true)
@ToString(exclude = {"user", "outfits"})
public class ClothingItem {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @EqualsAndHashCode.Include
    private UUID id;

    @Column(nullable = false)
    @Enumerated(EnumType.STRING)
    private Enums.Category category;

    @Column(name = "original_s3_key")
    private String originalS3Key;

    @Column(name = "processed_s3_key")
    private String processedS3Key;

    @Enumerated(EnumType.STRING)
    @Column(name = "processing_status", nullable = false, columnDefinition = "varchar(32) default 'WAITING_FOR_UPLOAD'")
    @Builder.Default
    private Enums.ProcessingStatus status = Enums.ProcessingStatus.WAITING_FOR_UPLOAD;

    @Column(name = "processing_error")
    private String processingError;

    @Column(name = "processing_attempt", nullable = false, columnDefinition = "integer default 1")
    @Builder.Default
    private int processingAttempt = 1;

    @Column(name = "processing_deadline_at")
    private LocalDateTime processingDeadlineAt;

    @Column(name = "upload_url_expires_at")
    private LocalDateTime uploadUrlExpiresAt;

    @Column(name = "uploaded_at")
    private LocalDateTime uploadedAt;

    @Column(name = "processing_started_at")
    private LocalDateTime processingStartedAt;

    @Column(name = "processed_at")
    private LocalDateTime processedAt;

    @Column(name = "original_deleted_at")
    private LocalDateTime originalDeletedAt;

    @Column(name = "image_hash")
    private String imageHash;

    @Column(name = "duplicate_of_id")
    private UUID duplicateOfId;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @ManyToMany(mappedBy = "items")
    @Builder.Default
    private Set<Outfit> outfits = new HashSet<>();

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    @Column(name = "removed_at")
    private LocalDateTime removedAt;

    @ElementCollection
    @CollectionTable(
            name = "clothing_tags",
            joinColumns = @JoinColumn(name = "clothing_item_id")
    )
    @Column(name = "tag")
    @Builder.Default
    private Set<String> tags = new HashSet<>();
}
