# Optional composition expansion

Copy this prompt into regular ChatGPT and return its JSON. Implementation continues independently; this adds musical repertoire without spending coding credits on composition drafts.

---

Act as an experienced jazz/electronic game composer. Write original, playable eight-bar melodic variations for a private multiplayer card lounge called Venatus. Desired sound: warm electric piano/Rhodes, upright-style bass, vibraphone, soft analog pads, brushed/broken-beat drums; tension builds cinematically for public reveals. Avoid copying any existing game or song. Do not promise audio recordings; deliver exact note data.

Engine contract: 4/4, 16 sixteenth-note positions per bar. Melody: integer MIDI note or null at each position; monophonic. Bass and chord voicings are already implemented. Your task is melody only. Leave at least 6 nulls per bar, include recurring motifs, call-and-response, passing notes and rests. Range MIDI 60–84. Avoid mechanical constant arpeggios, random pitch walks, perpetual climax and shrill high notes. Phrase ends should breathe. Do not add private-hand-based music cues.

Create one eight-bar melody per theme, aligned to these exact chords (one chord each bar; repeat after bar eight):

1. poker: 86 BPM, gentle swing. Dm9 – G13 – Cmaj9 – A7b9 – Bbmaj9 – Em7b5 – A7b9 – Dm9. Late-night Rhodes with restrained confidence.
2. chromatic: 112 BPM, very light swing. Fm9 – Abmaj9 – Bbm9 – C7b13 – Fm9 – Dbmaj9 – Bbm9 – C7b13. Playful electronic groove, syncopated plucked lead.
3. bluff: 78 BPM, gentle swing. Cm9 – Abmaj9 – Fm9 – G7b9 – Cm9 – Dm7b5 – G7b9 – Cm9. Sparse, sly vibraphone; tension comes from space.
4. rummy: 94 BPM, lightly swung. Fmaj9 – Dm9 – Gm9 – C13 – Am9 – Dm9 – Gm9 – C13. Warm Rhodes, flowing and unhurried.
5. ohhell: 90 BPM, gentle swing. Gm9 – Cm9 – F13 – Bbmaj9 – Ebmaj9 – Am7b5 – D7b9 – Gm9. Airy vibes, a reflective melody with a satisfying return.

Return only a valid JSON object with `themes`, an array of five objects. Each object must have `id` (poker/chromatic/bluff/rummy/ohhell), `title`, `melody` (exactly eight arrays of exactly 16 MIDI integers or nulls), and `compositionNotes` (at most 60 words explaining motif, harmony and space). Verify every array length, note range and minimum six rests per bar before returning. No prose outside JSON, no code and no invented audio links.
