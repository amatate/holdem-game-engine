# Pixel night / Phase A assets

Generated for this project with the built-in image generation tool on 2026-09-26.
Identity references: the approved character sheets in
`docs/design/pixel-night-v1/characters-v1/`. Prompts and design scope:
`docs/design/pixel-night-v1/phase-a.md`.

| File | Layout | Purpose |
| --- | --- | --- |
| hunter-v1.png | 1536 × 1024 RGBA | 林岚 |
| maniac-v1.png | 1536 × 1024 RGBA | 阿凯 |
| calling-station-v1.png | 1536 × 1024 RGBA | 莫叔 |
| room-v1.png | 1672 × 941 RGB | Static background without game information |

Each character atlas has three equal 512 × 1024 cells: neutral, speaking,
public win. CSS selects a cell; no card strength or private intent selects a face.
All seven configured NPCs now have runtime portraits. Unknown/custom character IDs
still use a named silhouette; they cannot construct an arbitrary asset URL.

PNG alpha was decoded and checked: each atlas has genuine alpha-zero background
and a substantial near-opaque foreground (mostly alpha 252–253, not 255).
Browser QA checks the composite on the actual room background. These are static
expression poses, not skeletal animation, Live2D, or a continuous talking loop.

The four original PNG files total approximately 7.7 MB. Fixed versioned HTTP
paths have immutable caching; API responses remain `no-store`. Future visual
replacements must use a new filename/version. No runtime CDN or remote font.
These are project-generated assets; this note does not grant an additional
third-party asset license or change the repository's existing license policy.

## Expanded runtime cast

The selected `rock-v2.png`, `small-ball-v2.png`, `trapper-v2.png` and
`value-bettor-v2.png` atlases have been copied here from the
[expansion asset catalog](../../../docs/design/pixel-night-v1/expansion-v1/README.md).
They cover 老周 / 程墨 / 苏蔓 / 韩烈, at 1536 × 1024 each, three equal cells.
No image pixels were changed; the original built-in imagegen prompts and alpha/cell
measurements remain in that catalog. All 12 additional cells pass its alpha and
no-side-edge-contact inspection. New atlas files total 7,698,524 bytes.

Rendering uses proportional per-character head anchors for different table widths.
Node static routes, Pages build/preview routes, 2–6 player rendering, English text,
and the lobby cast guide are covered by regression checks.
The rainy entrance remains a candidate, not a runtime background.

Writing: [character bible](../../../docs/character-bible-v1.md).
Next-stage art: [expression design and usage](../../../docs/design/pixel-night-v1/expression-plan-v1.md).
The six-state expression plan is **not implemented**; the runtime still uses three cells.

## Poker card back and readable faces (2026-10-05)

`card-back-v1.png` is a new original, opaque 1060 × 1484 PNG generated with the
built-in imagegen tool (not CLI), inspected and copied unchanged into this directory.
It is the decorative back for all hidden cards. Fixed Node/Pages routes use this
versioned local filename; no runtime dependency on the generator's output folder.
The original selected output was `exec-4fb21c66-0981-41dc-afc3-fec7a79d5d85.png`.

The front is intentionally **not a generated image**: `poker-cards.ts` renders one
rank plus one code-drawn SVG pip, with red hearts/diamonds and dark spades/clubs.
This keeps all 52 identities deterministic, readable by assistive technology,
and legible at small NPC sizes. The gold lower edge in the settlement marks a
publicly known hole card used among the engine's chosen best five.
No hidden card or AI intent selects an illustration.

Final generation prompt:

> Create one production-ready raster game asset: an ORIGINAL two-way symmetric playing card BACK for a pixel-art Texas Hold'em game called Night Table. A single FLAT front-facing portrait rectangle, 5:7 aspect ratio, filling the entire image edge to edge, with no surrounding mockup, no perspective, no rounded outside corners, no shadow outside the card. Deep midnight violet #1b1730 ground, antique brass #e7b866 geometric border, restrained teal #24554f accents and ivory #f3e6c7 highlights. Strong tasteful retro pixel-art clusters and crisp stepped edges, no blur, no gradients. Main design: a large elegant central diamond medallion containing a spade, mirrored night-window geometric ornaments above and below. Rotationally balanced composition. Broad bold ornament shapes that remain recognizable when reduced to a tiny 24 x 34 pixel game card. A clean double brass frame, dark breathing space between frame and medallion. Centered well-aligned layout. Sophisticated quiet casino atmosphere, visually compatible with a purple and green-felt pixel poker table. NO letters, NO numbers, NO words, NO logos, NO watermark, NO characters, NO extra cards. Opaque background. This is only decorative card-back artwork; no game information or card value.

The selected image is pixel-inspired ornament, not guaranteed mathematically
two-way identical. Orientation is fixed in the UI and carries no information.

## Wraith / 幽影 — Black Ghost I tribute (2026-10-05)

[deck-ghost-v1.png](deck-ghost-v1.png) is a new original, opaque two-panel
1499 × 1049 PNG generated with the **built-in imagegen tool**, inspected and
copied unchanged from `exec-713c78c3-2ad3-467b-8611-25ffe941c02f.png`.
Left: silver-white crescent/ribbon engraving on black. Right: a quiet black
face with a faint etched frame. It is an additional selectable skin, not a
replacement for an existing asset or a new default.

The user requested a Black Ghost first-edition homage. Reference boundaries:
[Ellusionist's current product page](https://ellusionist.com/products/bicycle-black-ghost-deck-playing-cards)
is explicitly **Second Edition**, although its description discusses the
original release. A [collector comparison](https://www.playingcardforum.com/index.php?topic=7894.0)
reports similar basic card designs across the two editions. We use the
black/white, inverted-print direction as inspiration, not as evidence of an
exact first-edition reconstruction. No reference photograph or brand artwork
was imported into the game. This is not an official Bicycle or Ellusionist deck.

The signature is the original mirrored crescent-and-ribbon back. The face uses
silver-white SVG pips and a readable red rank for hearts/diamonds, white for
spades/clubs. Shape and accessible labels remain explicit. Black paper,
silver edges and a dark card shadow are scoped to this skin; other decks keep
their existing red/black treatment. No new court illustrations, jokers, card
marking, game commands or hidden-information behavior.

Five presets now fit the desktop gallery, with two columns on phones. Both
language catalogs and fixed Node/Pages asset routes include the new skin.
Manual selection, mix-and-match, browser-local preferences and the public
`setSceneDeck('ghost')` hook work as before. No existing level automatically
selects Wraith; scene recommendations and original defaults are unchanged.

Final prompt:

```text
Use case: stylized-concept
Asset type: production-ready original poker game card texture atlas, exactly TWO equal-width portrait panels, LEFT a card BACK and RIGHT a matching blank card FACE.
Primary request: an original homage to the early Black Ghost first-edition aesthetic of inverted black playing cards: deep black, spectral white engraving, eerie elegance and restrained traditional playing-card filigree. This is NOT a branded reproduction.
Composition: landscape canvas ratio 10:7, divided at the exact vertical midpoint into two equal 5:7 portraits. Both panels fill the image edge to edge. No space, no gutters, no surrounding tabletop, no perspective, no shadows between panels, no rounded cutouts. The left and right halves must be perfectly usable as separate card backgrounds by CSS.
LEFT / BACK: matte ink-black ground #0d1014; fine bone-white and smoky silver engraved linework. Original two-way symmetrical design: two oval medallions stacked vertically, each containing a slender crescent entwined with wispy serpentine ribbons, the lower motif rotated 180 degrees. Delicate acanthus scrollwork and ghostly loops fill the outer frame. A thin double white rectangular frame inside a clean BLACK outer margin. Preserve large black voids between fine lines. Absolutely no red, purple, gold or blue ink on the back.
RIGHT / FACE: almost entirely quiet matte black #0d1014, even under software-rendered white ranks in the upper-left and a large white suit at lower center. Extremely faint gray corner etching and thin inset gray frame only. The interior 85% stays dark and unmarked. No large medallion, no central logo. The game will draw card values itself.
Style/medium: crisp monochrome engraved printed playing-card artwork, subtle dark paper tooth, no glow, no 3D, no cinematic lighting.
Constraints: both cards are BLACK, not ivory. No text, no letters, no numbers, no suit pips, no kings or queens, no mockup, no tuck box, no Bicycle logo, no cycling angels, no Ellusionist mark, no copied commercial back design, no watermarks. Flat front-on asset, professional ink engraving, exact equal-panel layout.
```

## Interchangeable engraved decks (2026-10-05)

Three original two-panel PNG atlases, generated with the **built-in imagegen**
tool (not CLI), visually inspected and copied unchanged into this directory:

| Asset | Face / back direction | Intended use |
| --- | --- | --- |
| [deck-lantern-v1.png](deck-lantern-v1.png) | Warm paper, crimson lanterns and foliage | Friendly club; tutorial recommendation |
| [deck-blue-hour-v1.png](deck-blue-hour-v1.png) | Cool ivory, indigo gramophones and wave lines | Jazz room; story-prologue recommendation |
| [deck-jade-v1.png](deck-jade-v1.png) | Rice paper, jade/gold ginkgo leaves | Optional collector look; future salon level |

All three outputs are 1499 × 1049, approximately 10:7. The left half is the back;
the right half is blank face artwork. CSS selects a half with a 200% background
width; no pixel editing or runtime remote assets. Approximate combined size: 7 MB.
At tiny card sizes the frame and motif simplify naturally. These are engraved,
print-inspired textures, not mathematically exact pixel grids or perfect two-way
manufacturing masters. No card identity or orientation is encoded in the art.

Reference: [Bicycle's official Rider Back glossary](https://de.bicyclecards.com/glossar/rider-back/)
and [official catalog](https://de.bicyclecards.com/wp-content/uploads/sites/2/2024_Bicycle-Katalog_Magic.pdf).
The reference informs printed-card color, framing and balanced composition only.
No brand asset was imported; no logo, cycling angel or claim of affiliation.
Suit pips and all 52 ranks still come from `poker-cards.ts`, including accessible labels.
These are blank-face textures with code-drawn ranks/pips, **not 52 painted cards
or separate J/Q/K court illustrations**.

### Integration and level hooks

- Open **牌组外观 / Deck style**. Choose a matched set or combine a face and back.
- Default remains the original Night Table deck. Preferences use only
  `holdem.deck-style.v1`; changing a skin never redraws game controls, submits a
  command, consumes RNG or writes the game checkpoint.
- Scene following is opt-in. Current public mapping: tutorial → lantern;
  story prologue → blue-hour; free play/lobby → night. Jade remains a manual option.
- Future levels may call `setSceneDeck('jade')` on the presentation controller.
  A manual choice takes priority until scene following is re-enabled.
  This does not introduce a new level, unlock system or card-marking mechanic.
- To add a deck: register a fixed ID in `deck-skins.ts`, add scoped face/back
  variables in `deck-skins.css`, translations and allowlisted Node/Pages paths.
  Never derive a back design from a rank, hidden card, AI intent or future event.
- Existing conservative build fingerprints still cover UI modules: this update
  does not change save format, but a prior-build checkpoint may fail compatibility.
  Do not erase or silently migrate such a checkpoint.

### Generation prompts

<details>
<summary>lantern — final built-in generation prompt</summary>

Use case: stylized-concept. Asset type: production game playing-card texture atlas. Create a flat 1600x1120 landscape raster with EXACTLY TWO equally sized 800x1120 portrait rectangles side by side, each a 5:7 card. The LEFT half is the decorative card BACK, the RIGHT half is a BLANK matching card FACE to receive code-rendered rank and suit later. No gutter, no margins outside these two rectangles, no perspective, no card shadows, no rounded exterior corners. The vertical split must be exactly 50 percent of the image. Both halves fill their rectangle completely edge to edge. Original vintage playing-card design, classic American printed-card heritage with an indie pixel-art game sensibility: precise stepped engraved lines, limited screen-printed colors, restrained fine ornament and strong silhouette. LEFT: two-way balanced ornament, even narrow ivory border, ample contrast and central bold ornaments legible when scaled down. RIGHT: almost entirely clean light ivory paper with only an extremely faint central watermark and a delicate frame at the outermost 2 percent; leave the upper-left 40 percent and lower-right 40 percent blank and clean for readable game values. NO text, NO letters, NO numbers, NO suit pips printed on the right half, NO brand logos, NO Bicycle branding, NO bicycles, NO angels, NO watermark signature. Opaque image. This is usable source artwork, not a mockup or presentation board. Theme: LANTERN CLUB. Crimson ink #a52c37 and warm ivory #fff3d9. LEFT: two inverted original old brass-lantern silhouettes enclosed in interlocking oval guilloche wreaths, curling acanthus leaves, tight red-and-ivory engraved border. Strict red/ivory duotone engraving; elegant not grungy. RIGHT: warm ivory #fff8e9 paper, a very pale rose thin ornamental frame, tiny faded lantern medallion centered. A welcoming old card room.

</details>

<details>
<summary>blue-hour — final built-in generation prompt</summary>

Use case: stylized-concept. Asset type: production game playing-card texture atlas. Create a flat 1600x1120 landscape raster with EXACTLY TWO equally sized 800x1120 portrait rectangles side by side, each a 5:7 card. The LEFT half is the decorative card BACK, the RIGHT half is a BLANK matching card FACE to receive code-rendered rank and suit later. No gutter, no margins outside these two rectangles, no perspective, no card shadows, no rounded exterior corners. The vertical split must be exactly 50 percent of the image. Both halves fill their rectangle completely edge to edge. Original vintage playing-card design, classic American printed-card heritage with an indie pixel-art game sensibility: precise stepped engraved lines, limited screen-printed colors, restrained fine ornament and strong silhouette. LEFT: two-way balanced ornament, even narrow ivory border, ample contrast and central bold ornaments legible when scaled down. RIGHT: almost entirely clean light ivory paper with only an extremely faint central watermark and a delicate frame at the outermost 2 percent; leave the upper-left 40 percent and lower-right 40 percent blank and clean for readable game values. NO text, NO letters, NO numbers, NO suit pips printed on the right half, NO brand logos, NO Bicycle branding, NO bicycles, NO angels, NO watermark signature. Opaque image. This is usable source artwork, not a mockup or presentation board. Theme: BLUE HOUR. Deep indigo ink #243d75 and chalk ivory #f3f4ef. LEFT: two inverted original gramophone horns inside concentric circular rosettes, musical wave-line filigree (no literal notes or text), symmetrical Art Deco corner fans. Strict blue/ivory duotone engraving. RIGHT: clean cool ivory #f6f8f5 paper, thin pale blue double-rule frame and extremely faint concentric rosette at exact center. A quiet late-night jazz lounge. Visually distinct circular rhythm rather than floral red-deck layout.

</details>

<details>
<summary>jade — final built-in generation prompt</summary>

Use case: stylized-concept. Asset type: production game playing-card texture atlas. Create a flat 1600x1120 landscape raster with EXACTLY TWO equally sized 800x1120 portrait rectangles side by side, each a 5:7 card. The LEFT half is the decorative card BACK, the RIGHT half is a BLANK matching card FACE to receive code-rendered rank and suit later. No gutter, no margins outside these two rectangles, no perspective, no card shadows, no rounded exterior corners. The vertical split must be exactly 50 percent of the image. Both halves fill their rectangle completely edge to edge. Original vintage playing-card design, classic American printed-card heritage with an indie pixel-art game sensibility: precise stepped engraved lines, limited screen-printed colors, restrained fine ornament and strong silhouette. LEFT: two-way balanced ornament, even narrow ivory border, ample contrast and central bold ornaments legible when scaled down. RIGHT: almost entirely clean light ivory paper with only an extremely faint central watermark and a delicate frame at the outermost 2 percent; leave the upper-left 40 percent and lower-right 40 percent blank and clean for readable game values. NO text, NO letters, NO numbers, NO suit pips printed on the right half, NO brand logos, NO Bicycle branding, NO bicycles, NO angels, NO watermark signature. Opaque image. This is usable source artwork, not a mockup or presentation board. Theme: JADE SALON. Deep jade #1b594d, muted antique gold #c2a467, pale rice ivory #f4f0d9. LEFT: a strong symmetrical diamond medallion filled with interlaced ginkgo leaves and four mirrored botanical fans, fine jade and gold engraving, graceful layered nested borders. The diamond/leaf motif is bold and readable, unlike a circular medallion. RIGHT: pale rice ivory paper, hairline jade-and-antique-gold stepped frame, extremely faint botanical diamond watermark at center. Collector-quality private salon deck; warm, calm and tactile. No dark face background.

</details>
