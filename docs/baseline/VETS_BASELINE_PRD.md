# Vets & Specialties - Baseline Technical PRD

| Field | Value |
|-------|-------|
| Created | September 16, 2026 |
| Version | 1.0 - Initial |
| Version Notes | Baseline documentation of vets and specialties |

> **This is a baseline PRD.** It documents the vets vertical slice **as it exists today**,
> verified against a running instance. Current-behaviour sections are evidence-based; future
> work is marked `PLANNED`.
>
> Companion documents: [ARCHITECTURE.md](./ARCHITECTURE.md),
> [PETS_BASELINE_PRD.md](./PETS_BASELINE_PRD.md),
> [AUTHENTICATION_BASELINE_PRD.md](./AUTHENTICATION_BASELINE_PRD.md),
> [OWNERS_BASELINE_PRD.md](./OWNERS_BASELINE_PRD.md),
> [BASELINE_UPDATES_FOR_MODERNIZATION.md](./BASELINE_UPDATES_FOR_MODERNIZATION.md).
>
> **This slice also owns** specialty delete-refusal semantics (`VET-03` / `VET-04`), specialty
> string-concat queries, and the duplicate `findVets` / `findAllVets` dead code (`VET-08`).
> Contrast with destructive pet-type delete: [PETS](./PETS_BASELINE_PRD.md) `PET-05`.

---

## Overview/Problem

Vets and their specialties form the clinic's staff directory. Structurally the slice is
independent of the owner → pet → visit chain: **no foreign key connects a vet to a visit**, so
the system records that a visit happened but never who performed it. The directory is
effectively a standalone reference list.

This is the healthiest slice in the application. Every endpoint works, deletion refuses rather
than destroys, and the one screen that consumes it renders correctly. Its problems are subtler.

Specialties are matched **by name**, and the id a client sends is ignored entirely. A vet
submitted with a specialty name that does not exist is created successfully with **no
specialties at all** and no warning — a silent data loss that looks like success. Conversely,
sending the wrong id with the right name silently corrects the id. Both behaviours mean the API
accepts requests it should arguably reject.

The contrast with pet types is worth noting: deleting an in-use specialty is **refused**, while
deleting an in-use pet type **destroys every pet of that type**. Two lookup tables, opposite
safety characteristics, no apparent reason.

Finally, the UI is read-only. There is no way to add, edit or delete a vet or a specialty
through the application, despite full CRUD existing on the API.

---

## Business Requirements

This slice exists so the clinic can **keep a staff directory**: who the veterinarians are and
which specialties they hold. It is independent of the owner → pet → visit chain. The directory
does not currently record which vet delivered a visit.

### Veterinarian Directory

#### Users

| Role | Who | What they need |
|---|---|---|
| Any clinic staff | Looks up who works here | Browse veterinarians and their specialties |
| Vet administrator | Maintains the directory | Add, correct or remove vets without silently dropping specialties |

#### Capabilities

| ID | The system shall | Fulfilment today |
|---|---|---|
| BR-VET-01 | Let staff browse a list of veterinarians with their specialties | **Met** — `/vets` is read-only and renders correctly |
| BR-VET-02 | Let an administrator add or update a veterinarian, including the specialties they hold | **Partial** — API CRUD works; there is no write UI (`VET-05`). Unknown specialty names are dropped while the create still succeeds (`VET-01`) |
| BR-VET-05 | Reject a request that names a specialty the catalogue does not have, rather than creating the vet with none | **Not met** — unknown names are silently dropped (`VET-01`) |

#### Business rules

1. **A veterinarian may hold zero or more specialties.** "None" is a valid directory state
   (seed: James Carter).
2. **Updating a vet replaces the entire specialty set** (`VET-06`). Partial add/remove is not a
   current business operation.
3. **Visits are not attributed to a veterinarian.** Connecting the directory to clinical history
   is a future product decision, not a missing baseline repair.

### Specialty Catalogue

#### Users

| Role | Who | What they need |
|---|---|---|
| Vet administrator | Maintains the catalogue | Add or remove specialties without destroying the directory |

#### Capabilities

| ID | The system shall | Fulfilment today |
|---|---|---|
| BR-VET-03 | Let an administrator maintain the specialty catalogue | **Partial** — API CRUD works; no UI |
| BR-VET-04 | Refuse to delete a specialty that is still assigned to a veterinarian | **Met** — in-use delete is refused (by flush ordering, not an explicit check) (`VET-03`) |

#### Business rules

1. **Specialties are a shared catalogue**, matched by name. Submitting an unknown name is an
   error, not an invitation to create the vet without specialties.
2. **Deleting a specialty in use must be refused.** Lookup rows must not destroy the directory
   the way pet-type delete destroys pets.

---

## Hypothesis

We believe that making specialty resolution explicit — rejecting unknown names instead of
silently dropping them — and exposing the existing CRUD through the UI will make the staff
directory trustworthy and maintainable for clinic administrators, without affecting the owner,
pet or visit slices.

---

## Scope

### In Scope

- **Database** — the `vets`, `specialties` and `vet_specialties` tables
- **DAO** — `VetRepository`, `SpecialtyRepository`, their three implementations each, and the
  `SpecialtyRepositoryOverride` delete behaviour
- **Service** — vet and specialty methods, including `findSpecialtiesByNameIn`
- **API** — `VetRestController` (5 operations), `SpecialtyRestController` (5 operations)
- **Mapping** — `VetMapper`, `SpecialtyMapper`
- **Frontend** — `VetsPage`, the only screen in this slice
- **Verified behaviour** — specialty resolution semantics, delete refusal, status codes

### Out of Scope

- **Associating vets with visits.** No such relationship exists; creating one is a feature, not
  a baseline gap. Noted as an observation only.
- **Pet types**, the other lookup table — [PETS_BASELINE_PRD.md](./PETS_BASELINE_PRD.md).
  Referenced here for the safety contrast (`PET-05` destroys; specialties refuse).
- **API-wide error advice / migrations / CORS** —
  [AUTHENTICATION_BASELINE_PRD.md](./AUTHENTICATION_BASELINE_PRD.md). Empty-list convention:
  [OWNERS](./OWNERS_BASELINE_PRD.md) `OWN-01`.

### Cut

- **Splitting specialties into their own PRD.** Considered and cut: they exist only to qualify
  vets, share the `VET_ADMIN` role, and are joined to vets by a dedicated table. Documenting
  them apart would duplicate most of this document.
- **Adding vet scheduling or availability.** Out of baseline scope entirely.

---

## Technical Requirements

### Database Schema

```sql
CREATE TABLE vets (
  id         INTEGER IDENTITY PRIMARY KEY,
  first_name VARCHAR(30),
  last_name  VARCHAR(30)
);
CREATE INDEX vets_last_name ON vets (last_name);

CREATE TABLE specialties (
  id   INTEGER IDENTITY PRIMARY KEY,
  name VARCHAR(80)
);
CREATE INDEX specialties_name ON specialties (name);

CREATE TABLE vet_specialties (
  vet_id       INTEGER NOT NULL,
  specialty_id INTEGER NOT NULL
);
ALTER TABLE vet_specialties ADD CONSTRAINT fk_vet_specialties_vets        FOREIGN KEY (vet_id)       REFERENCES vets (id);
ALTER TABLE vet_specialties ADD CONSTRAINT fk_vet_specialties_specialties FOREIGN KEY (specialty_id) REFERENCES specialties (id);
```

Notes:

- `vets.last_name` is plain `VARCHAR`, **not** `VARCHAR_IGNORECASE` like `owners.last_name` —
  though no vet search endpoint exists, so it makes no difference today.
- `vet_specialties` is a pure join table with **no surrogate key and no uniqueness constraint**,
  so duplicate pairings are possible at the database level (`VET-07`).
- `specialties.name` has no uniqueness constraint either, which matters because resolution is
  by name (`VET-02`).

Seed data: 6 vets, 3 specialties (radiology, surgery, dentistry), 5 pairings.

### Entities

```java
@Entity @Table(name = "vets")
public class Vet extends Person {
    @ManyToMany(fetch = FetchType.EAGER)
    @JoinTable(name = "vet_specialties",
        joinColumns = @JoinColumn(name = "vet_id"),
        inverseJoinColumns = @JoinColumn(name = "specialty_id"))
    private Set<Specialty> specialties;
}
```

`Specialty` extends `NamedEntity` — an id and a `@NotEmpty` name. `getSpecialties()` returns a
sorted, unmodifiable list; mutation goes through `addSpecialty` / `clearSpecialties`.

**There is no `CascadeType` on the many-to-many**, which is why deleting a vet does not delete
shared specialties — correct behaviour, and the opposite of the pet-type situation.

### DAO layer

`VetRepository` is the standard five methods. `SpecialtyRepository` adds
`findSpecialtiesByNameIn(Set<String>)`, which is the mechanism behind name-based resolution.

`SpringDataSpecialtyRepositoryImpl` provides the delete override:

```java
@Override
public void delete(Specialty specialty) {
    this.em.remove(this.em.contains(specialty) ? specialty : this.em.merge(specialty));
    Integer specId = specialty.getId();
    this.em.createNativeQuery("DELETE FROM vet_specialties WHERE specialty_id=" + specId).executeUpdate();
    this.em.createQuery("DELETE FROM Specialty specialty WHERE id=" + specId).executeUpdate();
}
```

Two observations. It uses **string concatenation** rather than bound parameters — the same
pattern found in **all four** delete-override classes (Pets owns pet/pet-type; Visits owns
visit delete; this slice owns specialty). Here the specialty override uses `createNativeQuery`,
which is not even JPQL-parsed, so the risk is higher (`VET-03`).
And the ordering is ineffective: `em.remove` is queued before the join-table cleanup, so the
flush attempts the specialty delete first and the foreign key rejects it. The net
effect is safe — deletion is refused — but by accident rather than design.

### Service layer

| Method | Transaction | Notes |
|---|---|---|
| `findAllVets()` / `findVets()` | `readOnly` | two methods, identical bodies (`VET-08`) |
| `findVetById(int)` | `readOnly` | returns `null` when absent |
| `saveVet` / `deleteVet` | write | |
| `findAllSpecialties()` / `findSpecialtyById(int)` | `readOnly` | |
| `findSpecialtiesByNameIn(Set<String>)` | `readOnly` | returns an **empty list** on failure |
| `saveSpecialty` / `deleteSpecialty` | write | |

`findSpecialtiesByNameIn` returning an empty list rather than throwing is what makes unknown
specialty names vanish silently.

### API Endpoints — Vets

On `VetRestController`, all guarded by `@PreAuthorize("hasRole(@roles.VET_ADMIN)")`.

| Endpoint | Success | Notes |
|---|---|---|
| `GET /api/vets` | 200 | 404 when empty |
| `GET /api/vets/{vetId}` | 200 | 404 unknown |
| `POST /api/vets` | **201** + `Location` | resolves specialties by name |
| `PUT /api/vets/{vetId}` | **204** | clears then re-adds specialties |
| `DELETE /api/vets/{vetId}` | 204 | does not affect specialties |

#### Specialty resolution — the defining behaviour

Both create and update discard the client's specialty objects and re-resolve them by **name**:

```java
if (vet.getNrOfSpecialties() > 0) {
    List<Specialty> vetSpecialities = this.clinicService.findSpecialtiesByNameIn(
        vet.getSpecialties().stream().map(Specialty::getName).collect(Collectors.toSet()));
    vet.setSpecialties(vetSpecialities);
}
```

Verified behaviour:

| Request | Result |
|---|---|
| `{"id":1,"name":"radiology"}` (valid) | resolved correctly, 201 |
| `{"id":999,"name":"surgery"}` (wrong id, right name) | **id silently corrected to 2**, 201 |
| `{"id":99,"name":"astrology"}` (name does not exist) | **specialty silently dropped**; vet created with `"specialties":[]`, 201 |

The third case is a silent data loss presented as success (`VET-01`). The second shows the
client-supplied id is ignored entirely (`VET-02`).

`updateVet` additionally calls `clearSpecialties()` before re-adding, so **an update always
replaces the full set** — there is no way to add or remove a single specialty (`VET-06`).

### API Endpoints — Specialties

On `SpecialtyRestController`, all `VET_ADMIN`. Standard CRUD: `GET` 200/404, `POST` 201 with
`Location`, `PUT` 204, `DELETE` 204.

#### DELETE /api/specialties/{specialtyId} — refuses when in use

Verified contrast with pet types:

| Case | Result |
|---|---|
| Specialty **not** referenced by any vet | **204**, deleted |
| Specialty referenced by a vet | **400**, refused, nothing deleted |

The 400 body exposes the underlying cause:

```json
{"className":"org.springframework.dao.DataIntegrityViolationException",
 "exMessage":"could not execute statement [integrity constraint violation: foreign key no action ;
              FK_VET_SPECIALTIES_SPECIALTIES table: VET_SPECIALTIES] ..."}
```

Refusing is the **safe** outcome, but the status is wrong — this should be `409 Conflict`, not
`400`, and it should not leak the constraint name or exception class (`VET-04`).

> **Compare with pet types.** `DELETE /pettypes/{id}` on an in-use type returns `204` and
> deletes every pet of that type and all their visits (`PET-05`). Two lookup tables, opposite
> behaviour, with no design rationale for the difference.

### User Interface Requirements

#### Veterinarians (`/vets`)

`VetsPage` is the **only** screen in this slice, and it is entirely read-only.

- Fetches `api/vets` on mount
- Table of two columns: Name (`firstName lastName`) and Specialties
- Specialties are comma-joined; vets with none render the literal text `none`
- Verified rendering: 6 vets, with "James Carter — none" and "Linda Douglas — dentistry, surgery"

Gaps: no create, edit or delete for vets; no specialty management screen at all; no search or
sort despite the `vets_last_name` index; no error state if the fetch fails; and a leftover
`console.log('vets', vets)` in `componentDidMount` (`VET-05`, `VET-09`).

---

## Implementation Phases

### Phase 0: Baseline documentation - COMPLETED

**Tasks**: document every layer; verify specialty resolution, delete refusal and status codes
against a running server; record gaps.

**Deliverables**: this document; gaps `VET-01`…`VET-09`.

### Phase 1: Make specialty handling explicit - PLANNED

**Objective**: A request that cannot be honoured is rejected, not silently altered.

**Tasks**:
1. Reject unknown specialty names with `400` and a message naming them, instead of dropping them
   (`VET-01`).
2. Decide whether specialties are addressed by id or by name, and apply it consistently — today
   the id is accepted and ignored (`VET-02`).
3. Add a uniqueness constraint on `specialties.name` if name remains the key (depends on
   `AUTH-14`, since there is no migration framework).

### Phase 2: Correct the deletion contract - PLANNED

**Tasks**:
1. Return `409 Conflict` with a clear message when a specialty is in use, instead of a `400`
   leaking the constraint name (`VET-04`). Depends on Authentication's catch-all fix (`AUTH-01`).
2. Make the refusal deliberate rather than incidental — check for references explicitly instead
   of relying on flush ordering (`VET-03`).
3. Parameterise the concatenated queries in `SpringDataSpecialtyRepositoryImpl` (`VET-03`).
4. Reconcile with pet-type deletion (`PET-05`) so both lookup tables behave the same way.

### Phase 3: Expose the directory in the UI - PLANNED

**Tasks**:
1. Add create, edit and delete for vets, with a multi-select for specialties (`VET-05`).
2. Add a specialty management screen.
3. Add an error state and remove the stray `console.log` (`VET-09`).
4. Add search/sort by last name, and consider `VARCHAR_IGNORECASE` for parity with owners.

### Phase 4: Consolidation - PLANNED

**Tasks**: remove the duplicate `findVets()` / `findAllVets()` pair (`VET-08`); add a uniqueness
constraint to `vet_specialties` (`VET-07`); decide whether visits should record the attending
vet.

---

## Technical Implementation Details

### Key Files

**Backend**
- `src/main/java/.../model/Vet.java` - `@ManyToMany` eager, no cascade
- `src/main/java/.../model/Specialty.java` - extends `NamedEntity`
- `src/main/java/.../repository/VetRepository.java`, `SpecialtyRepository.java`
- `src/main/java/.../repository/springdatajpa/SpringDataSpecialtyRepositoryImpl.java` - **`VET-03`**
- `src/main/java/.../rest/controller/VetRestController.java` - **`VET-01`, `VET-02`, `VET-06`**
- `src/main/java/.../rest/controller/SpecialtyRestController.java` - CRUD, `VET-04`
- `src/main/java/.../service/ClinicServiceImpl.java` - `findSpecialtiesByNameIn`, `VET-08`
- `src/main/java/.../mapper/VetMapper.java`, `SpecialtyMapper.java`

**Frontend**
- `client/src/components/vets/VetsPage.tsx` - the only screen; **`VET-05`, `VET-09`**

### Implementation Patterns

Creating a vet — the `name` must match an existing specialty exactly; the `id` is ignored:

```powershell
curl.exe --% -X POST http://localhost:9966/petclinic/api/vets -H "Content-Type: application/json" -d "{\"firstName\":\"Anna\",\"lastName\":\"Smith\",\"specialties\":[{\"id\":1,\"name\":\"radiology\"}]}"
```

Sending `"specialties": []` is valid and creates a vet with none.

### Important Notes

- **Specialties resolve by name; the id you send is ignored.** A wrong id with a right name is
  silently corrected.
- **An unknown specialty name is silently dropped** and the vet is still created — check the
  response body to confirm what was actually attached.
- **Updating a vet replaces the whole specialty set**; there is no incremental add or remove.
- **Deleting an in-use specialty is refused** (400) — unlike pet types, which destroy dependents.
- **Deleting a vet does not delete specialties**; the many-to-many has no cascade.
- **No vet is linked to any visit.** The clinic cannot report on who treated a pet.
- Everything in this slice requires `VET_ADMIN`, including reads.

---

## Acceptance Criteria

### Verified true today (baseline)

- [x] `GET /vets` returns the 6 seeded vets with nested specialties
- [x] `GET /vets/{id}` returns 200; unknown id returns 404
- [x] `POST /vets` returns **201** with a `Location` header
- [x] `PUT /vets/{id}` returns 204; `DELETE /vets/{id}` returns 204
- [x] `GET /specialties` returns the 3 seeded specialties; `GET /specialties/{id}` returns 200
- [x] `POST /specialties` returns 201; `PUT` returns 204
- [x] Deleting an **unused** specialty returns 204
- [x] Deleting an **in-use** specialty returns **400** and deletes nothing
- [x] A vet created with a valid specialty name has it attached
- [x] A vet created with a **wrong id but valid name** has the id silently corrected
- [x] A vet created with an **unknown specialty name** is created with `"specialties": []`
- [x] Deleting a vet leaves shared specialties intact
- [x] UI: the Veterinarians page renders all 6 vets, showing `none` where there are no specialties

### Failing today — must pass after remediation

- [ ] An unknown specialty name is rejected with a clear message (`VET-01`)
- [ ] Specialty identity is consistent — either id or name, not "id accepted then ignored" (`VET-02`)
- [ ] Deleting an in-use specialty returns `409` without leaking the constraint name (`VET-04`)
- [ ] Specialty deletion checks references explicitly rather than relying on flush ordering (`VET-03`)
- [ ] Repository queries use bound parameters (`VET-03`)
- [ ] Vets and specialties can be managed from the UI (`VET-05`)
- [ ] Individual specialties can be added or removed without replacing the set (`VET-06`)
- [ ] `GET /vets` with no rows returns `200` and an empty array (coordinate with `OWN-01`)

### Identified gaps

| ID | Gap | Evidence | Severity |
|---|---|---|---|
| `VET-01` | Unknown specialty names silently dropped; vet still created | verified: `astrology` → `"specialties":[]`, 201 | High |
| `VET-02` | Client-supplied specialty id ignored; resolution is by name | verified: id 999 + `surgery` → id 2 | Medium |
| `VET-03` | Specialty delete relies on flush ordering; queries string-concatenated | `SpringDataSpecialtyRepositoryImpl` | Medium |
| `VET-04` | In-use specialty delete returns 400 leaking the constraint name | verified body | Medium |
| `VET-05` | No vet or specialty management in the UI; read-only | `VetsPage` is the only screen | Medium |
| `VET-06` | Updating a vet replaces the entire specialty set | `clearSpecialties()` in `updateVet` | Low |
| `VET-07` | `vet_specialties` has no uniqueness constraint | `initDB.sql` | Low |
| `VET-08` | `findVets()` and `findAllVets()` are duplicates | `ClinicServiceImpl` | Low |
| `VET-09` | Stray `console.log`; no error state on the vets page | `VetsPage.componentDidMount` | Low |

---

## Success Metrics

| Metric | Target | How Measured |
|---|---|---|
| Silently discarded request data | 0 | Post an unknown specialty; assert rejection, not a 201 |
| Lookup-table deletion consistency | pet types and specialties behave identically | Cross-slice deletion test |
| Correct conflict status | 100% of in-use deletes return 409 | Contract test |
| Vet directory manageable without API access | create/edit/delete available in the UI | Browser flow suite |
| Parameterised repository queries | 100% | Static check for concatenation in `createQuery`/`createNativeQuery` |

---

## Dependencies

### External Dependencies
- `spring-boot-starter-data-jpa` - persistence and the `EntityManager` used by the override
- `mapstruct` - `VetMapper`, `SpecialtyMapper`

### Internal Dependencies
- `ClinicService.findSpecialtiesByNameIn` - the name-based resolution behind `VET-01`/`VET-02`
- `specialties` table - referenced by name, though the column has no uniqueness constraint
- `ExceptionControllerAdvice` - converts the FK violation into the 400 seen on in-use deletes
- Auth slice - `VET_ADMIN` on **all ten** operations, reads included; note `VET_ADMIN` also owns
  pet-type writes, documented in the pets PRD
- **No dependency on owners, pets or visits** — this slice is structurally isolated

---

## Risks and Mitigation

### Technical Risks

- **Risk**: `VET-01` loses data while reporting success. A bulk import of vets with slightly
  misspelled specialty names would produce a directory of unqualified vets, with every request
  returning 201.
  **Mitigation**: Phase 1, task 1. Until then, always read the response body to confirm which
  specialties were actually attached.

- **Risk**: Specialty deletion is refused only because of JPA flush ordering (`VET-03`), not an
  explicit check. A refactor of the override — or a switch to the `jpa` or `jdbc` profile, whose
  implementations differ — could silently turn refusal into cascade, matching the pet-type
  disaster.
  **Mitigation**: Make the check explicit in Phase 2, and test deletion under all three profiles.

- **Risk**: Name-based resolution has no uniqueness constraint behind it (`VET-07` and the
  missing constraint on `specialties.name`), so two rows with the same name would make
  resolution non-deterministic.
  **Mitigation**: Add the constraint in Phase 1 — blocked by the absence of a migration
  framework (`AUTH-14`).

- **Risk**: `createNativeQuery` with string concatenation is an injection pattern. The value is
  an `Integer` path variable today, so it is type-constrained, but a future signature change
  removes that protection.
  **Mitigation**: Parameterise now, alongside the identical fix in the pets slice (`PET-06`).

### User Experience Risks

- **Risk**: The directory is read-only, so any staffing change requires a direct API call. In
  practice the data will go stale.
  **Mitigation**: Phase 3.

- **Risk**: A user who adds a vet via the API and sees 201 has no indication that their
  specialties were dropped; the vets page will simply show `none`.
  **Mitigation**: Phase 1 fixes the cause; the UI should also distinguish "no specialties" from
  "specialties not recognised".

---

## Troubleshooting Guide

### A new vet shows "none" under Specialties
**Problem**: The vet was created with specialties, but none are attached.
**Cause**: The specialty **name** did not match an existing row. `findSpecialtiesByNameIn`
returns an empty list and the vet is saved without specialties, still returning 201 (`VET-01`).
**Solution**: Check `GET /api/specialties` for the exact name and resend. Names are matched
exactly.
**Code Reference**: `rest/controller/VetRestController.java` (`addVet`)

### A specialty id in the response differs from the one sent
**Problem**: Sending `{"id":999,"name":"surgery"}` returns `{"id":2,"name":"surgery"}`.
**Cause**: Intended — resolution is by name and the supplied id is ignored (`VET-02`).
**Solution**: Send the correct name; treat the id as informational.

### Cannot delete a specialty
**Problem**: `DELETE /specialties/{id}` returns 400 with a foreign-key message.
**Cause**: A vet still references it. The delete is refused by `fk_vet_specialties_specialties`
(`VET-04`). This is the safe outcome, reported with the wrong status.
**Solution**: Remove the specialty from every vet first, then delete it.

### Updating a vet removed their other specialties
**Problem**: Adding one specialty dropped the rest.
**Cause**: `updateVet` calls `clearSpecialties()` and re-adds only what the request contains
(`VET-06`).
**Solution**: Send the complete desired set on every update, not just the delta.

### Deleting a vet did not remove their specialties
**Problem**: The specialty rows still exist.
**Cause**: Intended — the many-to-many has no cascade, and specialties are shared.
**Solution**: None needed.

---

## Notes for AI Agents

1. This is a **baseline** document. Current-behaviour sections are verified fact. Read
   Business Requirements before changing directory behaviour; a successful create must not
   silently drop specialties the administrator submitted.
2. Do not implement Phase 1+ work without explicit approval.
3. **Specialties resolve by name, not id.** When creating a vet, send the exact existing name,
   and verify the response body — an unknown name yields an empty list with a 201.
4. Updating a vet **replaces** the specialty set. Always send the full set.
5. Adding a method to `VetRepository` or `SpecialtyRepository` means implementing it **three
   times**, once per profile.
6. Contrast with pet types before changing deletion here — the two lookup tables behave
   oppositely (`PET-05`), and they should be reconciled together.
7. Restore the seed data after mutating: 6 vets, 3 specialties. Restarting the backend reseeds it.
8. Use `filepath:line-number` when citing code.

---

## Current Status

**Last Updated**: 2026-09-22
**Current Phase**: Phase 0 - Baseline documentation
**Status**: COMPLETED
**Next Steps**: Review. This is the least broken slice; `VET-01` is the most valuable fix
because it silently discards submitted data while reporting success.

**Change log**:
- 2026-09-22 — added Business Requirements (BR-VET-01–05).
- 2026-09-22 — absorbed former cross-cutting specialty delete/concat and dead-code notes into
  `VET-03` / `VET-04` / `VET-08`; removed `CROSS_CUTTING_BASELINE_PRD.md` dependency.
