# Chrome

Chrome is how the reader finds their way and controls the page: the table of
contents, the running head of each chapter, how the page arrives, the labels on
scene objects and the sound control. In openwebx chrome belongs to the
**content** or to the **world**. Nothing is laid over the viewport as a fixed
dashboard, and the system cursor is never replaced.

## `brief.chrome`
```json
"chrome": {
  "contents": "list",
  "folio": "value-name",
  "values": ["ออกเดิน", "ก้าวที่ ๑", "…"],
  "arrival": "scene",
  "tags": "anchored",
  "sound": "offer",
  "sound_label": {"off": "ฟังลมบนสันดอย", "on": "พักเสียงไว้ก่อน"},
  "reasons": {
    "contents": "A guide people come back to: a plain list lets them jump to packing.",
    "folio": "Each stage of the climb is a step on the trail, so the head shows the step.",
    "arrival": "The lantern kindles while the world loads.",
    "tags": "Trail names and gear names sit beside the objects.",
    "sound": "Wind and a bell suit the ridge; offered, never forced."
  }
}
```

| Key | Options | Choose by meaning |
|---|---|---|
| `contents` | `list` · `sentence` · `none` | `list` for anything read or revisited (guides, docs, portfolios). `sentence` when the chapters read naturally as one line ("From the foot of the hill to the summit, through …"); write the lead-in in `contents_lead`. `none` only for single-chapter pieces |
| `folio` | `name` · `number-name` · `value-name` · `none` | The running head at the top of each chapter, travelling with it. `number-name` when order is information (steps). `value-name` when each chapter has a value in the story (an hour, a stage, a depth); the values go in `values` and must not invent facts |
| `arrival` | `veil` · `scene` · `hold-title` | `veil`: the world fades in behind text that is already there, the quiet default. `scene`: the scene turns loading into its opening (a lamp warming, fog lifting); the builder must render progress itself. `hold-title`: the headline words wait and rise as the world becomes ready; for short hero lines only |
| `tags` | `anchored` · `none` | `anchored` whenever the scene has named targets. `none` when nothing in the world needs naming |
| `sound` | `offer` · `none` | `offer` when sound adds meaning (wind, water, a room tone). The label is an invitation in the theme's voice, never "sound on/off" |
| `reasons` | one line per key | Required. Copied into `brief.md` |

## Rules
1. **Decide, don't default.** Every key is set on purpose, with its reason.
2. **In the flow, not on top.** Contents and the sound offer are part of
   chapter 0. Folios belong to their chapter. Tags belong to objects.
3. **Function is fixed, form is free.** Contents entries are real `#ch-N`
   links; the sound offer is a real `<button aria-pressed>`; everything works
   by keyboard and without JavaScript. `theme.css` restyles freely.
4. **Authored words.** Folio values, the contents lead-in, tag names and the
   sound invitation are copy in the content language, written like the rest of
   the page.
5. **Quiet.** Chrome never competes with the headline or the subject.
6. **Variety.** Two openwebx sites should not share the same combination of
   folio, arrival and sound wording unless their themes call for it.

The kit side (markup, runtime modules and API) is specified in
`runtime-api.md` and `brief-spec.md`.
