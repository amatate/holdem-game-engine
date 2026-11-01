# Game Studio review and Second Night v1

Status: implementation scope approved in chat. Review uses Game Studio, Web Game Foundations, Game UI Frontend and Game Playtest skills. Current code inspected; device and emotional acceptance require playtesting.

## Findings

1. Highest product gap: the playable First Night ends without persistent stakes or a next-night loop. Its 4 + 6 + optional 6 real hands are a working relationship-building prologue, not a campaign.
2. Keep the existing TypeScript rules, command boundary and DOM mobile frontend. A Phaser migration would not resolve this turn-based game's progression gap. Rendering must not own money or story outcomes.
3. NPC styles, public memory and real wins/losses are the distinctive experience. More AI strength, currencies, daily chores and mandatory bluff objectives are not this milestone.
4. First Night is deliberately a score game: fresh 100 per table. Do not retroactively cash its results into a wallet or require an old-version save to reach Second Night.
5. Existing checkpoint replay is useful but cross-version compatibility remains limited. Give Second Night an independent slot and preserve old free-play and First Night files. Do not advertise broad save migration.

## Playable scope

- Separate Second Night entry on home and First Night ending; direct entry is allowed for players who completed an older build.
- Initial wallet 600 virtual units. New room: buy-in 300, blinds 2/5, four players, at most 8 hands. Old room: buy-in 100, blinds 1/2, three players, at most 6 hands.
- Read terms before committing. Buy-in transfers wallet to table once; exit returns the actual settled stack once. No automatic rebuy, bonus or retroactive result change.
- Classic rules in this chapter. Existing First Night ability routes and free-play Ability Lab remain available.
- Reply to Kai, choose a venue, play or decline, leave after a settled hand, hear/read a concrete discrepancy, decide whether to ask. Declining the new room is a complete route.
- One contextual task, one evolving longer objective, optional notes and an auditable ledger. No win-count quest, stat buff or opaque relationship meter.
- Completion retains the actual wallet and observed facts. Third Night and later betrayals remain future work.

## Runtime and presentation

Second Night simulation owns choices, wallet and ledger. Existing game session owns betting and payout. Host transfers a closing stack only at a real hand-result boundary. Each choice is revision-checked and replayed in Node and browser Worker.

Portrait visual language remains night purple, green felt, brass and ivory. A distinct text-free pixel interior identifies the new room. Phone/old-room scenes reuse existing art. Story text stays in DOM with authored Chinese and English.

## Acceptance

Verify debit/cashout conservation; all routes; pause/action gates; stale and duplicate requests; early exit; bust and positive result; save/replay at pre-buy, active-table and completion; separate slots; mobile/desktop and English; Pages browser build. During animations do not reveal a future wallet payout, dialogue or task state.

Technical checks do not prove a compelling betrayal, balanced economy, real-device ergonomics or store readiness. Follow with human playthroughs measuring completed duration, venue choice, willingness to continue and whether the discrepancy feels earned.
