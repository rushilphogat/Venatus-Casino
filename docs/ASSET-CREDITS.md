# Experience assets

- `public/assets/avatars.webp`: 24 original illustrated portraits in a 6-column, 4-row atlas, produced with the built-in OpenAI image-generation tool and encoded to WebP. The local source is `public/assets/avatars.png`; only the optimized WebP ships. No third-party character art is used.
- Avatar generation brief (reconstructed from the implementation record): "Create one cohesive 6 × 4 sprite sheet of 24 cute, hand-inked indie card-game profile portraits. Warm paper, ink-blue outlines, muted coral, mint and violet accents. Equal square cells, consistent face framing. Characters in order: fox, midnight cat, frog, capybara, owl, ghost, red panda, robot, rabbit, bear, dragon, axolotl, raccoon, seal, mushroom, penguin, bat, otter, shiba, turtle, tiger, cardinal, alien, cloud. No labels, text, logos or external characters." The original tool prompt is retained in the originating chat, not reproduced verbatim here.
- `public/audio.js`: original procedural musical phrases, chord progressions, layers and sound effects synthesized locally with Web Audio. No soundtrack samples or external music service. Four themes; volume, mute and quiet Discord mix are device-local preferences.
- `public/personality.js`, `public/effects.css`: 39 curated comments and 15 implemented CSS scene motifs adapted from the user's two ChatGPT responses. Full selected storyboards and provenance labels are in `docs/CREATIVE-SELECTION.json`. Animation timing, authoritative outcomes, privacy and accessibility behavior are implemented separately; written storyboard suggestions do not execute as instructions.
- Existing Venatus logo: supplied by the user; proportions preserved.
- User-uploaded portraits: submitted by each player, cropped and re-encoded to bounded WebP thumbnails. Stored persistently alongside profiles, outside room snapshots.

There are no per-play AI calls, paid art subscriptions or remote soundtrack dependencies.
