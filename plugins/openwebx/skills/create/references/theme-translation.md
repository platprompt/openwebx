# Theme translation

The user gives a theme in a few words ("Lord of the Rings", "ร้านชาญี่ปุ่น",
"deep sea", "Bauhaus", "90s arcade"). The director turns it into a **visual
language**: the set of motifs every later decision draws from. A theme is
never only a palette.

## 1. Extract the motif sheet
Fill every row. Each entry should be concrete enough to build.

| Row | Question | Example: epic fantasy journey (inspired by LOTR) |
|---|---|---|
| World | Where are we, physically? | Mountain passes, ancient forests, ruined stone halls, a distant ember-lit peak |
| Materials | What is it made of? | Weathered parchment, hammered gold, moss-covered granite, woodsmoke |
| Light | What is the key light, and what are the accents? | Low golden dusk light; ember glow; cold moonlit blue for danger |
| Palette | 5 colours with roles (bg, ink, muted, accent, accent2) | Charcoal `#0e0d0b`, parchment `#e9dfc7`, lichen grey `#8d8a7c`, gilt `#c9a45c`, ember `#b4532a` |
| Atmosphere | What does the air contain? | Drifting ash and pollen, low valley mist |
| Motion verbs | How do things move? | Drift, smoulder, unfurl, echo. Nothing snappy |
| Signature object | One object that could stand for the page | A traveller's lantern carrying an ember (never a ring: a franchise's central symbol is off-limits even in "generic" form) |
| Type voice | Display, body, accent faces | A classical inscription serif for display, a humanist serif for reading, small caps for labels |
| Sound palette | What would it sound like? | A low bowed drone, a soft bell on chapter change, wind for the whoosh |
| Copy voice | How do folios, tags and the sound invitation talk? | Like chapter headings in an old travel journal |
| Verb | What does the reader do to the signature object? | Kindle: hold to make the ember brighter |

## 2. Inspired-by only (IP rule, always on)
The plugin is free and its sites are public, so franchise themes are
interpreted, never copied.

**Allowed:** genre and era cues, materials, landscapes, colour moods, generic
symbols (mountains, rings of light, runic-looking abstract glyphs you draw
yourself), public-domain typefaces, original compositions.

**Never:**
- franchise names, character or place names, or quotes in authored copy (folios, tags, sound invitation, eyebrows, chapter names, brand);
- logos or insignia;
- the franchise's own typeface or a font made to imitate it (e.g. "Aniron", "Ringbearer");
- recreated maps, and the actual scripts or alphabets of fictional languages;
- soundtrack references;
- screenshots or copyrighted images;
- the franchise's **signature symbol**, even as a "generic" version (the
  ring of a ring saga, the lightsaber of a space saga, the lightning scar of a
  wizard saga). When a motif is the first thing people associate with the
  franchise, choose a different one.

**Context stays the user's.** The theme lends mood, light, material and
pacing. It never replaces the subject of the content. A Thai hiking guide in
an epic-fantasy mood is still about Thai mountains (ดอย, ทะเลหมอก, ป่าดิบเขา,
จุดชมวิว). It is not a quest to destroy anything.

List every forbidden proper noun in `concept.avoid_terms`. Scaffold and QA both
reject authored copy that contains one of them. Text from the user's content
is exempt, because it is theirs.

Say what you did in the brief: "Inspired by the mood of high-fantasy
epics: our own world, no franchise names or marks."

## 3. From motif sheet to decisions
- **Form:** pick by the content's shape first (see `forms.md` quick map), then let the theme choose between the top two.
- **Palette → tokens:** the bg/ink contrast must pass WCAG AA for body text (4.5:1). Test ink against bg, and against scrim over the brightest part of the scene.
- **Type:** see `typography.md`. For Thai content, pair each Latin face with a Thai face in the same spirit.
- **Materials → shaders:** every material row becomes one shader idea (parchment = fbm grain plus a warm vignette; gilt = fresnel rim plus a slow specular sweep).
- **Motion verbs → easing:** drift = long damping (λ 1.5–3); snap-back = spring; smoulder = noise-modulated emissive.
- **Signature object → what the reader holds** (carried along a Path, placed on a Stage, completed by an Assembly) and where the ending resolves it.

## 4. Worked mini-examples
- **"Japanese tea house" + product page** → Stage lit by Hours. One cup on a
  low table by a paper screen; morning to evening light moves across it as the
  sections pass. Tokens: washi white `#f4f0e6`, sumi ink `#1d1b18`, matcha
  `#7a8b4f`, lacquer red `#8f2e22`. Verb: pour (hold to fill the cup, the
  steam answers). Display face: Shippori Mincho.
- **"Bauhaus" + agency portfolio** → Assembly. Primary red, yellow and blue on
  off-white; each project adds one geometric part to a single composition
  that is complete at the end. Verb: place. Display face: a geometric grotesk.
- **"Monsoon" + Thai SEO article about rice farming** → Path through Hours.
  The reader walks a paddy dyke from planting to harvest while the rains come
  and go; each H2 is one field on the way. Verb: part (the rain curtain opens
  where the pointer rests). Display: Trirong with a Latin serif.
