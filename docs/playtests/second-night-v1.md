# Second Night v1 — Game Studio review and validation

2026-10-31. Local implementation; not pushed or deployed.

## Direction

The strongest direction is character-driven narrative Hold'em: play real hands, choose how much to put at risk, observe people, and carry consequences into another evening. Keep the current TypeScript engine and DOM mobile composition. The next product milestone should deepen the consequences of this loop.

This review applied Game Studio and its Web Game Foundations, Game UI Frontend and Game Playtest workflows. It combines current source inspection, automated checks and real browser interactions; it is not a score from an independent player panel.

## Implemented

- Second Night as a direct home entry and continuation from First Night.
- Initial 600 wallet; independent journey save; no conversion of prologue scores.
- New room: real buy-in 300, 2/5 blinds, four players, cap 8 hands. Old room: 100, 1/2, three players, cap 6.
- Decline the invitation, cancel before buying, play, leave after a settled hand, or do not play at all.
- Atomic cloned buy-in transition; cash-out from actual finalStack exactly once; auditable ledger.
- Contextual task, evolving longer objective and sourced observations; authored Chinese and English.
- New text-free pixel room art; money, choices and dialogue remain live DOM text.
- Browser Worker and local Node use the same state transitions and command gates.
- Presentation holds the previous wallet/story state while settlement animations play. The read-table tool is paused when a story scene hides the table.

## Verification

- Final targeted run: 9 suites, 80 tests passed. Includes new wallet/routes/Node restart tests and First Night, mobile, client, server, browser API and English regressions.
- Type check, Node build, Pages browser build and git diff whitespace checks passed.
- Node browser at 390×844: read stakes, inspect 600→300 buy-in terms, buy in, act in a real hand, leave after settlement, verify opening +600 / buy-in -300 / cash-out +300 and a final wallet of 600 for this break-even hand.
- Inspected separate mobile wallet panel, task, longer objective and money ledger.
- Completed new-room dialogue route. No wager after leaving; ending retains actual money and witnessed fact.
- English Pages Worker: declined invitation, headed home without buying, retained 600, refreshed, resumed at the same scene with 600.
- 360×780 English DOM check: document width and scroll width both 360; dialogue box stays in view.
- Desktop 1366×768 check: mobile composition disabled; document width and scroll width both 1366; ending, wallet and objective render.
- No console errors observed on the tested Node and Worker pages.
- Original 4196 server updated after tests. Temporary QA servers were separate from the user's original session.

Screenshots: output/playwright/second-night-buy-in.png, second-night-wallet.png, second-night-english-360.png, second-night-desktop-ending.png. The wallet screenshot predates the final minor task-label edit from “Listen before leaving” to “Put your money away and get ready to leave”; amounts and layout are unchanged.

## Remaining product risks, in priority order

1. Cross-version save migration remains a release blocker. Old First Night/free-play saves are preserved and not overwritten by the journey slot, but old engine fingerprints are not promised to replay. Direct Second Night entry avoids requiring a prologue replay.
2. Third Night is not implemented. This milestone saves the wallet and a concrete unresolved question; a full multi-night economy and the later betrayals are still future work.
3. The 600 starting balance, buy-ins and hand caps need human economy playtests. Automated conservation does not establish good tension or session length.
4. The two routes currently converge on the question about Kai's debt. Later content should honor their different attendance, spending and observed evidence.
5. Dialogue naturalness and the emotional credibility of the discrepancy require reader/player review. A technically valid scene can still feel convenient.
6. Physical phones, background suspension and long-term browser storage have not been accepted on real hardware.

Recommended next slice: playtest this second night with several people, revise dialogue and amounts together, then make Third Night pay off the saved question and the route actually taken.

## Art

Built-in image generation, one new environment, copied unchanged to src/web/art/second-room-v1.png (1.7 MiB). No new sprite sheets were necessary. Complete generation prompt is in docs/design/second-night-room-prompt.txt; provenance is in src/web/art/README.md.
