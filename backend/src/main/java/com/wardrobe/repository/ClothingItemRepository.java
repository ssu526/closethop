package com.wardrobe.repository;

import com.wardrobe.constants.Enums;
import com.wardrobe.entity.ClothingItem;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.repository.query.Param;
import jakarta.persistence.LockModeType;
import org.springframework.stereotype.Repository;
import java.util.List;
import java.util.UUID;
import java.time.LocalDateTime;

@Repository
public interface ClothingItemRepository extends JpaRepository<ClothingItem, UUID> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT ci FROM ClothingItem ci WHERE ci.id = :id")
    java.util.Optional<ClothingItem> findAndLockById(@Param("id") UUID id);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT ci FROM ClothingItem ci WHERE ci.status = :status " +
            "AND ci.processingDeadlineAt IS NOT NULL AND ci.processingDeadlineAt <= :now " +
            "ORDER BY ci.processingDeadlineAt ASC")
    List<ClothingItem> findAndLockOverdue(
            @Param("status") Enums.ProcessingStatus status,
            @Param("now") LocalDateTime now,
            Pageable pageable);

    Page<ClothingItem> findByUserIdAndCategoryAndRemovedAtIsNull(
            UUID userId, Enums.Category category, Pageable pageable);
    Page<ClothingItem> findByUserIdAndRemovedAtIsNull(UUID userId, Pageable pageable);
    List<ClothingItem> findByUserIdAndCategoryAndStatusAndRemovedAtIsNull(
            UUID userId,
            Enums.Category category,
            Enums.ProcessingStatus status
    );
    long countByUserIdAndRemovedAtIsNull(UUID userId);
    java.util.Optional<ClothingItem>
    findFirstByUserIdAndImageHashAndStatusAndRemovedAtIsNullAndIdNotOrderByCreatedAtAsc(
            UUID userId, String imageHash, Enums.ProcessingStatus status, UUID id);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT ci FROM ClothingItem ci WHERE ci.status = :status " +
            "AND ci.uploadUrlExpiresAt IS NOT NULL AND ci.uploadUrlExpiresAt <= :cutoff " +
            "ORDER BY ci.uploadUrlExpiresAt ASC")
    List<ClothingItem> findAndLockExpiredUploads(
            @Param("status") Enums.ProcessingStatus status,
            @Param("cutoff") LocalDateTime cutoff,
            Pageable pageable);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT ci FROM ClothingItem ci WHERE ci.status = :status " +
            "AND ci.processedS3Key IS NOT NULL " +
            "AND ci.originalS3Key IS NOT NULL " +
            "AND ci.originalDeletedAt IS NULL " +
            "ORDER BY ci.processedAt ASC")
    List<ClothingItem> findAndLockReadyItemsWithOriginalsToDelete(
            @Param("status") Enums.ProcessingStatus status,
            Pageable pageable);

    @Query("SELECT ci.category, COUNT(ci) FROM ClothingItem ci " +
            "WHERE ci.user.id = :userId AND ci.removedAt IS NULL " +
            "GROUP BY ci.category")
    List<Object[]> countActiveByCategory(@Param("userId") UUID userId);

    @Query("SELECT ci FROM ClothingItem ci WHERE ci.removedAt < :cutoff AND ci.outfits IS EMPTY")
    List<ClothingItem> findPurgeableRemovedItems(
            @Param("cutoff") LocalDateTime cutoff,
            Pageable pageable);

    @Query("SELECT DISTINCT ci FROM ClothingItem ci " +
            "LEFT JOIN ci.tags t " +
            "WHERE ci.user.id = :userId " +
            "AND ci.removedAt IS NULL " +
            "AND (:category IS NULL OR ci.category = :category) " +
            "AND (:query IS NULL OR " +
            "LOWER(ci.category) LIKE LOWER(CONCAT('%', :query, '%')) OR " +
            "LOWER(t) LIKE LOWER(CONCAT('%', :query, '%')))")
    Page<ClothingItem> searchItems(
            @Param("userId") UUID userId,
            @Param("query") String query,
            @Param("category") Enums.Category category,
            Pageable pageable
    );
}
