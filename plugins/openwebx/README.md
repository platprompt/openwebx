# openwebx plugin

Turn any content into a themed, interactive 3D web experience.

- `/openwebx:create <theme> <content> [--ask]` runs the full pipeline: ingest →
  concepts → brief → scaffold → build → browser critique. With `--ask`, the
  concept, palette and intensity come as pop-up choices first.
- `/openwebx:grill-me [theme content | openwebx-out/<slug>]` runs the deep
  art-direction interview.

Agents: `openwebx-director` (concepts, questions, brief), `openwebx-builder`
(scene and theme CSS on the runtime kit), `openwebx-critic` (static and
browser QA; never edits).

See the repository README for installation, the architecture and the
development checks. MIT licensed.
