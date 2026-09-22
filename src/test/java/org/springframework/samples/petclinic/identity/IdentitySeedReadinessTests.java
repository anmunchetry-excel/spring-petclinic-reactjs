package org.springframework.samples.petclinic.identity;

import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import jakarta.persistence.EntityManager;
import jakarta.persistence.NoResultException;
import jakarta.persistence.PersistenceContext;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.samples.petclinic.model.Role;
import org.springframework.samples.petclinic.model.User;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.notNullValue;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * Phase 1 (Simple Auth) — HSQLDB seed + entity mapping readiness.
 * Uses JDBC + JPA EntityManager (not UserRepository.findByUsername — that is Phase 2).
 */
@SpringBootTest
@ActiveProfiles({"hsqldb", "spring-data-jpa"})
@Transactional
class IdentitySeedReadinessTests {

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @PersistenceContext
    private EntityManager entityManager;

    @Test
    @DisplayName("T-P1-04: JDBC seed admin exists, enabled, password {noop}admin")
    void jdbcSeedAdminExistsEnabledWithNoopPassword() {
        Map<String, Object> row = jdbcTemplate.queryForMap(
            "SELECT username, password, enabled FROM users WHERE username = ?", "admin");

        assertThat(row.get("USERNAME").toString(), is("admin"));
        assertThat(row.get("PASSWORD").toString(), is("{noop}admin"));
        assertThat(Boolean.valueOf(row.get("ENABLED").toString()), is(true));
    }

    @Test
    @DisplayName("T-P1-05: JDBC seed admin has exactly three roles")
    void jdbcSeedAdminHasThreeRoles() {
        List<String> roles = jdbcTemplate.queryForList(
            "SELECT role FROM roles WHERE username = ? ORDER BY role", String.class, "admin");

        assertThat(roles, hasSize(3));
        assertThat(roles, containsInAnyOrder("ROLE_ADMIN", "ROLE_OWNER_ADMIN", "ROLE_VET_ADMIN"));
    }

    @Test
    @DisplayName("T-P1-06: JPA User entity maps seed admin (entity readiness, not repository)")
    void jpaUserEntityMapsSeedAdmin() {
        User admin = entityManager
            .createQuery("SELECT u FROM User u WHERE u.username = :username", User.class)
            .setParameter("username", "admin")
            .getSingleResult();

        assertThat(admin, notNullValue());
        assertThat(admin.getUsername(), is("admin"));
        assertThat(admin.getPassword(), is("{noop}admin"));
        assertThat(admin.getEnabled(), is(true));
        assertThat(admin.getRoles(), notNullValue());

        Set<String> roleNames = new HashSet<>();
        for (Role role : admin.getRoles()) {
            roleNames.add(role.getName());
            assertThat(role.getUser(), notNullValue());
            assertThat(role.getUser().getUsername(), is("admin"));
        }
        assertThat(roleNames, containsInAnyOrder("ROLE_ADMIN", "ROLE_OWNER_ADMIN", "ROLE_VET_ADMIN"));
    }

    @Test
    @DisplayName("T-P1-07: unknown username has no user row (negative)")
    void unknownUsernameHasNoUserRow() {
        Integer count = jdbcTemplate.queryForObject(
            "SELECT COUNT(*) FROM users WHERE username = ?", Integer.class, "nosuchuser");
        assertThat(count, is(0));

        assertThrows(NoResultException.class, () -> entityManager
            .createQuery("SELECT u FROM User u WHERE u.username = :username", User.class)
            .setParameter("username", "nosuchuser")
            .getSingleResult());
    }
}
