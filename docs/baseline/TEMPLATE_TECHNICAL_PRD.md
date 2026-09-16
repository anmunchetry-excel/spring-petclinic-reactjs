Date created: [Date]
Date last modified: [Date]

# [Feature Name] - Technical PRD

## Overview/Problem

**Instructions**: Describe the specific problem this feature solves. Who experiences this problem? What happens today without this feature? Write 2-4 sentences of clear prose.

**Example**: "Teachers currently have no way to verify that their quiz questions align with state curriculum standards. They spend significant time manually cross-referencing TEKS documents, leading to inconsistent coverage and wasted preparation time."

---

## Hypothesis

**Instructions**: State your product bet in one sentence. Use the format: "We believe that [solution] will [outcome] for [user]."

**Example**: "We believe that providing AI-powered question generation with TEKS alignment will reduce quiz creation time by half while improving standards coverage for teachers."

---

## Scope

**Instructions**: Explicitly define what is being built, what is not, and what was considered but deliberately cut. This removes ambiguity for both humans and AI agents.

### In Scope

What will be built in this feature:

- [Requirement 1]
- [Requirement 2]
- [Requirement 3]

### Out of Scope

What is explicitly not being built now but may be considered later:

- [Item 1]
- [Item 2]

### Cut

Things that were considered during planning but deliberately removed (and why):

- [Item 1] - [Reason for cutting]
- [Item 2] - [Reason for cutting]

---

## Technical Requirements

**Instructions**: Describe how the feature will be built. Include database, API, and UI details. Use code examples where helpful.

### Database Schema

**Instructions**: Show all database tables needed. Include:
- Table name
- Column names and types
- Primary keys and foreign keys
- Indexes if needed
- Use SQL CREATE TABLE statements

**Example**:
```sql
CREATE TABLE table_name (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  column_name TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### API Endpoints

**Instructions**: List all API routes needed. For each endpoint, include:
- HTTP method (GET, POST, PUT, DELETE)
- Route path
- Request body structure (if any)
- Response structure
- Error codes and messages

**Format**:
```
#### POST /api/resource
**Request Body:**
```json
{
  "field": "value"
}
```

**Response:**
- Success (200): Response object
- Error (400): Validation error
- Error (500): Server error
```

### User Interface Requirements

**Instructions**: Describe all pages and components needed. Include:
- Page routes
- Form fields
- Validation rules
- User interactions
- Error handling

**Format**:
```
#### Page Name (/route/path)
- List of features
- Form fields with validation
- User actions available
```

---

## Implementation Phases

**Instructions**: Break work into phases. Each phase should have:
- Clear objective
- List of tasks
- Status marker
- Update status as work progresses

**Format**:
```
### Phase 1: [Phase Name] - PLANNED

**Objective**: [What this phase achieves]

**Tasks**:
1. Task description
2. Task description
3. Task description

**Deliverables**:
- File or component created
- Feature implemented
- Testing completed
```

**Status Markers**:
- COMPLETED - Phase is done
- IN PROGRESS - Currently working on this
- PLANNED - Not started yet

---

## Technical Implementation Details

**Instructions**: Add code examples and patterns used. Include:
- Key files and their purpose
- Code patterns and conventions
- Important implementation notes
- Configuration details

**Format**:
```
### Key Files
- `path/to/file.ts` - Purpose description
- `path/to/file.tsx` - Purpose description

### Implementation Patterns
```typescript
// Code example showing pattern
```

### Important Notes
- Critical gotchas or important details
- Best practices followed
- Known limitations
```

---

## Acceptance Criteria

**Instructions**: Define what must be true before this feature can ship. These are pass/fail conditions. Use checkboxes that can be marked as done during implementation.

**Format**:
```
- [ ] Users can [action] and receive [expected result]
- [ ] System handles [error scenario] by [expected behavior]
- [ ] [Edge case] is handled correctly
- [ ] Performance: [specific measurable requirement]
```

---

## Success Metrics

**Instructions**: Define how you will know if this feature achieved its intended outcome after launch. These are measurable outcomes, not just "did we build it" checks.

**Format**:
```
| Metric | Target | How Measured |
|--------|--------|--------------|
| [Metric name] | [Target value] | [Measurement method] |
```

**Example**:
```
| Metric | Target | How Measured |
|--------|--------|--------------|
| Quiz creation time | < 5 minutes average | Timestamp difference between start and save |
| TEKS alignment accuracy | > 90% teacher approval | Teacher feedback on generated questions |
```

---

## Dependencies

**Instructions**: List what this feature needs to work:
- External services or APIs
- Internal services or modules
- Database requirements
- Environment variables

**Format**:
```
### External Dependencies
- Service name - Purpose
- API name - Purpose

### Internal Dependencies
- Module name - Purpose
- Service name - Purpose
```

---

## Risks and Mitigation

**Instructions**: Identify potential problems and how to prevent or handle them.

**Format**:
```
### Technical Risks
- **Risk**: [What could go wrong]
- **Mitigation**: [How to prevent or handle it]

### User Experience Risks
- **Risk**: [What could go wrong]
- **Mitigation**: [How to prevent or handle it]
```

---

## Troubleshooting Guide

**Instructions**: Document common problems and solutions as they arise during implementation. Include:
- Problem description
- Root cause
- Solution steps
- Code references if helpful

**Format**:
```
### Common Issue Name
**Problem**: [What goes wrong]
**Cause**: [Why it happens]
**Solution**: [How to fix it]
**Code Reference**: `file.ts:line-number`
```

---

## Notes for AI Agents

**Instructions for AI**: When working with this PRD:
1. Start by reading the Problem and Hypothesis to understand intent
2. Use Scope (In/Out/Cut) to determine boundaries — do not build out-of-scope items
3. Update phase status markers as work progresses
4. Add implementation details under "Technical Implementation Details" as code is written
5. Mark acceptance criteria as complete when features work
6. Add troubleshooting entries when bugs are found and fixed
7. Keep all sections current - remove outdated information
8. Use code references format: `filepath:line-number` when citing code

---

## Current Status

**Instructions**: Add a brief summary of current state. Update this section regularly.

**Example**:
```
**Last Updated**: [Date]
**Current Phase**: Phase 2 - Backend Implementation
**Status**: IN PROGRESS
**Next Steps**: Complete API endpoint testing
```
