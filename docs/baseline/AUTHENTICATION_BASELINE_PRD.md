Date created: 2026-09-16
Date last modified: 2026-09-16

# Authentication & Identity - Baseline Technical PRD

> **This is a baseline PRD.** It documents the authentication vertical slice **as it exists
> today**, verified against a running instance, and defines the remediation work that follows.
> It is not a proposal for a greenfield feature. Sections describing current behaviour are
> evidence-based; sections describing future work are marked `PLANNED`.
>
> Part of a set of per-slice baseline PRDs. Companion documents:
> [ARCHITECTURE.md](./ARCHITECTURE.md),
> [BASELINE_UPDATES_FOR_MODERNIZATION.md](./BASELINE_UPDATES_FOR_MODERNIZATION.md).

---



## Overview/Problem

Authentication is the topmost capability in this system: every other vertical slice (owners,
pets, vets, visits, specialties, pet types) carries `@PreAuthorize` annotations that are inert
until this slice is switched on. Today it ships **disabled by default**, so the entire API is
publicly writable by anyone who can reach the port.

When it is switched on, the implementation is demo-grade rather than production-grade.
Credentials are stored and compared in plaintext, the only mechanism is HTTP Basic with no
session or token, authorization failures report the wrong status code while leaking internal
exception class names, and the React frontend contains no authentication code whatsoever — so
enabling security breaks the entire UI. Turning security on also locks out the Swagger
documentation and the Actuator health endpoint, which breaks container health probes.

The practical consequence is that there is no supported configuration in which this application
is both usable and secure. That blocks any deployment outside a local demo, and it blocks the
remaining slices from being modernized behind a trustworthy authorization boundary.

---



## Hypothesis

We believe that replacing plaintext HTTP Basic with hashed credentials and a stateless
token-based flow the SPA can drive, while correcting the status-code and CORS handling, will
make the application deployable outside a demo context for operators and end users — without
requiring changes to the domain, DAO or service layers.

---



## Scope



### In Scope

The authentication and identity vertical slice, documented end to end across every layer:

- **Database** — the `users` and `roles` tables, their constraints and seed data
- **DAO** — `UserRepository` and its three profile-specific implementations, plus the *second*,
separate JDBC credential-read path used by Spring Security
- **Service** — `UserService` / `UserServiceImpl`, role normalisation, absence of encoding
- **API** — `POST /api/users`, `UserRestController`, `UserMapper`, the DTO shapes
- **Security configuration** — `WebSecurityConfig`, `DisableSecurityConfig`,
`BasicAuthenticationConfig`, `Roles`
- **Authorization** — the `@PreAuthorize` role matrix applied across all other slices
- **CORS** — as it interacts with authentication
- **Frontend** — the current (absent) authentication handling in the React client
- **Verified behaviour** — measured status codes for authenticated, unauthenticated and
under-privileged requests
- **Identified gaps** and a phased remediation plan



### Out of Scope

Not addressed in this PRD; each will have its own baseline PRD:

- The business behaviour of the owners, pets, vets, visits, specialties and pet types slices.
Only their *authorization annotations* are in scope here.
- The frontend build modernization, already recorded in `BASELINE_UPDATES_FOR_MODERNIZATION.md`.
- Multi-tenancy, organisations, or any grouping of users beyond the three flat roles.
- Federated identity (OAuth2/OIDC/SAML) and social login.
- Password reset, email verification, account lockout, MFA.



### Cut

Considered while planning this baseline and deliberately excluded:

- **Fixing the defects as part of this document.** Cut because the baseline must first be an
accurate record of the starting point; remediation is sequenced in
[Implementation Phases](#implementation-phases) and needs review before any code changes.
- **Recommending a specific token technology (JWT vs opaque session).** Cut because the choice
depends on deployment topology that has not been decided; Phase 2 records the decision point
rather than pre-empting it.
- **Documenting the generated** `rest.api`**/**`rest.dto` **sources file by file.** Cut because they are
build artefacts regenerated from `openapi.yml`; the contract is documented instead.

---



## Technical Requirements

Everything in this section describes the **current** implementation.

### Database Schema

Two tables, created by `src/main/resources/db/hsqldb/initDB.sql` (equivalents exist for MySQL
and PostgreSQL). Hibernate does not manage this schema — `spring.jpa.hibernate.ddl-auto=none`.

```sql
CREATE TABLE users (
  username    VARCHAR(20) NOT NULL,
  password    VARCHAR(20) NOT NULL,
  enabled     BOOLEAN DEFAULT TRUE NOT NULL,
  PRIMARY KEY (username)
);

CREATE TABLE roles (
  id          INTEGER IDENTITY PRIMARY KEY,
  username    VARCHAR(20) NOT NULL,
  role        VARCHAR(20) NOT NULL
);
ALTER TABLE roles ADD CONSTRAINT fk_username FOREIGN KEY (username) REFERENCES users (username);
CREATE INDEX fk_username_idx ON roles (username);
```

Notes on the schema as it stands:

- `username` is the natural primary key; there is no surrogate id and no `User.id` field.
- `password` **is** `VARCHAR(20)`**.** A bcrypt hash is 60 characters, so the column cannot hold one.
Any move to hashed credentials requires a schema migration.
- The JPA entity declares a uniqueness constraint that the DDL does not:
`@Table(name = "roles", uniqueConstraints = @UniqueConstraint(columnNames = {"username", "role"}))`
in `model/Role.java`. Since `ddl-auto=none`, **this constraint is never created**, so duplicate
role rows are possible at the database level.
- There are no audit columns (`created_at`, `last_login`, `failed_attempts`) and no
`account_locked` / `credentials_expired` flags.

#### Schema evolution: there is no migration framework

Verified against the built artefact: **neither Flyway nor Liquibase is present** — not in
`pom.xml`, and not among the 90 jars bundled in `target/spring-petclinic-rest-3.2.1.jar`. There
is no `db/migration` directory and no changelog file anywhere in the project.

Schema management is Spring Boot's plain SQL init, with Hibernate explicitly disabled
(`spring.jpa.hibernate.ddl-auto=none` in all three profiles), so these scripts are the only
source of schema:

| Database | Scripts | Enabled by default? |
|---|---|---|
| HSQLDB | `db/hsqldb/initDB.sql` + `populateDB.sql` | Yes |
| MySQL | `db/mysql/initDB.sql` + `populateDB.sql` | No — commented out |
| PostgreSQL | `db/postgresql/initDB.sql` + `populateDB.sql` | No — commented out |

The scripts are **create-from-scratch, not incremental**. `initDB.sql` opens with
`DROP TABLE ... IF EXISTS` for all nine tables and recreates them. There is no version table, no
ordering, and no up/down concept, so there is no mechanism to evolve a database that already
holds data. With the default in-memory HSQLDB this is invisible — the schema is rebuilt and
reseeded on every startup — but it becomes blocking the moment a persistent database is used.
MySQL and PostgreSQL additionally ship `petclinic_db_setup_*.txt` files with manual setup
instructions, which is itself a sign that schema management here is a documented manual
procedure rather than an automated one.

This directly constrains the work in this PRD. Both `AUTH-06` (widen `users.password` so it can
hold a 60-character bcrypt hash) and `AUTH-13` (add the `roles` uniqueness constraint the entity
declares) are schema changes that today would have to be applied by hand to three dialects, with
no record of which environment has received them. Adopting a migration tool is therefore a
**prerequisite for Phase 1**, not a later nice-to-have. Tracked as `AUTH-14`.

Seed data, from `db/hsqldb/populateDB.sql` — a single user with all three roles:

```sql
INSERT INTO users(username,password,enabled) VALUES ('admin','{noop}admin', true);
INSERT INTO roles (username, role) VALUES ('admin', 'ROLE_OWNER_ADMIN');
INSERT INTO roles (username, role) VALUES ('admin', 'ROLE_VET_ADMIN');
INSERT INTO roles (username, role) VALUES ('admin', 'ROLE_ADMIN');
```

`{noop}` is the Spring Security `DelegatingPasswordEncoder` prefix meaning *no encoding*. The
stored password is literally `admin`.

### DAO layer

**Two independent data paths read these tables**, which is the single most surprising thing
about this slice.

**Path 1 — the repository, used for writes only.** `repository/UserRepository.java` is a
one-method interface:

```java
public interface UserRepository {
    void save(User user) throws DataAccessException;
}
```

Implemented three times and selected by profile, matching the pattern used by every other slice:


| Implementation                                      | Profile                       |
| --------------------------------------------------- | ----------------------------- |
| `repository/springdatajpa/SpringDataUserRepository` | `spring-data-jpa` *(default)* |
| `repository/jpa/JpaUserRepositoryImpl`              | `jpa`                         |
| `repository/jdbc/JdbcUserRepositoryImpl`            | `jdbc`                        |


There is **no** `findByUsername`, `findAll`, `update` or `delete`. Identity management through
the application is create-only.

**Path 2 — raw JDBC, used for authentication.** Spring Security never touches the repository.
`BasicAuthenticationConfig` queries the tables directly:

```java
auth.jdbcAuthentication()
    .dataSource(dataSource)
    .usersByUsernameQuery("select username,password,enabled from users where username=?")
    .authoritiesByUsernameQuery("select username,role from roles where username=?");
```

Consequences: the profile-switching abstraction does not apply to authentication (it is always
JDBC, even under the `jpa` profile); the `enabled` flag is honoured only on this path; and the
two paths must be kept in sync by hand if the schema changes.

### Entities

`model/User.java` — note it does **not** extend `BaseEntity`, because its key is the username:

```java
@Entity
@Table(name = "users")
public class User {
    @Id @Column(name = "username") private String username;
    @Column(name = "password")     private String password;
    @Column(name = "enabled")      private Boolean enabled;

    @OneToMany(cascade = CascadeType.ALL, mappedBy = "user", fetch = FetchType.EAGER)
    private Set<Role> roles;
}
```

`model/Role.java` extends `BaseEntity`, holds a `@ManyToOne` back-reference to `User` annotated
`@JsonIgnore` to break the serialisation cycle, and maps its `name` field to the `role` column.

### Service layer

`service/UserServiceImpl.java` is the whole of the identity business logic:

```java
@Override
@Transactional
public void saveUser(User user) {
    if (user.getRoles() == null || user.getRoles().isEmpty()) {
        throw new IllegalArgumentException("User must have at least a role set!");
    }
    for (Role role : user.getRoles()) {
        if (!role.getName().startsWith("ROLE_")) {
            role.setName("ROLE_" + role.getName());
        }
        if (role.getUser() == null) {
            role.setUser(user);
        }
    }
    userRepository.save(user);
}
```

It does exactly three things: rejects a user with no roles, normalises role names to the
`ROLE_` prefix Spring Security expects, and back-links each role to its user so the cascade
persists both. **No** `PasswordEncoder` **is involved at any point** — `user.getPassword()` is
persisted verbatim.

The empty-roles rejection throws `IllegalArgumentException`, which the global advice converts
to a 400 (see [Error handling](#error-handling)).

### API Endpoints

The slice exposes exactly one endpoint.

#### POST /api/users

Creates a user. Declared in `openapi.yml`; implemented by
`rest/controller/UserRestController.java`. Guarded by `@PreAuthorize("hasRole(@roles.ADMIN)")`,
which is inert while security is disabled.

**Request Body:**

```json
{
  "username": "vetonly",
  "password": "{noop}vetpass",
  "enabled": true,
  "roles": [ { "name": "VET_ADMIN" } ]
}
```

**Response:**

- Success (201): the created user — **including the password field**
  ```json
  {
    "username": "vetonly",
    "password": "{noop}vetpass",
    "enabled": true,
    "roles": [ { "name": "ROLE_VET_ADMIN" } ]
  }
  ```
- Error (400): no roles supplied, malformed body, **or access denied** — all collapse to 400
- Error (401): security enabled and no/invalid credentials

Observed behaviours worth recording:

- Role names are echoed back with the `ROLE_` prefix applied by the service.
- The password is returned in the response body.
- A password submitted **without** an encoder prefix such as `{noop}` is persisted but is
unusable for login: `DelegatingPasswordEncoder` cannot identify the encoding and rejects it.
Creating a working user therefore requires literally sending `"password": "{noop}secret"`.

There are no `GET /api/users`, `PUT`, `DELETE`, login, logout, refresh or "current user"
endpoints.

### Authentication mechanism

Controlled by a single property in `application.properties`:

```properties
petclinic.security.enable=false
```

Three configuration classes participate:


| Class                                | Condition                | Effect                                                                                                                          |
| ------------------------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `security/WebSecurityConfig`         | **none — always active** | `apiFilterChain` bean: permit all, CSRF off, plus a restrictive CORS policy                                                     |
| `security/DisableSecurityConfig`     | `...enable=false`        | `filterChain` bean: permit all, CSRF off                                                                                        |
| `security/BasicAuthenticationConfig` | `...enable=true`         | `filterChain` bean: `anyRequest().authenticated()`, HTTP Basic, JDBC auth, `@EnableGlobalMethodSecurity(prePostEnabled = true)` |


Because `WebSecurityConfig` carries no `@ConditionalOnProperty`, **two** `SecurityFilterChain`
**beans always exist**, both matching `/`**. Which one applies is decided by bean ordering rather
than by anything explicit in the code. Measured behaviour shows `BasicAuthenticationConfig`
wins for authentication, while `WebSecurityConfig`'s CORS policy never takes effect. Nothing
pins this ordering, so it must be re-tested after any change to these classes.

Authentication is **stateless HTTP Basic**: credentials are sent on every request. There is no
session, token, refresh or logout. CSRF is disabled in all three configurations, which is
consistent with a stateless API.

### Authorization model

`security/Roles.java` is a `@Component` holding three constants, referenced from annotations via
SpEL (`@PreAuthorize("hasRole(@roles.OWNER_ADMIN)")`):

```java
@Component
public class Roles {
    public final String OWNER_ADMIN = "ROLE_OWNER_ADMIN";
    public final String VET_ADMIN   = "ROLE_VET_ADMIN";
    public final String ADMIN       = "ROLE_ADMIN";
}
```


| Role               | Grants access to                    |
| ------------------ | ----------------------------------- |
| `ROLE_OWNER_ADMIN` | owners, pets, pet types, visits     |
| `ROLE_VET_ADMIN`   | vets, specialties                   |
| `ROLE_ADMIN`       | user management (`POST /api/users`) |


The model is flat: three coarse roles, no permissions, no hierarchy (an `ADMIN` does **not**
inherit the other two — the seed user is granted all three explicitly), and no per-record
ownership. An authenticated `OWNER_ADMIN` may read and modify *every* owner's data.

The annotations live on the controllers of the other slices and are always present in the
bytecode; `@EnableGlobalMethodSecurity` in `BasicAuthenticationConfig` is what activates them.
Enabling security therefore changes authorization behaviour across the entire API at once.

### Error handling

`rest/advice/ExceptionControllerAdvice` declares a single catch-all handler:

```java
@ExceptionHandler(Exception.class)
public ResponseEntity<String> exception(Exception e) {
    ...
    return ResponseEntity.badRequest().body(respJSONstring);   // always 400
}
```

For this slice that means an `AccessDeniedException` is returned as **400 instead of 403**, with
a body disclosing the internal type:

```json
{"className":"org.springframework.security.access.AccessDeniedException","exMessage":"Access is denied"}
```

401 responses are produced by the Spring Security filter chain, which runs before the
`@ControllerAdvice`, so those are correct.

### User Interface Requirements

**Current state: the React client contains no authentication code at all.** A search of
`client/src` for `Authorization`, `credentials`, `btoa`, `login` or `Basic`  returns nothing.

Consequently there is:

- no login page and no route for one (`configureRoutes.tsx` has no `/login`);
- no credential capture, storage or attachment — `util/index.tsx` builds plain `fetch` calls
with only `Accept` and `Content-Type` headers;
- no 401 handling, no redirect-to-login, no logout control, no "signed in as" indicator;
- no notion of the current user's roles, so the UI cannot hide actions a user may not perform.

With `petclinic.security.enable=true`, every API call from the SPA returns 401 and the
application is unusable. Because the backend returns `WWW-Authenticate: Basic realm="Realm"`,
a browser responds by showing its **native credential popup** rather than anything the
application controls.

A minimum usable UI for an authenticated build would need: a login route, credential capture,
authenticated request decoration, 401 interception with redirect, a logout affordance, and
role-aware rendering. None of it exists today.

---



## Implementation Phases



### Phase 0: Baseline documentation - COMPLETED

**Objective**: Establish a verified, evidence-based record of the authentication slice as it
exists, so remediation can be sequenced against a known starting point.

**Tasks**:

1. Read and document every layer of the slice — schema, DAO, service, API, security config.
2. Empirically verify authentication and authorization against a running secured instance.
3. Verify CORS, documentation and health-endpoint behaviour under security.
4. Confirm the frontend's authentication posture.
5. Record all gaps with evidence.

**Deliverables**:

- This document.
- Verification results recorded in [Acceptance Criteria](#acceptance-criteria).
- Gaps `AUTH-01` … `AUTH-14` in [Identified gaps](#identified-gaps).



### Phase 1: Correct credential storage and error semantics - PLANNED

**Objective**: Make the existing mechanism safe and honest without changing its shape, so the
slice can be secured without a frontend rewrite.

**Tasks**:

1. **Adopt a migration framework (`AUTH-14`) before any other task in this phase.** Introduce
  Flyway or Liquibase, baseline the existing schema, and express every task below as a versioned
  migration rather than an edit to `initDB.sql`. Decide first whether all three database
  dialects still need support — maintaining three parallel script sets is exactly the kind of
  duplication that drifts.
2. Widen `users.password` to at least `VARCHAR(255)` in all supported dialects; migrate seed data.
3. Introduce a `PasswordEncoder` bean; encode in `UserServiceImpl.saveUser`.
4. Remove `password` from `UserDto` responses (`@JsonProperty(access = WRITE_ONLY)` or a
  dedicated response DTO).
5. Replace the catch-all advice with specific handlers so `AccessDeniedException` → 403,
  not-found → 404, integrity violations → 409; stop returning internal class names.
6. Add the `roles` uniqueness constraint to match the entity declaration.

**Deliverables**:

- A migration tool wired in, with the current schema baselined as the initial version.
- Versioned migrations for the password-column widening and the `roles` constraint.
- Updated `UserServiceImpl`, `UserDto`, `ExceptionControllerAdvice`.
- Tests covering encode-on-save, password-absent-from-response, and 403-on-denial.



### Phase 2: Session/token strategy decision - PLANNED

**Objective**: Choose the authentication transport that the SPA will drive, and record why.

**Decision point** — not pre-empted by this document. Options: stateless JWT, opaque
server-side session cookie, or retaining HTTP Basic behind a reverse proxy that terminates
auth. Selection depends on deployment topology, which is undecided.

**Tasks**:

1. Document the deployment topology constraints.
2. Evaluate the options against them; record the decision and rationale here.
3. Suppress the `WWW-Authenticate: Basic` header so browsers stop showing the native popup.
4. Specify login/logout/current-user endpoints for the chosen approach.

**Deliverables**:

- A decision record appended to this PRD.
- An updated `openapi.yml` describing the new endpoints.



### Phase 3: Frontend authentication - PLANNED

**Objective**: Make the UI usable against a secured backend.

**Tasks**:

1. Add a `/login` route and credential capture form.
2. Centralise credential attachment in `client/src/util/index.tsx`, the single place all
  requests already pass through.
3. Intercept 401 and redirect to login; add a logout control and a signed-in indicator.
4. Gate navigation and actions on the current user's roles.

**Deliverables**:

- Login page, auth context/store, updated `util/index.tsx`.
- Browser-verified flows for login, logout, session expiry and access denial.



### Phase 4: Operational hardening - PLANNED

**Objective**: Make a secured deployment operable.

**Tasks**:

1. Permit `actuator/health` (at minimum the liveness/readiness probes) without credentials.
2. Decide and implement an access policy for Swagger UI and `v3/api-docs`.
3. Resolve the CORS contradiction: remove either `WebSecurityConfig`'s unused policy or the
  controller `@CrossOrigin` annotations, so one policy is authoritative.
4. Make `WebSecurityConfig` conditional, or merge it, so only one `SecurityFilterChain` is ever
  present and behaviour no longer depends on bean ordering.
5. Remove the seeded `admin/admin` account from non-development profiles.

**Deliverables**:

- Updated security configuration with a single authoritative filter chain and CORS policy.
- Verified health probes under security.



### Phase 5: Identity model extension - PLANNED

**Objective**: Support real user administration.

**Tasks**:

1. Extend `UserRepository` with find/update/delete; add the matching endpoints.
2. Add audit columns and account-state flags.
3. Decide whether authentication should read through the repository rather than raw JDBC, so the
  profile abstraction holds.

---



## Technical Implementation Details



### Key Files

**Backend — security configuration**

- `src/main/java/.../security/WebSecurityConfig.java` - always-active chain; permit-all plus an unused CORS policy
- `src/main/java/.../security/BasicAuthenticationConfig.java` - active when enabled; HTTP Basic + JDBC auth; enables `@PreAuthorize`
- `src/main/java/.../security/DisableSecurityConfig.java` - active when disabled; permit-all
- `src/main/java/.../security/Roles.java` - the three role-name constants referenced by SpEL

**Backend — identity slice**

- `src/main/java/.../model/User.java` - entity keyed by username, eager `roles`
- `src/main/java/.../model/Role.java` - entity; `name` ↔ `role` column; `@JsonIgnore` back-reference
- `src/main/java/.../repository/UserRepository.java` - single-method write interface
- `src/main/java/.../repository/{jpa,jdbc,springdatajpa}/*UserRepository*.java` - three implementations
- `src/main/java/.../service/UserServiceImpl.java` - role normalisation; **no password encoding**
- `src/main/java/.../rest/controller/UserRestController.java` - `POST /api/users`, `@PreAuthorize(ADMIN)`
- `src/main/java/.../mapper/UserMapper.java` - MapStruct User/Role ↔ DTO
- `src/main/java/.../rest/advice/ExceptionControllerAdvice.java` - catch-all that breaks status codes

**Backend — schema and seed**

- `src/main/resources/db/{hsqldb,mysql,postgresql}/initDB.sql` - `users` and `roles` DDL
- `src/main/resources/db/{hsqldb,mysql,postgresql}/populateDB.sql` - the `admin` seed user
- `src/main/resources/openapi.yml` - `User` and `Role` schemas; the `/users` path
- `src/main/resources/application.properties` - `petclinic.security.enable`

**Frontend**

- `client/src/util/index.tsx` - the single choke point every request passes through; the natural
place to attach credentials in Phase 3
- `client/src/configureRoutes.tsx` - route table; has no `/login`



### Implementation Patterns

Role check on a controller method, resolving the constant from the `Roles` bean:

```java
@PreAuthorize("hasRole(@roles.OWNER_ADMIN)")
@Override
public ResponseEntity<List<OwnerDto>> listOwners(String lastName) { ... }
```

Enabling a configuration by property, the mechanism behind the three security classes:

```java
@Configuration
@ConditionalOnProperty(name = "petclinic.security.enable", havingValue = "true")
public class BasicAuthenticationConfig { ... }
```

Calling the secured API:

```powershell
curl.exe -u admin:admin http://localhost:9966/petclinic/api/owners
```



### Important Notes

- **The default build is unauthenticated.** Every endpoint, including `POST /api/users`, is
public out of the box.
- `{noop}` **is load-bearing.** Any password stored without an encoder prefix cannot be used to
log in, even though the user row is created successfully.
- **Two filter chains always exist.** Verify authentication *and* CORS after touching any
security class; the outcome depends on bean ordering, not on declared intent.
- **Authentication bypasses the repository layer.** Changing `UserRepository` will not change
how credentials are read.
- **Enabling security breaks the SPA, Swagger UI and the health endpoint** simultaneously.
- Role names are persisted **with** the `ROLE_` prefix, applied by the service, not the mapper.

---



## Acceptance Criteria



### Verified true today (baseline)

Measured against an instance started with `--petclinic.security.enable=true` on port 9977, and
the default instance on 9966.

- [x] With security disabled, all endpoints are reachable with no credentials
- [x] With security enabled, `GET /api/vets` without credentials returns **401**
- [x] With security enabled, `GET /api/vets` with a wrong password returns **401**
- [x] With security enabled, `GET /api/vets` as `admin:admin` returns **200**
- [x] `POST /api/users` as `admin` creates a `VET_ADMIN`-only user and returns **201**
- [x] Role names are returned with the `ROLE_` prefix applied
- [x] That user can `GET /api/vets` (holds `VET_ADMIN`) — **200**
- [x] A CORS preflight succeeds without credentials, so the browser is not blocked at preflight
- [x] A 401 response carries `WWW-Authenticate: Basic realm="Realm"` and CORS headers



### Failing today — must pass after remediation

- [ ] A user lacking the required role receives **403** — *currently returns 400* (`AUTH-01`)
- [ ] Error responses do not disclose internal exception class names (`AUTH-02`)
- [ ] Passwords are stored hashed, never plaintext (`AUTH-03`)
- [ ] `POST /api/users` does not return the password in its response (`AUTH-04`)
- [ ] A password submitted without an encoder prefix still produces a usable login (`AUTH-05`)
- [ ] `users.password` can hold a bcrypt hash — *currently* `VARCHAR(20)` (`AUTH-06`)
- [ ] The SPA remains usable with security enabled (`AUTH-07`)
- [ ] `actuator/health` is reachable for probes with security enabled — *currently 401* (`AUTH-08`)
- [ ] Exactly one CORS policy is authoritative; a request from an unapproved origin is refused — *currently `evil.com` receives `Access-Control-Allow-Origin: *`* (`AUTH-09`)
- [ ] Exactly one `SecurityFilterChain` is present, so behaviour does not depend on bean ordering (`AUTH-10`)
- [ ] Schema changes are applied as versioned, repeatable migrations — *currently hand-edited `initDB.sql` per dialect, with no version tracking* (`AUTH-14`)



### Identified gaps


| ID        | Gap                                                                    | Evidence                                            | Severity                |
| --------- | ---------------------------------------------------------------------- | --------------------------------------------------- | ----------------------- |
| `AUTH-01` | Access denied returns 400, not 403                                     | `GET /owners` as `VET_ADMIN`-only user → 400        | High                    |
| `AUTH-02` | Error bodies leak internal class names                                 | `{"className":"...AccessDeniedException"}`          | Medium                  |
| `AUTH-03` | Passwords stored in plaintext                                          | `UserServiceImpl.saveUser`; seed uses `{noop}`      | Critical                |
| `AUTH-04` | Password echoed in API response                                        | `POST /api/users` 201 body                          | High                    |
| `AUTH-05` | Passwords without an encoder prefix cannot log in                      | `DelegatingPasswordEncoder` behaviour               | Medium                  |
| `AUTH-06` | `users.password` is `VARCHAR(20)`                                      | `initDB.sql`                                        | High (blocks `AUTH-03`) |
| `AUTH-07` | Frontend has no authentication whatsoever                              | no matches in `client/src`                          | Critical                |
| `AUTH-08` | Swagger UI, api-docs and `actuator/health` all 401 when secured        | measured: 401, 401, 401                             | High                    |
| `AUTH-09` | `WebSecurityConfig` CORS policy is dead code                           | preflight from `evil.com` allowed; `DELETE` allowed | High                    |
| `AUTH-10` | Two always-present filter chains; ordering decides behaviour           | `WebSecurityConfig` has no condition                | Medium                  |
| `AUTH-11` | No user read/update/delete; create-only identity management            | `UserRepository` has only `save`                    | Medium                  |
| `AUTH-12` | Flat roles; no per-record ownership                                    | any `OWNER_ADMIN` may edit any owner                | Medium                  |
| `AUTH-13` | `roles` uniqueness constraint declared on the entity but never created | `ddl-auto=none`                                     | Low                     |
| `AUTH-14` | No database migration framework; schema is drop-and-recreate SQL       | no Flyway/Liquibase in `pom.xml` or the 90 bundled jars | High (blocks `AUTH-06`, `AUTH-13`) |


---



## Success Metrics


| Metric                                   | Target                                        | How Measured                                               |
| ---------------------------------------- | --------------------------------------------- | ---------------------------------------------------------- |
| Plaintext credentials at rest            | 0                                             | Inspect `users.password`; no value without a hash prefix   |
| Correct authorization status codes       | 100% of denials return 403                    | Automated test per protected endpoint per role             |
| Internal type disclosure in error bodies | 0 responses                                   | Assert no `className` field in 4xx/5xx bodies              |
| SPA usability with security enabled      | All 15 baseline UI flows pass                 | Re-run the Playwright flow suite against a secured backend |
| Health probe availability when secured   | `actuator/health` returns 200 unauthenticated | Automated check in the secured profile                     |
| CORS origin enforcement                  | Requests from unapproved origins refused      | Preflight probe from a disallowed origin                   |
| Authorization regression coverage        | Every `@PreAuthorize` endpoint covered        | Test count vs annotation count                             |
| Schema changes under version control     | 100% applied via versioned migrations         | Migration history table matches the expected version       |


---



## Dependencies



### External Dependencies

- `spring-boot-starter-security` - filter chain, HTTP Basic, `@PreAuthorize`, `PasswordEncoder`
- `spring-boot-starter-jdbc` / `DataSource` - the JDBC credential lookup in `BasicAuthenticationConfig`
- `spring-boot-starter-data-jpa` - `User`/`Role` persistence on the write path
- `spring-boot-starter-actuator` - health endpoint affected by the security policy
- `springdoc-openapi-starter-webmvc-ui` - Swagger UI affected by the security policy
- `mapstruct` - `UserMapper` generation
- **A database migration tool - absent.** No Flyway or Liquibase is present (`AUTH-14`). Phase 1
cannot deliver `AUTH-06` or `AUTH-13` safely without first adding one.



### Internal Dependencies

- `users` / `roles` tables and their seed data - the credential store
- `db/{hsqldb,mysql,postgresql}/initDB.sql` - the only source of schema; must be changed in
three places, by hand, until `AUTH-14` is resolved
- `ExceptionControllerAdvice` - determines the status code of every authorization failure
- `Roles` bean - resolved by SpEL inside every `@PreAuthorize` across all slices
- **All other vertical slices** - each carries `@PreAuthorize` annotations activated by this one
- `client/src/util/index.tsx` - the single request choke point Phase 3 depends on
- `openapi.yml` - `User`/`Role` schemas; any new auth endpoint must be declared here first

---



## Risks and Mitigation



### Technical Risks

- **Risk**: Enabling security in any shared environment immediately breaks the SPA, Swagger UI
and health probes at once.
**Mitigation**: Sequence Phase 3 and Phase 4 before enabling security anywhere but a
developer machine. Treat "security enabled" as a release gate, not a toggle.
- **Risk**: Hashing passwords (`AUTH-03`) silently fails or truncates because the column is 20
characters (`AUTH-06`).
**Mitigation**: Ship the column widening in the same change as the encoder; add a test that
round-trips a bcrypt hash through save and authenticate.
- **Risk**: Correcting the catch-all advice changes status codes API-wide, beyond this slice.
**Mitigation**: It is a cross-slice change, not an auth-only one. Inventory current
status codes first (the curl reference in `readme.md` is the starting point) and coordinate
with the other slice PRDs.
- **Risk**: The two-filter-chain arrangement (`AUTH-10`) means a future change silently flips
which policy applies, potentially making a secured build permit-all.
**Mitigation**: Collapse to one chain in Phase 4. Until then, any change to a security class
must be followed by re-running the authentication checks in
[Acceptance Criteria](#acceptance-criteria).
- **Risk**: Authentication reads credentials by raw JDBC, so a schema change made through the
entity/repository path will not be reflected in the login query.
**Mitigation**: Treat the two SQL strings in `BasicAuthenticationConfig` as part of the schema
contract; cover login with an integration test per database profile.
- **Risk**: With no migration framework (`AUTH-14`), the `AUTH-06` column widening is applied
inconsistently — some environments get it, others silently do not, and nothing detects the
difference until a login fails or a hash is truncated on insert.
**Mitigation**: Add a migration tool as the first task of Phase 1 and baseline the existing
schema before making any change. Do not hand-edit `initDB.sql` for remediation work.
- **Risk**: Because the in-memory default rebuilds the schema on every startup, migration
defects stay invisible in local development and first appear against a persistent database.
**Mitigation**: Run the Phase 1 migrations at least once against a persistent MySQL or
PostgreSQL instance holding pre-existing rows, not only against HSQLDB.



### User Experience Risks

- **Risk**: Because the backend sends `WWW-Authenticate: Basic`, users see the browser's native
credential popup instead of an application login screen.
**Mitigation**: Suppress the header as part of Phase 2 before any login UI ships.
- **Risk**: A flat role model (`AUTH-12`) means any `OWNER_ADMIN` can edit every owner's
records, which users may reasonably assume is not the case.
**Mitigation**: Document the limitation explicitly; treat per-record ownership as a scoped
follow-up rather than an implicit expectation.

---



## Troubleshooting Guide



### Created a user but cannot log in

**Problem**: `POST /api/users` returns 201, but authenticating as that user returns 401.
**Cause**: The password was stored without an encoder prefix. `DelegatingPasswordEncoder`
cannot determine the encoding and refuses the match.
**Solution**: Send the password prefixed, e.g. `"password": "{noop}secret"`. Permanently fixed
by `AUTH-03`.
**Code Reference**: `service/UserServiceImpl.java` (no encoder on the save path)

### Authorization failure returns 400 instead of 403

**Problem**: A user without the required role gets 400 with an `AccessDeniedException` body.
**Cause**: `@ExceptionHandler(Exception.class)` catches `AccessDeniedException` and returns
`ResponseEntity.badRequest()`.
**Solution**: Add a dedicated handler for `AccessDeniedException` returning 403 (`AUTH-01`).
**Code Reference**: `rest/advice/ExceptionControllerAdvice.java:42-53`

### Browser shows a native credential popup

**Problem**: With security enabled, the browser's own login dialog appears.
**Cause**: The 401 carries `WWW-Authenticate: Basic realm="Realm"`, which browsers act on.
**Solution**: Suppress the header via a custom `AuthenticationEntryPoint` (Phase 2).

### The whole UI returns 401 after enabling security

**Problem**: Every screen fails once `petclinic.security.enable=true`.
**Cause**: Expected. The client sends no credentials on any request (`AUTH-07`).
**Solution**: Phase 3. For an interim demo, set the property back to `false`.

### `@PreAuthorize` annotations appear to do nothing

**Problem**: Role checks are ignored.
**Cause**: They are activated by `@EnableGlobalMethodSecurity` in `BasicAuthenticationConfig`,
which only loads when security is enabled.
**Solution**: Expected behaviour while disabled. Test authorization with
`--petclinic.security.enable=true`.

### Health check fails in a container

**Problem**: The orchestrator marks the container unhealthy when security is enabled.
**Cause**: `actuator/health` requires authentication — measured 401 (`AUTH-08`).
**Solution**: Permit the health probe paths in the filter chain (Phase 4).

### A schema change works locally but not against a real database

**Problem**: A column change behaves correctly in development and fails, or is silently absent,
elsewhere.
**Cause**: There is no migration framework (`AUTH-14`). The default in-memory HSQLDB drops and
recreates every table on startup, so an edit to `initDB.sql` always appears to work locally. A
persistent database never re-runs that script, so it keeps the old schema with no error.
**Solution**: Add a migration tool and baseline the schema (Phase 1, task 1). Until then, apply
schema changes manually to each environment and each dialect, and verify them explicitly.
**Code Reference**: `src/main/resources/application-hsqldb.properties:4-5` (`spring.sql.init.*`)

### Password insert fails or is truncated

**Problem**: Storing a hashed password errors, or the stored value is cut short.
**Cause**: `users.password` is `VARCHAR(20)` (`AUTH-06`); a bcrypt hash is 60 characters.
**Solution**: Widen the column as part of Phase 1 before enabling encoding. Depends on
`AUTH-14`.
**Code Reference**: `src/main/resources/db/hsqldb/initDB.sql` (`CREATE TABLE users`)

---



## Notes for AI Agents

When working with this PRD:

1. This is a **baseline** document. Sections describing current behaviour are verified fact —
  do not "correct" them to match what the code looks like it should do.
2. Read Scope before acting. Other vertical slices have their own baseline PRDs; do not modify
  them from here beyond their `@PreAuthorize` annotations.
3. Do not implement Phase 1+ work without explicit approval. Phase 0 is the only completed phase.
4. Update phase status markers as work progresses, and tick
  [Acceptance Criteria](#acceptance-criteria) only after verifying against a running instance.
5. When a gap is closed, mark its `AUTH-nn` row resolved rather than deleting it — the history
  is the point of a baseline.
6. Add entries to the Troubleshooting Guide as new problems are found.
7. Use `filepath:line-number` when citing code.
8. Re-run the authentication checks after **any** change to a class in `security/`; behaviour
  there depends on bean ordering that is not pinned by the code.

---



## Current Status

**Last Updated**: 2026-09-16
**Current Phase**: Phase 0 - Baseline documentation
**Status**: COMPLETED
**Next Steps**: Review this baseline, then proceed to the next vertical-slice baseline PRD
(Owners). Remediation Phase 1 is not started and requires approval before any code change.

**Open decisions blocking Phase 1**:

1. Which migration framework to adopt (`AUTH-14`) — Flyway or Liquibase.
2. Whether all three database dialects (HSQLDB, MySQL, PostgreSQL) must continue to be
   supported, since each additional dialect multiplies the migration effort.

**Change log**:

- 2026-09-16 — initial baseline.
- 2026-09-16 — added `AUTH-14` (no migration framework) after verifying the absence of Flyway
  and Liquibase in `pom.xml` and the packaged artefact; recorded it as a prerequisite for
  Phase 1 and added the related risks, troubleshooting entries and success metric.