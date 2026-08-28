# Task 11 MVP report

## Delivered

- Added physical-seat `Participant`, `ScriptedParticipant`, and `AgentParticipant` adapters.
- Added the deterministic tournament controller with automatic hand progression, exact per-decision RNG paths, `applyIntent` authority, strict/fallback handling, invariant/replay checks, event guard, and public-only callbacks.
- Added Chinese table/event rendering and the legal `f/x/c/r <raiseTo>/a` prompt.
- Added the playable `--seed` CLI with human seat 0 plus hunter, maniac, and calling-station opponents.
- Added only the four user-requested compact test files and root exports.

## TDD evidence

- Initial focused run: 4 suites failed only on the expected missing `participant`, `renderer`, and `prompts` modules.
- First green: controller, renderer, and prompt suites passed 11/11 tests.
- Final focused run: 4 files passed 12/12 tests, including the fixed-seed default tournament.

## Verification

- `npm test`: 32 files, 402 tests passed.
- `npm run check`: passed.
- `npm run build`: passed.
- `git diff --check`: passed.

## Deferred by the MVP override

No random-isolation matrix, replay saving, browser/package work, stress suite, expanded adversarial callback tests, or Task 12 files were added.
