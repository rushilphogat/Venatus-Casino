# Optional ChatGPT handoff — Venatus table personality

Copy everything below into regular ChatGPT. Return its JSON output to Codex. This is an optional content expansion; implementation does not wait for it.

---

You are a game writer and motion director. Create production-ready creative content for Venatus, a free private multiplayer browser card lounge played with friends in Discord voice chat. Its art direction is an expressive indie game: ink-blue scenes, warm paper cards, coral/mint/violet accents, cute hand-inked animal avatars, tactile cards and short theatrical reveals. Players are adults and students; humor should be witty, warm and concise. Avoid marketing copy, casino hype, corporate language, references to real money, abusive taunting and copied game catchphrases. No programming or external research is necessary.

Games: Texas Hold'em; Bluff (players claim a rank and 1–4 face-down cards; rank remains until all skip or a challenge resolves); Chromatic (street UNO rules, +2 on +2 and +4 on either); Indian Rummy; Oh Hell (predict tricks taken). Existing gameplay rules must remain unchanged.

Deliver ONE valid JSON object with these arrays:

1. `comments`: 60 distinct short bot/table quick comments, 12 per game. Each has `id`, `game`, `trigger`, `text`. Text at most 48 characters. Allowed triggers: round_start, public_all_in, public_win, public_loss, split_pot, bluff_caught, honest_claim, draw_stack, reverse, one_card, valid_declaration, exact_bid, overbid, rematch. Pick appropriate triggers per game. Comments must be true for that public event, never imply knowledge of anyone's hidden hand, never invent player actions, and never ridicule a losing player. Include some quiet reactions, not constant exclamation marks. No placeholders.

2. `scenes`: 15 distinct 2D/2.5D animation storyboards, three each for poker_showdown, bluff_caught, honest_claim, chromatic_finish, round_win. Each has `id`, `family`, `name`, `durationMs` between 1400 and 2800, `beats` (timestampMs, visual, audio), and `reducedMotionAlternative`. Use existing card faces, suits, chip tokens, flat lighting, paper textures and portrait frames. No expensive character rigs, video files, text paragraphs, rapid flashing or camera motion while the player must act. The readable result follows the animation for at least 6–8 seconds; do not include that hold in durationMs. Showdown must not imply a single winner when multiple pots exist. No imagery that represents a chip return or loss as a win.

3. `review`: five concise checks you applied to ensure variety, readability, hidden-information privacy and respectful humor.

Do not add music-generation prompts or change game rules. Output valid JSON without Markdown fences. All writing and storyboard concepts must be original. Check length and counts before returning.
