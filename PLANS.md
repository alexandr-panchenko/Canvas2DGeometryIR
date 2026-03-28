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
- [ ] Initialize Bun project
- [ ] Add strict TypeScript config
- [ ] Add Bun test setup
- [ ] Add README stub
- [ ] Add AGENTS.md
- [ ] Add initial source/module layout
- [ ] Ensure project builds and tests run

### Phase 1 — Core types and IR skeleton
- [ ] Define core math/types (`Point`, `Rect`, `Matrix`, etc.)
- [ ] Define segment model types
- [ ] Define path model types
- [ ] Define initial IR shape
- [ ] Decide which parts of IR are mutable during recording vs immutable after finalize
- [ ] Add tests for basic IR construction

### Phase 2 — Recording context
- [ ] Implement Canvas-like recording context skeleton
- [ ] Support state stack (`save` / `restore`)
- [ ] Support current transform state
- [ ] Support current path lifecycle (`beginPath`, `closePath`, etc.)
- [ ] Support line/path construction commands
- [ ] Support style state needed for fill/stroke
- [ ] Convert recorded commands into structured IR
- [ ] Add tests for deterministic recording behavior

### Phase 3 — Segment implementations
- [ ] Implement line segment geometry
- [ ] Implement Bézier segment geometry
- [ ] Implement arc segment geometry
- [ ] Decide whether to use `bezier-js` or internal Bézier utilities
- [ ] Add tests for segment-level bounds
- [ ] Add tests for segment-level closest-point behavior where applicable

### Phase 4 — Path composition and bounds
- [ ] Build path-level geometry from segments
- [ ] Implement axis-aligned bounds for paths
- [ ] Handle transforms correctly in bounds computation
- [ ] Add tests for transformed bounds
- [ ] Add tests for composite path bounds

### Phase 5 — Replay rendering
- [ ] Define replay target interface
- [ ] Implement replay from IR to injected canvas-like target
- [ ] Keep replay independent of DOM/browser globals
- [ ] Add tests using fake replay targets
- [ ] Add one or two manual examples for replay behavior

### Phase 6 — Hit testing
- [ ] Implement point hit testing for fills
- [ ] Implement point hit testing for strokes
- [ ] Define exact supported semantics and limitations
- [ ] Add tests for common hit-test cases
- [ ] Add tests for transformed objects

### Phase 7 — Closest-point queries
- [ ] Implement closest-point queries for line segments
- [ ] Implement closest-point queries for Bézier segments
- [ ] Implement closest-point queries for arcs
- [ ] Expose path-level closest-point query
- [ ] Add tests for representative cases

### Phase 8 — Anchors
- [ ] Define default anchor extraction strategy
- [ ] Expose anchor candidates from shapes/paths
- [ ] Keep anchor strategy simple and deterministic in v1
- [ ] Add tests for anchor extraction

### Phase 9 — Serialization
- [ ] Define JSON-safe serialization format
- [ ] Implement `toJSON`
- [ ] Implement `fromJSON`
- [ ] Add roundtrip tests
- [ ] Ensure no executable values leak into serialized output

### Phase 10 — API cleanup and examples
- [ ] Review public API
- [ ] Remove accidental abstractions
- [ ] Add examples for common usage
- [ ] Expand README with supported feature subset
- [ ] Document known limitations
- [ ] Add brief performance notes / obvious future optimization points

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
- [ ] resolved

Notes:
-

### Text support
Should text be:
- fully out of scope for v1
- represented as optional extension hooks
- minimally supported through injected measurement interface

Default assumption: out of scope for v1.

Status:
- [ ] unresolved
- [ ] resolved

Notes:
-

### Replay target shape
How closely should replay target mirror Canvas 2D?

Status:
- [ ] unresolved
- [ ] resolved

Notes:
-

### Anchor model
How rich should anchor extraction be in v1?

Status:
- [ ] unresolved
- [ ] resolved

Notes:
-

---

## Current status

### Completed
- None yet

### In progress
- None yet

### Blocked
- None yet

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
