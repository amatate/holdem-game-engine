# Known corrections

## Merge pot layers with identical eligibility

Status: open

Observed case: contributions `[0, 2, 8, 8]`, where the player contributing `2` has folded, are currently emitted as a `6`-chip layer and a `12`-chip layer. Both layers are contestable by the same two seats.

Expected behavior: merge contribution layers with identical `eligibleSeats` before pot awards and odd-chip distribution. The observed case should become one `18`-chip pot. Layers with genuinely different eligible seats must remain separate main and side pots.

Why it matters: the current result is numerically correct when one player wins every layer, but the duplicate presentation is misleading and independent odd-chip allocation can produce a different result when tied winners share equivalent layers.

Acceptance checks:

- Folded dead money plus equal live contributions produces one merged pot.
- Genuine all-in side pots with different eligible seats remain separate.
- Refunds, payouts, chip conservation, replay, and odd-chip order remain correct.
