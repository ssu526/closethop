package com.wardrobe.repository;

import com.wardrobe.entity.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import org.springframework.data.jpa.repository.Lock;
import jakarta.persistence.LockModeType;

import java.util.Optional;
import java.util.List;
import java.util.UUID;
import com.wardrobe.constants.Enums;

@Repository
public interface UserRepository extends JpaRepository<User, UUID> {
    Optional<User> findByUsername(String username);
    Optional<User> findByCognitoSub(String cognitoSub);
    boolean existsByUsername(String username);
    boolean existsByEmail(String email);
    Optional<User> findByIdAndVisibility(UUID id, Enums.Visibility visibility);
    @Query("""
            SELECT u
            FROM User u
            LEFT JOIN u.clothingItems item ON item.removedAt IS NULL
            WHERE u.visibility = :visibility
              AND u.id <> :excludedUserId
            GROUP BY u
            ORDER BY COUNT(item) DESC, u.username ASC
            """)
    List<User> findExploreUsers(
            @Param("visibility") Enums.Visibility visibility,
            @Param("excludedUserId") UUID excludedUserId);
}
