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
Other NPCs deliberately use a named silhouette until their own art is approved.

PNG alpha was decoded and checked: each atlas has genuine alpha-zero background
and a substantial near-opaque foreground (mostly alpha 252–253, not 255).
Browser QA checks the composite on the actual room background. These are static
expression poses, not skeletal animation, Live2D, or a continuous talking loop.

The four original PNG files total approximately 7.7 MB. Fixed versioned HTTP
paths have immutable caching; API responses remain `no-store`. Future visual
replacements must use a new filename/version. No runtime CDN or remote font.
These are project-generated assets; this note does not grant an additional
third-party asset license or change the repository's existing license policy.
