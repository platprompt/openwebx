# Art-direction grilling protocol

openwebx builds without questions by default (see `SKILL.md`). This protocol
runs only when the user asks to be consulted. It asks only what the user alone can decide, through pop-up pickers,
and every question arrives with an answer already worked out. The user
should be able to press Enter through the whole thing and still get a great
site.

The protocol follows the project-control `grilling` engine (design tree,
frontier rounds, the host question tool, recommended option first), narrowed
to creative decisions. If the `project-control` plugin is installed, its
`grilling` skill is the canonical reference for the general rules. This file
is self-contained, so openwebx works without it.

## Rules
1. **Facts are never asked.** Language, content type, section count,
   existing images and FAQ presence all come from `content.json`. Read them;
   do not ask.
2. **Ask with the question tool** (`AskUserQuestion` in Claude Code): 1–4
   questions per call, 2–4 options each. The recommended option comes first,
   labelled `(Recommended)`, with its reason in the `description`. `header`
   is ≤ 12 characters. The host adds "Other" automatically, so never add
   your own.
3. **Options are finished ideas,** not categories. "The Ember Road: an ember
   climbs from valley to summit (a path lit by the hours before dawn)" rather than "Dark
   fantasy".
4. **Write in the user's language, the way a person would say it.** Thai
   users get natural, conversational Thai, like a creative director
   explaining an idea to a client. Avoid translationese, stacked English
   jargon and internal vocabulary: form names (Path, Stage),
   composition names (`paper`, `interlude`) and section ids stay out of labels and
   descriptions. Describe what the viewer will *see and feel*. Internal
   terms can go in `preview` only when it helps.
4a. **Get the context right.** Imagery must fit the real subject of the
   content (a Thai mountain-trek guide means Thai *doi* landscapes: sea of
   mist, montane forest, ridgelines, a sunrise viewpoint), and the theme is
   carried by mood, light and material. Never transplant the franchise's
   story onto the user's topic.
5. **Grilling happens in the main conversation.** Subagents cannot open
   pickers. The director agent *prepares* questions as JSON and the main
   session asks them.
6. **Summarise between rounds** in one or two sentences: what is now decided
   and what it commits to.

## Round 1: the standard frontier
The director's proposal supplies the options. Send them as one call:

| header | question | options |
|---|---|---|
| `Concept` | Which concept for this theme? | 3 concepts: name + form + one-line experience. Recommended first. Add a `preview` with the mini chapter plan when the host supports it |
| `Palette` | Which mood/palette? | 3 palette directions within the theme. Put hex values for bg/ink/accent in each description |
| `Intensity` | How strong should the effects be? | Restrained / Cinematic / Maximal. Recommend based on content length (long reads → Restrained or Cinematic) |
| *(optional 4th)* | The single highest-leverage open decision the director flagged, e.g. `Look` (only when the theme could reasonably be stylised: realistic film stills vs. semi-painterly vs. flat graphic, with realistic as the default), `Reading` (read on paper between world moments vs. short text in the world), `Pacing` (compact vs. with interludes), `Type voice`, `Hero line`, `Language` for UI copy when content and audience differ | 2–3 options |

## Round 2: only when a branch opened
Ask a second round **only** if one of these holds, and only about that
branch:
- The user typed a free-text answer ("Other") that changes the concept or
  palette. Turn it into 2–3 concrete options and confirm.
- The chosen concept combines two forms and it is unclear which one leads
  (e.g. travelling a path vs. staying on a stage).
- A content problem needs the user: images with meaning but no alt text,
  content that itself names a franchise the theme is inspired by (keep or
  neutralise the authored copy around it?), or content too short for the
  chosen concept.
- The theme is ambiguous (e.g. "Dune": the desert landscape or the
  franchise?).

Otherwise, stop. Tell the user in one line what will be built and start. A
blocking confirmation round is not needed, because the brief is shown and
the user can redirect at any time.

## Deep mode (`/openwebx:grill-me`)
The user explicitly wants to be grilled. Walk the whole design tree
frontier by frontier until it is empty:
concept → form → held object and verb → first frame → palette → typography
(Latin + script pairing) → chapter plan (grouping, reading model, compositions, interludes) →
per-chapter beats → signature moments → contents and folios → arrival → tag
wording → sound invitation and palette
→ mobile behaviour → reduced-motion compositions → performance tier targets
→ SEO title/description.
Keep the recommended-first convention and summarise between rounds. Write
the result into `brief.json` / `brief.md` exactly as agreed.

## Hosts without a question tool (e.g. Codex)
Present the same round as a compact numbered list with the recommended
option marked, and say that replying "go" accepts all recommendations. Never
block for more than one round in this mode.

## Question JSON the director returns
```json
{
  "round": 1,
  "questions": [
    { "header": "Concept", "question": "…?", "multiSelect": false,
      "options": [
        { "label": "The Ember Road (Recommended)", "description": "Path + Hours: …", "preview": "01 หุบเขา …" },
        { "label": "…", "description": "…" }
      ] }
  ],
  "defaults": { "Concept": "The Ember Road", "Palette": "Dusk gilt", "Intensity": "Cinematic" }
}
```
`defaults` records what the director will use for any question the user skips.
