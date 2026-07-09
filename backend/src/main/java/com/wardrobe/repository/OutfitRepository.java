package com.wardrobe.repository;

import com.wardrobe.entity.Outfit;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.UUID;
import java.util.Optional;

@Repository
public interface OutfitRepository extends JpaRepository<Outfit, UUID> {
    Page<Outfit> findByUserIdAndSuggestedByIsNull(UUID userId, Pageable pageable);
    Page<Outfit> findByUserIdAndSuggestedByIsNotNull(UUID userId, Pageable pageable);
    Page<Outfit> findByUserIdAndSuggestedByIsNotNullAndAcceptedAtIsNull(UUID userId, Pageable pageable);
    @Query("""
            SELECT o FROM Outfit o
            WHERE o.user.id = :userId
              AND ((:includeCreated = true AND o.suggestedBy IS NULL)
                OR (:includeAccepted = true AND o.suggestedBy IS NOT NULL AND o.acceptedAt IS NOT NULL))
            """)
    Page<Outfit> findVisibleOutfits(
            @Param("userId") UUID userId,
            @Param("includeCreated") boolean includeCreated,
            @Param("includeAccepted") boolean includeAccepted,
            Pageable pageable);
    Optional<Outfit> findFirstByUserIdAndSuggestedByIsNullOrderByCreatedAtDesc(UUID userId);
}
