---
name: create
description: >
  Turn any content (a file or folder: SEO article, portfolio, product page, docs, report, story;
  md/txt/html/json/csv) into a premium interactive 3D web experience (Three.js, shaders, scroll-driven
  story, interactions on the objects themselves, optional sound, SEO-complete) in any theme the user names.
  The user gives only a theme and a content path; the AI picks the strongest concept, directs, builds and
  browser-QAs the site without questions. Pop-up art-direction questions only when the user asks.
  Use when the user asks for a showcase, creative web experience, 3D/WebGL site, immersive landing page or
  "เว็บสไตล์ <theme>" / "ทำ showcase ธีม X จากไฟล์/โฟลเดอร์นี้", or to refine a site in ./openwebx-out/.
argument-hint: "<theme> <content file or folder> [--ask]"
---

# openwebx: create

Two inputs: **theme** and **content**. The plugin decides everything else and
builds straight away. The user can ask to be consulted: `--ask`, "ask me
first", or `/openwebx:grill-me`. Then steps 3 and 4 run as questions.

`<skill>` below means this skill's base directory, which the host prints when
the skill loads. Scripts need Python 3.9+ (standard library only). Node is
optional and enables JS syntax checks.

## 0. Inputs
- Take the theme and content path from the arguments or the conversation.
- If either is missing, ask once with `AskUserQuestion`:
  - **Theme:** offer 3 themes that suit the content (the host adds "Other"
    for free text).
  - **Content:** offer up to 4 likely paths found with Glob in the working
    directory (`**/*.{md,html,json,csv,txt}`, excluding `openwebx-out`,
    `node_modules` and dot-folders).
- `.docx`, `.pdf`, `.pptx` and `.xlsx` are not read directly. Convert them
  first (docx/pdf skills, or `pandoc -t gfm`) into
  `openwebx-out/.work/<run>/source/`, then ingest that.

## 1. Ingest (facts, never questions)
```bash
python "<skill>/scripts/ingest.py" "<content>" --out "openwebx-out/.work/<run>/content.json"
```
`<run>` is a short slug of theme and content. The printed summary (language,
sections, word counts, FAQ, images) is the fact base for every later step.

## 2. Direct
Launch the **openwebx-director** agent (`subagent_type: openwebx:openwebx-director`)
with the theme, the work folder path and the skill path, and:
- `mode: auto` (default). It reads `content.json` and the references, writes
  `proposal.md`, takes its own top-ranked concept, palette and intensity,
  writes `brief.json` + `brief.md`, and validates them with a dry scaffold.
- `mode: propose` only when the user asked to be consulted. It returns the
  round-1 question JSON (see `references/grilling-protocol.md`).
If agents are unavailable (e.g. Codex), do this step inline following
`agents/openwebx-director.md` at the plugin root.

Show the user the brief headline in ≤ 6 lines: concept, where and when it
happens, palette, type, chapter count and the signature moment. Then carry on
to step 5 without waiting, unless they asked to be consulted.

## 3. Consult (only when asked)
Ask round 1 with `AskUserQuestion`, using the director's questions verbatim:
Concept · Palette · Intensity (+ one optional). Ask round 2 only on the
triggers listed in the protocol. Between rounds, summarise what is decided in
1–2 sentences. Never ask for facts.

## 4. Direct: finalise (only after step 3)
Resume the director (SendMessage to the same agent, or a new run with
`mode: finalize`) with the answers. It writes `brief.json` + `brief.md` and
validates them with a dry scaffold. Show the brief headline as in step 2.

## 5. Scaffold
```bash
python "<skill>/scripts/scaffold.py" --content "<work>/content.json" --brief "<work>/brief.json" --brief-md "<work>/brief.md" --out-root openwebx-out
```
This prints the site folder (`openwebx-out/<slug>/`, never overwriting an
existing one). The content is now in the page verbatim, and the runtime kit
(arrival, contents and folios, anchored tags, inertial scroll, optional
sound, adaptive quality, reduced motion, no-JS fallback) is in place.

## 6. Build
Launch **openwebx-builder** (`openwebx:openwebx-builder`) with the site path
and skill path. It:
- fetches the brief's CC0 assets (`fetch_cc0.py get <site> --from-brief`);
- writes `src/scene/**` and `css/theme.css` to the brief at its
  `look.fidelity`, which defaults to cinematic realism;
- must end with `qa.py <site>` passing and `bundle.py <site>` succeeding.

## 7. Critique → fix loop
Launch **openwebx-critic** (`openwebx:openwebx-critic`) with the site path. It
serves the site, runs the browser protocol in `references/quality-bar.md`, and
returns gates, scores, findings and screenshot paths.
- If there are blockers or majors, send the findings to the builder (continue
  the same builder via SendMessage when possible), then critique again. Stop
  after **2 fix rounds**, and report anything still open honestly.
- With no browser tool available, the critic runs static QA only and says so.
  Report the site as "not browser-verified".

## 8. Present (shareable version first)
Build the single-file presentation:
`python "<skill>/scripts/bundle.py" openwebx-out/<slug> --artifact`. It
writes:
- `present.html`: a full document for Canvas hosts and email;
- `artifact.html`: the same page as a fragment for Claude Artifacts (the
  Artifact adds its own document skeleton).

In both, CSS, JS and media are inlined; three, GSAP and fonts load from the
CDNs Artifacts allow. Media is decoded in memory, not fetched, because
Artifact and Canvas CSPs block fetch.

What happens next depends on the host:
- **Claude** (Claude Code, the Claude desktop app, claude.ai): publish
  `artifact.html` as an **Artifact** before anything else, and give the user
  the link. It is private until they share it. Follow the Artifact tool's
  own instructions: load its design skill first, as the tool requires, and
  keep the generated page as it is (it is already a finished, themed page).
- **ChatGPT / Codex:** open `present.html` in **Canvas** (ChatGPT's HTML
  preview) when the host exposes it. Otherwise hand the file over and tell
  the user to paste it into a ChatGPT Canvas and press Preview.
- **Gemini:** use **Gemini Canvas** the same way (paste the file and
  preview).
- **Anything else:** send the file, and offer the local server
  (`python openwebx-out/<slug>/serve.py`).

If the bundle is over its limit, it says so. Refetch the CC0 assets at 1k,
or drop a texture set, and bundle again.

## 9. Deliver
Report:
- the site path;
- how to view it (`python openwebx-out/<slug>/serve.py`);
- the concept in one line;
- gate results;
- the hero screenshot (send it with the file tool when available);
- any open findings;
- 2–3 refine ideas.

Offer to open it in the browser pane. Deployment is manual: the folder is a
static site. `_openwebx/` is build metadata and does not need to be deployed.

## Refine (after delivery)
The user describes changes in plain words. Route them:
- **Brief-level** (palette, fonts, copy, chapter grouping, reading model or compositions): edit
  `_openwebx/brief.json`, then run
  `python "<skill>/scripts/scaffold.py" --site openwebx-out/<slug>`. This
  keeps the scene and theme.css.
- **Scene-level** (motion, objects, interactions): hand the request to the
  builder.
- Always finish with `qa.py`, plus a short critic pass on the affected
  chapters.

## Non-negotiables
- Content stays verbatim, complete and in order. Scaffold and QA enforce it.
- Themes are **inspired-by**: no franchise names, marks, fonts or quotes in
  authored copy (`concept.avoid_terms`).
- There is always a readable HTML path: SEO, no-JS, reduced motion and
  mobile.
- Never deploy, push or publish without the user's explicit request.

## References (load only what the step needs)
| File | Used by |
|---|---|
| `references/grilling-protocol.md` | main session and director, only when the user asks to be consulted |
| `references/forms.md` | director |
| `references/theme-translation.md` | director |
| `references/content-mapping.md` | director |
| `references/typography.md` | director, builder |
| `references/brief-spec.md` | director, builder |
| `references/creative-direction.md` | director, builder, critic |
| `references/rendering.md` | director (look, CC0 picks), builder |
| `references/chrome.md` | director (contents, folio, arrival, tags, sound), builder |
| `references/runtime-api.md` | builder |
| `references/quality-bar.md` | critic |
