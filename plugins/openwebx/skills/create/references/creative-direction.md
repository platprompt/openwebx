# Creative direction

openwebx starts from a document that already exists and gives it a place to
happen. The reader came for the content; the world is how they keep it.
Every rule below follows from that, and each one can be checked.

## Four questions every brief answers

The director answers these in `brief.md`. The critic checks the finished page
against the answers, not against taste.

1. **What is the content for?** Name the reader's job in one line: choose a
   first trail and pack for it, judge whether a studio fits, decide to buy.
   The world serves that job. A scene that distracts from it is wrong,
   however beautiful.
2. **Where and when does it happen?** One place and one arc of time: a doi
   from blue hour to sunrise, a room from morning to night. The theme becomes
   a place, its materials and its hour. If the concept would still work with
   another theme word, it is not specific enough.
3. **What does the reader hold?** One object or force carries the thread (a
   lantern, a plinth, a tide). Interactions are done to it or through it.
4. **How does it end?** The last chapter resolves the place: the summit meets
   the sun, the room is back to one lamp. An ending that only stops is a
   finding.

## Rules by moment of the visit

### Arrive
- The headline and the first paragraph are readable in the first paint. The
  world joins when it is ready (`chrome.arrival`); nothing counts, fills or
  covers the page while it loads.
- The first frame is composed: subject placed, room left for the headline,
  foreground to background depth.

### Read
- Long reading never happens over a moving picture. Choose the reading model
  by length (`content-mapping.md`): long passages sit on paper between world
  moments; short text sits in the free area over a quiet zone. Boxes laid over
  the scene are a finding.
- The camera knows where the text is (`ctx.layout`) and frames the subject in
  the space left free. Text never covers the subject; the subject is never cut
  by the viewport unless the chapter is meant to bleed.
- Set type like a magazine: large scale contrast, a narrow left-aligned
  column, no centred paragraphs, and a different composition from the chapter
  before.
- Order of attention: headline, lede, body, then everything else. Squint at a
  screenshot; if the scene wins, the chapter fails.
- Contrast holds at the brightest frame of the chapter, not the average one.
- Thai and similar scripts follow `typography.md` (no tracking, generous
  leading). Every authored line reads as if a native writer wrote it.

### Touch
- Each affordance is a verb of the theme (kindle, turn, lift, part), taught
  once in a chapter `interaction`, and answered **on the object in the world**:
  the ember brightens, the stone glows, the sheet lifts into the light.
- Names and hints appear beside the object they describe (`chrome.tags`), not
  beside the pointer. The system cursor is left alone.
- Every hover has a tap equivalent; every hold also works as a long press.

### Travel
- Scroll is the clock. The camera follows a path through the place and every
  value it reads is damped, so no frame jumps.
- At least one crossing surprises a first-time reader: a threshold (through the
  cloud, glare settling into paper), a change of scale, or a reveal of what was
  always there.
- Chapters differ from their neighbours in layout, camera distance or beat.

### Finish
- The ending resolves the place and returns the reader to the content (the
  contents list, the call to action, the footer).

## Look

Unless `brief.look.fidelity` says otherwise, the target is **cinematic
realism in a controlled set**: light from an environment, physically based
surfaces, air with depth and a camera finish (see `rendering.md`), in a small
bounded world (a room, a table, a diorama, one object on a backdrop) rather
than an open landscape. Every frame has a clear key light and real contrast. These are the baseline of a
believable frame, not decoration. Flat, unlit silhouettes and default grey
materials are failures, not a style.

**One phenomenon leads.** Choose the single physical effect the page is about
(light through material, mist, water, dust in a beam) and let everything else
support it. Nothing moves without a cause: either the reader did something or
the story needs it. Idle motion is slow and driven by noise, never a visible
loop.

## Signs a page looks like someone else's (each is a finding)
- Chrome laid over the viewport: a fixed brand bar, corner sound switch, side
  rail, scroll hint, custom pointer. openwebx chrome lives in the content and
  the world (`chrome.md`).
- A loader that counts, fills a bar or covers the page.
- The stock three.js look: grey spheres, orbit controls, bloom on everything.
- A starfield with bloom standing in for "premium"; neon for a theme that is
  not about neon.
- A text box over a full-screen scene; the same composition in neighbouring
  chapters; centred paragraphs.
- Murky frames with no clear light, or a hero built from flat extrusions and
  untextured blocks.
- System fonts as the display face, or a typeface set borrowed whole from a
  known showcase (see `typography.md`).
- English interface words on a page whose content is Thai.
- The theme reduced to a palette on a generic scene.

## Build rules (the kit and QA enforce most of them)
- The runtime owns renderer, loop, scroll, pointer, arrival, chapters, tags
  and sound. The scene owns its world only, through `load`, `resize`,
  `update`, `render` and `dispose`.
- One module per actor under `src/scene/` once the scene grows.
- Tiers come from `ctx.device`: fewer instances and simpler shaders on `low`.
- Reduced motion: no drift or ambient motion and instant transitions; every
  interaction and all content still work.
- Report real progress from `load(progress)`. Reuse vectors and colours in
  `update`. Dispose everything the scene created. Load media only through
  `media()`, `mediaBytes()` or the kit loaders.
