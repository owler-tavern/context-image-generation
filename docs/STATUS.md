# v2.5 Status

## Objective
Implement ADR-002: two generation entry points, one kernel, optional references, and inert legacy outfit data.

## Current milestone
Task 2 — dormant scene-generation kernel.

## Completed
- ADR-002 accepted and corrected to wand + slash.
- Generation source and delivery destination contracts implemented.
- Extracted a dependency-injected scene-generation kernel without production wiring.
- Defined the Task 4 composition seams for capture, reference materialization, plan/message construction, provider dispatch, and coordination.

## Verification
- `node --test test/scene-generation-contracts.test.mjs` — 8 passed.
- `node --test test/scene-generation-kernel.test.mjs` — 7 passed after the expected missing-module red run.
- Focused kernel parity suite — 54 passed: `scene-generation-kernel`, `generation-plan`, `generation-coordinator`, `provider-dispatch`, `run-coordinator-phase-c`, and `no-spend-uat`.

## Failures / open issues
- Live browser UAT is outstanding.
- No paid-provider verification is authorized.

## Decisions
- Settings is configuration-only.
- Legacy outfit data is preserved, not purged.

## Next action
Add dormant wand/slash delivery adapters, then atomically wire the approved entry points in Task 4.
