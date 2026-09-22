package org.springframework.samples.petclinic.security;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.httpBasic;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Phase 4 (Simple Auth) — HTTP Basic against JDBC users (BasicAuthenticationConfig).
 * Probe endpoint for SPA login: GET /api/owners/1.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles({"hsqldb", "spring-data-jpa"})
class BasicAuthenticationIntegrationTests {

    /** Documented login probe — seeded owner, expects 200 with valid Basic. */
    private static final String LOGIN_PROBE = "/api/owners/1";

    @Autowired
    private MockMvc mockMvc;

    @Test
    @DisplayName("T-BE-03: valid Basic admin:admin → 2xx on probe")
    void validBasicReturnsOk() throws Exception {
        mockMvc.perform(get(LOGIN_PROBE).with(httpBasic("admin", "admin")))
            .andExpect(status().isOk());
    }

    @Test
    @DisplayName("T-BE-04: wrong password → 401")
    void wrongPasswordReturnsUnauthorized() throws Exception {
        mockMvc.perform(get(LOGIN_PROBE).with(httpBasic("admin", "wrong")))
            .andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("T-BE-05: unknown user → 401")
    void unknownUserReturnsUnauthorized() throws Exception {
        mockMvc.perform(get(LOGIN_PROBE).with(httpBasic("nobody", "admin")))
            .andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("T-BE-06: no Authorization header → 401")
    void missingAuthorizationReturnsUnauthorized() throws Exception {
        mockMvc.perform(get(LOGIN_PROBE))
            .andExpect(status().isUnauthorized())
            .andExpect(header().string("WWW-Authenticate", org.hamcrest.Matchers.containsString("Basic")));
    }

    @Test
    @DisplayName("T-BE-07: login probe response JSON has no password field")
    void loginProbeResponseDoesNotContainPassword() throws Exception {
        mockMvc.perform(get(LOGIN_PROBE).with(httpBasic("admin", "admin")))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.password").doesNotExist());
    }
}
