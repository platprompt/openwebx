# Content mapping

openwebx works with any content: SEO articles, portfolios, product pages,
documentation, reports, stories, event pages, résumés. `ingest.py` splits the
content into **sections** (usually one per H2, or one per item in a
collection). The director groups sections into **chapters**, which are the
units the scene choreographs.

## Hard rules
1. **Verbatim.** Section HTML comes from the user's content and is never
   rewritten, summarised, translated or trimmed. Scaffold and QA both enforce
   this.
2. **Complete and ordered.** Every section appears exactly once, in source
   order.
3. **The H1 is the content's H1.** When the content has none, the title comes
   from front matter, the JSON title, or the file name. The director may set
   the SEO `<title>` and meta description, but never the visible H1.
4. **Authored copy is limited to chrome:** hero eyebrow and lede, chapter
   names and eyebrows, breath-chapter display lines, folio values, the
   contents lead-in, tag names, the sound invitation, the arrival status and
   the footer. It follows the content language and the theme voice, never
   invents facts, and never makes claims about the user's business.

## Choosing the content type
| `content_type` | Signals | JSON-LD |
|---|---|---|
| `article` | prose, H2 sections, front matter with date/author | Article (+ FAQPage when questions are detected) |
| `collection` | JSON/CSV items, repeated `ox-item` blocks | CollectionPage + ItemList |
| `product` | a single product or service, features, specs | Product (no offers/reviews unless present in content) |
| `profile` | a person or studio about page, résumé | ProfilePage + Person |
| `page` | anything else (docs, reports, events) | WebPage |

## Pacing
- **Hero chapter** holds the H1, an optional eyebrow and lede, and the intro
  section (`s00`) only when it is short (≤ 80 words, or ≤ 320 Thai
  characters). Otherwise the intro gets its own chapter.
- Aim for 5–9 chapters. Fewer feels thin and more exhausts the scene's
  vocabulary. Group sections with related meaning (e.g. "preparation" = body
  + pack).
- A chapter should read in about 60–90 seconds: ≤ 350 words, or ≤ 1,400 Thai
  characters. Split longer sections across chapters only at their own
  headings; never cut a paragraph.
- Insert 1–3 **interludes** (composition `interlude`, no sections) at
  narrative turns. Each carries one authored display line and lets the world
  perform. They are `aria-hidden` and never replace content.
- FAQ sections sit near the end in a calm chapter: they are read, not watched.
- The final chapter is a resolution: the world reaches its destination (the
  summit, the last object, the whole assembly).

## Reading model (`brief.reading`)
Decide how text and world share the screen before choosing compositions. The
scaffold picks a default from length; override it only with a reason.

| Content | Reading model | Why |
|---|---|---|
| Long (> 900 words, > 3,600 Thai characters, or any chapter > 180 words) | `interleave` | Long reading happens on a calm paper surface; the world takes the whole screen between those passages. Nothing is read over a moving picture |
| Short (portfolios, product pages, landing pages) | `overlay` | The world is the page; short text sits in the free area with a quiet zone under it, never in a box |
| Specs, comparisons, documentation | `beside` | The object stays in view on one side while the reader works through the details |

## Composition per chapter
| Composition | Use it for | Limit |
|---|---|---|
| `opening` | chapter 0: headline, lede, contents, sound offer | — |
| `paper` | long reading in `interleave` | one narrow column |
| `spread` | medium reading, two related sections | two columns on wide screens |
| `ledger` | tables, long lists, specs | full measure on paper |
| `caption` | short text in the world | ≤ 60 words / ≤ 240 Thai characters |
| `dossier` | one collection item with its subject | a narrow column; the subject fills the free area |
| `interlude` | one display line | the only centred text |

Rules:
- Never give two neighbouring chapters the same composition **and** side.
  Vary scale too: follow a big world moment with a reading chapter, and a
  reading chapter with a short one.
- Alternate `side` so the subject moves across the frame through the page.
- Pick compositions from what the text *is*: a table is a `ledger` wherever
  it appears; a single project is a `dossier`; a closing line is a `caption`.
- Each chapter with a subject names it in `scene` params so the builder can
  register it with `ctx.layout.subject`.
- Set `tone: "night"` or `"bright"` on chapters meant to be very dark or very
  bright, so the light check judges them fairly.

## Scene beats
Each chapter gets a `beat`: one sentence saying what the scene does while
this chapter is on screen. Add an `interaction` when the chapter introduces a
new affordance ("hold to kindle the ember"). Teach one new interaction at a
time, and teach the most important one in the hero.

## Images from the content
- Referenced images are copied to `media/` (converted to WebP when Pillow is
  installed) and keep their alt text.
- Unreferenced images in the content folder can become scene textures or
  cards: list them in `brief.assets` with a `role`.
- Missing alt text is flagged by QA. Ask the user when the image carries
  meaning; use `alt=""` only for decoration.
