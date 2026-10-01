# Quality bar (critic rubric)

The critic runs static QA, opens the site in a real browser, and grades it
against this rubric. A site ships when **every gate passes** and **every
score is ≥ 3**, averaging ≥ 3.5. The critic returns findings; it never
edits code.

## Gates (any failure blocks delivery)
| ID | Gate | How to check |
|---|---|---|
| G-static | `qa.py <site> --online` exits 0 | run it |
| G-console | No console errors during load, full scroll, and press/hold/release | browser console + `__openwebx.errors` |
| G-ready | `window.__openwebx.ready === true` within 8 s on a normal connection | evaluate in page |
| G-read | All content readable: text never hidden, sufficient contrast over the scene (spot-check the brightest frame) | screenshots of every chapter |
| G-nojs | With JS disabled (or `ox-no-webgl`), the page is a complete, styled article | toggle `html.ox-no-webgl`, or disable JS if the tool allows |
| G-reduced | With reduced motion emulated, there is no ambient motion and nothing is broken | emulate `prefers-reduced-motion: reduce`, reload |
| G-mobile | At 390×844 the layout fits (no horizontal scroll), tags never cover the text column, and interaction works by tap | resize viewport |
| G-ip | No franchise names, marks or fonts in authored copy/code | `qa.py` avoid_terms plus a visual check |
| G-ui | No UI collisions: tags, folios, the contents list, the sound offer and text panels never overlap each other or run off-screen | hover every scene target near each viewport edge, tap them at 390×844, and screenshot the tag |
| G-orig | Chrome is openwebx's own: nothing fixed to the viewport except the skip link and the canvas layers, no counting or covering loader, the system cursor untouched, no borrowed typeface set | `qa.py` originality lint plus the hero and one mid-page screenshot |
| G-arrive | The headline and first paragraph are readable in the first paint, before the world is ready | throttle the network, screenshot at 300 ms |
| G-real | The look matches `brief.look.fidelity`: `cinematic-real` means lit surfaces, depth and atmosphere in a controlled set (no flat unlit silhouettes, no default grey materials) | compare every chapter screenshot with the brief |
| G-frame | Text never covers the subject and the subject is not cut off: `probe.layout[i].overlap ≤ 0.12` and `.visible ≥ 0.85` for every chapter with a subject (unless `frame: "bleed"`). Skip entries with `paper: true` or `covered: true` (paper, spread and ledger chapters hide the world; their numbers are transitional) | load with `?ox-qa`, visit every chapter, read `__openwebx.layout` |
| G-light | No murky or washed-out frames: `probe.light[i]` has `p95 − p05 ≥ 0.30` and `0.10 ≤ mean ≤ 0.85` (`tone: night` floor 0.05, `tone: bright` ceiling 0.92). Skip `covered: true` entries and chapters whose layout entry has `paper: true` | same run, read `__openwebx.light` |
| G-layout | `qa.py` Q-repeat, Q-center, Q-length and Q-hero pass, and no chapter reads as a box laid over the scene | `qa.py` plus the chapter screenshots |

## Scores (1–5)
| Dimension | 5 looks like | 2 looks like |
|---|---|---|
| Art direction | One unmistakable idea carried through palette, material, light and type | A palette swap on a generic scene |
| Composition | Every chapter is a framed shot; the subject sits in the free area and neighbouring chapters differ in composition and scale | Subject behind paragraphs, the same layout every time |
| Typography integration | Type and scene interact at least once; the display face defines the theme | Default-looking type floating over a canvas |
| Motion quality | Everything damped and inertial; transitions surprise and feel physical | Snaps, linear tweens, visible loops |
| Interaction feedback | Hover, press, hold and release each have a themed answer on the object itself; tags name things beside them | Nothing in the world reacts |
| Narrative | The scene changes meaningfully per chapter; the ending resolves | The same scene the whole way down |
| Performance | Holds ~60 fps on desktop (`__openwebx.fps`); no jank on scroll | Stutters, DPR degrades immediately |
| Restraint | One hero effect, calm behind long text | Bloom, particles, chromatic aberration all at once |
| Rendering fidelity | Frames could pass for photographs of a real set: environment light, PBR surfaces, a clear key light, atmospheric depth, camera finish; the hero is a detailed object | Flat unlit shapes, silhouettes, blocky or extruded stand-ins, murk |

## Browser protocol
1. Serve: `python <site>/serve.py 5190 --no-open` (in the background).
2. Load `/?ox-qa` at 1440×900. Wait for `__openwebx.ready`. Screenshot the hero.
3. For each chapter `i`, run `document.getElementById('ch-'+i).scrollIntoView()`,
   wait 1.5 s, screenshot, and record `__openwebx.fps`, `.chapter`,
   `.layout[i]` and `.light[i]`.
4. Interact: move the pointer across the hero, press and hold 1.5 s, release.
   Check the answer in the scene and the tag placement (screenshot mid-hold).
5. At 390×844, reload, then screenshot the hero and one long-text chapter.
6. Emulate reduced motion and reload: check the static compositions.
7. Collect `__openwebx.errors`, `.warnings` and the console.
8. Presentation build: run `python <skill>/scripts/bundle.py <site>`, open
   `/present.html` and confirm it reaches `ready` with no errors and looks
   the same as the site.

## Finding format
```json
{ "id": "F3", "severity": "blocker|major|minor", "gate_or_dim": "G-read|Composition|…",
  "where": "chapter 4 / src/scene/mist.js", "evidence": "screenshot ch4: paragraph over bright mist, contrast ~2.8:1",
  "fix": "Set chapter 4 panel to shade, or damp mist brightness while chapter 4 is current (scene.mist.opacity *= 0.5)." }
```
Every finding needs evidence (a screenshot, a probe value or a file line) and
a concrete fix. No vague taste notes.
