# Simple Authentication - Technical PRD

| Field | Value |
|-------|-------|
| Created | January 19, 2026 |
| Version | 1.5 |
| Version Notes | Phase 6 done: SPA logout (T-FE-07…09); Simple Auth feature complete |

> **Feature PRD** (greenfield for the SPA; reuses baseline identity).
> Baseline evidence and gaps:
> [AUTHENTICATION_BASELINE_PRD.md](../baseline/AUTHENTICATION_BASELINE_PRD.md)
> (especially *First feature readiness — SPA auth against existing HTTP Basic*),
> [ARCHITECTURE.md](../baseline/ARCHITECTURE.md) §6.
>
> Design choice: **Option A** — wire the SPA to the **existing** Spring Security HTTP Basic
> stack (no new login token API). Optionally add `UserRepository.findByUsername` for
> application-layer user fetch (today create-only). **Credential validation for API calls
> already happens in `BasicAuthenticationConfig` via JDBC** — not via `UserRepository`.
> No backend session. No user-registration UI. Seed: `admin` / `admin` (`{noop}admin` in DB).

---

## Overview/Problem

Clinic staff open the React SPA and can use every screen with no sign-in. There is no
login page, no logout control, and no `Authorization` header on API calls
(`AUTH-07`). Security is off by default (`petclinic.security.enable=false`); when it is
turned on, the SPA breaks and the browser may show a native Basic popup
(`WWW-Authenticate`).

Staff need a simple way to sign in with an existing account (starting with the seeded
`admin` user), keep working on the dashboard and domain screens with credentials sent
on every API call, and sign out by clearing the browser-stored credentials — without
server-side session management for now.

---

## Existing Spring Security (verified — do not reinvent)

Source files under `src/main/java/.../security/` and `application.properties`. This feature
**reuses** this stack; it does not replace it with Option B.

### Property switch

```properties
# application.properties — default
petclinic.security.enable=false
```

| Value | Effective auth |
|---|---|
| `false` (default) | API public; `@PreAuthorize` **inert** |
| `true` | HTTP Basic required on **every** request; `@PreAuthorize` **active** |

Verify this feature with `--petclinic.security.enable=true` (prefer a second port).

### Three configuration classes

| Class | Condition | What it does today |
|---|---|---|
| `WebSecurityConfig` | **Always loaded** (`@EnableWebSecurity`) | `apiFilterChain`: `anyRequest().permitAll()`, CSRF off, CORS allow-list `http://localhost:4444`, methods `OPTIONS,GET,POST,PUT` only (**no DELETE**) |
| `DisableSecurityConfig` | `enable=false` | `filterChain`: `anyRequest().permitAll()`, CSRF off |
| `BasicAuthenticationConfig` | `enable=true` | `filterChain`: `anyRequest().authenticated()`, `.httpBasic()`, CSRF off; JDBC user/role queries; `@EnableGlobalMethodSecurity(prePostEnabled = true)` |

**Dual filter chains (`AUTH-10`):** `WebSecurityConfig` always contributes a chain, plus either
Disable or Basic. Order is **not pinned** in code. Measured baseline: when enabled, Basic
enforcement wins for authentication; `WebSecurityConfig` CORS **does not** win — controller
`@CrossOrigin` does (`AUTH-09`). Re-test auth **and** CORS after any `security/` edit.

### How credentials are validated today (API path)

`BasicAuthenticationConfig` — Spring Security JDBC, **not** `UserRepository`:

```java
auth.jdbcAuthentication()
    .dataSource(dataSource)
    .usersByUsernameQuery(
        "select username,password,enabled from users where username=?")
    .authoritiesByUsernameQuery(
        "select username,role from roles where username=?");
```

- Stateless: credentials on **every** request; no server session, no logout endpoint.
- `enabled` is honoured on this JDBC path only.
- Always JDBC even if the app profile is `jpa` / `spring-data-jpa`.
- `PasswordEncoderFactories` / `PasswordEncoder` are **imported but unused**; no custom
  `@Bean` PasswordEncoder in this class — Spring Security’s default
  `DelegatingPasswordEncoder` applies (hence seed `{noop}admin` and form password `admin`).
- Failures return **401** with `WWW-Authenticate: Basic realm="Realm"` (native browser popup risk).

### Authorization (roles)

`Roles` bean constants (already include `ROLE_` prefix), activated only when security is on:

| Constant | Value | Grants |
|---|---|---|
| `OWNER_ADMIN` | `ROLE_OWNER_ADMIN` | owners, pets, pet types, visits |
| `VET_ADMIN` | `ROLE_VET_ADMIN` | vets, specialties |
| `ADMIN` | `ROLE_ADMIN` | `POST /api/users` only |

Seed `admin` has **all three** roles — suitable for exercising the full SPA after login.
`ADMIN` alone does **not** inherit the other two.

### Two identity paths (keep in sync)

| Path | Used by | Methods today |
|---|---|---|
| `UserRepository` / `UserService` | `POST /api/users` create | `save` / `saveUser` only |
| JDBC SQL in `BasicAuthenticationConfig` | HTTP Basic login on each request | username + password + enabled + roles |

Adding `findByUsername` improves the **repository** path for app/tests/optional UI. It does
**not** replace JDBC authentication. Do not implement a second password-compare that drifts
from Security’s encoder rules.

### Implications for Simple Auth

1. **No new backend “login session” API required** for Option A — SPA stores user/pass and
   sends Basic; Security already decodes and validates.
2. Login “success” check = call any protected endpoint with Basic (e.g. `GET /api/owners` —
   seed has owners so expect **200**, not empty-list **404** `OWN-01`) or
   `GET /api/owners/1`.
3. Optional `findByUsername` / OpenAPI user fetch is for **user metadata**, not for swapping
   out Basic.
4. Do **not** change default `petclinic.security.enable` to `true` in committed
   `application.properties` without an explicit product decision — document verification with
   the flag on.
5. Suppressing `WWW-Authenticate` (if native popup blocks SPA UX) is an allowed small security
   tweak; rewriting filter-chain / CORS consolidation remains baseline Phase work (`AUTH-09`/
   `AUTH-10`).

---

## Business Requirements

Staff (not pet owners) must sign in, keep a browser-only session while calling the API with
credentials, and sign out cleanly — without registration UI and without a backend session.

### Authentication

#### Users

| Role | Who | What they need |
|---|---|---|
| Clinic staff (admin) | Uses the SPA day to day | Sign in with username/password and reach the home/dashboard |
| Clinic administrator | Provisions accounts later | Not in this feature — reuse seed `admin` only |

#### Capabilities

| ID | The system shall |
|---|---|
| BR-SA-01 | Let a staff member open a login page from the top navigation and sign in with username and password |
| BR-SA-02 | After successful sign-in, land the user on the home/dashboard and show a logout control instead of login |
| BR-SA-05 | Reject API access when credentials are missing or wrong once protection is enabled |
| BR-SA-07 | Block unauthenticated users from protected SPA routes (redirect or send them to login) |

#### Business rules

1. **Existing users only for this feature.** No create-user / registration forms. Seed
   `admin` is the supported account for manual verification.
2. **Passwords must not be echoed** in API responses used by login (do not return the
   stored password to the SPA; the form already has what the user typed).
3. **Disabled accounts cannot sign in**, even with a correct password (baseline rule).
4. **Hardcoding `admin:admin` in source** for every request is forbidden; credentials come
   from the login form / local storage only.

### Session Management

#### Users

| Role | Who | What they need |
|---|---|---|
| Clinic staff (admin) | Signed-in SPA user | Stay signed in across navigations until they log out or clear storage |

#### Capabilities

| ID | The system shall |
|---|---|
| BR-SA-03 | Remember the signed-in session in the browser only (local storage) until logout or clear |
| BR-SA-04 | Send authenticated credentials on every SPA call to the backend API |

#### Business rules

1. **No backend session.** The browser holds credentials; the backend validates HTTP Basic on
   each request (`BasicAuthenticationConfig`).
2. Session data in local storage is **username + password** for this feature only (future
   token/session enhancement is out of scope).

### Logout

#### Users

| Role | Who | What they need |
|---|---|---|
| Clinic staff (admin) | Signed-in SPA user | Sign out and return to a logged-out UI |

#### Capabilities

| ID | The system shall |
|---|---|
| BR-SA-06 | Let a signed-in user sign out, clearing browser-stored credentials and returning to a logged-out state |

#### Business rules

1. Logout is **client-side only** (clear local storage). There is no backend logout endpoint
   in this feature.
2. After logout, the nav shows **Login** again, protected routes require sign-in, and API
   calls must not send a Basic header.

---

## Hypothesis

We believe that wiring a SPA login/logout flow to the **existing**
`BasicAuthenticationConfig` HTTP Basic + JDBC stack (local storage + Basic header on every
call), with an optional repository `findByUsername` for app-layer user fetch, will make the
PetClinic UI usable with `petclinic.security.enable=true` for staff — without tokens or
server sessions yet.

---

## Scope

### In Scope

- Enable usable **login** and **logout** for the SPA across **six implementation phases**
  (bottom-up: DB/entity → DAO → service → API/security → frontend login → logout).

- `UserRepository` / `UserService`: add **find/fetch user by username** (today only `save`) —
  for app-layer use/tests; **API credential checks stay on JDBC Basic**.
- Rely on existing **`BasicAuthenticationConfig`** to decode/validate Basic on each API
  request when `petclinic.security.enable=true` (verification config; see Existing Spring
  Security).
- Frontend: login link in top nav, login form (username + password), local storage for
  session, Basic `Authorization` header on all API `fetch` calls, route protection, logout
  clears local storage, nav switches login ↔ logout.
- TDD: positive and negative tests written **before** production changes
  (`.cursor/rules/07-tdd-workflow.mdc`).

### Out of Scope

- User registration / create-user UI and forms.
- Password hashing upgrade, wider `users.password` column (`AUTH-03` / `AUTH-06` / `AUTH-14`).
- Token or cookie session (`POST /api/auth/login` returning a token — Option B).
- Replacing JDBC auth with `UserRepository`-based `AuthenticationProvider` (unless a later
  PRD explicitly chooses that).
- Password reset, MFA, account lockout, federated identity.
- Fixing catch-all 400 vs 403 (`AUTH-01`), full CORS consolidation (`AUTH-09`), dual-chain
  refactor (`AUTH-10`), Swagger/health anonymous access (`AUTH-08`) — baseline gaps; only
  touch if they block the SPA login happy path (e.g. optional `WWW-Authenticate` suppress).
- Role-specific UI (hide menus by role).
- Committing `petclinic.security.enable=true` as the new repo default without explicit approval.

### Cut

- **Option B token/session login API** — cut for this feature; revisit later.
- **Custom AuthenticationProvider on UserRepository** — cut; keep JDBC queries in
  `BasicAuthenticationConfig`.
- **Multi-user provisioning UI** — cut; use seed `admin` only.
- **Server-side logout / session revoke** — cut; no backend session to revoke.

---

## Technical Requirements

### Database Schema

**No schema change required** for this feature. Reuse existing tables and seed.

```sql
-- Existing (all dialects). Do not alter for Simple Auth.
CREATE TABLE users (
  username VARCHAR(20) NOT NULL,
  password VARCHAR(20) NOT NULL,
  enabled  BOOLEAN DEFAULT TRUE NOT NULL,
  PRIMARY KEY (username)
);

CREATE TABLE roles (
  id       INTEGER IDENTITY PRIMARY KEY,
  username VARCHAR(20) NOT NULL,
  role     VARCHAR(20) NOT NULL
);
```

Seed (already in `populateDB.sql`):

| username | password (stored) | enabled | roles |
|---|---|---|---|
| `admin` | `{noop}admin` | true | `ROLE_OWNER_ADMIN`, `ROLE_VET_ADMIN`, `ROLE_ADMIN` |

Login form password for verification: **`admin`** (encoder prefix is storage-only).

### API Endpoints

#### Existing (reuse — primary auth path)

| Mechanism / path | Role in this feature |
|---|---|
| HTTP Basic when `petclinic.security.enable=true` | Spring Security decodes `Authorization: Basic …`, runs JDBC `usersByUsernameQuery` / `authoritiesByUsernameQuery` in `BasicAuthenticationConfig` |
| Any protected `/api/**` (e.g. `GET /api/owners`, `GET /api/owners/1`) | Login probe + all post-login SPA traffic |
| `POST /api/users` | **Out of scope** for SPA (no registration UI); still `ROLE_ADMIN` only |

There is **no** backend logout, refresh, or session endpoint today — and this feature does not add one.

#### New / extended behaviour

##### Fetch user (repository + service — secondary path)

| Layer | Addition |
|---|---|
| `UserRepository` | `User findByUsername(String username)` — all three DAO profiles (`03-service-layer.mdc`) |
| `UserService` | `User findUser(String username)` — `null` if absent; **never** put password in a response DTO |

This supports tests, optional “current user” metadata, and bottom-up completeness. It is **not**
the password-validation path for API requests (that remains JDBC Basic).

##### Login credential check (Option A — uses existing Security)

1. SPA collects username + password from the form.
2. SPA calls a protected probe with
   `Authorization: Basic ` + Base64(`username:password`).
   Prefer `GET /api/owners/1` or `GET /api/owners` (seeded data → **200**; avoid relying on
   empty-list **404** `OWN-01`).
3. **2xx** → store username + password in `localStorage`; navigate to `/`.
4. **401** → show error; do not store credentials.

Do **not** invent `POST /api/auth/login` with a token (Option B). Optional OpenAPI
`GET /api/users/{username}` (no password in body) only if product wants metadata after Basic
auth — not required for the minimum Option A path.

**Header on every subsequent SPA API call:**

```
Authorization: Basic <base64(username:password)>
```

**Responses (security enabled):**

| Case | Expected |
|---|---|
| Valid Basic, enabled user, sufficient role | 2xx for that resource |
| Missing / wrong Basic | **401** (+ often `WWW-Authenticate: Basic`) |
| Disabled user | **401** |
| Authenticated but wrong role | Often **400** today (`AUTH-01`) — out of scope to fix unless it blocks admin happy path |

**CORS note:** SPA origin is `http://localhost:4444`. Controllers use
`@CrossOrigin(exposedHeaders = "errors, content-type")` (wins today). Keep `errors` exposed
for validation. `WebSecurityConfig` CORS allow-list does not currently govern browser access.

### User Interface Requirements

Template format for pages/components (see also **Frontend Changes** below for file-level work).

#### Page: Login (`/login`)

- Features: credential capture; validate via Basic probe; store session; redirect home
- Form fields: Username (required), Password (required)
- Actions: Submit → success `/` or inline error; no register link
- Errors: invalid credentials, network failure

#### Page: Home / Dashboard (`/` — `WelcomePage`)

- Features: post-login landing; requires credentials in local storage (or redirect to `/login`)

#### Component: Top navigation (`Menu`)

- Logged out: **Login** link → `/login`
- Logged in: **Logout** control (hide Login)
- Logout: clear local storage → `/login`

#### Component: HTTP / auth helpers

- Attach Basic header on every API call when logged in
- Route guard for protected paths; 401 → `/login`

### Frontend Changes

Concrete SPA work for this feature (React 15, port **4444**). Today there is **no** auth code
in `client/src` (`AUTH-07`). These are the planned creates/edits.

#### Files to create

| File | Purpose |
|---|---|
| `client/src/components/auth/LoginPage.tsx` (or `components/LoginPage.tsx`) | Login form (username, password); submit → Basic probe → localStorage → redirect `/` |
| `client/src/util/auth.ts` (or `auth.tsx`) | Helpers: `getCredentials`, `setCredentials`, `clearCredentials`, `isLoggedIn`, `basicAuthHeader()` |
| `client/tests/__tests__/auth.test.tsx` (and/or `login.test.tsx`) | T-FE-01…09 (login, storage, header, guards, logout) |

#### Files to modify

| File | Change |
|---|---|
| `client/src/components/Menu.tsx` | Add **Login** link when logged out; **Logout** control when logged in; logout clears storage and navigates |
| `client/src/configureRoutes.tsx` | Register `/login` → `LoginPage`; wrap protected routes (owners, vets, pets, home) so missing credentials redirect to `/login` |
| `client/src/components/App.tsx` | Pass auth/logged-in state into `Menu` if needed (or Menu reads auth helper directly) |
| `client/src/util/index.tsx` | On every `fetch` / `submitForm`, if credentials exist set `Authorization: Basic ` + `btoa(username + ':' + password)` |
| `client/src/components/WelcomePage.tsx` | Optional: short “Signed in as {username}” indicator after login |

#### UI behaviour (Phase 5 — Login)

1. Top nav shows **Login** → opens `/login`.
2. User enters username/password (seed: `admin` / `admin`).
3. On submit, SPA calls a protected probe (`GET /api/owners/1` or `GET /api/owners`) with Basic.
4. **2xx** → write `petclinic.username` / `petclinic.password` to `localStorage` → navigate to `/`.
5. **401** → show error on the form; do **not** write local storage.
6. All later API calls from the SPA include the Basic header from local storage.
7. Visiting `/owners/*`, `/vets`, etc. without credentials → redirect to `/login`.

#### UI behaviour (Phase 6 — Logout)

1. When logged in, nav shows **Logout** (not Login).
2. Click Logout → `clearCredentials()` → navigate to `/login`.
3. Subsequent fetches send **no** `Authorization` header.
4. Protected routes again redirect to `/login`.

#### Local storage keys

| Key | Value |
|---|---|
| `petclinic.username` | string |
| `petclinic.password` | string |

#### Out of scope on the frontend

- Registration / create-user forms
- Hardcoded `admin:admin` in source
- Token/cookie session UI (Option B)
- Role-based menu hiding

---

## Implementation Phases

Bottom-up. Each phase: **write tests → run all tests → implement → run all tests again**
(`.cursor/rules/07-tdd-workflow.mdc`). Stop for approval before starting the next phase.

| Phase | Name | Status |
|---|---|---|
| 1 | Database & Entity readiness | **COMPLETED** |
| 2 | DAO — fetch user by username | **COMPLETED** |
| 3 | Service — find user | **COMPLETED** |
| 4 | API / Security — Basic auth verification | **COMPLETED** |
| 5 | Frontend — Login | **COMPLETED** |
| 6 | Frontend — Logout | **COMPLETED** |

### Phase 1: Database & Entity readiness — COMPLETED

**Objective**: Confirm identity schema/seed and entity model are ready; no parallel schema.
Baseline for later layers.

**Tasks**:

1. **Tests first** — ✅ added Phase 1 readiness tests (T-P1-01…07); run **all** tests.
2. Confirm `users` / `roles` DDL in all three dialects — ✅ verified by T-P1-01 / T-P1-03
   (`01-database-schema.mdc`). **No DDL change** required for Simple Auth.
3. Confirm seed `admin` / `{noop}admin` with all three roles — ✅ T-P1-02, T-P1-04, T-P1-05.
4. Confirm `User` / `Role` entities map seed — ✅ T-P1-06; unknown user negative — ✅ T-P1-07
   (`02-entity-layer.mdc`).
5. Record findings under Technical Implementation Details; **stop for approval** before any
   production code (Phase 1 may need **no** production change — readiness only).

**Deliverables**:

- [x] Readiness tests: `IdentitySchemaDialectReadinessTests`, `IdentitySeedReadinessTests`
- [x] Phase status COMPLETED (docs-only Green — no DDL/entity production change)
- [x] No accidental schema drift

**Phase 1 test IDs**

| ID | Assertion |
|---|---|
| T-P1-01 | hsqldb / mysql / postgresql `initDB.sql` define `users` + `roles` |
| T-P1-02 | all dialects `populateDB.sql` seed `admin` / `{noop}admin` + three roles |
| T-P1-03 | `users.password` is `VARCHAR(20)` in all dialects (`AUTH-06` documented) |
| T-P1-04 | HSQLDB JDBC: admin enabled with `{noop}admin` |
| T-P1-05 | HSQLDB JDBC: admin has exactly three roles |
| T-P1-06 | JPA `User`/`Role` map seed admin (EntityManager — not repository) |
| T-P1-07 | Unknown username absent (JDBC + JPA negative) |

### Phase 2: DAO — fetch user by username — COMPLETED

**Objective**: `UserRepository.findByUsername` works in **all three** DAO profiles.

**Tasks**:

1. **Tests first (Red)** — ✅ T-BE-01/02; compile failed until method existed (Red).
2. Add `findByUsername` to `UserRepository` — ✅ returns `User` or `null`.
3. Implement in all profiles — ✅ (`03-service-layer.mdc`):
   - `SpringDataUserRepository` — derived `findByUsername`
   - `JpaUserRepositoryImpl` — JPQL + `LEFT JOIN FETCH u.roles` (bind `:username`)
   - `JdbcUserRepositoryImpl` — SQL select user + load roles; `EmptyResultDataAccessException` → null
4. Run **all** tests again (Green) — ✅

**Deliverables**:

- [x] `findByUsername` on interface + three implementations
- [x] Tests: `AbstractUserRepositoryFindByUsernameTests` + jdbc/jpa/spring-data-jpa subclasses

**Files touched (Phase 2)**:

| Path | Change |
|---|---|
| `repository/UserRepository.java` | added `findByUsername` |
| `repository/springdatajpa/SpringDataUserRepository.java` | `@Override findByUsername` |
| `repository/jpa/JpaUserRepositoryImpl.java` | JPQL find + join fetch roles |
| `repository/jdbc/JdbcUserRepositoryImpl.java` | public find + `loadRoles` |
| `src/test/.../repository/user/AbstractUserRepositoryFindByUsernameTests.java` | **new** |
| `src/test/.../repository/user/UserRepositoryFindByUsername*Tests.java` | **new** (3 profiles) |
| `.cursor/rules/03-service-layer.mdc` | UserRepository no longer write-only |

### Phase 3: Service — find user — COMPLETED

**Objective**: `UserService.findUser(username)` returns user or `null`; never logs passwords.

**Tasks**:

1. **Tests first** — ✅ added to `AbstractUserServiceTests` (find admin / missing → null).
2. `UserService.findUser` / `UserServiceImpl.findUser` — ✅ `@Transactional(readOnly = true)`,
   delegates to `userRepository.findByUsername` (null-on-absence).
3. No DTO / password echo path added.
4. Full suite Green — ✅ **202** tests.

**Deliverables**:

- [x] `findUser` on service API
- [x] Tests green for jdbc / jpa / spring-data-jpa service subclasses

**Files touched (Phase 3)**:

| Path | Change |
|---|---|
| `service/UserService.java` | added `findUser` |
| `service/UserServiceImpl.java` | `findUser` read-only transactional |
| `src/test/.../userService/AbstractUserServiceTests.java` | T-BE-01/02 service cases |

### Phase 4: API / Security — Basic auth verification — COMPLETED

**Objective**: With security enabled, existing `BasicAuthenticationConfig` accepts valid Basic
and rejects bad/missing credentials. Reuse JDBC auth — do not replace with repository auth.

**Tasks**:

1. **Tests first** — ✅ T-BE-03…07 in `BasicAuthenticationIntegrationTests`
   (`@SpringBootTest` + `@AutoConfigureMockMvc`; test profile already
   `petclinic.security.enable=true`).
2. Run **all** tests — ✅ suite green; existing JDBC Basic behaviour already correct
   (characterization / verification — no Red failure against production code).
3. Reuse `BasicAuthenticationConfig` as-is — ✅ **no production security change**.
   `WWW-Authenticate` suppress deferred to SPA UX (Phase 5) if needed.
4. Did **not** flip committed default `petclinic.security.enable=false`.
5. No new OpenAPI login/user-fetch endpoint — probe is existing `GET /api/owners/1`.
6. No `security/` production edit → CORS re-test N/A for this phase.
7. Full suite again — ✅ **207** tests, 0 failures.

**Deliverables**:

- [x] Documented login probe: `GET /api/owners/1`
- [x] Passing Basic auth positive/negative API tests (T-BE-03…07)
- [x] Verification notes for `--petclinic.security.enable=true` (curl on :9977)

**Files touched (Phase 4)**:

| Path | Change |
|---|---|
| `src/test/.../security/BasicAuthenticationIntegrationTests.java` | **new** — T-BE-03…07 |
| `BasicAuthenticationConfig` / other `security/*` | Unchanged (as-is) |

### Phase 5: Frontend — Login — COMPLETED

**Objective**: Staff can open Login from the nav, sign in as `admin`, land on home, and call
APIs with Basic from local storage; protected routes require login.

**Tasks**:

1. **Tests first (Red)** — ✅ T-FE-01…06 (`auth.test`, `login.test`, `menu-auth.test`, util Basic).
2. Implement **Frontend Changes** for login — ✅ `LoginPage`, `util/auth.ts`, Menu Login/Logout,
   `/login` route, `apiFetch`/`submitForm` Basic header, `requireAuth` on protected routes
   (`05-frontend.mdc`).
3. No registration UI; no hardcoded `admin:admin` — ✅
4. Client suite green — ✅ **27** tests. Logout control present for T-FE-04; Phase 6 deepens
   logout coverage (T-FE-07…09).

**Deliverables**:

- [x] `/login` page + nav Login link
- [x] localStorage session after successful probe (`GET api/owners/1`)
- [x] Basic header on API calls (`apiFetch` + `submitForm`)
- [x] Protected-route redirect to `/login` (`requireAuth`)

**Files touched (Phase 5)**:

| Path | Change |
|---|---|
| `client/src/util/auth.ts` | **new** — credentials + Basic header + `requireAuth` |
| `client/src/components/auth/LoginPage.tsx` | **new** — login form + probe |
| `client/src/util/index.tsx` | `apiFetch` + Basic on `submitForm` |
| `client/src/components/Menu.tsx` | Login / Logout |
| `client/src/configureRoutes.tsx` | `/login` + `onEnter={requireAuth}` |
| `client/src/components/WelcomePage.tsx` | “Signed in as …” |
| `client/src/components/**` (owners/pets/vets/visits/Error) | use `apiFetch` |
| `client/tests/__tests__/auth.test.tsx` | **new** |
| `client/tests/__tests__/login.test.tsx` | **new** |
| `client/tests/__tests__/menu-auth.test.tsx` | **new** |
| `client/tests/__tests__/util.test.tsx` | T-FE-05 Basic on submitForm |

### Phase 6: Frontend — Logout — COMPLETED

**Objective**: Logout clears local storage, restores Login nav, stops sending Basic, and
guards routes again.

**Tasks**:

1. **Tests first (Red)** — ✅ T-FE-07…09 in `logout.test.tsx` (`logout` missing → Red).
2. Add `logout()` helper; Menu calls it then navigates to `/login` — ✅
3. Confirmed: after logout no Basic header; `requireAuth` redirects — ✅
4. Client suite green — ✅ **31** tests.

**Deliverables**:

- [x] Logout UI + cleared local storage
- [x] Logged-out nav and route behaviour
- [x] Full suite green; feature acceptance criteria ready to tick

**Files touched (Phase 6)**:

| Path | Change |
|---|---|
| `client/src/util/auth.ts` | added `logout()` → clear + return `/login` |
| `client/src/components/Menu.tsx` | Logout uses `logout()` |
| `client/tests/__tests__/logout.test.tsx` | **new** — T-FE-07…09 |

---

## Technical Implementation Details

### Key files (as of Phases 1–6 — feature complete)

| Area | Path | Status |
|---|---|---|
| Schema / seed | `src/main/resources/db/*/initDB.sql`, `populateDB.sql` | Unchanged (verified) |
| Entity | `model/User.java`, `model/Role.java` | Unchanged (verified) |
| DAO | `UserRepository` + springdatajpa / jpa / jdbc | **`save` + `findByUsername`** |
| Service | `UserService` / `UserServiceImpl` | **`saveUser` + `findUser`** |
| Phase 1–4 tests | identity / repository / service / security | Added |
| Security | `BasicAuthenticationConfig` (JDBC auth path) | Unchanged (verified) |
| Login probe | `GET /api/owners/1` | Documented + used by SPA |
| Frontend auth | `client/src/util/auth.ts` (`logout`, credentials, Basic, `requireAuth`) | **Phases 5–6** |
| Frontend UI | `LoginPage`, Menu Login/Logout, routes, `apiFetch` | **Phases 5–6** |

Full create/modify list and UI flows: **Technical Requirements → Frontend Changes**.

### Phase 1 readiness findings (2026-09-22) — COMPLETED

| Check | Result |
|---|---|
| `users` / `roles` in hsqldb, mysql, postgresql `initDB.sql` | Present |
| Seed `admin` / `{noop}admin` + three roles in all `populateDB.sql` | Present |
| `User` / `Role` JPA mapping of seed | Works via EntityManager |
| HSQL `roles` UNIQUE vs entity `@UniqueConstraint` | Entity declares unique; HSQL DDL does **not** (`AUTH-13`) — not a Phase 1 blocker |
| `users.password` VARCHAR(20) | All dialects (`AUTH-06`); OK for `{noop}admin` |
| Main `petclinic.security.enable` | **false** (default) |
| Test `application.properties` | `petclinic.security.enable=true` |

### Phase 2–3 implementation notes (2026-09-22)

- HTTP Basic login still uses **JDBC SQL in `BasicAuthenticationConfig`**, not `UserRepository`.
- App-layer fetch now available: `userRepository.findByUsername` / `userService.findUser`
  (null if absent). Roles loaded in all three DAO profiles.
- Verification (after Phase 3): full suite **202** tests, 0 failures (`BUILD SUCCESS`).

### Phase 4 verification notes (2026-09-22) — COMPLETED

- Login probe for SPA: **`GET /api/owners/1`** (seeded → 200 with valid Basic).
- MockMvc + real filter chain (`BasicAuthenticationIntegrationTests`):
  - T-BE-03 `admin`/`admin` → 200
  - T-BE-04 wrong password → 401
  - T-BE-05 unknown user → 401
  - T-BE-06 no header → 401 + `WWW-Authenticate` contains `Basic`
  - T-BE-07 probe JSON has **no** `password` field
- Production `BasicAuthenticationConfig` **unchanged**; JDBC queries remain auth path of record.
- Dual `SecurityFilterChain` still present (`WebSecurityConfig` + Basic); measured behaviour:
  Basic wins for API when `enable=true` (same as baseline `AUTH-10`).
- Manual curl: second process `--server.port=9977 --petclinic.security.enable=true`
  (committed default stays `false`).
- Full suite after Phase 4: **207** tests, 0 failures (`BUILD SUCCESS`).

### Phase 5 frontend notes (2026-09-22) — COMPLETED

- Storage keys: `petclinic.username` / `petclinic.password` (only after 2xx probe).
- Probe: `GET api/owners/1` with provisional Basic header (credentials not stored on 401).
- `apiFetch` + `submitForm` attach `Authorization: Basic …` when logged in.
- `requireAuth` on `/`, owners, vets, error routes; `/login` public.
- Menu: Login when logged out; Logout when logged in (Phase 6 adds deeper logout tests).
- Client: `cd client && npm test` → **27** tests, 0 failures.

### Phase 6 frontend notes (2026-09-22) — COMPLETED

- `logout()` clears `petclinic.username` / `petclinic.password` and returns `/login`.
- Menu Logout → `window.location.href = logout()`.
- After logout: nav shows Login; `basicAuthHeader()` empty; `submitForm` has no
  `Authorization`; `requireAuth` redirects protected routes to `/login`.
- Client: `cd client && npm test` → **31** tests, 0 failures (T-FE-01…09).

### Implementation patterns

```ts
// Frontend — attach Basic when credentials exist (illustrative)
const user = localStorage.getItem('petclinic.username');
const pass = localStorage.getItem('petclinic.password');
const headers: any = { 'Accept': 'application/json' };
if (user && pass) {
  headers['Authorization'] = 'Basic ' + btoa(user + ':' + pass);
}
fetch(url('api/owners'), { headers });
```

```java
// Actual (Phases 2–3)
User findByUsername(String username) throws DataAccessException; // null if absent
User findUser(String username); // UserService → repository
```

### Important notes

- **Auth path of record:** JDBC SQL inside `BasicAuthenticationConfig`, not `UserRepository`.
- Spring Security expects encoder id in stored password; seed uses `{noop}admin`. Form
  password is `admin` (not `{noop}admin`).
- `PasswordEncoder` imports in `BasicAuthenticationConfig` are unused — do not assume a
  custom encoder bean exists until one is added deliberately.
- Two `SecurityFilterChain` beans always exist; order unpinned (`AUTH-10`).
- Compare usernames/ids, not entity `equals` (`B1`).
- Suppress or mitigate native browser Basic popup if it blocks `/login` UX.
- Do not flip committed default `petclinic.security.enable` without approval; verify with
  `--petclinic.security.enable=true` (preferably another port).
- Cursor rules: `00`–`07`; TDD sequence mandatory.

### Test plan (write first — positive and negative)

#### Backend — fetch user / credential validation

| ID | Case | Expected |
|---|---|---|
| T-BE-01 | `findByUsername("admin")` | user found, enabled |
| T-BE-02 | `findByUsername("missing")` | null / not found |
| T-BE-03 | API with valid Basic `admin:admin` | 2xx on protected resource |
| T-BE-04 | API with wrong password | 401 |
| T-BE-05 | API with unknown user | 401 |
| T-BE-06 | API with no Authorization header (security on) | 401 |
| T-BE-07 | Any login/user DTO path | password **not** present in JSON body |

#### Frontend — login / storage / header / routes

| ID | Case | Expected |
|---|---|---|
| T-FE-01 | Submit valid credentials | store username/password; navigate to `/` |
| T-FE-02 | Submit invalid credentials | error shown; storage empty |
| T-FE-03 | Empty username or password | client validation; no API success path |
| T-FE-04 | Logged in | nav shows Logout, not Login |
| T-FE-05 | API helper with storage set | `Authorization: Basic …` present |
| T-FE-06 | Unauthenticated visit to protected route | redirect to `/login` |

#### Frontend — logout (Phase 6)

| ID | Case | Expected |
|---|---|---|
| T-FE-07 | Logout click | local storage cleared |
| T-FE-08 | After logout | nav shows Login; no Basic header on next fetch |
| T-FE-09 | After logout visit protected route | redirect to `/login` |

---

## Acceptance Criteria

- [x] Staff can open **Login** from the top navigation and see a username/password form
- [x] Valid `admin` / `admin` sign-in lands on the dashboard/home
- [x] After login, nav shows **Logout** (not Login)
- [x] Credentials are stored in local storage only after successful validation
- [x] All SPA API calls include `Authorization: Basic` + Base64(username:password) when logged in
- [x] With security enabled, backend rejects missing/wrong credentials with **401**
- [x] `UserRepository` / `UserService` can fetch a user by username (all DAO profiles covered by tests)
- [x] Login-related API responses do **not** include the password field
- [x] No registration / create-user UI was added
- [x] Logout clears local storage and returns the UI to a logged-out state
- [x] Protected frontend routes require login
- [x] Positive and negative tests above exist and pass; full suites run per TDD rule
  (backend T-BE-01…07; frontend T-FE-01…09)
- [ ] PRD phase markers and Current Status updated after each phase

---

## Success Metrics

| Metric | Target | How Measured |
|--------|--------|--------------|
| Login success with seed admin | Works on local SPA + secured API | Manual + automated tests T-BE-03, T-FE-01 |
| Unauthenticated API access | Denied (401) when security on | T-BE-06 |
| Logout clears client session | No credentials left in local storage | T-FE-07 |
| SPA usable with security on | No dependency on native browser Basic popup for happy path | Manual check on `/login` flow |

---

## Dependencies

### External Dependencies

- None new (HTTP Basic already in Spring Security)

### Internal Dependencies

- Baseline users/roles schema and seed `admin`
- `BasicAuthenticationConfig` / `petclinic.security.enable`
- Existing SPA shell (`Menu`, `configureRoutes`, `util/index.tsx`)
- Baseline Auth PRD Option A guidance

### Configuration

| Property | Purpose |
|---|---|
| `petclinic.security.enable=true` | Enforce Basic auth on APIs for this feature’s verification |
| `__API_SERVER_URL__` | SPA → API base (unchanged) |

---

## Risks and Mitigation

### Technical Risks

- **Risk**: Enabling security breaks Swagger/health (`AUTH-08`) and shows native Basic popup.
  **Mitigation**: Verify SPA against app login UI; document operator endpoints as known gap;
  suppress `WWW-Authenticate` if popup steals focus.
- **Risk**: Dual credential paths (JDBC in Security vs `UserRepository`) diverge.
  **Mitigation**: `findByUsername` tests + Basic integration tests against same seed user.
- **Risk**: Storing password in local storage is weak.
  **Mitigation**: Accepted for this feature; call out as future enhancement (token/session).
- **Risk**: `{noop}` / encoder prefix confusion (`AUTH-05`).
  **Mitigation**: Document form password `admin`; do not strip incorrectly in the SPA.

### User Experience Risks

- **Risk**: Users try to register; no UI exists.
  **Mitigation**: Out of scope; only document seed `admin` for demos.
- **Risk**: After logout, cached screens still look “logged in”.
  **Mitigation**: Clear storage, update nav state, redirect, guard routes.

---

## Troubleshooting Guide

### SPA 401 everywhere after enabling security

**Problem**: All API calls fail with 401.  
**Cause**: No Basic header or wrong credentials (`AUTH-07`).  
**Solution**: Confirm login stored credentials; inspect `Authorization` on the request.  
**Code Reference**: `client/src/util/index.tsx` (to be updated)

### Browser native login popup appears

**Problem**: Browser dialog instead of `/login`.  
**Cause**: `WWW-Authenticate: Basic` on 401.  
**Solution**: Prefer SPA login; consider suppressing the header (baseline AUTH troubleshooting).  

### Seed password does not work

**Problem**: `admin` / `admin` rejected.  
**Cause**: DB has `{noop}admin`; form must send `admin`, not `{noop}admin`.  
**Solution**: Use form password `admin`; restart backend to reseed HSQLDB if data was mutated.

### findByUsername works but Basic login fails

**Problem**: Repository finds user; Security still 401.  
**Cause**: JDBC queries in `BasicAuthenticationConfig` differ from repository mapping.  
**Solution**: Align on username/password/enabled/roles; add integration test with security on.

---

## Notes for AI Agents

1. Read Problem, Business Requirements, and Hypothesis before coding.
2. Honour Scope — **no** registration UI, **no** Option B tokens, **no** password hashing
   migration in this PRD.
3. **TDD mandatory**: write positive/negative tests → run **all** tests → implement → run
   **all** tests again (`.cursor/rules/07-tdd-workflow.mdc`).
4. Follow phases **1→6** bottom-up. Do not start Phase N+1 until Phase N is COMPLETED and
   approved. Phase 5 = frontend login; Phase 6 = logout.
5. Prefer Option A (Basic + localStorage) on top of **existing**
   `BasicAuthenticationConfig`. Do not invent bearer tokens. Do not replace JDBC auth with
   repository-based password checks.
6. `findByUsername` (Phase 2) must be implemented in **all three** DAO profiles; keep it in
   sync with the JDBC auth SQL columns.
7. Update phase status, Technical Implementation Details, Acceptance Criteria, and
   Troubleshooting as work proceeds. **Always document final changes in the feature PRD and
   any stale baseline/architecture PRDs** before marking a phase COMPLETED.
8. Cite code as `filepath:line-number`.
9. Stop for phase approval before commit/push (phase commit workflow).
10. Layer rules: Phase 1→`01`/`02`; Phase 2–3→`03`; Phase 4→`04`; Phase 5–6→`05`; tests `06`;
    workflow `07`.
11. After any edit under `security/`, re-test authentication **and** CORS.

12. After each phase COMPLETED, add/update **Phase verification (curl / API)** with
    copy-pasteable `curl.exe` commands for every new or relevant HTTP success/error case
    (Windows). If the phase has no HTTP surface, say so and point to the Maven test command.
13. After marking a phase COMPLETED, paste those curl (or "no HTTP — use mvnw -Dtest=…")
    commands in the approval handoff to the user.

---

## Phase verification (curl / API)

Base URL: `http://localhost:9966/petclinic`  
Use **PowerShell** / `curl.exe` (not the `curl` alias).

`findByUsername` / `findUser` are **not** exposed as REST yet — Phases 1–3 are verified mainly
by tests. HTTP below checks the running app + seed. Phase 4+ is where Basic auth curls matter.

### Shared — is the API up? (any phase)

```bat
curl.exe -s -w "%{http_code}" http://localhost:9966/petclinic/actuator/health
curl.exe -s http://localhost:9966/petclinic/actuator/health
```

Expect: `200` and `{"status":"UP"}` (security **off** by default).

### Phase 1 (Database & Entity) — COMPLETED

No new HTTP endpoint. Confirm seed data still reachable with security **off**:

```bat
curl.exe -s -w "\nHTTP %{http_code}\n" http://localhost:9966/petclinic/api/owners/1
curl.exe -s -w "\nHTTP %{http_code}\n" http://localhost:9966/petclinic/api/owners
```

Expect: `200` and owner JSON (seed has owners).

Layer tests:

```bat
mvnw.cmd "-Dtest=IdentitySchemaDialectReadinessTests,IdentitySeedReadinessTests" test
```

### Phase 2 (DAO findByUsername) — COMPLETED

No new HTTP endpoint (`findByUsername` is repository-only). Same smoke curls as Phase 1, plus:

```bat
mvnw.cmd "-Dtest=UserRepositoryFindByUsernameSpringDataJpaTests,UserRepositoryFindByUsernameJpaTests,UserRepositoryFindByUsernameJdbcTests" test
```

Expect: tests green (T-BE-01/02 all profiles).

### Phase 3 (Service findUser) — COMPLETED

No new HTTP endpoint (`findUser` is service-only). Smoke curls as Phase 1, plus:

```bat
mvnw.cmd "-Dtest=UserServiceSpringDataJpaTests,UserServiceJpaTests,UserServiceJdbcTests" test
```

Expect: tests green (find admin / missing → null).

Optional create-user API (security off):

```bat
curl.exe -s -w "\nHTTP %{http_code}\n" -X POST http://localhost:9966/petclinic/api/users/ -H "Content-Type: application/json" -H "Accept: application/json" -d "{\"username\":\"curluser\",\"password\":\"{noop}secret\",\"enabled\":true,\"roles\":[{\"name\":\"OWNER_ADMIN\"}]}"
```

Expect with security **off**: `201`. (Password may be echoed — known `AUTH-04`.)

### Phase 4 (API / Security Basic) — COMPLETED

Automated: `mvnw.cmd -Dtest=BasicAuthenticationIntegrationTests test` (T-BE-03…07).

Manual — start a **second** instance with security on (do not flip committed default):

```bat
mvnw.cmd spring-boot:run "-Dspring-boot.run.arguments=--server.port=9977 --petclinic.security.enable=true"
```

Then:

```bat
REM success — seed admin / admin (form password, not {noop}admin)
curl.exe -s -w "\nHTTP %{http_code}\n" -u admin:admin http://localhost:9977/petclinic/api/owners/1

REM fail — no credentials
curl.exe -s -w "\nHTTP %{http_code}\n" -D - http://localhost:9977/petclinic/api/owners/1 -o NUL

REM fail — wrong password
curl.exe -s -w "\nHTTP %{http_code}\n" -u admin:wrong http://localhost:9977/petclinic/api/owners/1

REM fail — unknown user
curl.exe -s -w "\nHTTP %{http_code}\n" -u nobody:admin http://localhost:9977/petclinic/api/owners/1
```

Expect: valid Basic → `200`; others → `401` (often with `WWW-Authenticate: Basic`).
Probe response JSON must not contain a `password` field.

### Phase 5 (Frontend Login) — COMPLETED

Client tests: `cd client && npm test` (T-FE-01…06).

API still verified with security on:

```bat
curl.exe -s -w "\nHTTP %{http_code}\n" -u admin:admin http://localhost:9977/petclinic/api/owners/1
curl.exe -s -w "\nHTTP %{http_code}\n" http://localhost:9977/petclinic/api/owners/1
```

Manual UI (SPA :4444 + API security on :9977 — point webpack `__API_SERVER_URL__` or run API on 9966 with `--petclinic.security.enable=true`):

1. Open `http://localhost:4444/owners/list` → redirect `/login`
2. `http://localhost:4444/login` → `admin` / `admin` → land on `/` (“Signed in as admin”)
3. DevTools → Network: `Authorization: Basic …` on API calls
4. Wrong password → error; localStorage empty

```bat
REM default API with security for SPA demo (port 9966)
mvnw.cmd spring-boot:run "-Dspring-boot.run.arguments=--petclinic.security.enable=true"
```

```bat
cd client
npm start
```

### Phase 6 (Frontend Logout) — COMPLETED

Client tests: `cd client && npm test -- --testPathPattern=logout` (T-FE-07…09).

Manual UI: Login → Logout → localStorage cleared → `/login`; nav shows Login; DevTools: no
`Authorization` on later calls. Visit `/owners/list` → redirect `/login`.

```bat
curl.exe -s -w "\nHTTP %{http_code}\n" -u admin:admin http://localhost:9966/petclinic/api/owners/1
curl.exe -s -w "\nHTTP %{http_code}\n" http://localhost:9966/petclinic/api/owners/1
```

(API still accepts Basic if you pass it — logout is client-side only.)

---
## Current Status

**Last Updated**: 2026-09-22  
**Current Phase**: Phase 6: Frontend — Logout — **COMPLETED**  
**Status**: **All six phases COMPLETED.** Simple Auth (Option A) feature ready for approval/commit.  
**Next Steps**: Phase approval → commit/push as agreed; enable security when demoing SPA.

**Verification (Phases 1–6)**:
- Backend: **207** Java tests, 0 failures
- Client: **31** tests, 0 failures (T-FE-01…09)
- Acceptance criteria: all checked

**Change log**:

- 2026-01-19 — initial Simple Auth PRD (Option A); metadata header Version 1.0.
- 2026-09-22 — six phases; Frontend Changes; security alignment; Version 1.1.
- 2026-09-22 — Phase 1 COMPLETED (readiness tests only).
- 2026-09-22 — Phase 2 COMPLETED (`findByUsername` all DAO profiles).
- 2026-09-22 — Phase 3 COMPLETED (`findUser` on UserService).
- 2026-09-22 — Version **1.2**; Technical Implementation Details filled for Phases 1–3;
  documentation rule reinforced in `00` / `07` Cursor rules.
- 2026-09-22 — added **Phase verification (curl / API)** section for Phases 1–6.
- 2026-09-22 — Phase 4 COMPLETED (Basic auth MockMvc T-BE-03…07; config as-is); Version **1.3**.
- 2026-09-22 — Phase 5 COMPLETED (SPA login + Basic header + guards; T-FE-01…06); Version **1.4**.
- 2026-09-22 — Phase 6 COMPLETED (SPA logout T-FE-07…09); Version **1.5**; feature complete.
