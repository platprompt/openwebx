# Forms

A form is the rule that ties the content's structure to the world: what stays,
what changes from chapter to chapter, and where the reader stands. It is not a
look. The theme supplies place, material, light and sound; the form decides
how chapters become moments in that place.

The director reads the content's shape first, chooses a form that fits it, and
then lets the theme dress it. Two concepts that differ only in colour are the
same concept.

## Step 1: read the content's shape

`content.json` already tells you the shape. Pick the one that describes what the
reader does with the text.

| Shape | Signs in the content | The reader… |
|---|---|---|
| **Sequence** | ordered steps, stages, a timeline, "first… then…" | follows it in order, often once |
| **Collection** | parallel items with the same fields (projects, products, people) | compares and picks |
| **Argument** | a claim built section by section (report, essay, case study) | is persuaded step by step |
| **Single subject** | one product, one idea, one place | studies it from several sides |
| **Reference** | many short answers, docs, FAQ, specs | jumps in and out |

## Step 2: choose a form

### Path
- **What stays / what changes:** the place is one continuous route; the
  reader's position on it changes.
- **Chapters are:** stations along the route, each with its own ground, light
  and weather.
- **Camera:** travels the route at a walking scale; looks ahead more than
  around.
- **Text lives:** beside the route, where the terrain opens up.
- **Ending:** arrival at the route's end, which the whole page has been
  pointing at.
- **Fits:** Sequence; Argument read as a journey.
- **Pitfalls:** stations that differ only in colour; travel so fast the reader
  never stands anywhere.
- **Example:** a beginner's hiking guide as a climb to sunrise. Build the route as a set: a lit model of the doi on a table
  rather than an open landscape (`rendering.md`).

### Stage
- **What stays / what changes:** the place and the point of view stay; the
  subject on the stage is replaced chapter by chapter.
- **Chapters are:** successive subjects, each made of its own material.
- **Camera:** holds a composed frame and adjusts distance per subject.
- **Text lives:** in the space the stage leaves free, opposite the subject.
- **Ending:** the stage returns to its first state, changed by what passed
  over it.
- **Fits:** Collection; Single subject shown in variations.
- **Pitfalls:** subjects that collide in transit (let one leave before the
  next arrives); a stage so plain it reads as an empty template.
- **Example:** *The Single Plinth* (a studio portfolio, one object at a time).

### Assembly
- **What stays / what changes:** one object is built, grown or revealed layer
  by layer; each chapter adds or exposes a part.
- **Chapters are:** layers or parts, in the order the argument needs them.
- **Camera:** circles the object and moves closer as it gains detail.
- **Text lives:** in the gaps between parts, or in labels on the part itself.
- **Ending:** the whole is complete and seen at once.
- **Fits:** Argument; Single subject; product explanations.
- **Pitfalls:** an exploded view with no reason to explode; parts that do not
  map to sections.

### Map
- **What stays / what changes:** the whole territory is visible from above;
  the reader's focus moves to one region at a time and back out.
- **Chapters are:** regions, reached from the overview.
- **Camera:** alternates overview and approach; the overview is the home.
- **Text lives:** in the region, or in a dossier beside the region where the reader
  landed.
- **Ending:** the overview again, now with every region known.
- **Fits:** Reference; Collection with a geography (branches, rooms, topics).
- **Pitfalls:** a map with nothing to find; approach moves that disorient.

### Hours
- **What stays / what changes:** the place and the subject stay; time,
  season or conditions move across the chapters.
- **Chapters are:** moments in that arc (dawn to night, spring to winter, calm
  to storm).
- **Camera:** nearly still; light, weather and sound do the travelling.
- **Text lives:** where the changing light allows, which the director plans
  per chapter.
- **Ending:** the arc closes.
- **Fits:** Sequence about change; Single subject; stories.
- **Pitfalls:** time change that only tints the frame; nothing reacts to it.

Forms combine: a Path whose stations are lit by Hours (a climb toward sunrise), a
Stage whose light follows Hours (one pedestal from morning to dusk). Take the structure from one
form and let at most one other colour it.

## Step 3: give the reader one verb

Choose the main action from the theme, and make every interaction a variation
of it: *kindle*, *turn*, *lift*, *part*, *pour*, *tune*, *trace*, *weigh*. The
verb is performed on the held object, answered in the world, and taught once in
a chapter `interaction`.

## Budget guide (high tier; the kit scales by `device.scale`)
- Instanced vegetation or props: ≤ 2,000 visible instances.
- Point particles: ≤ 10,000 in one draw call.
- Distinct materials: ≤ 12; one shadow-casting light.
- Texture memory: CC0 sets at 1k unless the subject fills the frame.

## Quick map

| Shape | First choice | Also consider |
|---|---|---|
| Sequence (guide, how-to, timeline) | Path | Hours |
| Collection (portfolio, catalogue) | Stage | Map |
| Argument (report, essay, case study) | Assembly | Path |
| Single subject (product, idea) | Stage | Assembly |
| Reference (docs, FAQ, specs) | Map | Stage |

Record the choice in `brief.concept.form` (for example `"path"` or
`["stage", "hours"]`) with a one-line reason in `brief.md`.
