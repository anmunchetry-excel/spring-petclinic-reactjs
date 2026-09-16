Date created: 2026-09-16
Date last modified: 2026-09-16

# Visits - Baseline Technical PRD

> **This is a baseline PRD.** It documents the visits vertical slice **as it exists today**,
> verified against a running instance. Current-behaviour sections are evidence-based; future
> work is marked `PLANNED`.
>
> Companion documents: [ARCHITECTURE.md](./ARCHITECTURE.md),
> [PETS_BASELINE_PRD.md](./PETS_BASELINE_PRD.md),
> [CROSS_CUTTING_BASELINE_PRD.md](./CROSS_CUTTING_BASELINE_PRD.md).

---

## Overview/Problem

A visit is a dated note attached to a pet — the clinic's actual record of care delivered. It is
the deepest entity in the domain (owner → pet → visit) and the smallest: an id, a date, a
description and a pet reference.

Its problems are mostly inherited. Like pets, the flat `POST /visits` endpoint is unusable
because the pet id is stripped from the request body as a read-only field, so only the
owner-scoped route works. In the UI, adding a visit **succeeds on the server and is then
reported as a failure**, because the page checks for `204` while the endpoint correctly returns
`201` — the user sees an error and stays on the form, while a visit has in fact been recorded.
Re-submitting creates duplicates.

Two data-integrity issues are specific to this slice. A visit can be saved **with no date at
all** — the entity constructor defaults it to today, but the mapper overwrites that with null —
and there is no constraint preventing a visit dated decades in the future. Since visits are the
clinical history, both undermine the one thing this table exists to guarantee.

---

## Hypothesis

We believe that correcting the success check in the UI, guaranteeing every visit has a sensible
date, and giving visits a first-class read/edit surface will make the clinical history reliable
for clinic staff — without changing the owner or pet slices.

---

## Scope

### In Scope

- **Database** — the `visits` table, its foreign key and index
- **DAO** — `VisitRepository`, its three implementations, and the `VisitRepositoryOverride` pattern
- **Service** — visit methods on `ClinicService`, including `findVisitsByPetId`
- **API** — `VisitRestController` (5 operations) and the owner-scoped creation route
- **Mapping** — `VisitMapper`, the `petId` flattening, and the lost date default
- **Frontend** — `VisitsPage`, `PetDetails`, and the visit columns in `PetsTable`
- **Verified behaviour** — status codes, date handling, validation, cascade deletion

### Out of Scope

- **Pets and owners** — their own PRDs. Visits are reached only through them.
- **The pet-type delete cascade** that destroys visits — owned by
  [PETS_BASELINE_PRD.md](./PETS_BASELINE_PRD.md) (`PET-05`), noted here as an inherited risk.
- **Cross-cutting concerns** — [CROSS_CUTTING_BASELINE_PRD.md](./CROSS_CUTTING_BASELINE_PRD.md).

### Cut

- **Adding a clinical data model** (vet performed, cost, follow-up). Cut as scope creep; the
  baseline records what exists.
- **Enforcing that a visit date is not before the pet's birth date.** Considered, but it is a
  new business rule, not a baseline gap.

---

## Technical Requirements

### Database Schema

```sql
CREATE TABLE visits (
  id          INTEGER IDENTITY PRIMARY KEY,
  pet_id      INTEGER NOT NULL,
  visit_date  DATE,
  description VARCHAR(255)
);
ALTER TABLE visits ADD CONSTRAINT fk_visits_pets FOREIGN KEY (pet_id) REFERENCES pets (id);
CREATE INDEX visits_pet_id ON visits (pet_id);
```

`pet_id` is **`NOT NULL`** — the constraint that makes `POST /visits` fail. `visit_date` is
nullable, which is how a dateless visit can be persisted. Seed data contains 4 visits.

### Entity

```java
@Entity
@Table(name = "visits")
public class Visit extends BaseEntity {
    @Column(name = "visit_date", columnDefinition = "DATE") private LocalDate date;
    @NotEmpty @Column(name = "description")                 private String description;
    @ManyToOne @JoinColumn(name = "pet_id")                 private Pet pet;

    public Visit() {
        this.date = LocalDate.now();   // defeated by the mapper — see VIS-03
    }
}
```

The no-arg constructor defaults the date to today, but MapStruct generates
`visit.setDate(dto.getDate())` unconditionally, so a request without a date **overwrites the
default with null**. Verified: posting `{"description":"no date supplied"}` returned
`{"date":null,...}` with status 201.

### DAO layer

```java
public interface VisitRepository {
    void save(Visit visit) throws DataAccessException;
    Collection<Visit> findByPetId(Integer petId);
    Visit findById(int id) throws DataAccessException;
    Collection<Visit> findAll() throws DataAccessException;
    void delete(Visit visit) throws DataAccessException;
}
```

Three implementations (`jpa`, `jdbc`, `spring-data-jpa`), with
`SpringDataVisitRepositoryImpl` providing the delete override. `findByPetId` exists but is
**not exposed through any endpoint** — there is no `GET /pets/{id}/visits` (`VIS-05`).

### Service layer

| Method | Transaction | Notes |
|---|---|---|
| `findAllVisits()` | `readOnly` | |
| `findVisitById(int)` | `readOnly` | returns `null` when absent |
| `findVisitsByPetId(int)` | `readOnly` | no endpoint uses it |
| `saveVisit(Visit)` | write | |
| `deleteVisit(Visit)` | write | |

### API Endpoints

On `VisitRestController` (`@RequestMapping("api")`), all guarded by
`@PreAuthorize("hasRole(@roles.OWNER_ADMIN)")`.

#### GET /api/visits
- Success (200): array of visits, each with `id`, `date`, `description`, `petId`
- Error (404): when the list is empty

#### GET /api/visits/{visitId}
- Success (200) / Error (404)

#### POST /api/visits — BROKEN

Uses the full `Visit` schema, in which `petId` is `readOnly`. The id is therefore stripped, and
the insert violates `fk_visits_pets` → **400** every time (`VIS-01`, global `B3`).

**Use `POST /api/owners/{ownerId}/pets/{petId}/visits` instead**, which takes the pet id from
the path. That route returns **201** with a `Location` header.

#### PUT /api/visits/{visitId}
- Success (**204**) / Error (404)

Updates `date` and `description` only. **A visit cannot be moved to a different pet** (`VIS-04`).

#### DELETE /api/visits/{visitId}
- Success (204) / Error (404)

### Validation

| Field | Rule | Where |
|---|---|---|
| `description` | required, 1–255 characters | `VisitFieldsDto` |
| `date` | **no constraint at all** — optional, any value | `VisitFieldsDto` |

An empty description fails cleanly with a structured `errors` header:

```
errors: [{"objectName":"visitFieldsDto","fieldName":"description","fieldValue":"",
          "errorMessage":"size must be between 1 and 255"}]
```

Dates are unconstrained in both directions. Verified: a visit dated **2099-12-31** was accepted
with status 201 (`VIS-06`), and a visit with **no date** was accepted and stored as null
(`VIS-03`).

### Cascade behaviour

Visits are destroyed by two upstream operations, both silently:

| Operation | Effect on visits |
|---|---|
| `DELETE /pets/{id}` | the pet's visits are deleted (`Pet.visits` is `CascadeType.ALL`) |
| `DELETE /owners/{id}` | owner → pets → visits all deleted |
| `DELETE /pettypes/{id}` | **every pet of that type and all their visits** (`PET-05`) |

Visits are the clinical record, so they are the most consequential thing these cascades remove,
and none of the three responses indicates that visits were affected.

### User Interface Requirements

#### Add visit (`/owners/:ownerId/pets/:petId/visits/new`)

`VisitsPage` is the **only** visit screen in the application.

- Fetches the owner, then finds the pet **client-side** from `owner.pets`
- `PetDetails` shows the pet's name, birth date, type and owner
- Form: **Date** (`DateInput`, react-datepicker) and **Description** (`Input`, `NotEmpty`)
- **Add Visit** button

The submit handler contains a live defect (`VIS-02`):

```ts
const url = '/api/owners/' + owner.id + '/pets/' + petId + '/visits';
submitForm('POST', url, request, (status, response) => {
  if (status === 204) {              // ❌ the endpoint returns 201
    this.context.router.push({ pathname: '/owners/' + owner.id });
  } else {
    this.setState({ error: response });
  }
});
```

Creation returns **201**, so the success branch never runs. The visit **is saved**, but the user
is shown an error and left on the form — and submitting again creates a duplicate.

Other UI gaps: visits are displayed read-only inside `PetsTable` on the owner page; there is no
visit list, **no edit and no delete anywhere in the UI** (`VIS-05`). The page renders
`Loading...` whenever state is unset, with no error branch, and `owner.pets.find(...)` returns
`undefined` for a pet id not belonging to that owner, which `PetDetails` does not guard
(`VIS-07`). The form also carries an inert `action={url('/api/owner')}` (`VIS-08`).

---

## Implementation Phases

### Phase 0: Baseline documentation - COMPLETED

**Tasks**: document every layer; verify status codes, date handling, validation and cascades
against a running server; record gaps.

**Deliverables**: this document; gaps `VIS-01`…`VIS-08`.

### Phase 1: Stop silently duplicating visits - PLANNED

**Objective**: Adding a visit reports success when it succeeds.

**Tasks**:
1. Accept `201` (and `204`) as success in `VisitsPage.onSubmit` (`VIS-02`).
2. Add an error state instead of an indefinite `Loading...`, and guard the case where the pet is
   not found in `owner.pets` (`VIS-07`).
3. Remove the inert `action` attribute (`VIS-08`).

### Phase 2: Guarantee date integrity - PLANNED

**Objective**: Every visit carries a meaningful date.

**Tasks**:
1. Decide whether `date` is required. If optional, restore the "default to today" behaviour the
   entity intends — MapStruct currently overwrites it with null (`VIS-03`).
2. Decide whether future dates are valid. A scheduled-visit feature would need them; a
   historical record would not (`VIS-06`).
3. Backfill or report any existing null dates.

### Phase 3: Give visits a first-class surface - PLANNED

**Tasks**:
1. Expose `findVisitsByPetId` as `GET /pets/{petId}/visits` — the service method already exists
   and is unused (`VIS-05`).
2. Add edit and delete for visits in the UI.
3. Decide whether a visit can be reassigned to another pet (`VIS-04`).

### Phase 4: Align the creation contract - PLANNED

**Tasks**:
1. Decide the fate of `POST /visits` (`VIS-01`): make `petId` writable, or remove the endpoint.
2. Make cascade deletions report what they removed, in coordination with the pets and owners
   slices.

---

## Technical Implementation Details

### Key Files

**Backend**
- `src/main/java/.../model/Visit.java` - entity; constructor date default defeated by the mapper
- `src/main/java/.../repository/VisitRepository.java` - includes the unused `findByPetId`
- `src/main/java/.../repository/springdatajpa/SpringDataVisitRepositoryImpl.java` - delete override
- `src/main/java/.../rest/controller/VisitRestController.java` - the five operations
- `src/main/java/.../rest/controller/OwnerRestController.java` - `addVisitToOwner`, the only working create
- `src/main/java/.../mapper/VisitMapper.java` - `@Mapping(source = "pet.id", target = "petId")`
- `src/main/resources/openapi.yml` - `Visit` / `VisitFields`; `petId` is `readOnly`

**Frontend**
- `client/src/components/visits/VisitsPage.tsx` - the only visit screen; **contains `VIS-02`**
- `client/src/components/visits/PetDetails.tsx` - pet summary above the form
- `client/src/components/owners/PetsTable.tsx` - read-only visit display
- `client/src/components/form/DateInput.tsx` - react-datepicker wrapper

### Implementation Patterns

The only working way to create a visit:

```powershell
curl.exe --% -X POST http://localhost:9966/petclinic/api/owners/1/pets/1/visits -H "Content-Type: application/json" -d "{\"date\":\"2024-06-01\",\"description\":\"vaccination\"}"
```

The mapper line that costs the date default:

```java
Visit toVisit(VisitFieldsDto visitFieldsDto);   // generates setDate(dto.getDate()) unconditionally
```

### Important Notes

- **Adding a visit from the UI reports failure even though it worked.** Users who retry create
  duplicates. This is the highest-impact defect in the slice.
- **A visit can have no date.** The entity default is dead code.
- **Future dates are accepted** — verified with 2099-12-31.
- **`POST /visits` is dead**; use the owner-scoped route.
- **Three different deletes destroy visits**, none of which mention visits in their response.
- `findVisitsByPetId` exists in the service and repository but no endpoint calls it.

---

## Acceptance Criteria

### Verified true today (baseline)

- [x] `GET /visits` returns the 4 seeded visits with `id`, `date`, `description`, `petId`
- [x] `GET /visits/{id}` returns 200; unknown id returns 404
- [x] `PUT /visits/{id}` returns 204
- [x] `DELETE /visits/{id}` returns 204
- [x] `POST /owners/{ownerId}/pets/{petId}/visits` returns **201** with a `Location` header
- [x] `POST /visits` returns **400** — foreign-key violation, never succeeds
- [x] A visit with an empty description returns 400 with detail in the `errors` header
- [x] A visit with **no date** is accepted and stored with `date: null`
- [x] A visit dated **2099-12-31** is accepted
- [x] Deleting a pet deletes its visits; deleting a pet type deletes pets and their visits
- [x] UI: the add-visit form renders with pet details, date picker and description

### Failing today — must pass after remediation

- [ ] Adding a visit from the UI redirects to the owner page instead of showing an error (`VIS-02`)
- [ ] Every persisted visit has a non-null date (`VIS-03`)
- [ ] Future-dated visits are either rejected or explicitly supported (`VIS-06`)
- [ ] Visits can be listed per pet via an endpoint (`VIS-05`)
- [ ] Visits can be edited and deleted from the UI (`VIS-05`)
- [ ] `POST /visits` either works with a pet id or is removed (`VIS-01`)
- [ ] The add-visit page shows an error state when the pet cannot be resolved (`VIS-07`)
- [ ] `GET /visits` with no rows returns `200` and an empty array (cross-cutting)

### Identified gaps

| ID | Gap | Evidence | Severity |
|---|---|---|---|
| `VIS-01` | `POST /visits` always 400 — `petId` stripped as `readOnly` | verified; global `B3` | High |
| `VIS-02` | UI checks for `204`; creation returns `201`, so success looks like failure and retries duplicate | `VisitsPage.onSubmit` | **High** |
| `VIS-03` | A visit can be saved with no date; the entity default is overwritten by the mapper | verified: `date: null`, 201 | High |
| `VIS-04` | A visit cannot be moved to another pet | `updateVisit` ignores `petId` | Low |
| `VIS-05` | No per-pet visit endpoint; no visit edit or delete in the UI | `findVisitsByPetId` unused | Medium |
| `VIS-06` | No date-range validation; far-future dates accepted | verified: 2099-12-31 → 201 | Medium |
| `VIS-07` | No error state; unresolvable pet yields `undefined` into `PetDetails` | `VisitsPage.render` | Medium |
| `VIS-08` | Inert `action="/api/owner"` on the form | `VisitsPage.render` | Low |

---

## Success Metrics

| Metric | Target | How Measured |
|---|---|---|
| Duplicate visits caused by false-failure retries | 0 | Submit once; assert exactly one row created |
| Visits with a null date | 0 | Query the `visits` table after a creation suite |
| Visit lifecycle completable in the UI | add, edit, delete all succeed | Browser flow suite |
| Dead endpoints in the slice | 0 | Every documented endpoint succeeds on its happy path |
| Clinical history preserved across cascades | deletions report affected visits | Cascade tests asserting counts |

---

## Dependencies

### External Dependencies
- `spring-boot-starter-data-jpa` - persistence
- `mapstruct` - `VisitMapper`; its generated setter is what defeats the date default
- `react-datepicker` - the `DateInput` control

### Internal Dependencies
- **Pets slice** - a visit cannot exist without a pet; `POST /owners/{id}/pets/{petId}/visits` is
  the only creation path, and `PET-05` destroys visits wholesale
- **Owners slice** - the UI reaches visits only through the owner detail page and resolves the
  pet from `owner.pets`
- `openapi.yml` - the `readOnly` marker on `petId` that causes `VIS-01`
- `client/src/util/index.tsx` - `submitForm`, whose status-code contract `VIS-02` misreads
- Auth slice - `OWNER_ADMIN` on all five operations

---

## Risks and Mitigation

### Technical Risks

- **Risk**: `VIS-02` makes a successful write look like a failure, so users retry and create
  duplicate clinical records. The data is wrong in a way nobody notices, because each individual
  request succeeded.
  **Mitigation**: Phase 1, task 1. Audit existing data for same-day duplicate descriptions on
  the same pet before concluding the history is accurate.

- **Risk**: Null dates (`VIS-03`) make the clinical history unsortable and unreportable, and the
  column is nullable so the database will not catch it.
  **Mitigation**: Decide the rule in Phase 2 and enforce it at the DTO layer, not only the
  entity — remember there is no migration framework (`AUTH-14`) if the column must change.

- **Risk**: Three separate delete operations destroy visits, and the most destructive
  (`DELETE /pettypes/{id}`) looks like a harmless lookup-table edit.
  **Mitigation**: Fix `PET-05` first; it is the largest data-loss risk affecting this slice.

- **Risk**: Fixing `VIS-01` by making `petId` writable would allow a visit to be moved between
  pets implicitly, which `updateVisit` deliberately does not allow.
  **Mitigation**: Decide `VIS-01` and `VIS-04` together, as one contract decision.

### User Experience Risks

- **Risk**: A user who adds a visit sees an error, cannot tell whether it was recorded, and has
  no visit list to check against — the UI offers no way to verify.
  **Mitigation**: Phase 1 and Phase 3 together; the success fix matters less if there is still
  no way to review what was saved.

- **Risk**: The date picker allows any date, so a typo in the year is silently accepted into the
  clinical record.
  **Mitigation**: Constrain the picker's range as part of Phase 2.

---

## Troubleshooting Guide

### Adding a visit shows an error but the visit was created
**Problem**: The form reports a failure and stays put; the visit appears on the owner page after
a reload.
**Cause**: `VisitsPage.onSubmit` treats only `204` as success, but
`POST /owners/{id}/pets/{petId}/visits` returns `201` (`VIS-02`).
**Solution**: Do not resubmit — that creates a duplicate. Navigate back to the owner to confirm.
**Code Reference**: `client/src/components/visits/VisitsPage.tsx` (`onSubmit`)

### A visit has no date
**Problem**: `GET /visits` returns `"date": null`.
**Cause**: The request omitted `date`. `Visit`'s constructor defaults to today, but the
generated mapper calls `setDate(null)` afterwards (`VIS-03`).
**Solution**: Always send an explicit `date` until the default is restored.

### `POST /visits` always returns 400
**Problem**: Creating a visit at the flat endpoint fails with a `DataIntegrityViolationException`.
**Cause**: `petId` is `readOnly` in `openapi.yml`, so it is stripped and `visits.pet_id` is
inserted as null (`VIS-01`).
**Solution**: Use `POST /api/owners/{ownerId}/pets/{petId}/visits`.

### Visits disappeared
**Problem**: A pet's history is gone.
**Cause**: One of three cascades — deleting the pet, deleting its owner, or deleting the pet's
**type** (`PET-05`, which removes every pet of that type and all their visits).
**Solution**: No recovery; restart the backend to reseed the in-memory database.

### The add-visit page stays on "Loading..."
**Problem**: The form never appears.
**Cause**: The owner fetch has not resolved, or failed — there is no error branch (`VIS-07`).
If the `petId` in the URL does not belong to the owner, `owner.pets.find(...)` yields
`undefined` and `PetDetails` receives no pet.
**Solution**: Check the owner/pet pairing in the URL.

---

## Notes for AI Agents

1. This is a **baseline** document. Current-behaviour sections are verified fact.
2. Do not implement Phase 1+ work without explicit approval.
3. The only working creation path is `POST /owners/{ownerId}/pets/{petId}/visits`, returning
   **201** — not 204. Check status codes against this document, not against assumptions.
4. Adding a method to `VisitRepository` means implementing it **three times**, once per profile.
5. Visits are destroyed by pet, owner **and pet-type** deletion. Account for that in tests.
6. Restore the seed data after mutating: 4 visits. Restarting the backend reseeds it.
7. Use `filepath:line-number` when citing code.

---

## Current Status

**Last Updated**: 2026-09-16
**Current Phase**: Phase 0 - Baseline documentation
**Status**: COMPLETED
**Next Steps**: Review. `VIS-02` is the highest-impact defect in this slice because it silently
corrupts the clinical record through user retries, and it is a small client-side fix.
