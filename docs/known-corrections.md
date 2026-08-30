# Known corrections

## Merge pot layers with identical eligibility

Status: resolved in v0.1.0

Observed case: contributions `[0, 2, 8, 8]`, where the player contributing `2` has folded, were previously emitted as a `6`-chip layer and a `12`-chip layer. Both layers are contestable by the same two seats.

Expected behavior: merge contribution layers with identical `eligibleSeats` before pot awards and odd-chip distribution. The observed case should become one `18`-chip pot. Layers with genuinely different eligible seats must remain separate main and side pots.

Resolution: v0.1.0 merges contribution layers with identical `eligibleSeats` before awards. Genuine main and side pots remain separate, and odd chips are distributed once from the merged pot.

Why it mattered: the previous result was numerically correct when one player won every layer, but the duplicate presentation was misleading and independent odd-chip allocation could produce a different result when tied winners shared equivalent layers.

Acceptance checks:

- Folded dead money plus equal live contributions produces one merged pot.
- Genuine all-in side pots with different eligible seats remain separate.
- Refunds, payouts, chip conservation, replay, and odd-chip order remain correct.

Verification: the focused pot and odd-chip tests pass, as do the full 33-file / 423-test suite, TypeScript check, and diff check.
