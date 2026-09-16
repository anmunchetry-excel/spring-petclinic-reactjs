# Baseline updates for modernization

Record of the work done to get this repository building, running and verified, and of every
defect found along the way.

- **Date:** 2026-09-16
- **Last reviewed:** 2026-09-16
- **Branch:** `frature/sprint-3-docs-creation`
- **Status:** backend and frontend both run; all changes uncommitted pending review

This document is the **chronological work log**: what was changed to get the repository running,
and the defects found while doing it. The full, per-slice defect catalogue lives in the baseline
PRDs — see [ARCHITECTURE.md](./ARCHITECTURE.md) for the document map and
[CROSS_CUTTING_BASELINE_PRD.md](./CROSS_CUTTING_BASELINE_PRD.md) for the recommended
remediation order across all slices.

---

## 1. Starting state

The repository is a clone of `spring-petclinic-reactjs`, but the two halves come from
different upstream projects and had drifted apart:

| Part | What it actually is |
|---|---|
| Backend | `spring-petclinic-rest` 3.2.1 on Spring Boot 3.2.1, port 9966, context path `/petclinic/` |
| Frontend | The 2016 React 15 + TypeScript client in `client/`, written against an *older* PetClinic API |
| `readme.md` | Described a third thing entirely — the old ReactJS port on `localhost:8080` |

The backend compiled and ran on the first attempt. The frontend could not build at all, and
`client/node_modules` was not even installed.

### Verified toolchain

| Tool | Version present |
|---|---|
| JDK | Amazon Corretto 21.0.4 |
| Maven | 3.6.3 via the bundled `mvnw` wrapper |
| Node.js | 24.20.0 |
| npm | 11.19.0 |

---

## 2. Why the frontend could not build

Dependabot had bumped the client's dependencies over several years, but nobody ever updated the
build configuration to match. The result was a toolchain whose parts cannot work together:

| Component | Installed | Problem |
|---|---|---|
| `webpack.config.js` | — | Written in **webpack 1** syntax (`module.loaders`, `preLoaders`, `'style!css'` chains, `resolve.extensions: ['', ...]`) |
| `webpack` | 5.94.0 | Rejects all of the above; removed in webpack 2 |
| `babel-loader` | 9.1.3 | Requires `@babel/core` 7; only `babel-core` 6 was present |
| `ts-loader` | 9.5.1 | Requires TypeScript ≥ 4; `typescript` 2.0.10 was present |
| `webpack-dev-server` | 1.16.5 | Cannot drive webpack 5 |
| `extract-text-webpack-plugin` | 3.0.2 | Peer-depends on webpack 3 — **blocked `npm install` outright** |
| `ts-jest` | 0.1.13 | Peer-depends on `jest@~16`; `jest` 29 was present — also blocked `npm install` |
| `typings` | 1.3.2 | `postinstall` hook fetches React types from a registry that no longer exists |
| `style-loader` | 0.13.2 | webpack 1 era |

React's type definitions came from the retired `typings` registry, so the sources could not be
type checked even once the build ran.

---

## 3. Changes made

No backend source file was modified. All changes are in `client/` plus the README.

### 3.1 Build configuration

**`client/webpack.config.js`** — rewritten for webpack 5. `module.rules` replaces
`module.loaders`/`preLoaders`; explicit loader arrays replace the `!`-chained strings; webpack 5
asset modules replace `url-loader`/`file-loader`; a `devServer` block sets the port, static
directory, HMR and `historyApiFallback` (required because React Router uses real paths). The
TSLint pre-loader was dropped. Backend URL is overridable via the `API_SERVER_URL` env var.

**`client/webpack.config.prod.js`** — same migration, `mode: 'production'`. Also corrected
`__API_SERVER_URL__`, which pointed at `http://localhost:8080` — the wrong backend entirely.

**`client/package.json`** —

- removed the `postinstall: typings install` hook that broke every `npm install`;
- `start` now runs `webpack serve` instead of the obsolete `node server.js`;
- dropped the `NODE_ENV=production` shell prefix from `build:prod`, which cannot work on Windows
  (the mode is set in the config instead);
- migrated the Jest block from the removed `scriptPreprocessor` option to `transform`, with
  `testEnvironment: jsdom` and `diagnostics: false`.

### 3.2 Dependencies

Ranges below are as recorded in `client/package.json` after installation.

| Removed | Added or upgraded |
|---|---|
| `babel-core`, `babel-loader`, `babel-preset-es2015`, `babel-preset-react`, `babel-preset-stage-0` | `typescript` `~2.0.2` → `^5.9.3` |
| `tslint`, `tslint-loader` | `style-loader` `^0.13.0` → `^4.0.0` |
| `extract-text-webpack-plugin` | `less` `^2.7.1` → `^4.9.1` |
| `url-loader`, `file-loader` (replaced by asset modules) | `webpack-dev-server` `^1.14.1` → `^5.2.6` |
| `typings` | `webpack-cli` `^5.1.4` (new) |
| `react-hot-loader` | `ts-jest` `^0.1.13` → `^29.4.12` |
| | `jest-environment-jsdom` `^29.7.0` (new) |

Unchanged and still current: `webpack` `^5.94.0`, `css-loader` `^6.10.0`, `less-loader`
`^12.2.0`, `ts-loader` `^9.5.1`, `jest` `^29.7.0`, and the React 15 runtime dependencies.

TypeScript is compiled by `ts-loader` in **`transpileOnly` mode**. This is deliberate: without
the `typings` definitions the React 15 sources cannot be fully type checked, and restoring type
safety means migrating to `@types` packages first. See [follow-ups](#7-recommended-follow-ups).

### 3.3 Frontend source corrections

The client was written against an older PetClinic API. Four call sites did not match this
backend:

**`client/src/util/index.tsx`** — the `url()` helper joined base and path with a slash while
callers already supplied one, producing `//api/...`. Spring Boot 3 rejects the double slash with
a 400. The helper now collapses leading slashes, which fixes every caller at once.

**`OwnersPage.tsx`, `EditOwnerPage.tsx`, `VisitsPage.tsx`, `createPetEditorModel.ts`** — all
called the old singular `/api/owner/{id}`, which returns 400. Changed to `/api/owners/{id}`.

**`ErrorPage.tsx`** — had a hardcoded `http://localhost:8080/api/oups`, a host that is not part
of this project. Now uses the configured backend via the `url()` helper. Note this endpoint is
unimplemented server-side either way; see defect B4.

### 3.4 Hot-loader removal

Removing Babel meant the `react-hot-loader/babel` plugin no longer ran, so `AppContainer` logged
`react-hot-loader/patch did not run` as a console error on **every page**. Since this was a
regression introduced by the build migration, it was fixed rather than documented:
`client/src/main.tsx` now renders `Root` directly with a standard HMR accept block, the
`react-hot-loader` dependency was uninstalled, and the dead `client/src/react-hot-loader.d.ts`
was deleted.

### 3.5 Tests

`client/tests/__tests__/util.test.tsx` contained two assertions that contradicted the code —
they expected `http://localhost:8080` when the source already defaulted to `9966`, and one
asserted the double-slash URL as *correct*. Both were updated, and a case was added covering the
leading-slash normalisation. These tests could not previously execute at all, so this is not a
regression that was introduced here.

### 3.6 Documentation

`readme.md` was rewritten. It had described a different project with install instructions that
cannot work. It now covers the real stack, prerequisites, start commands for both servers with
Windows variants, the ports table, profile/database/security configuration, project layout, a
complete curl reference, test commands, all known defects, and a warning about the build
migration.

### 3.7 Complete file list

```
 M readme.md
 M client/package.json
 M client/package-lock.json
 M client/webpack.config.js
 M client/webpack.config.prod.js
 M client/src/main.tsx
 M client/src/util/index.tsx
 M client/src/components/ErrorPage.tsx
 M client/src/components/owners/EditOwnerPage.tsx
 M client/src/components/owners/OwnersPage.tsx
 M client/src/components/pets/createPetEditorModel.ts
 M client/src/components/visits/VisitsPage.tsx
 M client/tests/__tests__/util.test.tsx
 D client/src/react-hot-loader.d.ts
```

Left in place but now unused: `client/server.js` (the old CRA-style dev server) and
`client/.babelrc`.

---

## 4. Verification performed

Everything below was executed against a running instance. Nothing is inferred from reading code.

### 4.1 Backend

`mvnw package` succeeds. All **30 endpoints** were exercised with curl and their status codes
recorded. Swagger UI, the OpenAPI JSON document and `actuator/health` all return 200. Every
record created during testing was deleted afterwards; the database is back to its seeded state
of 10 owners with ids 1–10.

### 4.2 Authentication

Auth was tested empirically by starting a second instance on port 9977 with
`--petclinic.security.enable=true`:

| Request | Result |
|---|---|
| `GET /vets` with no credentials | 401 |
| `GET /vets` with wrong password | 401 |
| `GET /vets` as `admin:admin` | 200 |
| `POST /users` as `admin` creating a `VET_ADMIN`-only user | 201 |
| `GET /vets` as that user (has `VET_ADMIN`) | 200 |
| `GET /owners` as that user (needs `OWNER_ADMIN`) | **400**, not 403 |
| `POST /users` as that user (needs `ADMIN`) | **400**, not 403 |

Role enforcement works correctly; only the status code is wrong. See defect B5.

### 4.3 Frontend

The production build compiles with warnings only (bundle size and Less mixin deprecations). All
**14 Jest tests pass** across 3 suites. `npm install` now resolves with **no flags** — previously
it failed outright.

The app was then driven in real Chrome through Playwright across **15 flows**, capturing
screenshots, console output and every network call.

**Working (11):** home page; all four nav buttons; Find Owner search unfiltered (10 owners) and
filtered (`Davis` → 2); owner row → detail page; Add Owner end to end (`201`, then redirect);
edit-owner form pre-filling with live validation; add-pet form populating its dropdown from
`/api/pettypes`; the Add Visit page; and the 404 page. Bootstrap styling, webfonts and
glyphicons all load correctly.

**Failing (4):** covered as defects F1, F2, B1 and B4 below.

---

## 5. Defects found

None of these were introduced by the changes above. All are confirmed against a running server.

### Backend

**B1 — `GET /owners/{ownerId}/pets/{petId}` always returns 400.** The handler compares the pet's
owner against the requested owner using `equals()`, but `BaseEntity` never overrides it, so the
comparison is reference identity. Because `spring.jpa.open-in-view=false`, the two lookups run
in separate JPA sessions and return distinct instances that can never match.
*Workaround:* `GET /pets/{petId}`.

**B2 — `PUT /owners/{ownerId}/pets/{petId}` returns 501.** `updateOwnersPet` is declared in
`openapi.yml` but never overridden in `OwnerRestController`, so the generated default applies.
*Workaround:* `PUT /pets/{petId}`.

**B3 — `POST /pets` and `POST /visits` fail with a foreign-key violation.** `ownerId` and
`petId` are marked `readOnly` in the OpenAPI schema, so the generated DTOs discard them from the
request body and the foreign key is inserted as null.
*Workaround:* the nested routes `POST /owners/{ownerId}/pets` and
`POST /owners/{ownerId}/pets/{petId}/visits`.

**B4 — `GET /oops` is declared in `openapi.yml` with no controller behind it.** It fails at the
framework level. Because no handler matches, the response carries no CORS headers, so a browser
reports it as a CORS failure rather than a 404.

**B5 — every error is flattened to HTTP 400.** `ExceptionControllerAdvice` has a single
`@ExceptionHandler(Exception.class)` returning `ResponseEntity.badRequest()`. Authorization
failures, integrity violations and routing errors all surface as 400. The body also leaks
internal class names, e.g. `{"className":"org.springframework.security.access.AccessDeniedException"}`.

**B6 — passwords are stored in plaintext.** `UserServiceImpl.saveUser` persists
`user.getPassword()` with no `PasswordEncoder`, and `POST /users` echoes the password back in
its response. Seed data relies on the `{noop}` prefix. A password submitted without that prefix
is unusable for login.

**B7 — the CORS policy in `WebSecurityConfig` is dead code.** It restricts origins to
`http://localhost:4444` and omits `DELETE`, but the `@CrossOrigin` annotations on the
controllers take precedence. Verified: a preflight from `http://evil.com` returns
`Access-Control-Allow-Origin: *`, and a `DELETE` preflight is approved.

### Frontend

**F1 — saving an existing owner succeeds but crashes the page.** `OwnerEditor.onSubmit` treats
only `200`/`201` as success, while `PUT /owners/{id}` correctly returns `204`. The response
falls into the error branch and rendering throws
`Cannot read properties of undefined (reading 'firstName')` on the missing `fieldErrors`. The
data *is* saved — reloading shows the change.

**F2 — adding a pet from the UI always fails with 400.** `PetEditor` submits `typeId` as a
string (`IPetRequest` in `src/types/index.ts`), but the API requires a nested `type` object.
Confirmed by replaying both payloads: `{"typeId":"2"}` → 400, `{"type":{"id":2,"name":"dog"}}` →
201. The empty birth-date field was ruled out as the cause.

**F3 — cosmetic.** The edit-owner screen is titled "New Owner" because the heading is hardcoded
in `OwnerEditor`, and the `action=` attributes on several forms still point at an old
`/api/owner` path. The latter are inert since every submit handler calls `preventDefault()`.

### Dead code

`CallMonitoringAspect` is annotated `@Aspect` and `@ManagedResource` but is never registered as
a bean, so the JMX call monitoring it implements does not run. The `spring-boot-starter-cache`
dependency is declared but nothing uses `@Cacheable` or `@EnableCaching`. Also unused:
`ClinicService.findVisitsByPetId` (implemented in all three DAO profiles, called by no
endpoint) and the duplicate `findVets()` / `findAllVets()` pair.

### Found later, during the per-slice review

`B1`–`B7` and `F1`–`F3` above were found while getting the application running. The per-slice
baselining that followed exercised each endpoint deliberately and turned up more. These are
recorded in full in the slice PRDs; summarised here so this log stays complete.

**B8 — deleting a pet type destroys pets and their visits.** `CRITICAL`.
`SpringDataPetTypeRepositoryImpl.delete` explicitly deletes every pet of that type and each
pet's visits, then returns **204**. Verified: `DELETE /api/pettypes/1` (cat) reduced the pet
count from 13 to 9 and left owner 1 with `"pets": []`. Nothing in the response signals the
collateral damage. → `PET-05` / `XC-07`, and `ARCHITECTURE.md` §3.4.

**B9 — a vet created with an unknown specialty name silently loses it.** Specialties are
resolved by **name**, and `findSpecialtiesByNameIn` returns an empty list for no match, so the
vet is created with `"specialties": []` and status **201**. The client-supplied specialty `id`
is ignored entirely — sending id `999` with name `surgery` silently resolves to id `2`.
→ `VET-01`, `VET-02`.

**B10 — a visit can be persisted with no date.** `Visit`'s constructor defaults the date to
today, but the generated MapStruct mapper calls `setDate(...)` unconditionally and overwrites it
with null. Verified: posting `{"description":"..."}` returned `{"date":null,...}` with 201.
Far-future dates are also unconstrained — `2099-12-31` was accepted. → `VIS-03`, `VIS-06`.

**B11 — every list endpoint returns 404 when empty.** The `isEmpty()` → `NOT_FOUND` guard is
present in all six list controllers, so a successful query with no matches is reported as a
missing resource. → `XC-02`.

**B12 — owner telephone validation is duplicated and inconsistent.** The DTO allows up to 20
characters matching `^[0-9]*$`; the entity declares `@Digits(fraction = 0, integer = 10)`. An
11–20 digit number passes DTO validation and then fails at persist time, leaking a raw
`ConstraintViolationException` with property paths and class names. → `OWN-09`.

**F4 — adding a visit from the UI reports failure although it succeeded.** `VisitsPage` checks
for `204`, but `POST /owners/{id}/pets/{petId}/visits` correctly returns `201`. The visit is
saved, the user is shown an error, and retrying creates a duplicate. This is the third variant
of the same mistake: `OwnerEditor` accepts only 200/201 and breaks on the correct 204 (`F1`),
while `PetEditor` and `VisitsPage` accept only 204 and break on the correct 201.
→ `VIS-02`, `PET-11`, `XC-08`.

**Also noted:** `POST /pets` would return `200` with no `Location` header and echo back the
request DTO rather than the persisted entity, if it were reachable at all (`PET-08`); and all
**four** `spring-data-jpa` override classes build their queries by string concatenation rather
than bound parameters, one of them via `createNativeQuery` (`XC-06`).

---

## 6. Additional artefacts produced

Beyond the code changes in §3, the baselining work produced:

- **The baseline PRD set** in `docs/baseline/` — one per vertical slice plus a cross-cutting
  document, each with its own gap catalogue, verified acceptance criteria and phased
  remediation plan. See the document map in [ARCHITECTURE.md](./ARCHITECTURE.md).
- **Cursor rules** in `.cursor/rules/` — nine `.mdc` files encoding the traps found here so
  future agent sessions do not rediscover them: `project-overview`, `schema-migrations`,
  `dao-layer`, `service-layer`, `api-contract`, `error-handling`, `security`, `frontend-build`
  and `frontend-api`.

---

## 7. Recommended follow-ups

Reordered after the per-slice review. Data loss first, then the things that block other fixes.

1. **Stop the data loss (B8).** Make `DELETE /pettypes/{id}` refuse when pets reference the
   type, instead of deleting them and their visits. Nothing else in this list matters if a
   single request can destroy the clinic's records.
2. **Adopt a database migration framework.** There is none — no Flyway, no Liquibase, and the
   DDL is drop-and-recreate across three dialects. This **blocks** at least five other fixes,
   including B6. Tracked as `AUTH-14` / `XC-03`.
3. **Hash passwords (B6)** with a `PasswordEncoder`, and stop returning the password in
   `POST /users` responses. Depends on item 2, because `users.password` is `VARCHAR(20)` —
   too narrow for a bcrypt hash.
4. **Replace the catch-all exception handler (B5)** with per-exception handlers so authorization
   returns 403, missing records 404, conflicts 409, and internal class names stop leaking. This
   is a **breaking change** that invalidates status codes documented across every slice PRD, so
   coordinate it as one release.
5. **Fix the client status-code assumptions (F1, F4, and `PET-11`).** Three components each
   guess differently and each breaks on a correct response. Small changes, high user impact —
   F4 in particular causes duplicate clinical records.
6. **Fix F2, B1 and B2** to make the pet screens work: send a nested `type` object, compare
   owner *ids* rather than object identity, and implement `updateOwnersPet`.
7. **Reject silently discarded input (B9, B12).** A request that cannot be honoured should fail,
   not succeed with data missing.
8. **Resolve the CORS contradiction (B7)** and collapse the two always-present security filter
   chains, so behaviour no longer depends on bean ordering.
9. **Parameterise the repository queries** in all four override classes (`XC-06`).
10. **Restore type checking.** Replace the dead `typings` definitions with `@types` packages,
    then drop `transpileOnly`. The largest item, and probably wants a React upgrade alongside
    it, since React 15 is long out of support.
11. **Align the client with the OpenAPI contract.** Generating a typed client from `openapi.yml`
    would have prevented F2, F4 and all four path mismatches structurally.

> **Warning for future dependency bumps.** The root cause of the original breakage was
> dependencies moving while `webpack.config.js` stood still. A bump that ignores the build
> configuration will reintroduce exactly this failure.
