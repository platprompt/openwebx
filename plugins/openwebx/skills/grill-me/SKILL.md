---
name: grill-me
description: Deep art-direction interview for an openwebx site. Walks the whole creative design tree (concept, form, held object and verb, composition, palette, type, chapters, beats, contents and folios, arrival, tags, sound, mobile, motion) through pop-up pickers with recommended answers, then writes the agreed brief.
disable-model-invocation: true
argument-hint: "[theme] [content path | openwebx-out/<slug>]"
---

# openwebx: grill me

Run the **deep mode** of the art-direction grilling protocol:
`../create/references/grilling-protocol.md` (section "Deep mode").

If the `project-control` plugin is installed, its `grilling` skill defines
the general engine (design tree, frontier rounds, the question tool,
recommended option first). Follow it, and apply the openwebx specifics below.

## Starting points
- **New site** (theme + content given): run steps 0–2 of the `create` skill
  (ingest, director proposal), then grill in deep mode instead of the
  standard single round. Continue with `create` from step 4 when the
  frontier is empty.
- **Existing site** (`openwebx-out/<slug>`): load `_openwebx/brief.json` and
  `brief.md`, then grill only the branches the user wants to revisit. Apply
  the results by editing the brief and running
  `scaffold.py --site`. Scene-level changes go to the builder.

## Rules
- Facts come from `content.json` and the files, never from questions.
- Ask 1–4 questions per `AskUserQuestion` call, recommended option first,
  in the user's language.
- Summarise the settled decisions between rounds.
- Stop only when every branch in the deep-mode list is settled, then write
  `brief.json` / `brief.md` exactly as agreed and show the summary.
