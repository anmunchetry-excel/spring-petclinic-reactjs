package org.springframework.samples.petclinic.service.userService;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.MockitoAnnotations;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.samples.petclinic.model.Role;
import org.springframework.samples.petclinic.model.User;
import org.springframework.samples.petclinic.service.UserService;

import java.util.HashSet;
import java.util.Set;

import static org.hamcrest.CoreMatchers.is;
import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.hamcrest.Matchers.notNullValue;
import static org.hamcrest.Matchers.nullValue;

public abstract class AbstractUserServiceTests {

    @Autowired
    private UserService userService;

    @BeforeEach
    public void init() {
        MockitoAnnotations.openMocks(this);
    }

    @Test
    public void shouldAddUser() throws Exception {
        User user = new User();
        user.setUsername("username");
        user.setPassword("password");
        user.setEnabled(true);
        user.addRole("OWNER_ADMIN");

        userService.saveUser(user);
        assertThat(user.getRoles().parallelStream().allMatch(role -> role.getName().startsWith("ROLE_")), is(true));
        assertThat(user.getRoles().parallelStream().allMatch(role -> role.getUser() != null), is(true));
    }

    @Test
    @DisplayName("T-BE-01 service: findUser(admin) returns enabled seed user")
    public void shouldFindSeedAdminUser() {
        User admin = userService.findUser("admin");
        assertThat(admin, notNullValue());
        assertThat(admin.getUsername(), is("admin"));
        assertThat(admin.getPassword(), is("{noop}admin"));
        assertThat(admin.getEnabled(), is(true));

        Set<String> roleNames = new HashSet<>();
        for (Role role : admin.getRoles()) {
            roleNames.add(role.getName());
        }
        assertThat(roleNames, containsInAnyOrder("ROLE_ADMIN", "ROLE_OWNER_ADMIN", "ROLE_VET_ADMIN"));
    }

    @Test
    @DisplayName("T-BE-02 service: findUser(missing) returns null")
    public void shouldReturnNullForUnknownUser() {
        assertThat(userService.findUser("nosuchuser"), nullValue());
    }
}
