# Creative brief spec

The director writes two files in the work folder:

- `brief.md`: the human-readable creative brief, shown to the user and kept in
  `_openwebx/` of the site;
- `brief.json`: the machine brief that `scaffold.py` renders and the builder
  implements.

## brief.json

Required fields: `palette.bg`, `palette.ink`, `palette.accent`, `chapters`.
Every other field has a sensible default, but a good brief sets all of them.

```json
{
  "theme": "Lord of the Rings",
  "slug": "ember-road-first-summit",
  "title": "เดินป่าขึ้นดอยครั้งแรก: คู่มือเตรียมตัวฉบับสมบูรณ์",
  "description": "คู่มือเดินป่าขึ้นดอยครั้งแรก ตั้งแต่เลือกเส้นทางจนถึงมารยาทบนเส้นทาง",
  "lang": "th",
  "content_type": "article",
  "brand": "Trail Notes",
  "intensity": "cinematic",
  "concept": {
    "name": "The Ember Road",
    "form": "path",
    "logline": "An ember carried from the valley to the summit; each chapter climbs one realm.",
    "ip_mode": "inspired-by",
    "ip_note": "Inspired by the mood of high-fantasy epics: an original world, no franchise names or marks.",
    "avoid_terms": ["Lord of the Rings", "Middle-earth", "Mordor", "Frodo", "Gandalf", "Sauron", "Tolkien", "Hobbit", "Shire", "Rivendell", "Gondor"]
  },
  "palette": {
    "scheme": "dark",
    "bg": "#0e0d0b", "surface": "#171511", "ink": "#ece3cc", "muted": "#9b937f",
    "accent": "#c9a45c", "accent2": "#b4532a",
    "line": "rgba(236,227,204,.14)", "scrim": "rgba(10,9,7,.72)"
  },
  "fonts": {
    "display": { "family": "Cormorant Garamond", "weights": [300, 400, 600], "italic": true, "fallback": "serif" },
    "body": { "family": "EB Garamond", "weights": [400, 600], "italic": true, "fallback": "serif" },
    "mono": { "family": "IBM Plex Mono", "weights": [400], "fallback": "monospace" },
    "thai_display": { "family": "Trirong", "weights": [300, 400, 600], "fallback": "serif" },
    "thai_body": { "family": "Sarabun", "weights": [300, 400, 500], "fallback": "sans-serif" }
  },
  "chrome": {
    "contents": "list",
    "folio": "value-name",
    "values": ["หุบเขา", "ทางแยก", "พักหายใจ"],
    "arrival": "scene",
    "tags": "anchored",
    "sound": "offer",
    "sound_label": { "off": "ฟังลมบนสันดอย", "on": "พักเสียงลมไว้ก่อน" },
    "reasons": {
      "contents": "A guide people come back to: a plain list lets them jump to packing.",
      "folio": "Each chapter is a stage of the climb, so the running head names the stage.",
      "arrival": "The ember kindles while the world loads.",
      "tags": "Trail and gear names sit beside the objects.",
      "sound": "Wind and a bell suit the ridge; offered, never forced."
    }
  },
  "arrival_status": "ภาพเส้นทางขึ้นดอยพร้อมแล้ว",
  "reading": "interleave",
  "look": {
    "fidelity": "cinematic-real",
    "quiet": 0.6,
    "lighting": "hdri",
    "cc0": [
      { "type": "hdri", "id": "table_mountain_1", "res": "1k", "role": "dawn sky and ambient light" },
      { "type": "texture", "id": "forest_ground_04", "res": "1k", "role": "trail surface" }
    ],
    "post": { "bloom": { "strength": 0.3, "threshold": 0.85 }, "grain": 0.045, "vignette": 0.3, "grade": { "warmth": 0.25 } },
    "camera": { "fov": 35 }
  },
  "type": { "display_weight": 300, "display_tracking": "-0.01em", "leading": 1.8, "measure": "60ch", "radius": "2px" },
  "hero": { "eyebrow": "บันทึกการเดินทาง · บทที่หนึ่ง", "lede": "ถือถ่านไฟดวงเล็กไว้ แล้วเริ่มก้าวแรก" },
  "chapters": [
    { "name": "หุบเขา", "composition": "opening", "side": "left", "sections": ["s00"],
      "beat": "A lantern on a parchment map inside a small valley diorama; dusk light from the right.",
      "interaction": "Hold to kindle the lantern; release sends sparks along the map's trail." },
    { "name": "ทางแยก", "composition": "paper", "side": "left", "sections": ["s01"], "eyebrow": "เลือกเส้นทาง",
      "beat": "(world hidden behind paper) the diorama turns to the fork while the reader reads." },
    { "name": "ลมหายใจ", "composition": "interlude", "side": "center", "display": "ภูเขาไม่รีบ เราก็ไม่ต้องรีบ",
      "tone": "night", "frame": "bleed",
      "beat": "Close on the lantern glass; embers drift upward with the scroll speed." }
  ],
  "sound": { "pitch": 0.75, "cues": { "turn": { "release": 2.4 }, "touch": { "level": 0.1 } } },
  "scene": {
    "hero": { "source": "procedural", "detail": ["brass lantern with a riveted cage", "hand-inked contour map on creased paper", "glass chimney with soot at the rim"] },
    "ember": { "color": "#ffb46b", "count": 900 },
    "mist": { "layers": 3, "color": "#2a2620" },
    "zones": ["valley", "forest", "ridge", "pass", "summit"]
  },
  "assets": [],
  "canonical": null,
  "og_image": null,
  "footer": "Trail Notes · คู่มือเดินป่า"
}
```

Field notes:
- `chapters[].sections` must cover every `content.json` section exactly once,
  in order. `interlude` chapters hold no sections.
- `concept.form` is a string, or a list of at most two, from `path`,
  `stage`, `assembly`, `map`, `hours` (see `forms.md`).
- `reading`, `chapters[].composition`, `side`, `tone` and `frame`: see
  **Reading and composition** below.
- `scene.hero` (required by `qa.py` Q-hero): what the hero object is made of.
  Either `{ "source": "cc0", "id": "<Poly Haven model id>" }` or
  `{ "source": "procedural", "detail": ["<concrete feature>", …] }` with at
  least 3 concrete features (materials, wear, parts). Flat extrusions,
  untextured primitives and blocky stand-ins fail the critic (D-hero).
- `look.quiet` (0..1, default 0.6): strength of the quiet zone that keeps
  text over the world legible (darker, softer, less saturated under the text
  only).
- `palette.paper` / `palette.paper_ink` (optional; default `surface` / `ink`):
  the opaque surface of paper, spread and ledger chapters.
- `chapters[].params` (optional, free-form) is passed to the scene as
  `brief.chapters[i].params`.
- `scene` is free-form: whatever the builder needs, kept declarative
  (numbers, colours, names). It is how a refine request ("more mist") becomes
  a one-line edit.
- `intensity`: `restrained` means one hero effect, slow motion and fewer
  particles; `cinematic` is the default; `maximal` allows two hero effects,
  richer ambient life and a stronger camera. This changes behaviour, not
  budgets: perf budgets still apply.
- `chrome` chooses the contents, folio, arrival, tags and sound forms per
  brief (see `chrome.md` for how to choose, and **`chrome` reference** below
  for the exact schema). Set every key deliberately, with a reason.
- `arrival_status` (optional): one sentence announced to screen readers when
  the world is ready. Default from the UI language table.
- `sound.pitch` shifts every cue; `sound.cues.<name>` tunes a cue recipe
  (fields in `runtime-api.md`, **Sound**).
- `ui` (optional) overrides words the kit writes: `skip`, `contents`,
  `contents_lead`, `ready`, `sound_label`, and for the `sentence` contents
  `list_sep`, `list_and`, `sentence_end`.
- `look` sets rendering fidelity, lighting, CC0 assets, post finish and
  lens. See `rendering.md`. The default fidelity is `cinematic-real`. Pick
  the `cc0` ids with `fetch_cc0.py search`, and never invent an id.
- `assets[]`: `{ "src": "<absolute path>", "role": "texture|card|hero" }`.
  Scaffold copies each one and records its `as` path in
  `_openwebx/assets.json`.
- Copy fields follow the content language.

## Reading and composition

`reading` (the reason goes in `chrome.reasons.reading`):

| Value | Behaviour | Default when |
|---|---|---|
| `interleave` | Long chapters sit on opaque paper in the page flow; between them the world takes the screen with short text. The world is not rendered while paper covers the viewport | more than 900 words (3,600 Thai characters) in all, or any chapter over 180 words (720 Thai characters) |
| `overlay` | Text directly over the world, no box; a quiet zone under the text keeps it legible | otherwise |
| `beside` | Split screen: the world sticky on the right (desktop 54% width; mobile the top 52svh, above the page, with the text scrolling up under it), text scrolls on the left. No overlap by construction | never by default; for spec-like or comparison content |

Length is counted in units: one Latin word, or four Thai characters.

`chapters[i].composition` and `chapters[i].side`:

| Composition | Use | Rules |
|---|---|---|
| `opening` | chapter 0 only (default there) | largest display headline, lede, then contents and the sound offer |
| `paper` | long reading | opaque paper, narrow column, large numeral in the margin |
| `spread` | medium reading | two columns on paper, heading across both (one column below 900px) |
| `ledger` | tables, long lists, specs | full measure on paper, tabular figures, hairline rules |
| `caption` | short text over or beside the world | at most 60 words (240 Thai characters); a museum label in one corner |
| `dossier` | one collection item | at most 180 words (720 Thai characters); meta row (`eyebrow`), heading, body in a narrow column on `side` |
| `interlude` | a single display line (`display`) | no sections, at most 20 words; the only centred text; aria-hidden |

- `side` ∈ `left · right · center`; `center` only for `opening` and `interlude`.
- **No two consecutive chapters may share the same (composition, side).**
- Defaults when omitted: chapter 0 `opening`; a chapter without sections
  `interlude`; one holding a table `ledger`; ≤ 60 words `caption`; ≤ 180
  words `dossier` (overlay and beside) ; ≤ 400 words `spread`; longer `paper`.
  Sides alternate left/right (opening left, interlude center).
- Text over a composition's limit is a `BriefError` that says to use paper,
  spread or ledger (qa.py repeats the check as Q-length).
- `tone` (optional): `night` (a deliberately dark chapter; the light gate's
  mean floor drops to 0.05) or `bright` (ceiling 0.92).
- `frame` (optional): `fit` (default) or `bleed` (the subject may run past
  the frame; the framing gate is skipped).
- Removed in 0.2.0 (rejected with a migration hint): `layout` (`hero` →
  `opening`, `breath` → `interlude`, `wide` → `ledger` or `paper`,
  `left`/`right` → `side`, `center` → `interlude`) and `panel` (drop it).

## `chrome` reference

| Key | Options (default first) | What the scaffold writes |
|---|---|---|
| `contents` | `list` · `sentence` · `none` | `list`: `<nav id="contents">` in chapter 0 after the verbatim content, with a label and an `<ol>` of `#ch-N` links. `sentence`: one sentence, `contents_lead` followed by the chapter links. `none` is allowed only for single-chapter pieces (the scaffold rejects it otherwise). Interludes and chapter 0 are not listed |
| `folio` | `name` · `number-name` · `value-name` · `none` | The first element of every chapter section: a running head at the head of its section (it scrolls with the chapter), linking to `#contents`. `number-name` = "3 / 8 · Name" (no zero padding); `value-name` = `values[i]` + name |
| `values` | one string per chapter | Authored per-chapter values (hours of a day, stages of a climb). Required for `value-name`; also shown in the `list` contents. Never invent factual numbers the content does not state |
| `arrival` | `veil` · `scene` · `hold-title` | `html[data-arrival]`. `veil`: text at once, canvas fades in when ready. `scene`: canvas visible at once, the scene visualises loading. `hold-title`: the hero headline's words wait (at most ~2.6 s) and rise when the world is ready; never with reduced motion. Never a counter, bar or overlay |
| `tags` | `anchored` · `none` | `anchored`: the `.ox-tag` layer and its touch live region |
| `sound` | `offer` · `none` | `offer`: `<button class="ox-sound" aria-pressed="false">` in chapter 0 after the contents, labelled `sound_label.off` / `.on`. Sound starts off on every visit; nothing is persisted |
| `sound_label` | `{ "off": "…", "on": "…" }` | Short phrases in the theme's voice. Default: a neutral phrase from the UI language table. "Sound on/off" is rejected |
| `contents_lead` | string | Lead-in for `sentence` contents. Default from the UI language table |
| `reasons` | one line per key | Required by the director; copied into `brief.md`. The scaffold warns when a key has no reason |

Removed in 0.2.0 (the scaffold rejects them with a `BriefError` naming the
migration): `chrome.nav` → `contents` + `folio`; `chrome.nav_labels` →
`values`; `chrome.loader` and `brief.loader` → `arrival`; `chrome.readout` →
`folio`; `chrome.cursor`, `chrome.hold` and `brief.cursor` → `tags`;
`chrome.sound: "text" | "icon"` → `"offer"` with `sound_label`.

Every authored chrome word (`values`, `sound_label`, `contents_lead`,
`reasons`, `arrival_status`) is checked against `concept.avoid_terms`.

## brief.md template

```markdown
# <Concept name>: creative brief

**Theme:** <user theme> → <one-line interpretation> (inspired-by; no franchise marks)
**Content:** <type>, <n> sections, <lang>, ~<words> words
**Form:** <form(s)> because <reason tied to the content's shape>

## The idea
<3–5 sentences: what the viewer experiences from first frame to last.>

## Visual language
- World / materials / light / atmosphere: …
- Palette: bg … · ink … · accent … · accent2 … (contrast ink/bg = x:1)
- Type: display … / body … / labels … (+ Thai pairing)
- Motion verbs: …
- Sound palette: … (cue tuning, the offer's wording)
- Reading: interleave / overlay / beside because …
- Hero object: cc0 <id> / procedural: <3+ concrete features>

## Chrome
| Key | Choice | Reason |
|---|---|---|
| contents | … | … |
| folio | … | … |
| arrival | … | … |
| tags | … | … |
| sound | … | … |

## Chapter plan
| # | Chapter | Sections | Composition / side | Scene beat | New interaction |
|---|---|---|---|---|---|

## Signature moments
1. <the moment people will remember>
2. …

## Guardrails
- Performance: <budget on high/mid/low>
- Reduced motion: <what changes>
- Mobile: <what changes>
- IP: avoid_terms = …
```
