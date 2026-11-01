# Story campaign v1 — implementation and playtest record

2026-10-31. Local development, not pushed or deployed to public Pages.

## What is playable

Third Night through Sixth Night now form a complete arc: Kai's referral debt, Mo's room subsidy, Lin's withheld material, and three ways to conclude. The player can leave early in Third Night as well. First Night remains a separate score prologue; Second Night remains the economic and choice source.

The campaign carries the actual Second Night wallet, venue, poker net result, whether the player asked Kai, and whether Mo was questioned. An attended visit earned Kai the agreed deduction; a declined visit did not. The 150 installment exists only on the attended route, requires accepting cash, and is recorded once. Promised but unpaid amounts never enter the wallet.

Optional announced tables: Third Night 50 / 1–2 / up to 4 hands; Fourth Night 100 / 1–2 / up to 6; Fifth Night 50 / 1–2 / up to 4. Insufficient funds or refusing a table does not block conversation or evidence. The existing Hold'em engine determines wins and payouts.

## Story-mode system

- Data-defined scenes and conditions, with authoritative line cursor, revision and choice gates.
- Dialogue position saves after each accepted line/choice; an unfinished poker hand returns to its last settlement checkpoint.
- Shared Node/Worker commands; cloned transitions commit only after opening an engine successfully.
- One auditable cross-night ledger, sourced evidence, descriptive relationship states, chapter progress and read-only dialogue history.
- History includes the actual Second Night closing exchange, then only lines already reached in the new chapters.
- Existing journey slot continues; free-play and First Night slots remain separate.
- Three ending directions: account for the records together, settle personal arrangements and leave, or step away.
- Mobile story entry is promoted when a journey exists. Restart is explicitly labeled as resetting story money.

## Save compatibility

Before editing, local data was backed up under the ignored .holdem-data directory. Recorded the deployed local Second Night v1 Node fingerprint and last Pages v1 build ID. Only these known builds are permitted to attempt old-version replay; full state digest validation remains required before any new progression.

Tests use a frozen pre-change Second Night fixture with wallet 300 after a real losing hand, plus a declined-visit fixture with 600. Both restore without resetting money. Unknown versions and damaged digests are rejected without overwriting the record. A read-only audit also restored the one existing local Second Night record successfully, changing zero files.

This is a bounded migration from verified Second Night v1, not general compatibility with every historical build. Some temporary unpublished QA builds are deliberately unsupported.

## Automated verification

- 11 related suites: 99 tests passed in the combined run.
- After adding the last translation assertion, 3 UI/language suites passed 39 tests, including the one new assertion. This yields 100 distinct related cases verified across the runs.
- TypeScript check, Node build, Pages browser build and git diff whitespace check passed.
- Tests cover route/help/ending combinations; absent versus made promises; only-seen evidence; cursor and stale/duplicate gates; insufficient funds; all three real optional engine tables and cash-outs; both known legacy build IDs; corrupted and unknown saves; exact cursor after Worker replay and Node restart; original First Night/Second Night/free-play regressions.

## Actual browser verification

- Chinese 390×844: declined the new room on Second Night, continued with 600, read Third Night, bought in for 50, folded the real 1 small blind, cashed out 49, and carried 599 through Fourth, Fifth and Sixth Night to the accounting ending.
- Checked the narrative/real-table transition, result review before story continuation, journal drawer, locked future chapters and ledger.
- English Worker at 360×780: explicitly restarted an old temporary unsupported QA save, reached Third Night with 600, advanced to line 2/5, refreshed, resumed at the same line and amount. Record source labels are authored in English. Document and scroll widths were both 360.
- English desktop at 1366×768: resumed that story checkpoint; DOM mobile mode was false and document/scroll widths both 1366.
- Screenshots: output/playwright/story-third-night.png, story-journal.png, story-fifth-night.png, story-english-360.png, story-desktop.png. Some screenshots precede final small objective-label and translation corrections.

## Game Studio assessment and remaining acceptance

The intended loop is now inspectable: play or decline, retain the actual money, confront people using what was witnessed, and choose what happens to those relationships. Keep this character-driven narrative Hold'em direction. More currencies or unrelated daily chores would not improve this milestone.

The dialogue now has situated actions, evasions and disagreements. No poker outcome is scripted to force a betrayal, no lost pot proves a referral deal, and no unrequested promise is assigned to Lin. Technical checks cannot establish that every line feels natural or that every ending feels earned.

Next human playtest should compare attended/declined and asked/unasked routes, measure completed duration, check the 150/50/100 amounts, and ask whether each person is distinguishable without a nickname. Physical phone background suspension, long-run storage, general save migrations and store packaging remain unaccepted.

## Art

One new environment, generated with the built-in image tool, copied unchanged to src/web/art/garage-room-v1.png. All existing portraits and room images are reused. Full prompt: docs/design/garage-room-prompt.txt. Source provenance: src/web/art/README.md.
