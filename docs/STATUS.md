# v2.5 Status

## Objective
Implement ADR-002: two generation entry points, one kernel, optional references, and inert legacy outfit data.

## Current milestone
Task 1 — generation-entry contracts.

## Completed
- ADR-002 accepted and corrected to wand + slash.
- Generation source and delivery destination contracts implemented.

## Verification
- `node --test test/scene-generation-contracts.test.mjs` — 8 passed.

## Failures / open issues
- Live browser UAT is outstanding.
- No paid-provider verification is authorized.

## Decisions
- Settings is configuration-only.
- Legacy outfit data is preserved, not purged.

## Next action
Proceed to the next ADR-002 implementation task.
