# Owners - Baseline Technical PRD

| Field | Value |
|-------|-------|
| Created | September 16, 2026 |
| Version | 1.0 - Initial |
| Version Notes | Baseline documentation of the owners vertical slice |

> **This is a baseline PRD.** It documents the owners vertical slice **as it exists today**,
> verified against a running instance. Sections describing current behaviour are evidence-based;
> future work is marked `PLANNED`.
>
> Companion documents: [ARCHITECTURE.md](./ARCHITECTURE.md),
> [AUTHENTICATION_BASELINE_PRD.md](./AUTHENTICATION_BASELINE_PRD.md),
> [PETS_BASELINE_PRD.md](./PETS_BASELINE_PRD.md),
> [VISITS_BASELINE_PRD.md](./VISITS_BASELINE_PRD.md),
> [VETS_BASELINE_PRD.md](./VETS_BASELINE_PRD.md),
> [BASELINE_UPDATES_FOR_MODERNIZATION.md](./BASELINE_UPDATES_FOR_MODERNIZATION.md).
>
> **This slice also owns** the empty-list → 404 convention (`OWN-01`, present in all six list
> controllers) and the OwnerEditor half of create/update status-code mismatches (`OWN-04`).

---

## Overview/Problem

The owner is the **aggregate root of the clinic domain**. Pets belong to owners, visits belong
to pets, and the `owners` table is the only entity a user can reach directly from the UI — every
pet and visit screen is navigated to through an owner. Getting this slice right therefore
constrains the pets and visits slices that sit beneath it.

Read operations are in good shape: search, listing and detail all work, and the owner detail
response carries the full pet-and-visit graph in a single query. Write operations are where the
problems cluster. Creating an owner works end to end, but **saving an edit succeeds on the
server and then crashes the page**, because the client treats the correct `204` response as a
failure. Two owner-scoped pet endpoints are broken outright — one always returns 400, the other
is unimplemented and returns 501 — which is why the Edit Pet screen cannot load.

Underneath that sit quieter issues: two validation layers disagree about the telephone field, so
some input passes DTO validation and then fails at persist time with a raw exception leaked to
the client; deleting an owner silently cascades to their pets and visits with no warning; and
the list endpoint returns `404` rather than an empty array when nothing matches.

---

## Business Requirements

This slice exists so clinic staff can **keep a file on each pet owner** and reach that owner's
pets and visits from it. The owner is the clinic's client, not an application login.

### Find & View Owners

#### Users

| Role | Who | What they need |
|---|---|---|
| Reception staff | Front desk | Find an owner by last name and open the file |
| Clinic administrator | `OWNER_ADMIN` when security is on | Same capabilities across every owner — no per-record ownership |

#### Capabilities

| ID | The system shall | Fulfilment today |
|---|---|---|
| BR-OWN-01 | Let staff find owners by last name and open a file that shows contact details, pets and visits | **Met** — search, list and detail work |
| BR-OWN-04 | Tell staff clearly when a search matches nobody, without implying the resource is missing | **Not met** — empty list returns 404 (`OWN-01`) |

#### Business rules

1. **An owner is the aggregate root.** Pets belong to owners; visits are reached through the
   owner file. Staff navigate pet and visit screens from the owner, not from a global pet list.
2. **Last-name search is a prefix match**, case-insensitive.
3. **Any `OWNER_ADMIN` may edit any owner.** Record-level ownership is out of scope (`OWN-10`).

### Register & Edit Owners

#### Users

| Role | Who | What they need |
|---|---|---|
| Reception staff | Front desk | Register a new client; correct contact details |

#### Capabilities

| ID | The system shall | Fulfilment today |
|---|---|---|
| BR-OWN-02 | Let staff register a new owner with name, address, city and telephone | **Met** — create works end to end in the UI |
| BR-OWN-03 | Let staff correct an existing owner's contact details and stay on a working screen afterwards | **Partial** — the save succeeds, then the page crashes (`OWN-04`) |
| BR-OWN-05 | Reject a telephone number the clinic cannot dial, with a field-level message | **Partial** — client and DTO rules disagree with the entity; 11–20 digits leak a raw exception (`OWN-09`) |

#### Business rules

1. **Contact fields are mandatory:** first name, last name, address, city, telephone.
2. **Telephone is digits only**, at most 10 digits at the entity layer (the DTO currently allows
   20 — that disagreement is a defect, not two valid rules).

### Owner Deletion

#### Users

| Role | Who | What they need |
|---|---|---|
| Clinic administrator | Maintains records | Must not destroy pets/visits without an explicit confirmation flow |

#### Capabilities

| ID | The system shall | Fulfilment today |
|---|---|---|
| BR-OWN-06 | Not offer owner deletion in the UI until staff can confirm that pets and visits will go with it | **Met as a cut** — delete exists on the API and cascades (`OWN-07`); it is deliberately hidden |

#### Business rules

1. **Deleting an owner deletes their pets and those pets' visits.** That is current cascade
   behaviour. Exposing it in the UI requires an explicit confirmation the product does not have
   yet.

---

## Hypothesis

We believe that correcting the client's handling of `204`, reconciling the duplicated validation
rules, and repairing the two owner-scoped pet endpoints will make the owner lifecycle completable
end to end in the UI for clinic staff — without changing the DAO or service layers.

---

## Scope

### In Scope

The owners vertical slice, end to end:

- **Database** — the `owners` table, its index, and the `pets.owner_id` foreign key
- **DAO** — `OwnerRepository` and its three profile-specific implementations
- **Service** — the owner methods on `ClinicService` / `ClinicServiceImpl`
- **API** — all nine operations on `OwnerRestController`, `OwnerMapper`, and the DTO shapes
- **Validation** — the two separate layers (DTO Bean Validation and entity constraints)
- **Frontend** — `FindOwnersPage`, `OwnersPage`, `NewOwnerPage`, `EditOwnerPage`, `OwnerEditor`,
  `OwnerInformation`, `OwnersTable`, `PetsTable`
- **Verified behaviour** — search semantics, validation, status codes, delete cascade
- **Identified gaps** and a phased remediation plan

### Out of Scope

- **Authentication and authorization mechanics** — owned by
  [AUTHENTICATION_BASELINE_PRD.md](./AUTHENTICATION_BASELINE_PRD.md), including the catch-all
  exception advice (`AUTH-01` / `AUTH-02`) and migration framework (`AUTH-14`). Only the
  `@PreAuthorize("hasRole(@roles.OWNER_ADMIN)")` annotations on this controller are noted here.
- **The pets and visits slices themselves.** The owner-scoped endpoints that *create* pets and
  visits are in scope because they live on `OwnerRestController`; the pet and visit domain
  behaviour is not. PetEditor / VisitsPage status mismatches are owned by those PRDs.
- **Frontend build tooling** — recorded in `BASELINE_UPDATES_FOR_MODERNIZATION.md`.

### Cut

- **Fixing `OWN-04` (the edit-owner crash) as part of this document.** Cut because the baseline must
  record the starting point first; it is Phase 1 task 1 and needs approval.
- **Adding owner deletion to the UI.** Considered and cut: deletion cascades silently to pets and
  visits, so exposing it needs a confirmation design that does not exist yet (`OWN-07`).
  Empty-list → empty array (`OWN-01`) stays in this PRD's Phase 4; when changing it, update the
  same guard in Pets, PetTypes, Visits, Vets and Specialties controllers in the same release.

---

## Technical Requirements

Everything in this section describes the **current** implementation.

### Database Schema

```sql
CREATE TABLE owners (
  id         INTEGER IDENTITY PRIMARY KEY,
  first_name VARCHAR(30),
  last_name  VARCHAR_IGNORECASE(30),
  address    VARCHAR(255),
  city       VARCHAR(80),
  telephone  VARCHAR(20)
);
CREATE INDEX owners_last_name ON owners (last_name);
```

Referenced by `pets.owner_id`:

```sql
ALTER TABLE pets ADD CONSTRAINT fk_pets_owners FOREIGN KEY (owner_id) REFERENCES owners (id);
```

Notes:

- **`last_name` is `VARCHAR_IGNORECASE`.** This HSQLDB-specific type is what makes owner search
  case-insensitive; the MySQL and PostgreSQL scripts achieve this differently or not at all, so
  search behaviour is **not guaranteed identical across dialects**.
- No column is declared `NOT NULL` even though every field is `@NotEmpty` on the entity — all
  emptiness rules live in Java, not the database.
- `telephone` is `VARCHAR(20)`, but the entity restricts it further to 10 digits (see
  [Validation](#validation)).
- There is no migration framework; see `AUTH-14` and §2.2 of `ARCHITECTURE.md`.

### Entity

`model/Owner.java` extends `Person` (which extends `BaseEntity`):

```java
@Entity
@Table(name = "owners")
public class Owner extends Person {
    @Column(name = "address")   @NotEmpty private String address;
    @Column(name = "city")      @NotEmpty private String city;
    @Column(name = "telephone") @NotEmpty @Digits(fraction = 0, integer = 10) private String telephone;

    @OneToMany(cascade = CascadeType.ALL, mappedBy = "owner", fetch = FetchType.EAGER)
    private Set<Pet> pets;
}
```

`CascadeType.ALL` on `pets` is what makes owner deletion remove the owner's pets — and, through
`Pet.visits`, their visits too. `getPets()` returns a sorted, unmodifiable view.

### DAO layer

`repository/OwnerRepository.java`, implemented three times and selected by profile:

```java
public interface OwnerRepository {
    Collection<Owner> findByLastName(String lastName) throws DataAccessException;
    Owner findById(int id) throws DataAccessException;
    void save(Owner owner) throws DataAccessException;
    Collection<Owner> findAll() throws DataAccessException;
    void delete(Owner owner) throws DataAccessException;
}
```

| Implementation | Profile | Notes |
|---|---|---|
| `SpringDataOwnerRepository` | `spring-data-jpa` *(default)* | interface only; `@Query` with `left join fetch` |
| `JpaOwnerRepositoryImpl` | `jpa` | hand-written JPQL; `findById` uses `getSingleResult()`, so it **throws** when absent |
| `JdbcOwnerRepositoryImpl` | `jdbc` | `NamedParameterJdbcTemplate` |

Both the Spring Data and JPA implementations append `%` to the search term, which is what makes
search a **prefix match**:

```java
@Query("SELECT DISTINCT owner FROM Owner owner left join fetch owner.pets WHERE owner.lastName LIKE :lastName%")
Collection<Owner> findByLastName(@Param("lastName") String lastName);
```

The `left join fetch` avoids N+1 loading of the eager `pets` collection.

### Service layer

Five methods on `ClinicServiceImpl`, all thin delegations that establish the transaction
boundary:

| Method | Transaction | Absence behaviour |
|---|---|---|
| `findAllOwners()` | `readOnly` | — |
| `findOwnerById(int)` | `readOnly` | catches and returns `null` |
| `findOwnerByLastName(String)` | `readOnly` | returns empty collection |
| `saveOwner(Owner)` | write | — |
| `deleteOwner(Owner)` | write | — |

`findOwnerById` swallows `ObjectRetrievalFailureException` / `EmptyResultDataAccessException` so
that all three DAO profiles present absence identically as `null`.

### API Endpoints

Nine operations on `rest/controller/OwnerRestController.java` (`@RequestMapping("/api")`), each
annotated `@PreAuthorize("hasRole(@roles.OWNER_ADMIN)")`.

#### GET /api/owners

Optional `lastName` query parameter. Returns the full owner list, or the filtered subset.

**Response:**
- Success (200): array of owners, each with a nested `pets` array
- Error (404): **no owners matched** — not an empty array (`OWN-01`)

> **`OWN-01` is API-wide.** The identical `isEmpty()` → `NOT_FOUND` guard is present in
> `OwnerRestController`, `PetRestController`, `PetTypeRestController`, `SpecialtyRestController`,
> `VetRestController` and `VisitRestController`. Verified: `GET /owners?lastName=Zzz` → **404**.
> This slice owns the convention change; Pets / Visits / Vets must update their controllers in
> the same release. A successful query with no matches is not a missing resource — clients must
> treat list-404 as "no matches" today. `FindOwnersPage` currently renders an empty table rather
> than a "no results" message because of it.

#### GET /api/owners/{ownerId}

**Response:**
- Success (200): the owner with nested `pets`, each with nested `visits`
- Error (404): unknown id

#### POST /api/owners

**Request Body** (`OwnerFieldsDto`):
```json
{
  "firstName": "John",
  "lastName": "Doe",
  "address": "1 Main St",
  "city": "Madison",
  "telephone": "6085551234"
}
```

**Response:**
- Success (201): the created owner, with `id`, empty `pets`, and a `Location` header
- Error (400): validation failure — details in the `errors` response header

#### PUT /api/owners/{ownerId}

Same body as `POST`. Copies the five editable fields onto the loaded entity and saves.

**Response:**
- Success (**204**, no body) — note this is what the frontend mishandles (`OWN-04`)
- Error (404): unknown id

#### DELETE /api/owners/{ownerId}

`@Transactional`. **Cascades to the owner's pets and their visits.**

**Response:**
- Success (204)
- Error (404): unknown id

#### POST /api/owners/{ownerId}/pets

Creates a pet for the owner. Resolves the pet type **by name**, not by id:

```java
PetType petType = this.clinicService.findPetTypeByName(pet.getType().getName());
```

**Response:** 201 with the created pet and a `Location` header.

#### POST /api/owners/{ownerId}/pets/{petId}/visits

Creates a visit for the pet. **Response:** 201.

#### GET /api/owners/{ownerId}/pets/{petId} — BROKEN

Always returns **400**, even for a pet that genuinely belongs to the owner (`OWN-02`, global
`B1`). Use `GET /api/pets/{petId}`.

#### PUT /api/owners/{ownerId}/pets/{petId} — NOT IMPLEMENTED

Returns **501** (`OWN-03`, global `B2`). Use `PUT /api/pets/{petId}`.

### Validation

**Two layers disagree**, and this is a live defect.

| Layer | Rule | Where |
|---|---|---|
| DTO (`OwnerFieldsDto`) | all five fields required; `telephone` matches `^[0-9]*$`, 1–20 chars; names match `^[a-zA-Z]*$`, 1–30 | generated from `openapi.yml` |
| Entity (`Owner`) | all `@NotEmpty`; `telephone` `@Digits(fraction = 0, integer = 10)` | `model/Owner.java` |

DTO validation is checked first and fails cleanly, returning 400 with structured detail in the
`errors` header:

```
errors: [{"objectName":"ownerFieldsDto","fieldName":"telephone","fieldValue":"not-a-number",
          "errorMessage":"must match \"^[0-9]*$\""}]
```

But a **telephone of 11–20 digits passes the DTO and then fails at persist time**, producing a
raw exception leaked to the client (`OWN-09`):

```json
{"className":"jakarta.validation.ConstraintViolationException",
 "exMessage":"Validation failed ... 'numeric value out of bounds (<10 digits>.<0 digits> expected)',
              propertyPath=telephone, rootBeanClass=class ...model.Owner ..."}
```

### User Interface Requirements

Eight components under `client/src/components/owners/`, plus two routes that reuse the editor.

#### Find Owners (`/owners/list`)

- Single `lastName` filter input, plus a **Find Owner** button
- Results table: Name (link), Address, City, Telephone, Pets (comma-joined names)
- Heading shows `{n} Owners found`
- **Add Owner** link to `/owners/new`
- Fetches `api/owners?lastName={query}`; an empty query returns all owners

#### Owner detail (`/owners/:ownerId`)

- `OwnerInformation`: name, address, city, telephone, plus **Edit Owner** and **Add New Pet**
- `PetsTable`: each pet's name, birth date, type, and visits, with **Edit Pet** / **Add Visit**
- Renders `No Owner loaded` until the fetch resolves
- **No delete control** — owner deletion is not reachable from the UI

#### New owner (`/owners/new`) and Edit owner (`/owners/:ownerId/edit`)

Both render `OwnerEditor`. New passes a blank owner with `isNew: true`; Edit fetches the owner
first and renders `null` until it arrives.

- Fields: First Name, Last Name, Address, City, Telephone
- Per-field validation on change: `NotEmpty` on all, `Digits(10)` on telephone
- Valid fields show a tick; invalid show an error panel
- Submit posts to `/api/owners` or puts to `/api/owners/{id}`
- On success, routes to `/owners/{id}`

Known UI problems: the edit screen is titled **"New Owner"** (`OWN-05`); saving an edit crashes
the page (`OWN-04`); `OwnersTable` rows use `<a href>` rather than React Router `<Link>`, forcing
a **full page reload** on every row click (`OWN-06`); and `EditOwnerPage` renders `null` forever
if the fetch fails (`OWN-12`).

---

## Implementation Phases

### Phase 0: Baseline documentation - COMPLETED

**Objective**: Establish a verified record of the owners slice.

**Tasks**:
1. Document every layer — schema, entity, DAO, service, API, validation, UI.
2. Verify search semantics, validation, status codes and delete cascade against a running server.
3. Record all gaps with evidence.

**Deliverables**:
- This document; gaps `OWN-01` … `OWN-13`; verification in [Acceptance Criteria](#acceptance-criteria).

### Phase 1: Make the owner lifecycle completable in the UI - PLANNED

**Objective**: A user can create, view, search and edit an owner without hitting an error.

**Tasks**:
1. Fix `OWN-04` — treat `204` as success in `OwnerEditor.onSubmit` and route to the owner page.
2. Fix `OWN-05` — derive the heading from `owner.isNew` instead of hardcoding "New Owner".
3. Fix `OWN-12` — render an error state when the owner fetch fails.
4. Fix `OWN-06` — replace `<a href>` with `<Link>` in `OwnersTable`.
5. Remove the inert `action={url('/api/owner')}` attributes (`OWN-11`).

**Deliverables**:
- Updated owner components; browser-verified create/search/view/edit flows.

### Phase 2: Reconcile validation - PLANNED

**Objective**: One authoritative set of rules; no raw exceptions reaching clients.

**Tasks**:
1. Decide the real telephone rule and align `openapi.yml` with `Owner` (`OWN-09`).
2. Decide whether entity-level Bean Validation is kept at all, or whether the DTO is the single
   gate.
3. Ensure any persist-time violation is translated, not leaked — depends on
   [AUTHENTICATION_BASELINE_PRD.md](./AUTHENTICATION_BASELINE_PRD.md) catch-all fix (`AUTH-01`).

### Phase 3: Repair the owner-scoped pet endpoints - PLANNED

**Objective**: Unblock the Edit Pet screen.

**Tasks**:
1. Fix `OWN-02` — compare owner **ids** rather than object identity in `getOwnersPet`.
2. Implement `updateOwnersPet` (`OWN-03`), or remove it from `openapi.yml` if the flat
   `/pets/{id}` route is the intended contract.

> Coordinate with the pets baseline PRD — these endpoints straddle both slices.

### Phase 4: List semantics and scale - PLANNED

**Objective**: Make the list endpoint conventional and bounded.

**Tasks**:
1. Return `200` with an empty array instead of `404` (`OWN-01`) — **breaking**. Apply the same
   change to all six list controllers in one release; update client empty-state handling.
2. Document create/update status conventions for editors: creates → `201`, updates → `204`.
   `OwnerEditor` must accept `204` (`OWN-04`); see also `PET-11` and `VIS-02` for the other two
   wrong assumptions about the same convention.
3. Add pagination and sorting (`OWN-08`); the list is currently unbounded.
4. Consider search beyond `lastName` (`OWN-13`).

### Phase 5: Deletion and ownership - PLANNED

**Tasks**:
1. Decide whether cascade-on-delete is correct; if exposed in the UI, require confirmation
   showing what will be removed (`OWN-07`).
2. Revisit per-record ownership (`OWN-10`, `AUTH-12`).

---

## Technical Implementation Details

### Key Files

**Backend**
- `src/main/java/.../model/Owner.java` - entity; `CascadeType.ALL` on `pets`; `@Digits(integer = 10)`
- `src/main/java/.../repository/OwnerRepository.java` - the five-method interface
- `src/main/java/.../repository/springdatajpa/SpringDataOwnerRepository.java` - default impl
- `src/main/java/.../repository/jpa/JpaOwnerRepositoryImpl.java` - throws on missing id
- `src/main/java/.../repository/jdbc/JdbcOwnerRepositoryImpl.java` - JDBC impl
- `src/main/java/.../service/ClinicServiceImpl.java` - transaction boundary; null-on-absence
- `src/main/java/.../rest/controller/OwnerRestController.java` - all nine operations
- `src/main/java/.../mapper/OwnerMapper.java` - `@Mapper(uses = PetMapper.class)`
- `src/main/resources/openapi.yml` - `Owner` / `OwnerFields` schemas; `/owners` paths
- `src/main/resources/db/*/initDB.sql` - `owners` DDL

**Frontend** (`client/src/components/owners/`)
- `FindOwnersPage.tsx` - search form and results
- `OwnersPage.tsx` - detail; composes `OwnerInformation` + `PetsTable`
- `OwnerEditor.tsx` - shared create/edit form; **contains `OWN-04` and `OWN-05`**
- `NewOwnerPage.tsx` / `EditOwnerPage.tsx` - thin wrappers around the editor
- `OwnersTable.tsx` - results table; **contains `OWN-06`**
- `OwnerInformation.tsx`, `PetsTable.tsx` - detail presentation

### Implementation Patterns

Controller shape — map, delegate, translate to a status:

```java
@PreAuthorize("hasRole(@roles.OWNER_ADMIN)")
@Override
public ResponseEntity<OwnerDto> getOwner(Integer ownerId) {
    Owner owner = this.clinicService.findOwnerById(ownerId);
    if (owner == null) {
        return new ResponseEntity<>(HttpStatus.NOT_FOUND);
    }
    return new ResponseEntity<>(ownerMapper.toOwnerDto(owner), HttpStatus.OK);
}
```

The `204` the client must handle:

```ts
submitForm('PUT', '/api/owners/' + owner.id, owner, (status, response) => {
  // ❌ current: 204 falls through to the error branch and crashes render
  if (status === 200 || status === 201) { ... }
});
```

### Important Notes

- **Owner search is a case-insensitive prefix match**, and that case-insensitivity comes from the
  HSQLDB `VARCHAR_IGNORECASE` column type — it may not hold on MySQL or PostgreSQL.
- **Deleting an owner silently deletes their pets and visits.** Verified.
- **The owner detail response is a deep graph** — owner → pets → visits — loaded eagerly in one
  query. Adding fields here inflates every list response too.
- Pet type on `POST /owners/{id}/pets` is resolved **by name**, so the `name` field must be
  present and correct; the `id` alone is not sufficient.
- List endpoints return `404`, not an empty array. Clients must handle that.

---

## Acceptance Criteria

### Verified true today (baseline)

Measured against the running instance on port 9966.

- [x] `GET /owners` returns all 10 seeded owners with nested pets
- [x] `GET /owners?lastName=Davis` returns the 2 matching owners
- [x] `GET /owners?lastName=Dav` matches by **prefix**
- [x] `GET /owners?lastName=davis` matches **case-insensitively**
- [x] `GET /owners?lastName=avis` does **not** match (no infix search)
- [x] `GET /owners?lastName=Zzz` returns **404**, not an empty array
- [x] `GET /owners/{id}` returns the owner with nested pets and visits; unknown id → 404
- [x] `POST /owners` returns 201 with the created owner
- [x] `PUT /owners/{id}` returns 204
- [x] `DELETE /owners/{id}` returns 204; unknown id → 404
- [x] Deleting an owner **cascades**: the owner's pet was also removed (404 afterwards)
- [x] Invalid telephone (`not-a-number`) → 400 with structured detail in the `errors` header
- [x] Missing `lastName` → 400 with `"must not be null"` in the `errors` header
- [x] `POST /owners/{id}/pets` returns 201
- [x] `POST /owners/{id}/pets/{petId}/visits` returns 201
- [x] UI: search, filter, detail view and owner creation all work in the browser

### Failing today — must pass after remediation

- [ ] Saving an existing owner returns the user to the owner page without error (`OWN-04`)
- [ ] The edit screen is titled "Edit Owner", not "New Owner" (`OWN-05`)
- [ ] `GET /owners/{ownerId}/pets/{petId}` returns the pet for a valid pairing (`OWN-02`)
- [ ] `PUT /owners/{ownerId}/pets/{petId}` updates the pet, or is removed from the spec (`OWN-03`)
- [ ] An 11–20 digit telephone is either accepted or rejected cleanly, never leaking
      `ConstraintViolationException` (`OWN-09`)
- [ ] Clicking an owner row navigates client-side without a full page reload (`OWN-06`)
- [ ] A failed owner fetch renders an error state rather than a blank page (`OWN-12`)
- [ ] A search with no matches returns `200` with an empty array (`OWN-01`, breaking change)
- [ ] The owner list is paginated (`OWN-08`)

### Identified gaps

| ID | Gap | Evidence | Severity |
|---|---|---|---|
| `OWN-01` | List returns 404 instead of an empty array (same guard in all six list controllers) | `?lastName=Zzz` → 404 | Medium |
| `OWN-02` | `GET /owners/{ownerId}/pets/{petId}` always 400 | global `B1`; `equals()` on `BaseEntity` | High |
| `OWN-03` | `PUT /owners/{ownerId}/pets/{petId}` returns 501 | global `B2`; not overridden | High |
| `OWN-04` | Edit-owner save succeeds then crashes the page (expects 200/201; update returns 204) | global `F1` | High |
| `OWN-05` | Edit screen titled "New Owner" | hardcoded `<h2>` in `OwnerEditor` | Low |
| `OWN-06` | Owner rows use `<a href>`, forcing a full page reload | `OwnersTable.tsx` | Low |
| `OWN-07` | Owner deletion cascades silently to pets and visits | verified: pet 404 after owner delete | Medium |
| `OWN-08` | No pagination or sorting; list is unbounded | `findAll()` returns everything | Medium |
| `OWN-09` | DTO and entity telephone rules disagree; raw exception leaks | 15-digit phone → `ConstraintViolationException` | High |
| `OWN-10` | No per-record ownership; any `OWNER_ADMIN` edits any owner | see `AUTH-12` | Medium |
| `OWN-11` | Inert `action="/api/owner"` attributes on forms | `OwnerEditor.tsx`; `preventDefault()` makes them dead | Low |
| `OWN-12` | `EditOwnerPage` renders `null` forever if the fetch fails | no error branch | Medium |
| `OWN-13` | Search supports only `lastName` | `listOwners(String lastName)` | Low |

---

## Success Metrics

| Metric | Target | How Measured |
|---|---|---|
| Owner lifecycle completable in the UI | create, search, view, edit all pass | Browser flow suite |
| Unhandled client errors in owner flows | 0 | Console errors captured during the flow suite |
| Raw exception types leaked from owner endpoints | 0 | Assert no `className` in 4xx bodies |
| Validation consistency | 0 inputs that pass the DTO and fail at persist | Boundary tests on telephone and name lengths |
| Owner list response time at scale | bounded by page size | Measure with a seeded large dataset |
| Cross-dialect search parity | identical results on all supported databases | Run the search suite per profile |

---

## Dependencies

### External Dependencies
- `spring-boot-starter-data-jpa` - persistence for the default profile
- `spring-boot-starter-validation` - DTO and entity Bean Validation
- `mapstruct` - `OwnerMapper`, which delegates to `PetMapper`
- `hsqldb` - `VARCHAR_IGNORECASE` provides case-insensitive search

### Internal Dependencies
- `openapi.yml` - generates `OwnersApi` and the `Owner`/`OwnerFields` DTOs; edit it before code
- `ClinicService` - the shared facade and transaction boundary
- `PetMapper` - nested pets in every owner response
- **Pets slice** - `POST /owners/{id}/pets` resolves pet types by name; `Pet.type` must exist
- **Visits slice** - reached only through `POST /owners/{id}/pets/{petId}/visits`
- `ExceptionControllerAdvice` - determines how validation and authorization failures surface
- `client/src/util/index.tsx` - `url()` and `submitForm`, used by every owner component
- Auth slice - `@PreAuthorize(OWNER_ADMIN)` on all nine operations

---

## Risks and Mitigation

### Technical Risks

- **Risk**: Changing the list endpoint from 404 to an empty array (`OWN-01`) breaks every
  existing client, including `FindOwnersPage`.
  **Mitigation**: Single coordinated release — update all six list controllers and
  `FindOwnersPage` empty-state handling together (this PRD owns the convention).

- **Risk**: Owner deletion cascades to pets and visits. A bulk cleanup or an accidental call
  destroys more than intended, and nothing warns the caller.
  **Mitigation**: Keep deletion out of the UI until a confirmation exists. Cover the cascade with
  a test so a future mapping change cannot silently alter it.

- **Risk**: Search case-insensitivity depends on the HSQLDB `VARCHAR_IGNORECASE` type, so
  behaviour may differ on MySQL and PostgreSQL.
  **Mitigation**: Run the search acceptance tests against each supported dialect before claiming
  parity. Do not assume the default profile is representative.

- **Risk**: Reconciling validation (`OWN-09`) by loosening the entity rule could allow data the
  database cannot hold, since `telephone` is `VARCHAR(20)`.
  **Mitigation**: Decide the rule against the column width, and remember there is no migration
  framework (`AUTH-14`) if the column must change.

- **Risk**: The owner detail response is a deep eager graph. Adding fields to `Pet` or `Visit`
  inflates every owner list response.
  **Mitigation**: Measure the list payload when changing nested entities; consider a summary DTO
  for lists if it grows.

### User Experience Risks

- **Risk**: The edit-owner crash (`OWN-04`) looks like data loss, because the page breaks after a
  save that actually succeeded. Users may re-enter data or assume the app is broken.
  **Mitigation**: Highest-priority fix in Phase 1.

- **Risk**: A search with no matches returns 404, which the client renders as an empty table
  rather than a clear "no results" message.
  **Mitigation**: Add an explicit empty state alongside the Phase 4 change.

---

## Troubleshooting Guide

### Edit-owner page goes blank after clicking Update
**Problem**: The page throws `Cannot read properties of undefined (reading 'firstName')` after a
successful save.
**Cause**: `PUT` returns `204`; `OwnerEditor.onSubmit` only treats `200`/`201` as success, so the
empty body is set as `error` and rendering dereferences the missing `fieldErrors`.
**Solution**: Accept `204` (`OWN-04`). The data was saved — reloading shows the change.
**Code Reference**: `client/src/components/owners/OwnerEditor.tsx` (`onSubmit`)

### Owner search returns nothing for a name that clearly exists
**Problem**: Searching `avis` does not find `Davis`.
**Cause**: Search is a **prefix** match — the repository appends `%` only to the end.
**Solution**: Search by the start of the last name. Infix search requires a query change.
**Code Reference**: `repository/springdatajpa/SpringDataOwnerRepository.java`

### Creating an owner fails with a long telephone number
**Problem**: A 15-digit number returns 400 with a `ConstraintViolationException` body.
**Cause**: The DTO allows up to 20 characters, but the entity declares
`@Digits(fraction = 0, integer = 10)`, which fails at persist time (`OWN-09`).
**Solution**: Use 10 digits or fewer until the two layers are reconciled.
**Code Reference**: `model/Owner.java` (`telephone`)

### Deleting an owner removed pets and visits too
**Problem**: More data disappeared than expected.
**Cause**: Intended — `@OneToMany(cascade = CascadeType.ALL)` on `Owner.pets`, and `Pet.visits`
cascades in turn. Verified: the pet returned 404 after the owner was deleted.
**Solution**: None needed; be aware before calling `DELETE /owners/{id}` (`OWN-07`).

### Edit Pet screen never loads
**Problem**: It hangs on "Loading..." and the dev server shows a runtime error.
**Cause**: `GET /owners/{ownerId}/pets/{petId}` always returns 400 (`OWN-02`).
**Solution**: Use `GET /pets/{petId}` until the endpoint is fixed.

---

## Notes for AI Agents

1. This is a **baseline** document. Current-behaviour sections are verified fact — do not
   "correct" them to match what the code appears to intend. Read Business Requirements before
   changing owner lifecycle behaviour; do not weaken a Met capability while remediating a
   Not-met one.
2. Do not implement Phase 1+ work without explicit approval. Phase 0 is the only completed phase.
3. Owner-scoped **pet** endpoints live on `OwnerRestController` but belong to both slices.
   Coordinate with the pets baseline PRD before changing them.
4. Adding a method to `OwnerRepository` means implementing it **three times**, once per profile.
5. Never compare entities with `equals()` across service calls — that is the `OWN-02` bug.
6. After any change, restore the seed data: 10 owners with ids 1–10, 13 pets.
7. Mark a gap resolved rather than deleting its row; the history is the point of a baseline.
8. Use `filepath:line-number` when citing code.

---

## Current Status

**Last Updated**: 2026-09-22
**Current Phase**: Phase 0 - Baseline documentation
**Status**: COMPLETED
**Next Steps**: Review, then proceed to the Pets baseline PRD — it shares the owner-scoped pet
endpoints documented here. Remediation phases require approval before any code change.

**Change log**:
- 2026-09-22 — added Business Requirements (BR-OWN-01–06).
- 2026-09-22 — absorbed former cross-cutting list-404 and editor status-convention ownership
  (`OWN-01`, `OWN-04`); catch-all advice / migrations remain under Authentication.

**Cross-slice items surfaced here**:

1. List endpoints returning `404` instead of an empty array (`OWN-01`) — this PRD owns the
   convention; apply to all six list controllers together.
2. Persist-time validation leaks (`OWN-09`) — symptom of `AUTH-01` / `AUTH-02`.
3. No migration framework (`AUTH-14`) — blocks any `owners` column change.
