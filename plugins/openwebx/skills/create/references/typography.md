# Typography

Type carries half the art direction. Choose the **display** face for the
theme, the **body** face for long reading, and a **label** face for folios,
tags and small print. When the content is Thai (or Lao, Khmer, Myanmar), pair each Latin face
with a face for that script in the same spirit. Font stacks list the Latin
face first and the script face second, so each glyph falls back correctly.

All families below were verified against the Google Fonts CSS2 API with the
listed weights (2026-09). Requesting a weight a family lacks makes Google
return HTTP 400, and that family then fails to load. Stay within the listed
weights, or run `qa.py --online`, which fetches every font URL.

## Latin families

| Mood | Display | Weights (italic) | Body / label partners |
|---|---|---|---|
| Editorial, luxury, quiet | Instrument Serif | 400 (+italic) only | Hanken Grotesk 300/400/500, DM Mono 300/400/500 |
| Classical, literary, epic | Cormorant Garamond | 300/400/600 (+italic) | EB Garamond 400/600 (+italic), IBM Plex Mono 400 |
| Warm, organic, expressive | Fraunces (variable) | `300..700`, opsz `9..144` | Inter 400/500, JetBrains Mono 300/400 |
| Inscription, monumental | Cinzel (capitals only) | 400/600/700 | EB Garamond body, IBM Plex Mono labels |
| Fashion, high contrast | Playfair Display / DM Serif Display | 400/700 · 400 (+italic) | Manrope 300/400/600 |
| Tech, precise, scientific | Space Grotesk | 300/400/500/700 | IBM Plex Mono 300/400/500 |
| Loud, futuristic, poster | Unbounded / Syne | 300/500/800 · 400/600/800 | Inter 400, JetBrains Mono 400 |
| Friendly modern | Sora / Bricolage Grotesque | 300/400/600 · 300/400/700 | Manrope 400 |
| Retro digital | Press Start 2P / VT323 | 400 only | Space Mono 400/700 |
| Japanese minimal | Shippori Mincho | 400/600 | Inter 400 |

## Thai families

| Mood | Thai display | Weights | Thai body |
|---|---|---|---|
| Editorial serif, classical | Trirong / Taviraj | 300/400/600 (+italic) | Sarabun 300/400/500 or IBM Plex Sans Thai |
| Modern serif, readable | Noto Serif Thai | 300/400/600/700 | Noto Sans Thai 300–600 |
| Humanist sans | Anuphan / IBM Plex Sans Thai | 300–600 | IBM Plex Sans Thai Looped 300–500 (with loops, easier for long reading) |
| Tech / futuristic | Chakra Petch / Bai Jamjuree | 300–600 | IBM Plex Sans Thai |
| Ornate, ceremonial, fantasy | Srisakdi (display only) | 400/700 | Pridi 300/400/600 |
| Poster, bold | Chonburi (display only) / Kanit / Prompt | 400 · 300–600 | Sarabun |
| Playful | Mali / Itim | 300/400/600 · 400 | K2D / Niramit |
| Script accent (sparingly) | Charm | 400/700 | none (accent only) |

Rules for Thai:
- Never use letter-spacing on Thai text: it detaches the vowels and tone marks. The kit resets tracking under `:lang(th)`.
- Display line-height ≥ 1.25 and body line-height ≥ 1.7. The kit sets both, and they must not be overridden lower.
- No `text-transform: uppercase` expectations: Thai has no case, so mono/label styling needs another cue (colour, size, rule lines).
- Word splitting uses `Intl.Segmenter`, and punctuation stays with the word before it. Thai, Lao, Khmer and Myanmar headings are not split (word spans would add line breaks inside compounds such as ดวงจันทร์); they keep native line breaking and rise as one block.
- Use a looped face (IBM Plex Sans Thai Looped, Noto Sans Thai Looped, Sarabun) for long body text when the audience is general Thai readers. Loopless faces suit short display lines.

## Borrowed house styles
A typeface set lifted whole from a well-known showcase makes the page read as
a copy of it. Choose each face for this theme. In particular, **Instrument
Serif + Inter Tight + JetBrains Mono together** is rejected by `qa.py`; any one
of them alone is fine when the theme calls for it.

## `brief.fonts` shape
```json
"fonts": {
  "display":      { "family": "Cormorant Garamond", "weights": [300, 400, 600], "italic": true, "fallback": "serif" },
  "body":         { "family": "EB Garamond", "weights": [400, 600], "italic": true, "fallback": "serif" },
  "mono":         { "family": "IBM Plex Mono", "weights": [400], "fallback": "monospace" },
  "thai_display": { "family": "Trirong", "weights": [300, 400, 600], "fallback": "serif" },
  "thai_body":    { "family": "Sarabun", "weights": [300, 400, 500], "fallback": "sans-serif" }
}
```
For a variable range, set `"weights": "300..700"`. For a system font with no network request, set `"source": "system"`.

## Scale and rhythm (magazine)
- Scale ratio 1.333: the opening headline is the largest thing on the page,
  chapter headings clearly smaller, body text calm. Contrast in size does the
  work; decoration does not.
- Measure: Latin ≤ 62ch, Thai ≤ 34em. Body text is always left-aligned. Only
  the `interlude` line may be centred.
- Vary the page: a large chapter numeral in the margin of `paper` and
  `dossier`, a pull of the chapter's own words in `caption`, tabular figures in
  `ledger`.
- Display sizes are fluid clamps in `openwebx.css`. Adjust per theme through `brief.type.display_weight` / `display_tracking`, or in `theme.css`.
- Keep a ≤ 62ch measure for body text (`brief.type.measure`).
- Use one accent style only (italic *or* small caps *or* colour), not all three.
