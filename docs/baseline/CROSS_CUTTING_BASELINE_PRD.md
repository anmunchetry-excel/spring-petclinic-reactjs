Date created: 2026-09-16
Date last modified: 2026-09-16

# Cross-Cutting Concerns - Baseline Technical PRD

> **This is a baseline PRD.** It documents concerns that span **every** vertical slice, verified
> against a running instance. Current-behaviour sections are evidence-based; future work is
> marked `PLANNED`.
>
> Slice PRDs: [AUTHENTICATION](./AUTHENTICATION_BASELINE_PRD.md),
> [OWNERS](./OWNERS_BASELINE_PRD.md), [PETS](./PETS_BASELINE_PRD.md),
> [VISITS](./VISITS_BASELINE_PRD.md), [VETS](./VETS_BASELINE_PRD.md).
> See also [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## Overview/Problem

While baselining the five vertical slices, the same handful of problems appeared in every one.
They are not slice defects — they are properties of the platform, and fixing them in one slice
would either be impossible or would create an inconsistency with the other four.

Four concerns dominate. **Every error becomes HTTP 400**, because a single catch-all handler
converts every exception into a bad-request response carrying the internal exception class name,
so authorization failures, missing records, and integrity violations are indistinguishable to a
client. **Every list endpoint returns 404 instead of an empty array**, a pattern repeated
identically in all six controllers. **There is no database migration framework**, so no slice can
change its schema safely. And **the CORS configuration is contradictory**, with a restrictive
policy that never applies and permissive annotations that do.

Two further patterns recur: repositories that build SQL by string concatenation, and lookup
tables whose deletion semantics are opposite to one another for no discernible reason.

These are listed here so that each is decided **once**, rather than five times inconsistently.

---

## Hypothesis

We believe that resolving these platform concerns once — correct status codes, conventional list
responses, versioned migrations and a single CORS policy — will make every slice's remediation
simpler and mutually consistent, for both API consumers and the engineers doing the work.

---

## Scope

### In Scope

- **Error handling** — `ExceptionControllerAdvice` and the status codes it produces API-wide
- **List response conventions** — the 404-when-empty pattern in all six controllers
- **Schema evolution** — the absence of a migration framework and its consequences
- **CORS** — the two competing configurations
- **Security filter-chain composition** — two always-present chains whose order is unpinned
- **Repository query construction** — string concatenation in the override classes
- **Deletion semantics** — inconsistent cascade-versus-refuse behaviour across lookup tables
- **Create-response conventions** — status codes and `Location` headers
- **Dead and unused code** — unregistered beans, unused dependencies, unused service methods

### Out of Scope

- **Domain behaviour of any individual slice** — each has its own PRD. This document covers only
  what is shared.
- **The frontend build toolchain** — recorded in
  [BASELINE_UPDATES_FOR_MODERNIZATION.md](./BASELINE_UPDATES_FOR_MODERNIZATION.md).
- **Choosing the migration tool or the auth token strategy.** Both are open decisions recorded
  in the auth PRD; this document states the constraints, not the answers.

### Cut

- **Fixing anything here as part of this document.** Cut for the same reason as the slice PRDs:
  the baseline records the starting point, and these changes are API-wide and breaking.
- **A general API-versioning strategy.** Considered, because several fixes here are breaking
  changes. Cut as premature — decide it when the first breaking change is actually scheduled.

---

## Technical Requirements

### XC-01: Every error is flattened to HTTP 400

`rest/advice/ExceptionControllerAdvice` declares one handler for everything:

```java
@ExceptionHandler(Exception.class)
public ResponseEntity<String> exception(Exception e) {
    ObjectMapper mapper = new ObjectMapper();
    ErrorInfo errorInfo = new ErrorInfo(e);     // className + exMessage
    ...
    return ResponseEntity.badRequest().body(respJSONstring);   // always 400
}
```

Observed consequences, each verified in a different slice:

| Actual condition | Correct status | Returned |
|---|---|---|
| User lacks the required role | 403 | **400** |
| Route matches no controller | 404 | **400** |
| Foreign-key violation (in-use specialty) | 409 | **400** |
| Entity-level validation failure at persist | 400 or 422 | 400, but with a raw exception dump |

The body discloses internal types in every case, for example:

```json
{"className":"org.springframework.security.access.AccessDeniedException","exMessage":"Access is denied"}
{"className":"org.springframework.dao.DataIntegrityViolationException","exMessage":"could not execute statement [integrity constraint violation: foreign key no action ; FK_VET_SPECIALTIES_SPECIALTIES table: VET_SPECIALTIES] ..."}
```

This leaks the framework, the persistence layer, table names and constraint names to any caller.

One path is handled correctly and must be preserved: `MethodArgumentNotValidException` returns
400 with structured field detail in an `errors` header via `BindingErrorsResponse`.

### XC-02: List endpoints return 404 instead of an empty array

All six list controllers contain the identical guard:

```java
if (owners.isEmpty()) {
    return new ResponseEntity<>(HttpStatus.NOT_FOUND);
}
```

Verified present in `OwnerRestController`, `PetRestController`, `PetTypeRestController`,
`SpecialtyRestController`, `VetRestController` and `VisitRestController`. Verified behaviour:
`GET /owners?lastName=Zzz` returns **404**.

This is unconventional — a successful query with no matches is not a missing resource — and it
forces every client to treat 404 as two different things. `FindOwnersPage` currently renders an
empty table rather than a "no results" message because of it.

### XC-03: No database migration framework

**Neither Flyway nor Liquibase is present** — verified against `pom.xml` and against all 90 jars
bundled in the built artifact. Schema comes solely from hand-written `initDB.sql` per dialect,
with `spring.jpa.hibernate.ddl-auto=none`.

The scripts are drop-and-recreate, with no version table. Under the default in-memory HSQLDB the
schema is rebuilt on every start, so an edit **always appears to work locally**; a persistent
MySQL or PostgreSQL database never re-runs the script and silently keeps the old schema.

Pending schema changes already blocked by this:

| Change | Needed for |
|---|---|
| Widen `users.password` from `VARCHAR(20)` | hashing passwords (`AUTH-03`/`AUTH-06`) |
| Add the `roles` uniqueness constraint | `AUTH-13` — declared on the entity, never created |
| Add a uniqueness constraint on `specialties.name` | `VET-01`/`VET-02` name-based resolution |
| Add a uniqueness constraint on `vet_specialties` | `VET-07` |
| Reconcile `owners.telephone` width with its validation | `OWN-09` |

Full detail in [ARCHITECTURE.md](./ARCHITECTURE.md) §2.2; tracked as `AUTH-14`.

### XC-04: Two competing CORS policies

`WebSecurityConfig` declares a restrictive policy:

```java
configuration.setAllowedOrigins(List.of("http://localhost:4444"));
configuration.setAllowedMethods(List.of("OPTIONS", "GET", "POST", "PUT"));
```

Every controller separately declares `@CrossOrigin(exposedHeaders = "errors, content-type")`,
which defaults to all origins and all methods. **The annotation wins**; the central policy is
dead code. Verified:

| Probe | Result |
|---|---|
| Preflight from `http://evil.com` | allowed, `Access-Control-Allow-Origin: *` |
| Preflight for `DELETE` (absent from the allow-list) | allowed |
| `GET` with `Origin: http://localhost:4444` | `Access-Control-Allow-Origin: *` |

The API is therefore open to any origin. Note the `exposedHeaders` on the annotations is
load-bearing — the frontend reads validation failures from the `errors` header.

### XC-05: Two always-present security filter chains

`WebSecurityConfig` carries no `@ConditionalOnProperty`, so its `apiFilterChain` bean coexists
with whichever of `DisableSecurityConfig` / `BasicAuthenticationConfig` is active. Both match
`/**`, and which applies is decided by bean ordering rather than anything explicit.

Measured: authentication is correctly enforced when enabled, so `BasicAuthenticationConfig`
wins — but `WebSecurityConfig`'s CORS never applies, which is how `XC-04` arises. Nothing in the
code pins this, so a refactor could silently make a secured build permit-all.

### XC-06: Repository queries built by string concatenation

**All four** `spring-data-jpa` override classes build queries by concatenation rather than
binding parameters:

| Class | Concatenated queries |
|---|---|
| `SpringDataPetTypeRepositoryImpl` | 3 × `createQuery` |
| `SpringDataSpecialtyRepositoryImpl` | 1 × `createNativeQuery`, 1 × `createQuery` |
| `SpringDataPetRepositoryImpl` | 2 × `createQuery` |
| `SpringDataVisitRepositoryImpl` | 1 × `createQuery` |

```java
// SpringDataPetTypeRepositoryImpl
this.em.createQuery("SELECT pet FROM Pet pet WHERE type.id=" + petTypeId)
// SpringDataSpecialtyRepositoryImpl — native, so not even JPQL-parsed
this.em.createNativeQuery("DELETE FROM vet_specialties WHERE specialty_id=" + specId)
// SpringDataPetRepositoryImpl
this.em.createQuery("DELETE FROM Visit visit WHERE pet.id=" + petId)
```

The concatenated values are `Integer` path variables today, so they are type-constrained and
not currently exploitable. The pattern is unsafe regardless, and `createNativeQuery` removes
even the JPQL parsing layer. A future change of parameter type turns these into injection points.

### XC-07: Inconsistent deletion semantics

Two structurally similar lookup tables behave in opposite ways when a referenced row is deleted:

| Operation | In-use behaviour | Result |
|---|---|---|
| `DELETE /specialties/{id}` | **refuses** — FK violation surfaced as 400 | safe (by accident of flush ordering) |
| `DELETE /pettypes/{id}` | **destroys** every pet of that type and all their visits, returns 204 | **verified: 13 pets → 9** |

Elsewhere, cascades are intentional and documented: deleting an owner removes their pets and
visits; deleting a pet removes its visits. But no delete response indicates what else was
removed, so a caller cannot tell a simple delete from a destructive one.

`PET-05` is the single most dangerous defect found across all slices.

### XC-08: Inconsistent create responses

Most creates return `201` with a `Location` header. One does not:

| Endpoint | Status | `Location` | Body |
|---|---|---|---|
| `POST /owners`, `/pettypes`, `/specialties`, `/vets`, `/visits`, `/owners/{id}/pets` | 201 | yes | persisted entity |
| `POST /pets` | **200** | **no** | the **request** DTO, without the generated id |

`POST /pets` is unreachable anyway (`PET-01`), but the inconsistency should not survive any fix.

Separately, clients disagree about which statuses mean success — `OwnerEditor` accepts only
200/201 and breaks on the correct `204` (`OWN-04`), while `VisitsPage` and `PetEditor` accept
only `204` and break on the correct `201` (`VIS-02`, `PET-11`). Three components, three
different wrong assumptions, all rooted in there being no documented convention.

### XC-09: Dead and unused code

| Item | Status |
|---|---|
| `util/CallMonitoringAspect` | annotated `@Aspect` and `@ManagedResource` but **never registered as a bean** — JMX call monitoring does not run |
| `spring-boot-starter-cache` | declared in `pom.xml`; no `@Cacheable` or `@EnableCaching` anywhere |
| `ClinicService.findVisitsByPetId` | implemented in all three DAO profiles; **no endpoint calls it** (`VIS-05`) |
| `ClinicService.findVets()` / `findAllVets()` | duplicates with identical bodies (`VET-08`) |
| `GET /oops` | declared in `openapi.yml`; no controller (`B4`) |
| `client/server.js`, `client/.babelrc` | superseded by the webpack 5 migration |

---

## Implementation Phases

### Phase 0: Baseline documentation - COMPLETED

**Tasks**: identify concerns recurring across all five slices; verify each against a running
instance; record them once with cross-references.

**Deliverables**: this document; gaps `XC-01`…`XC-09`.

### Phase 1: Stop data loss - PLANNED

**Objective**: No request can silently destroy records. Highest priority across all PRDs.

**Tasks**:
1. Make `DELETE /pettypes/{id}` refuse when pets reference the type (`XC-07`, `PET-05`).
2. Parameterise the concatenated queries in both override classes (`XC-06`).
3. Audit every `...RepositoryImpl` override for both patterns.

### Phase 2: Correct error semantics - PLANNED

**Objective**: Status codes mean what they say; internals stop leaking.

**Tasks**:
1. Replace the catch-all with specific handlers: `AccessDeniedException` → 403,
   not-found → 404, `DataIntegrityViolationException` → 409 (`XC-01`).
2. Stop returning `className` and raw exception messages to clients.
3. Preserve the `MethodArgumentNotValidException` path and its `errors` header.
4. Re-verify every status code documented in the slice PRDs; several will change.

> **Breaking change.** Coordinate with all five slice PRDs; their acceptance criteria encode
> current statuses.

### Phase 3: Establish schema evolution - PLANNED

**Objective**: Schema can change safely. Prerequisite for several slice fixes.

**Tasks**:
1. Choose Flyway or Liquibase — open decision (`XC-03`, `AUTH-14`).
2. Decide whether all three dialects remain supported; each multiplies the work.
3. Baseline the existing schema, then deliver the five pending changes listed above.
4. Verify against a **persistent** database with pre-existing rows, not only HSQLDB.

### Phase 4: Consolidate security configuration - PLANNED

**Tasks**:
1. Collapse to a single `SecurityFilterChain` so behaviour no longer depends on bean ordering
   (`XC-05`).
2. Make one CORS policy authoritative — remove either the central config or the annotations,
   keeping `exposedHeaders: errors` either way (`XC-04`).
3. Re-run the authentication and CORS checks from the auth PRD afterwards.

### Phase 5: API conventions - PLANNED

**Tasks**:
1. Return `200` with an empty array from list endpoints (`XC-02`) — breaking; update clients in
   the same release.
2. Make every create return `201` with a `Location` header and the persisted entity (`XC-08`).
3. Document the status conventions in `openapi.yml` and align all three frontend editors.
4. Add pagination to list endpoints.

### Phase 6: Remove dead code - PLANNED

**Tasks**: register or delete `CallMonitoringAspect`; remove the unused cache starter; expose or
remove `findVisitsByPetId`; de-duplicate `findVets`; implement or remove `GET /oops`; delete
`client/server.js` and `.babelrc` (`XC-09`).

---

## Technical Implementation Details

### Key Files

- `src/main/java/.../rest/advice/ExceptionControllerAdvice.java` - **`XC-01`**; the single
  highest-leverage file in this document
- `src/main/java/.../rest/controller/*RestController.java` - **`XC-02`** (six copies of the
  `isEmpty()` guard), **`XC-04`** (`@CrossOrigin` on each), **`XC-08`**
- `src/main/java/.../security/WebSecurityConfig.java` - **`XC-04`**, **`XC-05`**
- `src/main/java/.../repository/springdatajpa/SpringDataPetTypeRepositoryImpl.java` - **`XC-06`**, **`XC-07`**
- `src/main/java/.../repository/springdatajpa/SpringDataSpecialtyRepositoryImpl.java` - **`XC-06`**
- `src/main/resources/db/*/initDB.sql` - **`XC-03`**; three parallel dialect scripts
- `src/main/resources/openapi.yml` - where response conventions must be declared first
- `src/main/java/.../util/CallMonitoringAspect.java` - **`XC-09`**, never registered
- `client/src/util/index.tsx` - the single client choke point where status conventions land

### Implementation Patterns

Replacing the catch-all — add specific handlers, keep the fallback last:

```java
@ExceptionHandler(AccessDeniedException.class)
@ResponseStatus(HttpStatus.FORBIDDEN)
public void accessDenied() { }

@ExceptionHandler(DataIntegrityViolationException.class)
@ResponseStatus(HttpStatus.CONFLICT)
public ResponseEntity<ApiError> conflict(DataIntegrityViolationException e) {
    return ResponseEntity.status(CONFLICT).body(new ApiError("Resource is in use"));
}
```

Parameterising a repository query:

```java
// ❌ current
this.em.createQuery("SELECT pet FROM Pet pet WHERE type.id=" + petTypeId)
// ✅
this.em.createQuery("SELECT pet FROM Pet pet WHERE pet.type.id = :typeId")
       .setParameter("typeId", petTypeId)
```

### Important Notes

- **A 400 from this API means almost nothing.** Read the `className` field before assuming the
  request was malformed.
- **A 404 from a list endpoint means "no matches", not "wrong URL".**
- **Fixing `XC-01` or `XC-02` changes every slice's documented status codes.** Both are breaking
  and must be coordinated across all five slice PRDs.
- **Nothing pins which security filter chain applies.** Re-verify after any change in
  `security/`.
- **Schema cannot change safely** until `XC-03` is resolved; at least five pending fixes depend
  on it.

---

## Acceptance Criteria

### Verified true today (baseline)

- [x] Authorization failures return **400**, not 403, with `AccessDeniedException` in the body
- [x] Unmatched routes return **400**, not 404
- [x] Foreign-key violations return **400**, not 409, leaking table and constraint names
- [x] Bean Validation failures return 400 with structured detail in the `errors` header
- [x] All six list controllers return **404** when the result set is empty
- [x] Neither Flyway nor Liquibase is present in `pom.xml` or the 90 bundled jars
- [x] A CORS preflight from `http://evil.com` is allowed with `Access-Control-Allow-Origin: *`
- [x] A `DELETE` preflight is allowed despite being absent from the central allow-list
- [x] Two `SecurityFilterChain` beans exist in every configuration
- [x] `DELETE /pettypes/{id}` on an in-use type destroys pets and visits and returns 204
- [x] `DELETE /specialties/{id}` on an in-use specialty is refused with 400
- [x] `POST /pets` returns 200 without a `Location` header; all other creates return 201 with one
- [x] `CallMonitoringAspect` is never registered as a bean

### Failing today — must pass after remediation

- [ ] Authorization failures return `403` (`XC-01`)
- [ ] Missing resources return `404`; conflicts return `409` (`XC-01`)
- [ ] No 4xx/5xx body contains an exception class name or constraint name (`XC-01`)
- [ ] List endpoints return `200` with an empty array (`XC-02`)
- [ ] Schema changes are applied by versioned migrations (`XC-03`)
- [ ] Exactly one CORS policy is authoritative; unapproved origins are refused (`XC-04`)
- [ ] Exactly one `SecurityFilterChain` exists (`XC-05`)
- [ ] No repository query is built by string concatenation (`XC-06`)
- [ ] Lookup-table deletion behaves identically for pet types and specialties (`XC-07`)
- [ ] Every create returns `201` with a `Location` header and the persisted entity (`XC-08`)
- [ ] All three frontend editors agree with the documented status conventions (`XC-08`)

### Identified gaps

| ID | Gap | Severity | Blocks |
|---|---|---|---|
| `XC-01` | Catch-all advice flattens every error to 400 and leaks internals | High | `AUTH-01`, `VET-04`, `OWN-09` |
| `XC-02` | All list endpoints return 404 instead of an empty array | Medium | `OWN-01` and equivalents in 5 slices |
| `XC-03` | No migration framework; drop-and-recreate DDL across three dialects | High | `AUTH-03`, `AUTH-06`, `AUTH-13`, `VET-01`, `OWN-09` |
| `XC-04` | Two CORS policies; the restrictive one is dead code | High | `AUTH-09` |
| `XC-05` | Two always-present filter chains; ordering unpinned | Medium | `AUTH-10` |
| `XC-06` | Repository queries built by string concatenation in **all four** override classes | Medium | `PET-06`, `VET-03` |
| `XC-07` | Lookup-table deletion is destructive in one slice, refused in another | **Critical** | `PET-05` |
| `XC-08` | Inconsistent create responses and client success checks | Medium | `PET-08`, `OWN-04`, `VIS-02`, `PET-11` |
| `XC-09` | Dead code: unregistered aspect, unused cache starter, unused methods | Low | — |

---

## Success Metrics

| Metric | Target | How Measured |
|---|---|---|
| Responses with a correct status code | 100% | Contract test per endpoint per failure mode |
| 4xx/5xx bodies leaking internal type names | 0 | Assert no `className` field API-wide |
| Records destroyed by a lookup-table delete | 0 | Counts before/after across both lookup tables |
| Schema changes under version control | 100% | Migration history table matches expected version |
| Client/server status-convention mismatches | 0 | Each frontend editor tested against its real endpoint |
| Repository queries using bound parameters | 100% | Static check for concatenation in `createQuery`/`createNativeQuery` |
| Dead code items | 0 | Re-audit the `XC-09` table |

---

## Dependencies

### External Dependencies
- `spring-boot-starter-web` - `@ControllerAdvice`, status handling
- `spring-boot-starter-security` - filter chains and the CORS source in `WebSecurityConfig`
- `spring-boot-starter-validation` - the one error path that works correctly
- A **migration framework** — absent; must be chosen (`XC-03`)

### Internal Dependencies
- **All five slice PRDs** — their acceptance criteria encode the current status codes, so
  `XC-01` and `XC-02` invalidate parts of each and must be coordinated
- `openapi.yml` - conventions must be declared here before implementation
- `client/src/util/index.tsx` - the single client-side choke point for status handling
- `db/*/initDB.sql` - three parallel dialect scripts that every schema fix must touch

---

## Risks and Mitigation

### Technical Risks

- **Risk**: `XC-01` and `XC-02` are breaking API changes. Fixing them silently would break the
  SPA and any other consumer, and would invalidate the verified status codes recorded in all
  five slice PRDs.
  **Mitigation**: Treat them as a single coordinated release. Update the slice PRDs' acceptance
  criteria in the same change, and update the client in lockstep.

- **Risk**: Fixing the catch-all could mask errors that are currently at least visible, if a new
  handler swallows an exception without logging.
  **Mitigation**: Keep a last-resort handler that returns 500 and **logs** the exception server
  side while returning an opaque body to the client.

- **Risk**: `XC-07` is the largest data-loss risk in the codebase and is reachable by a single
  request that looks like a harmless lookup-table edit.
  **Mitigation**: Phase 1, ahead of all cosmetic work. Until then, treat
  `DELETE /pettypes/{id}` as unsafe in any environment with real data.

- **Risk**: Schema fixes are blocked by `XC-03`, so `AUTH-03` (plaintext passwords) cannot be
  resolved properly — the password column is too narrow for a hash.
  **Mitigation**: Sequence Phase 3 before the auth slice's Phase 1.

- **Risk**: The security-configuration cleanup (`XC-05`) could flip which chain applies and
  silently make a secured build permit-all.
  **Mitigation**: Re-run the auth PRD's verification matrix after the change; it is the only
  thing that currently detects this.

### User Experience Risks

- **Risk**: Users see generic failures they cannot act on, because every error is a 400 with a
  Java class name.
  **Mitigation**: `XC-01`, then surface the `errors` header content in the three editors.

- **Risk**: An empty search renders as an empty table with no explanation, because 404 is
  indistinguishable from an error.
  **Mitigation**: `XC-02`, with an explicit empty state in `FindOwnersPage`.

---

## Troubleshooting Guide

### A request returns 400 but the request looks correct
**Problem**: A well-formed request is rejected as a bad request.
**Cause**: `@ExceptionHandler(Exception.class)` converts every exception to 400 (`XC-01`).
**Solution**: Read the `className` field. `AccessDeniedException` means a missing role;
`DataIntegrityViolationException` means a constraint; `NoResourceFoundException` means the route
does not exist.
**Code Reference**: `rest/advice/ExceptionControllerAdvice.java:42-53`

### A list endpoint returns 404
**Problem**: `GET /owners?lastName=Zzz` returns 404.
**Cause**: Intended — controllers return 404 when the result set is empty (`XC-02`).
**Solution**: Treat 404 from a list endpoint as "no matches".

### A schema change works locally but not on a real database
**Problem**: A column change has no effect outside development.
**Cause**: No migration framework (`XC-03`). In-memory HSQLDB rebuilds from `initDB.sql` on
every start; a persistent database never re-runs it.
**Solution**: Apply manually to every environment and dialect until Phase 3.

### CORS behaves differently from the configuration
**Problem**: `WebSecurityConfig` restricts origins, but any origin is accepted.
**Cause**: The controller `@CrossOrigin` annotations take precedence; the central policy is dead
code (`XC-04`).
**Solution**: Change the annotations, not the config, until Phase 4 consolidates them.

### Records disappeared after deleting a lookup row
**Problem**: Deleting a pet type removed pets and visits.
**Cause**: `SpringDataPetTypeRepositoryImpl.delete` deletes dependents explicitly (`XC-07`).
Specialties behave the opposite way and refuse.
**Solution**: No recovery; restart the backend to reseed. Do not call this against real data.

### A form shows an error although the save worked
**Problem**: A successful write is reported as a failure.
**Cause**: The component checks for the wrong status (`XC-08`). `OwnerEditor` expects 200/201
but update returns 204; `VisitsPage` and `PetEditor` expect 204 but creation returns 201.
**Solution**: Do not resubmit — that duplicates data. Reload to confirm.

---

## Notes for AI Agents

1. This is a **baseline** document covering concerns shared by every slice. Verified
   current-behaviour statements are fact.
2. **Do not fix any of these in a single slice.** They are API-wide; a one-slice fix creates an
   inconsistency. Raise it and coordinate.
3. `XC-01` and `XC-02` are **breaking changes** that invalidate status codes documented in all
   five slice PRDs. Update those documents in the same change.
4. `XC-07` (`PET-05`) is the most urgent item across all PRDs — it destroys data.
5. `XC-03` blocks schema work in the auth, vets and owners slices. Check it before proposing any
   column change.
6. After any change under `security/`, re-run the auth PRD's verification matrix — nothing else
   detects a filter-chain ordering flip.
7. When a gap is closed, mark its `XC-nn` row resolved rather than deleting it.
8. Use `filepath:line-number` when citing code.

---

## Current Status

**Last Updated**: 2026-09-16
**Current Phase**: Phase 0 - Baseline documentation
**Status**: COMPLETED
**Next Steps**: Review the full baseline set. Recommended remediation order across all PRDs:

1. **`XC-07` / `PET-05`** — stop pet-type deletion destroying pets and visits (data loss)
2. **`XC-03`** — adopt a migration framework (unblocks five schema fixes)
3. **`AUTH-03`** — hash passwords (depends on 2)
4. **`XC-01`** — correct error semantics (unblocks `AUTH-01`, `VET-04`, `OWN-09`)
5. Per-slice UI fixes: `OWN-04`, `VIS-02`, `PET-02`, `PET-03`

**Open decisions**: migration tool (Flyway vs Liquibase); whether all three database dialects
remain supported; session vs token strategy for auth.
