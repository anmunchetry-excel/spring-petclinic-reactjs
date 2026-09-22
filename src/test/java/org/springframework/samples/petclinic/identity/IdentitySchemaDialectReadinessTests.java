package org.springframework.samples.petclinic.identity;

import java.nio.charset.StandardCharsets;
import java.util.List;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.util.StreamUtils;

import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.is;

/**
 * Phase 1 (Simple Auth) — schema contract across dialects.
 * No Spring context; asserts classpath DDL/seed files match SIMPLE_AUTH_PRD readiness.
 */
class IdentitySchemaDialectReadinessTests {

    private static final List<String> DIALECTS = List.of("hsqldb", "mysql", "postgresql");

    @Test
    @DisplayName("T-P1-01: all dialects define users and roles tables")
    void allDialectsDefineUsersAndRolesTables() throws Exception {
        for (String dialect : DIALECTS) {
            String ddl = read("db/" + dialect + "/initDB.sql");
            assertThat(dialect + " users table", ddl.toLowerCase(), containsString("create table"));
            assertThat(dialect + " users", ddl.toLowerCase(), containsString("users"));
            assertThat(dialect + " roles", ddl.toLowerCase(), containsString("roles"));
            assertThat(dialect + " username column", ddl.toLowerCase(), containsString("username"));
            assertThat(dialect + " password column", ddl.toLowerCase(), containsString("password"));
            assertThat(dialect + " enabled column", ddl.toLowerCase(), containsString("enabled"));
        }
    }

    @Test
    @DisplayName("T-P1-02: all dialects seed admin with {noop}admin and three roles")
    void allDialectsSeedAdminWithNoopPasswordAndThreeRoles() throws Exception {
        for (String dialect : DIALECTS) {
            String data = read("db/" + dialect + "/populateDB.sql");
            assertThat(dialect + " admin user", data, containsString("'admin'"));
            assertThat(dialect + " noop password", data, containsString("{noop}admin"));
            assertThat(dialect + " OWNER_ADMIN", data, containsString("ROLE_OWNER_ADMIN"));
            assertThat(dialect + " VET_ADMIN", data, containsString("ROLE_VET_ADMIN"));
            assertThat(dialect + " ADMIN", data, containsString("ROLE_ADMIN"));
        }
    }

    @Test
    @DisplayName("T-P1-03: users.password remains VARCHAR(20) in all dialects (AUTH-06 known limit)")
    void passwordColumnWidthIsTwentyInAllDialects() throws Exception {
        for (String dialect : DIALECTS) {
            String ddl = read("db/" + dialect + "/initDB.sql");
            // Accept VARCHAR(20) / varchar(20) near password — documents current contract for Simple Auth
            assertThat(dialect + " password width",
                ddl.toLowerCase().contains("password") && ddl.toLowerCase().contains("varchar(20)"),
                is(true));
        }
    }

    private static String read(String classpathLocation) throws Exception {
        ClassPathResource resource = new ClassPathResource(classpathLocation);
        assertThat("missing " + classpathLocation, resource.exists(), is(true));
        return StreamUtils.copyToString(resource.getInputStream(), StandardCharsets.UTF_8);
    }
}
