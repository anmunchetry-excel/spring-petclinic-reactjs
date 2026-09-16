Date created: 2026-09-16
Date last modified: 2026-09-16

# Pets & Pet Types - Baseline Technical PRD

> **This is a baseline PRD.** It documents the pets vertical slice **as it exists today**,
> verified against a running instance. Current-behaviour sections are evidence-based; future
> work is marked `PLANNED`.
>
> Companion documents: [ARCHITECTURE.md](./ARCHITECTURE.md),
> [OWNERS_BASELINE_PRD.md](./OWNERS_BASELINE_PRD.md),
> [CROSS_CUTTING_BASELINE_PRD.md](./CROSS_CUTTING_BASELINE_PRD.md).

---

## Overview/Problem

A pet belongs to exactly one owner and has exactly one type. The slice sits between owners
(above) and visits (below), and it is the **most broken slice in the application**.

Reads work. Writes are a different story. Creating a pet through the flat `POST /pets` endpoint
is impossible — the owner id is stripped from the request body, so the insert violates a
not-null foreign key. Creating one through the UI is also impossible, because the client sends
`typeId` where the API requires a nested `type` object. The Edit Pet screen cannot even load,
because the endpoint it reads from always returns 400, and the endpoint it would save to is
unimplemented and returns 501. In short, **no pet can be created or edited through the user
interface at all**, and only the owner-scoped creation endpoint works from the API.

Pet types are a small lookup table, but they carry the single most dangerous behaviour found
anywhere in this codebase: **deleting a pet type silently deletes every pet of that type, along
with all their visits**, and returns `204` as though nothing unusual happened.

---

## Hypothesis

We believe that repairing the pet write paths — the owner comparison, the unimplemented update,
the `typeId`/`type` mismatch, and the stripped `ownerId` — will make the pet lifecycle completable
for clinic staff, and that making pet-type deletion refuse to destroy dependent records will
remove the largest accidental-data-loss risk in the system.

---

## Scope

### In Scope

- **Database** — the `pets` and `types` tables, their foreign keys and indexes
- **DAO** — `PetRepository`, `PetTypeRepository` and their three implementations each, including
  the `PetTypeRepositoryOverride` delete behaviour
- **Service** — pet and pet-type methods on `ClinicService`
- **API** — `PetRestController` (5 operations), `PetTypeRestController` (5 operations)
- **Mapping** — `PetMapper`, `PetTypeMapper`, and the `readOnly` field problem
- **Frontend** — `NewPetPage`, `EditPetPage`, `PetEditor`, `createPetEditorModel`, `PetsTable`,
  and the `SelectInput` / `DateInput` form controls
- **Verified behaviour** — status codes, the pet-type delete cascade, creation failures

### Out of Scope

- **Owners** — [OWNERS_BASELINE_PRD.md](./OWNERS_BASELINE_PRD.md). The owner-scoped endpoints
  `POST/GET/PUT /owners/{ownerId}/pets/...` are documented there; their *pet* semantics are
  analysed here because they are the only working creation path.
- **Visits** — their own PRD; only the cascade from pet deletion is covered here.
- **Cross-cutting concerns** (catch-all error handling, list-404, no migration framework) —
  [CROSS_CUTTING_BASELINE_PRD.md](./CROSS_CUTTING_BASELINE_PRD.md).

### Cut

- **Fixing `PET-01`…`PET-04` here.** Cut because the baseline records the starting point;
  remediation is phased and needs approval.
- **Redesigning pet-type deletion to soft-delete.** Considered, but the immediate need is simply
  to stop destroying data; a soft-delete model is a larger design question.

---

## Technical Requirements

### Database Schema

```sql
CREATE TABLE types (
  id   INTEGER IDENTITY PRIMARY KEY,
  name VARCHAR(80)
);
CREATE INDEX types_name ON types (name);

CREATE TABLE pets (
  id         INTEGER IDENTITY PRIMARY KEY,
  name       VARCHAR(30),
  birth_date DATE,
  type_id    INTEGER NOT NULL,
  owner_id   INTEGER NOT NULL
);
ALTER TABLE pets ADD CONSTRAINT fk_pets_owners FOREIGN KEY (owner_id) REFERENCES owners (id);
ALTER TABLE pets ADD CONSTRAINT fk_pets_types  FOREIGN KEY (type_id)  REFERENCES types (id);
CREATE INDEX pets_name ON pets (name);
```

Both foreign keys are **`NOT NULL`**. This is precisely why `POST /pets` and `POST /visits`
fail: the generated DTO drops the incoming id and the insert violates the constraint.

Seed data: 6 pet types (cat, dog, lizard, snake, bird, hamster) and 13 pets.

### Entity

```java
@Entity
@Table(name = "pets")
public class Pet extends NamedEntity {
    @Column(name = "birth_date", columnDefinition = "DATE") private LocalDate birthDate;
    @ManyToOne @JoinColumn(name = "type_id")  private PetType type;
    @ManyToOne @JoinColumn(name = "owner_id") private Owner owner;

    @OneToMany(cascade = CascadeType.ALL, mappedBy = "pet", fetch = FetchType.EAGER)
    private Set<Visit> visits;
}
```

`PetType` extends `NamedEntity`, so it is just an id and a `@NotEmpty` name. `Pet.visits`
cascades, so deleting a pet deletes its visits. `getVisits()` returns a sorted, unmodifiable view.

### DAO layer

`PetRepository` adds `findPetTypes()` to the usual five methods; `PetTypeRepository` adds
`findByName(String)`, which the owner-scoped creation endpoint depends on.

Both use the **override pattern** under `spring-data-jpa` for deletion, because dependent rows
must be removed first. `SpringDataPetTypeRepositoryImpl.delete` is the origin of the destructive
behaviour:

```java
@Override
public void delete(PetType petType) {
    this.em.remove(this.em.contains(petType) ? petType : this.em.merge(petType));
    Integer petTypeId = petType.getId();

    List<Pet> pets = this.em.createQuery("SELECT pet FROM Pet pet WHERE type.id=" + petTypeId).getResultList();
    for (Pet pet : pets) {
        for (Visit visit : pet.getVisits()) {
            this.em.createQuery("DELETE FROM Visit visit WHERE id=" + visit.getId()).executeUpdate();
        }
        this.em.createQuery("DELETE FROM Pet pet WHERE id=" + pet.getId()).executeUpdate();
    }
    this.em.createQuery("DELETE FROM PetType pettype WHERE id=" + petTypeId).executeUpdate();
}
```

Two problems in one method: it **deletes dependent pets and visits** rather than refusing
(`PET-05`), and it builds every query by **string concatenation** instead of bound parameters
(`PET-06`). The concatenated values are `Integer` path variables today, so they are
type-constrained, but the pattern is unsafe and should not be copied.

### Service layer

| Method | Transaction | Notes |
|---|---|---|
| `findAllPets()` / `findPetById(int)` | `readOnly` | `findPetById` returns `null` when absent |
| `savePet(Pet)` / `deletePet(Pet)` | write | |
| `findAllPetTypes()` / `findPetTypeById(int)` | `readOnly` | |
| `findPetTypeByName(String)` | `readOnly` | used by `addPetToOwner` |
| `findPetTypes()` | `readOnly` | delegates to `petRepository`, not `petTypeRepository` |
| `savePetType` / `deletePetType` | write | |

### API Endpoints — Pets

All on `PetRestController`, guarded by `@PreAuthorize("hasRole(@roles.OWNER_ADMIN)")`.

#### GET /api/pets
- Success (200): array of pets, each with nested `type` and `visits`
- Error (404): when the list is empty

#### GET /api/pets/{petId}
- Success (200) / Error (404)

Note the handler maps **before** the null check — `petMapper.toPetDto(findPetById(petId))`. It
works only because MapStruct returns `null` for a `null` input (`PET-07`).

#### POST /api/pets — BROKEN AND NON-STANDARD

```java
public ResponseEntity<PetDto> addPet(PetDto petDto) {
    this.clinicService.savePet(petMapper.toPet(petDto));
    return new ResponseEntity<>(petDto, HttpStatus.OK);
}
```

Three defects in four lines:

1. `ownerId` is `readOnly` in the schema, so it is stripped and the insert violates
   `fk_pets_owners` → **400** every time (`PET-01`). The endpoint is effectively dead.
2. It would return **`200`**, not `201`, and sets **no `Location` header** — inconsistent with
   every other create in the API (`PET-08`).
3. It echoes back the **request** DTO, not the persisted entity, so the caller never learns the
   generated id (`PET-08`).

**Use `POST /api/owners/{ownerId}/pets` instead.**

#### PUT /api/pets/{petId}
- Success (**204**)
- Error (404): unknown id

Updates `name`, `birthDate` and `type` only. **The owner cannot be changed** — there is no way
to reassign a pet to a different owner through the API (`PET-09`).

#### DELETE /api/pets/{petId}
- Success (204); cascades to the pet's visits
- Error (404): unknown id

### API Endpoints — Pet Types

On `PetTypeRestController`. **Authorization is split**, unlike any other slice:

| Operation | Role required |
|---|---|
| `GET /api/pettypes`, `GET /api/pettypes/{id}` | `OWNER_ADMIN` **or** `VET_ADMIN` |
| `POST`, `PUT`, `DELETE /api/pettypes` | `VET_ADMIN` **only** |

An `OWNER_ADMIN` can therefore read pet types — which they must, to create a pet — but cannot
manage them.

#### POST /api/pettypes
- Success (201) with `Location`
- Error (400) if the body carries a non-zero `id`:
  ```java
  if (Objects.nonNull(petTypeDto.getId()) && !petTypeDto.getId().equals(0)) {
      return new ResponseEntity<>(HttpStatus.BAD_REQUEST);
  }
  ```
  A bare 400 with no explanatory body (`PET-10`).

#### PUT /api/pettypes/{id} — 204. #### GET — 200/404.

#### DELETE /api/pettypes/{petTypeId} — DESTRUCTIVE

Returns **204** and **deletes every pet of that type, plus all their visits**.

Verified: `DELETE /api/pettypes/1` (cat) reduced the pet count from **13 to 9** and left
owner 1 with `"pets": []` — their pet Leo was destroyed by a request that appears to target only
a lookup row. Nothing in the response indicates the collateral damage (`PET-05`).

### Mapping

`PetMapper` flattens the owner: `@Mapping(source = "owner.id", target = "ownerId")`. The reverse
direction does not exist, because `ownerId` is `readOnly` in `openapi.yml` — the root cause of
`PET-01`.

Two DTO shapes: `PetFieldsDto` (`name`, `birthDate`, `type`) for owner-scoped creation, and
`PetDto` (adds `id`, `ownerId`, `visits`) elsewhere.

### User Interface Requirements

#### Add pet (`/owners/:ownerId/pets/new`) and Edit pet (`/owners/:ownerId/pets/:petId/edit`)

Both render `PetEditor`. `createPetEditorModel` loads the pet-type list and the owner in
parallel; the edit route additionally fetches the pet.

- Read-only owner name
- **Name** — text, `NotEmpty`
- **Birth date** — `DateInput` (react-datepicker)
- **Type** — `SelectInput` populated from `GET /api/pettypes`
- Submit button reads "Add Pet" or "Update Pet"

Neither screen works:

- **Add** always fails with 400, because `PetEditor` submits `typeId` where the API requires a
  nested `type` object (`PET-02`, global `F2`):

  ```ts
  const request: IPetRequest = { birthDate, name, typeId: editablePet.typeId };
  ```

  Verified by replaying both payloads: `{"typeId":"2"}` → 400,
  `{"type":{"id":2,"name":"dog"}}` → 201.

- **Edit** never loads. It reads `GET /api/owners/{ownerId}/pets/{petId}`, which always returns
  400 (`PET-03`), leaving the page on "Loading..." with a runtime error overlay.

- Even if it loaded, saving would `PUT /api/owners/{ownerId}/pets/{petId}`, which returns **501**
  (`PET-04`).

- Success is checked as `status === 204`, but owner-scoped creation returns **201**, so the
  redirect would not fire even on success (`PET-11`).

#### Pets table (within owner detail)

`PetsTable` renders each pet's name, birth date, type and visits, with **Edit Pet** and
**Add Visit** links. Read-only and working; there is **no delete control** for pets anywhere in
the UI (`PET-12`).

---

## Implementation Phases

### Phase 0: Baseline documentation - COMPLETED

**Tasks**: document every layer; verify status codes, creation failures and the pet-type delete
cascade against a running server; record gaps.

**Deliverables**: this document; gaps `PET-01`…`PET-12`.

### Phase 1: Stop the data loss - PLANNED

**Objective**: No request can silently destroy records. Highest priority in this PRD.

**Tasks**:
1. Make `DELETE /pettypes/{id}` **refuse** when pets reference the type — return `409 Conflict`
   (`PET-05`). Do not delete dependents.
2. Replace the string-concatenated queries in `SpringDataPetTypeRepositoryImpl` with bound
   parameters (`PET-06`).
3. Audit the other override classes for the same two patterns — **all four** use string
   concatenation (`SpringDataPetTypeRepositoryImpl`, `SpringDataPetRepositoryImpl`,
   `SpringDataSpecialtyRepositoryImpl`, `SpringDataVisitRepositoryImpl`).
4. Add tests asserting that deleting an in-use pet type leaves pets and visits intact.

### Phase 2: Make the pet lifecycle work in the UI - PLANNED

**Objective**: Staff can add and edit a pet.

**Tasks**:
1. Send a nested `type` object instead of `typeId` from `PetEditor` (`PET-02`).
2. Fix `getOwnersPet` to compare owner **ids**, not object identity (`PET-03`).
3. Implement `updateOwnersPet`, or point the editor at `PUT /pets/{petId}` (`PET-04`).
4. Accept both `201` and `204` as success in `PetEditor` (`PET-11`).
5. Add an error state to `EditPetPage` instead of an indefinite "Loading...".

### Phase 3: Normalise the pet API - PLANNED

**Tasks**:
1. Decide the fate of `POST /pets` (`PET-01`): make `ownerId` writable in the schema, or remove
   the endpoint in favour of the owner-scoped route. Do not leave it dead.
2. If kept, return `201` with a `Location` header and the persisted entity (`PET-08`).
3. Decide whether a pet can be reassigned to another owner (`PET-09`).
4. Give the pet-type id guard an explanatory body (`PET-10`).

### Phase 4: Lifecycle completeness - PLANNED

**Tasks**: pet deletion in the UI with a confirmation showing dependent visits (`PET-12`);
pagination for `GET /pets`.

---

## Technical Implementation Details

### Key Files

**Backend**
- `src/main/java/.../model/Pet.java`, `model/PetType.java` - entities
- `src/main/java/.../repository/PetRepository.java`, `PetTypeRepository.java` - interfaces
- `src/main/java/.../repository/springdatajpa/SpringDataPetTypeRepositoryImpl.java` - **`PET-05`, `PET-06`**
- `src/main/java/.../repository/springdatajpa/SpringDataPetRepositoryImpl.java` - pet delete override
- `src/main/java/.../rest/controller/PetRestController.java` - **`PET-01`, `PET-08`, `PET-09`**
- `src/main/java/.../rest/controller/PetTypeRestController.java` - split authorization, `PET-10`
- `src/main/java/.../mapper/PetMapper.java` - owner flattening
- `src/main/resources/openapi.yml` - `readOnly` on `ownerId`, the root cause of `PET-01`

**Frontend** (`client/src/components/pets/`)
- `PetEditor.tsx` - **`PET-02`, `PET-11`**
- `createPetEditorModel.ts` - parallel load of pet types and owner
- `EditPetPage.tsx` - blocked by `PET-03`
- `NewPetPage.tsx`, `LoadingPanel.tsx`
- `client/src/components/owners/PetsTable.tsx` - read-only presentation
- `client/src/types/index.ts` - `IPetRequest` encodes the wrong contract

### Implementation Patterns

The only working way to create a pet:

```powershell
curl.exe --% -X POST http://localhost:9966/petclinic/api/owners/1/pets -H "Content-Type: application/json" -d "{\"name\":\"Buddy\",\"birthDate\":\"2021-03-04\",\"type\":{\"id\":2,\"name\":\"dog\"}}"
```

Note `addPetToOwner` resolves the type **by name**, not by id:

```java
PetType petType = this.clinicService.findPetTypeByName(pet.getType().getName());
```

so `type.name` must be present and must match an existing row. An id alone is not enough.

### Important Notes

- **`DELETE /pettypes/{id}` destroys pets and visits.** Treat it as dangerous in every
  environment. Verified: 13 pets → 9.
- **`POST /pets` is dead.** Always 400. Use the owner-scoped route.
- **Pet types are resolved by name on creation** but by id elsewhere — send both fields.
- **A pet cannot be moved between owners** through any endpoint.
- Pet-type writes need `VET_ADMIN`; pet-type reads also allow `OWNER_ADMIN`.
- Deleting a pet cascades to its visits (`Pet.visits` is `CascadeType.ALL`).

---

## Acceptance Criteria

### Verified true today (baseline)

- [x] `GET /pets` returns all 13 seeded pets with nested `type` and `visits`
- [x] `GET /pets/{id}` returns 200; unknown id returns 404
- [x] `PUT /pets/{id}` returns 204
- [x] `DELETE /pets/{id}` returns 204
- [x] `GET /pettypes` returns the 6 seeded types; `GET /pettypes/{id}` returns 200
- [x] `POST /pettypes` returns 201; with an explicit non-zero `id` returns 400
- [x] `PUT /pettypes/{id}` returns 204; `DELETE /pettypes/{id}` returns 204
- [x] `POST /owners/{id}/pets` with a nested `type` returns 201
- [x] `POST /pets` returns **400** — foreign-key violation, never succeeds
- [x] `POST /owners/{id}/pets` with `typeId` instead of `type` returns **400**
- [x] `GET /owners/{ownerId}/pets/{petId}` returns **400** for a valid pairing
- [x] `PUT /owners/{ownerId}/pets/{petId}` returns **501**
- [x] **`DELETE /pettypes/1` deleted 4 pets and their visits** (13 → 9) and returned 204
- [x] UI: the add-pet form loads and populates its type dropdown
- [x] UI: the edit-pet screen never loads

### Failing today — must pass after remediation

- [ ] Deleting an in-use pet type refuses with `409` and leaves pets intact (`PET-05`)
- [ ] Repository queries use bound parameters, not string concatenation (`PET-06`)
- [ ] A pet can be created from the UI (`PET-02`)
- [ ] The edit-pet screen loads an existing pet (`PET-03`)
- [ ] The edit-pet screen saves changes (`PET-04`)
- [ ] `POST /pets` either works with an owner id or is removed (`PET-01`)
- [ ] Pet creation returns `201` with a `Location` header and the persisted entity (`PET-08`)
- [ ] `GET /pets` with no rows returns `200` and an empty array (cross-cutting)

### Identified gaps

| ID | Gap | Evidence | Severity |
|---|---|---|---|
| `PET-01` | `POST /pets` always 400 — `ownerId` stripped as `readOnly` | verified; global `B3` | High |
| `PET-02` | UI sends `typeId`; API needs nested `type` | verified both payloads; global `F2` | High |
| `PET-03` | `GET /owners/{ownerId}/pets/{petId}` always 400 | global `B1` | High |
| `PET-04` | `PUT /owners/{ownerId}/pets/{petId}` returns 501 | global `B2` | High |
| `PET-05` | **Deleting a pet type deletes its pets and their visits** | 13 pets → 9, owner 1 emptied | **Critical** |
| `PET-06` | Repository builds JPQL by string concatenation | `SpringDataPetTypeRepositoryImpl` (3×), `SpringDataPetRepositoryImpl` (2×); see `XC-06` | Medium |
| `PET-07` | `getPet` maps before the null check | `PetRestController.getPet` | Low |
| `PET-08` | `addPet` returns 200, no `Location`, echoes the request DTO | `PetRestController.addPet` | Medium |
| `PET-09` | A pet cannot be reassigned to another owner | `updatePet` ignores owner | Medium |
| `PET-10` | Pet-type id guard returns a bare 400 with no explanation | `addPetType` | Low |
| `PET-11` | `PetEditor` treats only `204` as success; creation returns `201` | `PetEditor.onSubmit` | Medium |
| `PET-12` | No pet deletion anywhere in the UI | `PetsTable` | Low |

---

## Success Metrics

| Metric | Target | How Measured |
|---|---|---|
| Records destroyed by a lookup-table delete | 0 | Pet and visit counts before/after a pet-type delete |
| Pet lifecycle completable in the UI | add and edit both succeed | Browser flow suite |
| Dead endpoints in the pets slice | 0 | Every documented endpoint returns a success code on its happy path |
| Create-response consistency | 100% of creates return 201 + `Location` | Contract test across all slices |
| Parameterised repository queries | 100% | Static check for string concatenation in `createQuery` |

---

## Dependencies

### External Dependencies
- `spring-boot-starter-data-jpa` - persistence and the `EntityManager` used by the overrides
- `mapstruct` - `PetMapper`, `PetTypeMapper`
- `react-datepicker` - the `DateInput` control on the pet form

### Internal Dependencies
- **Owners slice** - the only working creation path is `POST /owners/{ownerId}/pets`; pets are
  cascade-deleted when their owner is deleted
- **Visits slice** - visits cascade-delete with their pet, and again when a pet type is deleted
- `openapi.yml` - the `readOnly` markers that cause `PET-01`
- `ClinicService.findPetTypeByName` - name-based type resolution on creation
- `client/src/types/index.ts` - `IPetRequest`, which encodes the wrong contract
- Auth slice - `OWNER_ADMIN` for pets; `VET_ADMIN` for pet-type writes

---

## Risks and Mitigation

### Technical Risks

- **Risk**: `DELETE /pettypes/{id}` destroys pets and visits with no warning and a `204`
  response. A cleanup of "unused" lookup rows could silently delete a large part of the clinic's
  records, and with no migration framework or backups configured there is no recovery path.
  **Mitigation**: Phase 1, task 1. Until then, treat the endpoint as unsafe in any environment
  holding real data. It requires `VET_ADMIN`, which is the only thing currently limiting blast
  radius.

- **Risk**: The string-concatenated queries are safe only because the values are `Integer` path
  variables. A future refactor to a `String` parameter turns them into injection points —
  `createNativeQuery` especially.
  **Mitigation**: Parameterise them now, before the types change.

- **Risk**: Making `ownerId` writable to fix `POST /pets` would let a client move a pet between
  owners implicitly, which no other endpoint allows.
  **Mitigation**: Decide `PET-09` and `PET-01` together, as one contract decision.

- **Risk**: Name-based pet-type resolution breaks if a type is renamed, and silently creates a
  mismatch between the `id` and `name` a client sends.
  **Mitigation**: Resolve by id, with the name as a fallback, when fixing `PET-02`.

### User Experience Risks

- **Risk**: Both pet write flows fail with a raw 400 and no message, so users cannot tell whether
  the data or the application is at fault.
  **Mitigation**: Phase 2, plus surfacing the `errors` header content in the editors.

- **Risk**: The edit-pet screen hangs on "Loading..." indefinitely, which reads as a slow network
  rather than a failure.
  **Mitigation**: Add an explicit error state (Phase 2, task 5).

---

## Troubleshooting Guide

### Pets disappeared after deleting a pet type
**Problem**: Owners lost pets after an apparently unrelated lookup-table change.
**Cause**: `SpringDataPetTypeRepositoryImpl.delete` explicitly deletes every pet of that type and
each pet's visits (`PET-05`). The response is `204`.
**Solution**: No recovery — restart the backend to reseed the in-memory database. Do not call
this endpoint against data you care about.
**Code Reference**: `repository/springdatajpa/SpringDataPetTypeRepositoryImpl.java:41-54`

### `POST /pets` always returns 400
**Problem**: Creating a pet at the flat endpoint fails with a `DataIntegrityViolationException`.
**Cause**: `ownerId` is `readOnly` in `openapi.yml`, so it is stripped from the request body and
`pets.owner_id` is inserted as null (`PET-01`).
**Solution**: Use `POST /api/owners/{ownerId}/pets`.

### Adding a pet from the UI fails with 400
**Problem**: The add-pet form always errors.
**Cause**: `PetEditor` sends `typeId`; the API requires a nested `type` object (`PET-02`).
**Solution**: Send `{"type": {"id": 2, "name": "dog"}}`. Include `name` — the server resolves the
type by name.
**Code Reference**: `client/src/components/pets/PetEditor.tsx` (`onSubmit`)

### Edit Pet screen stays on "Loading..."
**Problem**: The page never renders and the dev server shows a runtime error.
**Cause**: `GET /owners/{ownerId}/pets/{petId}` always returns 400 (`PET-03`), and the empty body
fails `response.json()`.
**Solution**: Use `GET /pets/{petId}` until fixed.

### A pet cannot be moved to a different owner
**Problem**: Updating a pet does not change its owner.
**Cause**: `updatePet` copies only `name`, `birthDate` and `type` (`PET-09`). No endpoint exposes
owner reassignment.
**Solution**: None currently. Delete and recreate under the new owner — but note that destroys
the pet's visit history.

---

## Notes for AI Agents

1. This is a **baseline** document. Current-behaviour sections are verified fact.
2. **Never call `DELETE /pettypes/{id}` casually** — it destroys pets and visits (`PET-05`).
3. Do not implement Phase 1+ work without explicit approval.
4. Adding a method to `PetRepository` or `PetTypeRepository` means implementing it **three
   times**, once per profile.
5. The owner-scoped pet endpoints straddle this slice and the owners slice; coordinate changes.
6. Restore the seed data after mutating: 13 pets, 6 pet types. Restarting the backend reseeds
   the in-memory database.
7. Use `filepath:line-number` when citing code.

---

## Current Status

**Last Updated**: 2026-09-16
**Current Phase**: Phase 0 - Baseline documentation
**Status**: COMPLETED
**Next Steps**: Review. `PET-05` is the most urgent finding across all slices documented so far
and is recommended for remediation ahead of cosmetic work.
