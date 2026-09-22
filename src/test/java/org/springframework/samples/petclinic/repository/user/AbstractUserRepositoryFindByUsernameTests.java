package org.springframework.samples.petclinic.repository.user;

import java.util.HashSet;
import java.util.Set;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.samples.petclinic.model.Role;
import org.springframework.samples.petclinic.model.User;
import org.springframework.samples.petclinic.repository.UserRepository;

import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.notNullValue;
import static org.hamcrest.Matchers.nullValue;

/**
 * Phase 2 (Simple Auth) — T-BE-01 / T-BE-02 for UserRepository.findByUsername.
 * Concrete subclasses activate each DAO profile.
 */
public abstract class AbstractUserRepositoryFindByUsernameTests {

    @Autowired
    protected UserRepository userRepository;

    @Test
    @DisplayName("T-BE-01: findByUsername(admin) returns enabled user with three roles")
    public void findByUsernameAdminReturnsSeedUserWithRoles() {
        User admin = userRepository.findByUsername("admin");

        assertThat(admin, notNullValue());
        assertThat(admin.getUsername(), is("admin"));
        assertThat(admin.getPassword(), is("{noop}admin"));
        assertThat(admin.getEnabled(), is(true));
        assertThat(admin.getRoles(), notNullValue());

        Set<String> roleNames = new HashSet<>();
        for (Role role : admin.getRoles()) {
            roleNames.add(role.getName());
        }
        assertThat(roleNames, containsInAnyOrder("ROLE_ADMIN", "ROLE_OWNER_ADMIN", "ROLE_VET_ADMIN"));
    }

    @Test
    @DisplayName("T-BE-02: findByUsername(missing) returns null")
    public void findByUsernameMissingReturnsNull() {
        User missing = userRepository.findByUsername("nosuchuser");
        assertThat(missing, nullValue());
    }
}
