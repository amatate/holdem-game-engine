# Story campaign v1 — third night through endings

Approved scope: continue Second Night money and choices, advance Kai's debt, improve dialogue, strengthen story mode. Use Game Studio foundations/UI/playtest workflows, retaining the TypeScript rules and DOM mobile UI.

## Story and player loop

Third Night: meet Kai at his repair shop. Attendance, actual poker result and whether the player already asked change the conversation. Establish a fixed 3,000 debt reduction for bringing a new player, independent of poker winnings; a declined visit did not earn that reduction. The player may request the actual record, accept a limited 150 cash installment if Kai benefited, or refuse money. Refusing money does not erase the question. Optional 50 buy-in heads-up; no wager is required to learn facts.

Fourth Night: return to Mo. Show his specific knowledge and the monthly 800 room subsidy, with a source the player can ask to see. Do not retroactively rewrite the first night as a conspiracy. Optional 100 buy-in table; existing money and genuine closing stacks carry over.

Fifth Night: Lin helps if asked; if the player did not ask, do not invent a broken promise. Her choice to omit Mo's material is visible. The player can request the original or verify the relevant entry with Han independently. Optional 50 buy-in small table.

Sixth Night: resolve with an in-room accounting, a personal settlement, or leaving. Consequences use evidence actually seen, money actually paid, and decisions actually made. A promised remaining amount is not cash already in the wallet. All communication is fictional in-game dialogue.

## Runtime

- One data-defined scene graph with conditional lines/choices, persistent line cursor, explicit transition intents, ledger, witnessed evidence, relationship statuses, chapter history and completed ending.
- Host owns choices, money and scene progress. Renderer only displays them. A choice is legal only after reading the current scene's final line; requests carry a scene revision and table packet.
- Optional tables use the existing engine, fixed announced stakes and a hand cap. No rigging or forced loss. Cash-out once at hand-result; insufficient funds never blocks the conversational route.
- Continue in the existing journey slot. Preserve Second Night v1 simulation for verified legacy replay, allow only recorded v1 build IDs, and validate the full digest before continuation. Unknown versions and corrupt records remain blocked and untouched.
- Backed up local data before edits. No source-reference files, GitHub, ChipZen or external accounts are modified.

## Writing

Give each scene an immediate activity: closing the shop, clearing cups, checking a phone, comparing two pages. Use pauses, evasions and specific disagreements. No rotating moral summaries, universal praise, omniscient evidence or identical lines for attended/declined routes. Important claims remain attributable to their speaker or record.

## UI and validation

Portrait story scenes retain the pixel night palette and character art. Add a shop environment; reuse existing old/new room art. One line at a time; choices after the line; a journal drawer contains chapter progress, earlier dialogue, evidence, relationships and ledger. History is read-only.

Verify legacy non-default wallet recovery, both Second Night routes, partial/complete saves, mid-dialogue cursor, rejected stale/double actions, insufficient funds, actual optional poker payout, each ending, no unseen evidence, English, Node restart, Worker reload, mobile/desktop and playback boundaries. Human dialogue and economy acceptance remain separate.
