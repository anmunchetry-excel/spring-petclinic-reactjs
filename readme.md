# Spring PetClinic — REST backend + React frontend

A two-part sample application:

- **Backend** — `spring-petclinic-rest` 3.2.1 on Spring Boot 3.2.1. A pure REST API whose
  controllers implement interfaces generated from `src/main/resources/openapi.yml`.
- **Frontend** — a single-page React + TypeScript client in `client/`, originally written in
  2016 as a port of the Spring PetClinic UI.

The two halves come from different upstream projects and are **not fully in sync**. Most of the
UI works, but a few flows hit endpoints that have changed or are unimplemented. See
[Known issues](#known-issues).

## Prerequisites

| Tool | Version |
|---|---|
| JDK | 17 or newer (built and verified on Corretto 21) |
| Node.js | 18 or newer (verified on 24) |
| Maven | not required — use the bundled `mvnw` / `mvnw.cmd` wrapper |

No database server is needed. The default profile uses an in-memory HSQLDB that is created and
seeded on every start.

## Quick start

Run the two servers in separate terminals. **Start the backend first** — the frontend has no
data of its own.

### 1. Backend

```bash
./mvnw -DskipTests package
java -jar target/spring-petclinic-rest-3.2.1.jar
```

On Windows use `.\mvnw.cmd` instead of `./mvnw`. You can also run it directly with
`./mvnw spring-boot:run`.

### 2. Frontend

```bash
cd client
npm install
PORT=4444 npm start
```

On Windows PowerShell, set the port separately: `$env:PORT=4444; npm start`. The port defaults
to 3000 if unset.

Then open <http://localhost:4444>.

### Where things listen

| | URL |
|---|---|
| Frontend | <http://localhost:4444> |
| API base | <http://localhost:9966/petclinic/api> |
| Swagger UI | <http://localhost:9966/petclinic/swagger-ui.html> |
| OpenAPI JSON | <http://localhost:9966/petclinic/v3/api-docs> |
| Actuator health | <http://localhost:9966/petclinic/actuator/health> |

The backend port and the `/petclinic/` context path are set in
`src/main/resources/application.properties`. The frontend reads the backend location from the
`__API_SERVER_URL__` constant baked in by webpack; override it with the `API_SERVER_URL`
environment variable at build time.

## Configuration

Two active profiles are selected in `application.properties`: one for the database and one for
the persistence layer.

```properties
spring.profiles.active=hsqldb,spring-data-jpa
```

- Database: `hsqldb` (default), `mysql`, or `postgresql`
- Persistence: `spring-data-jpa` (default), `jpa`, or `jdbc`

Settings for the other databases live in `application-mysql.properties` and
`application-postgresql.properties`. For MySQL in Docker:

```bash
docker run -e MYSQL_ROOT_PASSWORD=petclinic -e MYSQL_DATABASE=petclinic -p 3306:3306 mysql:8.0
```

### Security

Authentication is **disabled by default**:

```properties
petclinic.security.enable=false
```

Every endpoint below is therefore callable without credentials. Enabling it activates the
`@PreAuthorize` role checks already present on the controllers.

## Project layout

```
src/main/java/.../rest/controller/   REST controllers (implement generated interfaces)
src/main/java/.../model/             JPA entities
src/main/java/.../repository/        Three interchangeable persistence layers
src/main/java/.../mapper/            MapStruct entity <-> DTO mappers
src/main/resources/openapi.yml       API contract; DTOs and interfaces generate from this
client/src/components/               React components, grouped by feature
client/src/util/index.tsx            fetch helpers and backend URL construction
client/webpack.config.js             Dev build + dev server
client/webpack.config.prod.js        Production build
```

Editing `openapi.yml` regenerates the API interfaces and DTOs on the next build.

## API reference

Base URL: `http://localhost:9966/petclinic/api`. All responses are JSON.

The examples use `curl.exe` and the `--%` token because this repository is commonly used on
Windows: PowerShell otherwise splits JSON bodies on the spaces inside string values and curl
treats the fragments as extra URLs. On macOS and Linux, drop `.exe` and `--%` and single-quote
the JSON instead.

### Owners

```powershell
curl.exe http://localhost:9966/petclinic/api/owners
curl.exe "http://localhost:9966/petclinic/api/owners?lastName=Davis"
curl.exe http://localhost:9966/petclinic/api/owners/1
curl.exe --% -X POST http://localhost:9966/petclinic/api/owners -H "Content-Type: application/json" -d "{\"firstName\":\"John\",\"lastName\":\"Doe\",\"address\":\"1 Main St\",\"city\":\"Madison\",\"telephone\":\"6085551234\"}"
curl.exe --% -X PUT http://localhost:9966/petclinic/api/owners/1 -H "Content-Type: application/json" -d "{\"firstName\":\"George\",\"lastName\":\"Franklin\",\"address\":\"110 W. Liberty St.\",\"city\":\"Madison\",\"telephone\":\"6085551023\"}"
curl.exe -X DELETE http://localhost:9966/petclinic/api/owners/11
```

Listing returns `404` rather than an empty array when nothing matches. Create returns `201`,
update and delete return `204`.

### Pets belonging to an owner

```powershell
curl.exe --% -X POST http://localhost:9966/petclinic/api/owners/1/pets -H "Content-Type: application/json" -d "{\"name\":\"Buddy\",\"birthDate\":\"2021-03-04\",\"type\":{\"id\":2,\"name\":\"dog\"}}"
curl.exe --% -X POST http://localhost:9966/petclinic/api/owners/1/pets/1/visits -H "Content-Type: application/json" -d "{\"date\":\"2024-06-01\",\"description\":\"vaccination\"}"
```

These are the **working** ways to create pets and visits. The corresponding
`GET /owners/{ownerId}/pets/{petId}` and `PUT /owners/{ownerId}/pets/{petId}` are broken — see
[Known issues](#known-issues).

### Pets

```powershell
curl.exe http://localhost:9966/petclinic/api/pets
curl.exe http://localhost:9966/petclinic/api/pets/1
curl.exe --% -X PUT http://localhost:9966/petclinic/api/pets/1 -H "Content-Type: application/json" -d "{\"name\":\"Leo\",\"birthDate\":\"2010-09-07\",\"type\":{\"id\":1,\"name\":\"cat\"}}"
curl.exe -X DELETE http://localhost:9966/petclinic/api/pets/15
```

### Pet types

```powershell
curl.exe http://localhost:9966/petclinic/api/pettypes
curl.exe http://localhost:9966/petclinic/api/pettypes/1
curl.exe --% -X POST http://localhost:9966/petclinic/api/pettypes -H "Content-Type: application/json" -d "{\"name\":\"turtle\"}"
curl.exe --% -X PUT http://localhost:9966/petclinic/api/pettypes/6 -H "Content-Type: application/json" -d "{\"name\":\"hamster\"}"
curl.exe -X DELETE http://localhost:9966/petclinic/api/pettypes/7
```

### Visits

```powershell
curl.exe http://localhost:9966/petclinic/api/visits
curl.exe http://localhost:9966/petclinic/api/visits/1
curl.exe --% -X PUT http://localhost:9966/petclinic/api/visits/1 -H "Content-Type: application/json" -d "{\"date\":\"2013-01-01\",\"description\":\"rabies shot\",\"petId\":7}"
curl.exe -X DELETE http://localhost:9966/petclinic/api/visits/5
```

### Vets and specialties

```powershell
curl.exe http://localhost:9966/petclinic/api/vets
curl.exe http://localhost:9966/petclinic/api/vets/1
curl.exe --% -X POST http://localhost:9966/petclinic/api/vets -H "Content-Type: application/json" -d "{\"firstName\":\"Anna\",\"lastName\":\"Smith\",\"specialties\":[]}"
curl.exe --% -X PUT http://localhost:9966/petclinic/api/vets/1 -H "Content-Type: application/json" -d "{\"firstName\":\"James\",\"lastName\":\"Carter\",\"specialties\":[]}"
curl.exe -X DELETE http://localhost:9966/petclinic/api/vets/7

curl.exe http://localhost:9966/petclinic/api/specialties
curl.exe http://localhost:9966/petclinic/api/specialties/1
curl.exe --% -X POST http://localhost:9966/petclinic/api/specialties -H "Content-Type: application/json" -d "{\"name\":\"cardiology\"}"
curl.exe --% -X PUT http://localhost:9966/petclinic/api/specialties/3 -H "Content-Type: application/json" -d "{\"name\":\"dentistry\"}"
curl.exe -X DELETE http://localhost:9966/petclinic/api/specialties/4
```

### Users

Admin-only when security is enabled. The server prefixes role names with `ROLE_` in its
response.

```powershell
curl.exe --% -X POST http://localhost:9966/petclinic/api/users -H "Content-Type: application/json" -d "{\"username\":\"testuser\",\"password\":\"pass1234\",\"enabled\":true,\"roles\":[{\"name\":\"OWNER_ADMIN\"}]}"
```

## Tests

```bash
./mvnw test          # backend
cd client && npm test # frontend (Jest, 14 tests)
```

The backend build also enforces JaCoCo coverage thresholds (85% line, 66% branch).

## Known issues

These are real defects confirmed against a running instance, not setup problems. Four are in
the backend and two in the frontend.

### Backend

**`GET /owners/{ownerId}/pets/{petId}` always returns 400.** The handler compares the pet's
owner to the requested owner with `equals()`, but `BaseEntity` never overrides it, so this is
reference identity. Because `spring.jpa.open-in-view=false`, the two lookups run in separate
JPA sessions and return distinct instances that never match. Use `GET /pets/{petId}` instead.

**`PUT /owners/{ownerId}/pets/{petId}` returns 501.** `updateOwnersPet` is declared in
`openapi.yml` but never overridden in `OwnerRestController`, so the generated default applies.
Use `PUT /pets/{petId}` instead.

**`POST /pets` and `POST /visits` fail with a foreign-key violation.** `ownerId` and `petId` are
marked `readOnly` in the OpenAPI schema, so the generated DTOs discard them from the request
body and the foreign key is inserted as null. Use the nested routes
`POST /owners/{ownerId}/pets` and `POST /owners/{ownerId}/pets/{petId}/visits`.

**`GET /oops` is declared in `openapi.yml` with no controller behind it.** It 404s at the
framework level. Because no handler is matched, the response carries no CORS headers, so the
browser reports it as a CORS failure rather than a 404.

### Frontend

**Saving an existing owner succeeds but then crashes the page.** `OwnerEditor.onSubmit` treats
only `200`/`201` as success, while `PUT /owners/{id}` correctly returns `204`. The response
falls through to the error branch and rendering throws on the missing `fieldErrors`. The data
*is* saved; reloading shows the change.

**Adding a pet from the UI always fails with 400.** `PetEditor` submits `typeId` as a string,
but the API requires a nested `type` object (`{"id": 2, "name": "dog"}`). Creating a pet
through the API directly works.

Two smaller cosmetic problems: the edit-owner screen is titled "New Owner" because the heading
is hardcoded in `OwnerEditor`, and the `action=` attributes on the forms still point at an old
`/api/owner` path. They are inert, since every submit handler calls `preventDefault()`.

## Notes on the frontend build

The client is a 2016 React 15 / TypeScript application. Its dependencies were bumped over the
years without matching updates to the build config, which left it unable to compile at all. The
build was repaired by moving the webpack configuration to v5 syntax and replacing the obsolete
toolchain: `ts-loader` in `transpileOnly` mode now handles TypeScript, webpack 5 asset modules
replace `url-loader`/`file-loader`, and Babel, TSLint and `extract-text-webpack-plugin` are gone.

Type checking is deliberately off. The React 15 type definitions came from the retired
`typings` registry and can no longer be fetched, so the sources cannot be fully type checked
without first migrating to `@types` packages. The `postinstall` hook that tried to fetch them
was removed because it broke every `npm install`.

Keep this in mind when upgrading: a dependency bump that ignores `webpack.config.js` will
reintroduce exactly the breakage that was just fixed.

## Related projects

- [spring-petclinic-rest](https://github.com/spring-petclinic/spring-petclinic-rest) — the backend this repository uses
- [spring-petclinic](https://github.com/spring-projects/spring-petclinic) — the original server-rendered application
- [spring-petclinic-graphql](https://github.com/spring-petclinic/spring-petclinic-graphql) — a React client using GraphQL instead of REST

## Contributing

The [issue tracker](https://github.com/spring-projects/spring-petclinic/issues) is the preferred
channel for bug reports, feature requests and pull requests. Editor preferences are defined in
[`.editorconfig`](.editorconfig); see <https://editorconfig.org> for plugins.

## License

Apache License 2.0 — see [LICENSE.txt](LICENSE.txt).
