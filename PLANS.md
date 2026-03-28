# PLANS.md

## Project

`Canvas2DGeometryIR`

A standalone Bun + TypeScript library for deterministic 2D vector composition, structured geometry, and render replay.

---

## Mission

Build a library with a Canvas-like recording API that does not render pixels directly during composition.

Instead, the library must record drawing commands into a structured internal representation and derive from it:

- replay rendering
- bounds
- hit testing
- closest-point queries
- anchors / anchor candidates
- JSON-safe serialization

The design should be deterministic, geometry-first, and suitable for future safe plugin-style usage where only data crosses trust boundaries.

---

## Core constraints

- Use TypeScript
- Use Bun, not npm
- Use Bun test runner
- Avoid `any`
- Use Zod where runtime validation is needed
- Keep dependencies minimal
- `bezier-js` is allowed if useful, but not required
- Core library must not depend on DOM/browser APIs
- Text is out of scope for v1 unless it can be added cleanly as an optional extension
- Prefer simple explicit data structures over clever abstractions
- Keep the API subset small and solid

---

## Architectural direction

### Recording model
Expose a Canvas-like subset for authoring.

The recording surface should feel familiar, but it does not need full browser Canvas fidelity.

The result of composition must be a structured engine-owned IR.

### Geometry model
Paths consist of ordered segments.

Each segment is one of:
- line
- Bézier curve
- arc

Geometry operations should be defined first for segments, then composed into path-level behavior.

### Outputs
The recorded result should support:
- render replay
- `getBounds()`
- `hitTestPoint(...)`
- `closestPoint(...)`
- `getAnchors()`
- `toJSON()`
- `fromJSON(...)`

Exact names may evolve, but these capabilities should exist.

---

## Delivery strategy

Implement in phases.

Each phase should leave the project:
- compiling
- tested
- documented enough to understand current scope

Do not try to build everything at once.

---

## Phase checklist

### Phase 0 — Repository setup
- [x] Initialize Bun project
- [x] Add strict TypeScript config
- [x] Add Bun test setup
- [x] Add README stub
- [x] Add AGENTS.md
- [x] Add initial source/module layout
- [x] Ensure project builds and tests run

### Phase 1 — Core types and IR skeleton
- [x] Define core math/types (`Point`, `Rect`, `Matrix`, etc.)
- [x] Define segment model types
- [x] Define path model types
- [x] Define initial IR shape
- [x] Decide which parts of IR are mutable during recording vs immutable after finalize
- [x] Add tests for basic IR construction

### Phase 2 — Recording context
- [x] Implement Canvas-like recording context skeleton
- [x] Support state stack (`save` / `restore`)
- [x] Support current transform state
- [x] Support current path lifecycle (`beginPath`, `closePath`, etc.)
- [x] Support line/path construction commands
- [x] Support style state needed for fill/stroke
- [x] Convert recorded commands into structured IR
- [x] Add tests for deterministic recording behavior

### Phase 3 — Segment implementations
- [x] Implement line segment geometry
- [x] Implement Bézier segment geometry
- [x] Implement arc segment geometry
- [x] Decide whether to use `bezier-js` or internal Bézier utilities
- [x] Add tests for segment-level bounds
- [x] Add tests for segment-level closest-point behavior where applicable

### Phase 4 — Path composition and bounds
- [x] Build path-level geometry from segments
- [x] Implement axis-aligned bounds for paths
- [x] Handle transforms correctly in bounds computation
- [x] Add tests for transformed bounds
- [x] Add tests for composite path bounds

### Phase 5 — Replay rendering
- [x] Define replay target interface
- [x] Implement replay from IR to injected canvas-like target
- [x] Keep replay independent of DOM/browser globals
- [x] Add tests using fake replay targets
- [x] Add one or two manual examples for replay behavior

### Phase 6 — Hit testing
- [x] Implement point hit testing for fills
- [x] Implement point hit testing for strokes
- [x] Define exact supported semantics and limitations
- [x] Add tests for common hit-test cases
- [x] Add tests for transformed objects

### Phase 7 — Closest-point queries
- [x] Implement closest-point queries for line segments
- [x] Implement closest-point queries for Bézier segments
- [x] Implement closest-point queries for arcs
- [x] Expose path-level closest-point query
- [x] Add tests for representative cases

### Phase 8 — Anchors
- [x] Define default anchor extraction strategy
- [x] Expose anchor candidates from shapes/paths
- [x] Keep anchor strategy simple and deterministic in v1
- [x] Add tests for anchor extraction

### Phase 9 — Serialization
- [x] Define JSON-safe serialization format
- [x] Implement `toJSON`
- [x] Implement `fromJSON`
- [x] Add roundtrip tests
- [x] Ensure no executable values leak into serialized output

### Phase 10 — API cleanup and examples
- [x] Review public API
- [x] Remove accidental abstractions
- [x] Add examples for common usage
- [x] Expand README with supported feature subset
- [x] Document known limitations
- [x] Add brief performance notes / obvious future optimization points

### Phase 11 — Browser playground for manual verification and bug capture
- [x] Add browser playground scaffold using Bun + TypeScript
- [x] Load and render built-in scenes
- [x] Select path by clicking visible geometry
- [x] Drag selected path
- [x] Edit path points/control points (basic)
- [x] Record structured interaction events
- [x] Export bug-case artifact (scene + tool state + event log + geometry document)
- [x] Add tests for export/serialization and deterministic built-in scenes
- [x] Document how to run playground and capture bug reports

---

## Open questions

### Bézier implementation
Should Bézier support use:
- `bezier-js`
- internal math utilities
- hybrid approach

Decision should be pragmatic based on correctness, simplicity, and performance.

Status:
- [ ] unresolved
- [x] resolved

Notes:
- Internal math utilities are currently sufficient; no external Bézier dependency added.

### Text support
Should text be:
- fully out of scope for v1
- represented as optional extension hooks
- minimally supported through injected measurement interface

Default assumption: out of scope for v1.

Status:
- [ ] unresolved
- [x] resolved

Notes:
- Kept out of scope in current implementation.

### Replay target shape
How closely should replay target mirror Canvas 2D?

Status:
- [ ] unresolved
- [x] resolved

Notes:
- Current replay target mirrors a focused subset of Canvas 2D path + paint APIs.

### Anchor model
How rich should anchor extraction be in v1?

Status:
- [ ] unresolved
- [x] resolved

Notes:
- Vertex and arc-extreme candidates are exposed as deterministic default anchors.

---

## Current status

### Completed
- Core recording, geometry, replay, and serialization phases.
- Browser playground milestone for manual verification and reproducible bug capture.

### In progress
- None.

### Blocked
- None.

### Known limitations
- Playground currently supports a single-canvas workspace with utilitarian controls (intentionally minimal).
- Export includes scene + interaction trace for replay/debug reasoning, but does not yet include an automated interaction replayer.

---

## Working rules for agents

- Update this file as phases progress
- Mark completed checklist items
- Record major decisions under Open questions
- Do not silently expand scope without noting it here
- Prefer completing one phase cleanly before partially touching many others
- If architecture changes significantly, update the relevant sections before continuing

---

## Definition of done

The first usable version is done when:

- the library records deterministic vector compositions
- replay works through an injected target
- paths with line / Bézier / arc segments are supported
- bounds, hit testing, closest-point queries, and anchors are available in a practical v1 form
- serialization roundtrips cleanly
- tests pass under Bun
- the public surface is documented
