# AGENTS.md

## Purpose

This repository contains `Canvas2DGeometryIR`, a standalone Bun + TypeScript library for deterministic 2D vector composition, structured geometry, and render replay.

The library exposes a Canvas-like recording API. It does not paint pixels directly during composition. Instead, it records commands into a structured internal representation and derives geometry and replay behavior from that representation.

## Core priorities

1. Determinism
2. Strict typing
3. Simple explicit internal data structures
4. JSON-safe serialization
5. Geometry-first design
6. Small clear API surface
7. Strong tests

## Tech stack

- TypeScript
- Bun
- Bun test runner
- Zod for runtime schemas where needed

Do not use npm-based tooling when Bun equivalents are sufficient.

## Typing rules

- Avoid `any`
- Prefer explicit generic types
- Prefer narrow discriminated unions
- Keep public API types readable
- Use Zod where runtime validation is required
- Do not let untyped values leak into core geometry or IR code

## Dependency rules

Keep dependencies minimal.

Allowed:
- small focused utilities
- `zod`
- optionally `bezier-js` if it is the clearest practical choice

Do not add large rendering frameworks or browser-dependent packages.

If a dependency is proposed, justify it in code comments or PR notes by one of:
- correctness
- substantial implementation simplification
- measurable performance benefit

## Architecture rules

### Recording API
Expose a Canvas-like subset, but do not chase full browser Canvas fidelity.

### Internal representation
Define the IR early.
Keep it explicit, serializable, and stable.
Prefer structured objects over opaque command blobs where possible.

### Geometry
Geometry is a first-class output, not a side effect of rendering.

Paths should be built from segments.
Each segment must be one of:
- line
- Bézier curve
- arc

Implement geometry operations first at the segment level, then compose them at the path level.

### Rendering
Replay rendering should target an injected canvas-like target.
Do not make the core library depend on DOM APIs.

### Text
Text is not required in v1.
Do not let text complicate the first architecture.
If adding text hooks, keep them optional and isolated.

## Development approach

Build in stages.
Each stage should leave the library in a working, tested state.

Preferred order:
1. setup
2. recording context
3. IR
4. segment/path model
5. replay rendering
6. bounds
7. hit testing
8. closest-point queries
9. anchors
10. serialization
11. examples and polish

## Testing expectations

Add tests for:
- deterministic recording
- bounds
- hit testing
- closest-point behavior
- replay consistency
- serialization roundtrip

Tests should favor semantic behavior over snapshotting incidental object shapes.

## Performance expectations

Be mindful of:
- Bézier approximation cost
- repeated bounds computation
- repeated path flattening
- hit testing on complex shapes

It is fine to start simple, but note obvious hotspots and introduce caching only when it improves clarity or cost meaningfully.

## Style guidance

- Prefer small modules
- Prefer readable math over clever abstractions
- Keep naming concrete
- Avoid speculative extension layers
- Build the minimum solid system first

## Done means

A task is done when:
- code compiles with Bun
- tests pass
- types are strict
- public API is documented if changed
- the change keeps the IR and geometry model coherent
