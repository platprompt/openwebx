#!/usr/bin/env python3
"""openwebx scaffold: assemble a site from content.json + brief.json.

New site:
    python scaffold.py --content content.json --brief brief.json [--brief-md brief.md]
                       [--out-root ./openwebx-out]
Re-render an existing site after editing its brief (keeps src/scene/** and
css/theme.css, refreshes the runtime core):
    python scaffold.py --site ./openwebx-out/<slug> [--brief new-brief.json]

The page content is rendered from content.json verbatim, grouped into the
chapters the brief defines. Every section must be used exactly once and in
source order; the script refuses otherwise. Prints the site directory.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from ox_html import esc, slugify, to_text  # noqa: E402

SKILL = HERE.parent
RUNTIME = SKILL / "runtime"
PLUGIN_ROOT = SKILL.parent.parent


def plugin_version() -> str:
    try:
        return (PLUGIN_ROOT / "VERSION").read_text(encoding="utf-8").strip()
    except OSError:
        return "0.0.0"


THREE = "0.170.0"
GSAP = "3.13.0"
IMPORTMAP = {
    "imports": {
        "three": f"https://cdn.jsdelivr.net/npm/three@{THREE}/build/three.module.js",
        "three/addons/": f"https://cdn.jsdelivr.net/npm/three@{THREE}/examples/jsm/",
        "gsap": f"https://cdn.jsdelivr.net/npm/gsap@{GSAP}/index.js",
        "gsap/": f"https://cdn.jsdelivr.net/npm/gsap@{GSAP}/",
    }
}
LOCALES = {"th": "th_TH", "en": "en_US", "ja": "ja_JP", "zh": "zh_CN", "ko": "ko_KR", "fr": "fr_FR", "de": "de_DE",
           "es": "es_ES", "vi": "vi_VN", "id": "id_ID", "ms": "ms_MY", "lo": "lo_LA"}
# UI language table: words the kit itself writes. The brief overrides any key
# through brief.ui; languages without a row use "en". Sound phrases are
# neutral invitations, never an on/off switch label.
UI_DEFAULTS = {
    "th": {"skip": "ข้ามไปยังเนื้อหา", "contents": "สารบัญ", "contents_lead": "ในหน้านี้มี",
           "list_sep": " ", "list_and": " และ", "sentence_end": "",
           "ready": "ภาพสามมิติของหน้านี้พร้อมแล้ว",
           "sound_label": {"off": "เปิดฟังเสียงประกอบ", "on": "พักเสียงประกอบไว้ก่อน"}},
    "en": {"skip": "Skip to content", "contents": "Contents", "contents_lead": "This page moves through",
           "list_sep": ", ", "list_and": " and", "sentence_end": ".",
           "ready": "The 3D scene for this page is ready.",
           "sound_label": {"off": "Play the soundscape", "on": "Let the page go quiet"}},
}
# Reading model (brief.reading) and per-chapter composition + side
# (docs/decisions/0.2.0-layout-and-beauty.md).
READINGS = {"interleave", "overlay", "beside"}
COMPOSITIONS = {"opening", "paper", "spread", "ledger", "caption", "dossier", "interlude"}
PAPER = {"paper", "spread", "ledger"}  # on an opaque surface in the page flow
SIDES = {"left", "right", "center"}
TONES = {"night", "bright"}
FRAMES = {"fit", "bleed"}
# Length is counted in units: one Latin word, or four Thai characters.
LONG_TOTAL = 900  # > 900 words (3,600 Thai characters) in all -> interleave
LONG_CHAPTER = 180  # > 180 words (720 Thai characters) in one chapter -> interleave
LENGTH_LIMITS = {"caption": 60, "dossier": 180, "interlude": 20}
LAYOUT_MIGRATION = {
    "hero": "composition 'opening'", "breath": "composition 'interlude'",
    "wide": "composition 'ledger' (tables, specs) or 'paper' (long text)",
    "left": "side 'left' with a composition (paper, spread, caption, dossier...)",
    "right": "side 'right' with a composition (paper, spread, caption, dossier...)",
    "center": "composition 'interlude' (the only centred text) or side 'center' on the opening",
}
# Site chrome is chosen per brief, never one fixed look (see references/chrome.md).
# It lives in the content (contents, folios, sound offer) or in the world
# (arrival, anchored tags); nothing is fixed over the viewport.
CHROME = {
    "contents": {"list", "sentence", "none"},
    "folio": {"name", "number-name", "value-name", "none"},
    "arrival": {"veil", "scene", "hold-title"},
    "tags": {"anchored", "none"},
    "sound": {"offer", "none"},
}
CHROME_DEFAULTS = {"contents": "list", "folio": "name", "arrival": "veil", "tags": "anchored", "sound": "offer"}
CHROME_COPY = {"values", "sound_label", "contents_lead", "reasons"}
# Keys removed in 0.2.0, with how to migrate each one.
REMOVED_CHROME = {
    "nav": "use chrome.contents (in-flow table of contents) and chrome.folio (running head per chapter)",
    "nav_labels": "rename to chrome.values (one authored value per chapter)",
    "loader": "use chrome.arrival: veil | scene | hold-title",
    "readout": "use chrome.folio (the running head at the top of each chapter)",
    "cursor": "use chrome.tags: anchored | none (the system cursor is never replaced)",
    "hold": "use chrome.tags; show hold charge in the scene itself (frame.pointer.hold)",
}
REMOVED_BRIEF = {
    "loader": "use chrome.arrival: veil | scene | hold-title (and brief.arrival_status for the ready sentence)",
    "cursor": "use chrome.tags: anchored | none",
}
HOLD_MS = 2600  # hold-title: longest the headline waits for the world


class BriefError(Exception):
    pass


# ------------------------------------------------------------------ brief

def normalise_brief(brief: dict, content: dict) -> tuple[dict, list[str]]:
    warnings: list[str] = []
    b = dict(brief)
    b.setdefault("lang", content.get("lang", "en"))
    b.setdefault("title", content.get("title", "Untitled"))
    desc = b.get("description") or content.get("description") or content.get("stats", {}).get("lead_text", "")
    b["description"] = desc.strip()
    b.setdefault("brand", b["title"].split(":")[0].split(" — ")[0][:40])
    b.setdefault("content_type", "collection" if content.get("kind_hint") == "collection" else "article")
    b.setdefault("intensity", "cinematic")
    b.setdefault("slug", slugify(b.get("theme", "") + "-" + b["title"], "openwebx-site"))
    b["slug"] = slugify(b["slug"], "openwebx-site")

    pal = dict(b.get("palette") or {})
    for key in ("bg", "ink", "accent"):
        if key not in pal:
            raise BriefError(f"palette.{key} is required")
    pal.setdefault("scheme", "dark")
    pal.setdefault("surface", pal["bg"])
    pal.setdefault("muted", pal["ink"])
    pal.setdefault("accent2", pal["accent"])
    pal.setdefault("line", "rgba(127,127,127,.25)")
    pal.setdefault("scrim", "rgba(0,0,0,.55)" if pal["scheme"] == "dark" else "rgba(255,255,255,.7)")
    b["palette"] = pal

    fonts = dict(b.get("fonts") or {})
    fonts.setdefault("display", {"family": "Fraunces", "weights": "300..700", "fallback": "serif"})
    fonts.setdefault("body", {"family": "Inter", "weights": [400, 500], "fallback": "sans-serif"})
    fonts.setdefault("mono", {"family": "IBM Plex Mono", "weights": [400], "fallback": "monospace"})
    if b["lang"] == "th":
        fonts.setdefault("thai_display", {"family": "Noto Serif Thai", "weights": [400, 600], "fallback": "serif"})
        fonts.setdefault("thai_body", {"family": "IBM Plex Sans Thai", "weights": [400, 500], "fallback": "sans-serif"})
    b["fonts"] = fonts

    ui = dict(UI_DEFAULTS.get(b["lang"], UI_DEFAULTS["en"]))
    ui.update(b.get("ui") or {})
    b["ui"] = ui
    b["chrome"] = normalise_chrome(b, warnings)
    status = b.get("arrival_status")
    if status is not None and (not isinstance(status, str) or not status.strip()):
        raise BriefError("arrival_status must be one non-empty sentence")
    b["arrival_status"] = (status or ui["ready"]).strip()
    b.setdefault("sound", {})
    if not isinstance(b["sound"], dict):
        raise BriefError("brief.sound must be an object ({pitch, cues})")
    b.setdefault("scene", {})
    if not isinstance(b["scene"], dict):
        raise BriefError("brief.scene must be an object")
    if not hero_ok(b["scene"].get("hero")):
        warnings.append("brief.scene.hero is missing or incomplete; qa.py (Q-hero) will fail the site")
    b.setdefault("hero", {})
    look = dict(b.get("look") or {})
    quiet = look.get("quiet", 0.6)
    if not isinstance(quiet, (int, float)) or not 0 <= quiet <= 1:
        raise BriefError("look.quiet must be a number from 0 to 1")
    look["quiet"] = quiet
    b["look"] = look

    chapters = b.get("chapters")
    if not chapters:
        raise BriefError("brief.chapters must list at least one chapter")
    chapters = b["chapters"] = [dict(ch) for ch in chapters]
    ids = [s["id"] for s in content["sections"]]
    used: list[str] = []
    for i, ch in enumerate(chapters):
        ch.setdefault("name", f"{i + 1:02d}")
        ch.setdefault("sections", [])
        if "layout" in ch:
            hint = LAYOUT_MIGRATION.get(ch["layout"], "a composition and a side")
            raise BriefError(f"chapter {i}: 'layout' was removed in 0.2.0; use {hint} "
                             "(compositions: opening, paper, spread, ledger, caption, dossier, interlude)")
        if "panel" in ch:
            raise BriefError(f"chapter {i}: 'panel' was removed in 0.2.0; drop it (no boxes over the world: "
                             "long text uses composition 'paper', and text over the world gets a quiet zone)")
        for sid in ch["sections"]:
            if sid not in ids:
                raise BriefError(f"chapter {i} references unknown section '{sid}'")
            used.append(sid)
    missing = [s for s in ids if s not in used]
    dupes = sorted({s for s in used if used.count(s) > 1})
    if missing or dupes:
        raise BriefError(f"every section must be used exactly once. missing={missing} duplicated={dupes}")
    if used != ids:
        raise BriefError(f"sections must keep source order. got {used}, expected {ids}")
    secs = {s["id"]: s for s in content["sections"]}
    units = [sum(text_units(secs[sid].get("text", "")) for sid in ch["sections"]) for ch in chapters]
    b["reading"] = normalise_reading(b, units, warnings)
    normalise_compositions(b, chapters, units, secs)
    chrome = b["chrome"]
    values = chrome.get("values")
    if values is not None and len(values) != len(chapters):
        raise BriefError(f"chrome.values must have one value per chapter ({len(chapters)}), got {len(values)}")
    if chrome["folio"] == "value-name" and values is None:
        raise BriefError("chrome.folio 'value-name' needs chrome.values (one authored value per chapter)")
    listed = contents_chapters(chapters)
    if chrome["contents"] == "none" and listed:
        raise BriefError("chrome.contents 'none' is only for single-chapter pieces; use 'list' or 'sentence'")
    if chrome["contents"] != "none" and not listed:
        raise BriefError("chrome.contents needs at least one reading chapter after chapter 0; use 'none' for a single-chapter piece")

    # Theme IP: AI-written copy must not use franchise terms.
    avoid = [t.lower() for t in (b.get("concept", {}).get("avoid_terms") or []) if t.strip()]
    if avoid:
        authored = json.dumps({k: b.get(k) for k in ("ui", "hero", "brand", "footer", "arrival_status")}, ensure_ascii=False).lower()
        authored += json.dumps([{k: c.get(k) for k in ("name", "eyebrow", "display")} for c in chapters], ensure_ascii=False).lower()
        authored += json.dumps(b.get("chrome", {}), ensure_ascii=False).lower()
        hits = sorted({t for t in avoid if t in authored})
        if hits:
            raise BriefError(f"brief copy uses avoid_terms {hits}; rewrite as inspired-by")
    return b, warnings


def normalise_chrome(b: dict, warnings: list[str]) -> dict:
    """Validate brief.chrome (0.2.0 model) and fill defaults. Removed 0.1.0
    keys are rejected with a migration hint."""
    for key, hint in REMOVED_BRIEF.items():
        if key in b:
            raise BriefError(f"brief.{key} was removed in 0.2.0: {hint}")
    raw = b.get("chrome") or {}
    if not isinstance(raw, dict):
        raise BriefError("brief.chrome must be an object")
    for key, hint in REMOVED_CHROME.items():
        if key in raw:
            raise BriefError(f"chrome.{key} was removed in 0.2.0: {hint}")
    unknown = sorted(set(raw) - set(CHROME) - CHROME_COPY)
    if unknown:
        raise BriefError(f"unknown chrome keys {unknown}; allowed: {sorted(set(CHROME) | CHROME_COPY)}")
    if raw.get("sound") in ("text", "icon"):
        raise BriefError(f"chrome.sound '{raw['sound']}' was removed in 0.2.0: use 'offer' and write the invitation in chrome.sound_label")
    chrome = {**CHROME_DEFAULTS, **raw}
    for key, allowed in CHROME.items():
        if chrome[key] not in allowed:
            raise BriefError(f"chrome.{key} '{chrome[key]}' not in {sorted(allowed)}")
    values = chrome.get("values")
    if values is not None:
        if not isinstance(values, list) or not all(isinstance(v, (str, int, float)) and str(v).strip() for v in values):
            raise BriefError("chrome.values must be a list of short non-empty strings, one per chapter")
        chrome["values"] = [str(v).strip() for v in values]
    ui = b["ui"]
    label = chrome.get("sound_label")
    if label is None:
        label = dict(ui["sound_label"])
    elif not (isinstance(label, dict) and all(isinstance(label.get(k), str) and label[k].strip() for k in ("off", "on"))):
        raise BriefError('chrome.sound_label must be {"off": "<invitation>", "on": "<phrase>"}')
    if any(re.fullmatch(r"\s*sound\s*(on|off)\s*", label[k], re.I) for k in ("off", "on")):
        raise BriefError("chrome.sound_label must be authored phrases in the theme's voice, not an on/off switch label")
    chrome["sound_label"] = {"off": label["off"].strip(), "on": label["on"].strip()}
    lead = chrome.get("contents_lead")
    if lead is not None and (not isinstance(lead, str) or not lead.strip()):
        raise BriefError("chrome.contents_lead must be a short authored lead-in")
    chrome["contents_lead"] = (lead or ui["contents_lead"]).strip()
    reasons = chrome.get("reasons") or {}
    missing = [k for k in CHROME if k not in reasons]
    if missing:
        warnings.append(f"chrome.reasons has no reason for {missing} (the director writes one line per key)")
    return chrome


def contents_chapters(chapters: list[dict]) -> list[int]:
    """Chapters the contents lists: the reading chapters after chapter 0
    (interludes are decorative and aria-hidden)."""
    return [i for i, ch in enumerate(chapters) if i > 0 and ch.get("composition") != "interlude"]


def text_units(text: str) -> float:
    """Reading length in units: one Latin word, or four Thai characters."""
    thai = len(re.findall(r"[\u0e00-\u0e7f]", text or ""))
    words = len(re.findall(r"[^\W_]+(?:['’-][^\W_]+)*", re.sub(r"[\u0e00-\u0e7f]+", " ", text or "")))
    return words + thai / 4


def describe_units(n: float) -> str:
    return f"~{round(n)} words (1 word = 4 Thai characters)"


def hero_ok(hero) -> bool:
    """brief.scene.hero: {"source": "cc0", "id": ...} or
    {"source": "procedural", "detail": [>= 3 concrete features]}."""
    if not isinstance(hero, dict):
        return False
    if hero.get("source") == "cc0":
        return isinstance(hero.get("id"), str) and bool(hero["id"].strip())
    if hero.get("source") == "procedural":
        detail = hero.get("detail")
        return isinstance(detail, list) and len([d for d in detail if isinstance(d, str) and d.strip()]) >= 3
    return False


def normalise_reading(b: dict, units: list[float], warnings: list[str]) -> str:
    reading = b.get("reading")
    if reading is None:
        long = sum(units) > LONG_TOTAL or any(u > LONG_CHAPTER for u in units)
        return "interleave" if long else "overlay"
    if reading not in READINGS:
        raise BriefError(f"reading '{reading}' not in {sorted(READINGS)}")
    if not (b["chrome"].get("reasons") or {}).get("reading"):
        warnings.append("brief.reading is set by hand; give the reason in chrome.reasons.reading")
    return reading


def default_composition(i: int, ch: dict, n: float, html: str, reading: str) -> str:
    if i == 0:
        return "opening"
    if not ch["sections"]:
        return "interlude"
    if "<table" in html:
        return "ledger"
    if n <= LENGTH_LIMITS["caption"]:
        return "caption"
    if reading != "interleave" and n <= LENGTH_LIMITS["dossier"]:
        return "dossier"
    return "spread" if n <= 400 else "paper"


def normalise_compositions(b: dict, chapters: list[dict], units: list[float], secs: dict) -> None:
    """Fill composition/side/tone/frame and enforce the composition rules:
    opening is chapter 0 only, center only for opening/interlude, no two
    neighbours with the same (composition, side), and length limits."""
    reading = b["reading"]
    prev = None
    for i, ch in enumerate(chapters):
        html = "".join(secs[sid].get("html", "") for sid in ch["sections"])
        comp = ch.get("composition") or default_composition(i, ch, units[i], html, reading)
        if comp not in COMPOSITIONS:
            raise BriefError(f"chapter {i} composition '{comp}' not in {sorted(COMPOSITIONS)}")
        if (i == 0) != (comp == "opening"):
            raise BriefError(f"chapter {i}: 'opening' is chapter 0's composition and only chapter 0's")
        if comp == "interlude":
            if ch["sections"]:
                raise BriefError(f"chapter {i} is an interlude (one display line) and cannot hold sections; use caption or paper")
            n = text_units(ch.get("display", ""))
        else:
            n = units[i]
        limit = LENGTH_LIMITS.get(comp)
        if limit is not None and n > limit:
            raise BriefError(f"chapter {i} is a {comp} with {describe_units(n)}; {comp} allows {limit}. "
                             "Use paper, spread or ledger for longer text")
        if i > 0 and comp != "interlude" and not ch["sections"]:
            raise BriefError(f"chapter {i} has no sections; only an interlude may be empty")
        explicit = ch.get("side")
        side = explicit or ("center" if comp == "interlude" else
                            "left" if comp == "opening" or not prev or prev[1] != "left" else "right")
        if side not in SIDES:
            raise BriefError(f"chapter {i} side '{side}' not in {sorted(SIDES)}")
        if side == "center" and comp not in ("opening", "interlude"):
            raise BriefError(f"chapter {i}: side 'center' is only for opening and interlude (never centre body text)")
        if prev == (comp, side) and not explicit and side != "center":
            side = "right" if side == "left" else "left"
        if prev == (comp, side):
            raise BriefError(f"chapters {i - 1} and {i} are both ({comp}, {side}); neighbours need a different composition or side")
        tone = ch.get("tone")
        if tone is not None and tone not in TONES:
            raise BriefError(f"chapter {i} tone '{tone}' not in {sorted(TONES)}")
        frame = ch.get("frame", "fit")
        if frame not in FRAMES:
            raise BriefError(f"chapter {i} frame '{frame}' not in {sorted(FRAMES)}")
        ch["composition"], ch["side"], ch["frame"] = comp, side, frame
        prev = (comp, side)


# ------------------------------------------------------------------ fonts & tokens

def gf_family(f: dict) -> str:
    name = f["family"].strip().replace(" ", "+")
    w = f.get("weights", [400])
    if isinstance(w, str):  # variable range such as "200..800"
        axis = f"ital,wght@0,{w};1,{w}" if f.get("italic") else f"wght@{w}"
    else:
        ws = sorted({int(x) for x in w})
        if f.get("italic"):
            axis = "ital,wght@" + ";".join([f"0,{x}" for x in ws] + [f"1,{x}" for x in ws])
        else:
            axis = "wght@" + ";".join(str(x) for x in ws)
    return f"family={name}:{axis}"


def font_links(fonts: dict) -> str:
    seen, links = set(), []
    for f in fonts.values():
        if not isinstance(f, dict) or f.get("source", "google") != "google" or not f.get("family"):
            continue
        fam = gf_family(f)
        if fam in seen:
            continue
        seen.add(fam)
        # One stylesheet per family: an unavailable weight only breaks that family.
        links.append(f'  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?{fam}&amp;display=swap">')
    if links:
        links.insert(0, '  <link rel="preconnect" href="https://fonts.googleapis.com">\n  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>')
    return "\n".join(links)


def stack(*fonts: dict | None, fallback: str) -> str:
    names = []
    for f in fonts:
        if f and f.get("family"):
            names.append(f"'{f['family']}'")
    return ", ".join(names + [fallback])


def tokens_css(b: dict) -> str:
    p, f, t = b["palette"], b["fonts"], b.get("type") or {}
    display = stack(f.get("display"), f.get("thai_display"), fallback=f["display"].get("fallback", "serif"))
    body = stack(f.get("body"), f.get("thai_body"), fallback=f["body"].get("fallback", "sans-serif"))
    mono = stack(f.get("mono"), f.get("thai_body"), fallback="monospace")
    return f"""/* Generated by openwebx scaffold from brief.json. Edit the brief, then re-run scaffold --site. */
:root {{
  color-scheme: {p['scheme']};
  --ox-bg: {p['bg']};
  --ox-surface: {p['surface']};
  --ox-ink: {p['ink']};
  --ox-muted: {p['muted']};
  --ox-accent: {p['accent']};
  --ox-accent-2: {p['accent2']};
  --ox-line: {p['line']};
  --ox-scrim: {p['scrim']};
  --ox-font-display: {display};
  --ox-font-body: {body};
  --ox-font-mono: {mono};
  --ox-display-weight: {t.get('display_weight', 400)};
  --ox-display-tracking: {t.get('display_tracking', '-0.02em')};
  --ox-leading: {t.get('leading', 1.75 if b['lang'] in ('th', 'lo', 'my', 'km') else 1.65)};
  --ox-measure: {t.get('measure', '62ch')};
  --ox-radius: {t.get('radius', '0px')};
  --ox-paper: {p.get('paper', p['surface'])};
  --ox-paper-ink: {p.get('paper_ink', p['ink'])};
  --ox-quiet: {b['look']['quiet']};
}}
"""


# ------------------------------------------------------------------ content

def rewrite_images(html: str, section: dict, media: Path, first_image: list) -> tuple[str, list[str]]:
    notes: list[str] = []
    by_src = {i["src"]: i for i in section.get("images", [])}

    def repl(m):
        tag = m.group(0)
        src = m.group(1)
        info = by_src.get(src, {})
        new_src = src
        # A refresh reuses the copy recorded in the snapshot, so it works even
        # when the original content folder has moved or is on another drive.
        if info.get("media") and (media.parent / info["media"]).is_file():
            new_src = info["media"]
        elif info.get("path"):
            path = Path(info["path"])
            if path.is_file():
                new_src = "media/" + copy_media(path, media)
                info["media"] = new_src
            else:
                notes.append(f"missing image {src}")
        attrs = ""
        if first_image[0]:
            attrs = ' loading="lazy" decoding="async"'
        first_image[0] = True
        tag = tag.replace(f'src="{src}"', f'src="{esc(new_src)}"', 1)
        if "alt=" not in tag:
            tag = tag[:-1] + ' alt=""' + ">"
        return tag[:-1] + attrs + ">"

    return re.sub(r'<img\b[^>]*\bsrc="([^"]+)"[^>]*>', repl, html), notes


def copy_media(path: Path, media: Path) -> str:
    media.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha1(str(path).encode()).hexdigest()[:6]
    stem = slugify(path.stem, "img")
    ext = path.suffix.lower()
    if ext in (".jpg", ".jpeg", ".png"):
        try:
            from PIL import Image  # optional
            img = Image.open(path)
            img.thumbnail((2000, 2000))
            name = f"{stem}-{digest}.webp"
            img.save(media / name, "WEBP", quality=82, method=6)
            return name
        except Exception:
            pass
    name = f"{stem}-{digest}{ext}"
    shutil.copy2(path, media / name)
    return name


def mark_split(html: str) -> str:
    return re.sub(r"<h2>", "<h2 data-split>", html, count=1)


def render_folio(b: dict, i: int) -> str:
    """Running head of chapter i. It sits in the chapter's own flow at the
    head of the section and links back to the contents."""
    c, ui, chs = b["chrome"], b["ui"], b["chapters"]
    if c["folio"] == "none":
        return ""
    ch = chs[i]
    parts = []
    if c["folio"] == "number-name":
        parts.append(f'<span class="ox-folio__num">{i + 1} / {len(chs)}</span> <span class="ox-folio__sep" aria-hidden="true">·</span>')
    elif c["folio"] == "value-name":
        parts.append(f'<span class="ox-folio__value">{esc(c["values"][i])}</span>')
    parts.append(f'<span class="ox-folio__name">{esc(ch["name"])}</span>')
    inner = " ".join(parts)
    # Breath interludes are aria-hidden: their folio is text, never a focusable link.
    if c["contents"] != "none" and ch["composition"] != "interlude":
        return (f'<a class="ox-folio" href="#contents" data-folio="{c["folio"]}">{inner}'
                f'<span class="ox-sr-only"> · {esc(ui["contents"])}</span></a>')
    return f'<p class="ox-folio" data-folio="{c["folio"]}">{inner}</p>'


NUMERAL_MAX = 6  # characters: "05:30", "1868", "−4 s" fit; phrases do not


def render_numeral(b: dict, i: int) -> str:
    """The large chapter numeral of paper and dossier chapters (decoration;
    chrome.folio decides its content: a short value (a time, a year, a
    figure) for value-name, else the chapter number; none for folio none).
    A value that is a phrase would repeat the folio right above it in large
    type, so those chapters get the number."""
    c, ch = b["chrome"], b["chapters"][i]
    if ch["composition"] not in ("paper", "dossier") or c["folio"] == "none":
        return ""
    value = c["values"][i] if c["folio"] == "value-name" else ""
    text = value if value and len(value) <= NUMERAL_MAX else str(i + 1)
    return f'<span class="ox-numeral" aria-hidden="true">{esc(text)}</span>'


def render_contents(b: dict) -> str:
    """The table of contents: a real <nav id="contents"> in chapter 0 whose
    entries are #ch-N links (works without JavaScript)."""
    c, ui, chs = b["chrome"], b["ui"], b["chapters"]
    if c["contents"] == "none":
        return ""
    listed = contents_chapters(chs)
    values = c.get("values")
    if c["contents"] == "list":
        items = []
        for i in listed:
            value = f'<span class="ox-contents__value">{esc(values[i])}</span> ' if values else ""
            items.append(f'<li><a href="#ch-{i}">{value}<span class="ox-contents__name">{esc(chs[i]["name"])}</span></a></li>')
        return (f'<nav id="contents" class="ox-contents" data-contents="list" aria-labelledby="contents-label">'
                f'<p class="ox-contents__label" id="contents-label">{esc(ui["contents"])}</p>'
                f'<ol>{"".join(items)}</ol></nav>')
    links = [f'<a href="#ch-{i}">{esc(chs[i]["name"])}</a>' for i in listed]
    joined = links[0] if len(links) == 1 else esc(ui["list_sep"]).join(links[:-1]) + esc(ui["list_and"]) + " " + links[-1]
    return (f'<nav id="contents" class="ox-contents" data-contents="sentence" aria-label="{esc(ui["contents"])}">'
            f'<p class="ox-contents__sentence">{esc(c["contents_lead"])} {joined}{esc(ui["sentence_end"])}</p></nav>')


def render_sound(b: dict) -> str:
    """The sound offer: a real toggle button in chapter 0. It stays hidden
    until the runtime can actually play sound (never shown without JS)."""
    c = b["chrome"]
    if c["sound"] == "none":
        return ""
    return (f'<button class="ox-sound" type="button" aria-pressed="false" hidden>'
            f'<span class="ox-sound__label">{esc(c["sound_label"]["off"])}</span></button>')


def render_tag_layer(b: dict) -> str:
    if b["chrome"]["tags"] == "none":
        return ""
    return ('  <div class="ox-tag" aria-hidden="true"></div>\n'
            '  <p class="ox-tag-live ox-sr-only" aria-live="polite"></p>\n')


def render_chapters(b: dict, content: dict, media: Path) -> tuple[str, list[str]]:
    secs = {s["id"]: s for s in content["sections"]}
    out, notes = [], []
    first_image = [False]
    for i, ch in enumerate(b["chapters"]):
        comp, side = ch["composition"], ch["side"]
        extra = ' aria-hidden="true"' if comp == "interlude" else ""
        if ch.get("tone"):
            extra += f' data-tone="{ch["tone"]}"'
        if ch["frame"] != "fit":
            extra += f' data-frame="{ch["frame"]}"'
        head = (f'    <section class="ox-chapter ox-chapter--{comp}" id="ch-{i}" data-chapter="{i}" data-name="{esc(ch["name"])}" '
                f'data-composition="{comp}" data-side="{side}"{extra}>')
        folio = render_folio(b, i)
        inner = []
        # Text over the world gets a quiet zone; the CSS fallback layer sits behind it.
        if comp not in PAPER and b["reading"] != "beside":
            inner.append('<div class="ox-quiet" aria-hidden="true"></div>')
        numeral = render_numeral(b, i)
        if numeral:
            inner.append(numeral)
        if i == 0:
            hero = b.get("hero") or {}
            if hero.get("eyebrow"):
                inner.append(f'<p class="ox-eyebrow"><i></i><span>{esc(hero["eyebrow"])}</span></p>')
            inner.append(f"<h1 data-split>{esc(content.get('h1') or b['title'])}</h1>")
            if hero.get("lede"):
                inner.append(f'<p class="ox-lede">{esc(hero["lede"])}</p>')
        elif ch.get("eyebrow"):
            inner.append(f'<p class="ox-eyebrow"><i></i><span>{esc(ch["eyebrow"])}</span></p>')
        if comp == "interlude" and ch.get("display"):
            inner.append(f'<p class="ox-display">{esc(ch["display"])}</p>')
        for sid in ch["sections"]:
            html, n = rewrite_images(secs[sid]["html"], secs[sid], media, first_image)
            notes.extend(n)
            inner.append(f"<!-- {sid} -->" + mark_split(html))
        if i == 0:
            inner += [x for x in (render_contents(b), render_sound(b)) if x]
        body = "\n        ".join(inner)
        folio_line = f"\n      {folio}" if folio else ""
        out.append(f'{head}{folio_line}\n      <div class="ox-chapter__inner ox-prose">\n        {body}\n      </div>\n    </section>')
    return "\n".join(out), notes


# ------------------------------------------------------------------ SEO

def json_ld(b: dict, content: dict) -> list[dict]:
    fm = content.get("front_matter", {})
    lang = b["lang"]
    url = b.get("canonical")
    image = b.get("og_image")
    graph: list[dict] = []
    ctype = b["content_type"]
    if ctype == "article":
        art = {"@type": "Article", "headline": b["title"][:110], "description": b["description"], "inLanguage": lang}
        if fm.get("author"):
            art["author"] = {"@type": "Person" if " " in str(fm["author"]) and len(str(fm["author"])) < 40 else "Organization", "name": fm["author"]}
        if fm.get("date"):
            art["datePublished"] = fm["date"]
            art["dateModified"] = fm.get("updated", fm["date"])
        if fm.get("keywords"):
            art["keywords"] = fm["keywords"] if isinstance(fm["keywords"], str) else ", ".join(fm["keywords"])
        if image:
            art["image"] = image
        if url:
            art["mainEntityOfPage"] = url
        graph.append(art)
    elif ctype == "collection":
        items = [{"@type": "ListItem", "position": k + 1, "name": s["heading"]} for k, s in enumerate(content["sections"]) if s["heading"]]
        graph.append({"@type": "CollectionPage", "name": b["title"], "description": b["description"], "inLanguage": lang,
                      "mainEntity": {"@type": "ItemList", "itemListElement": items}})
    elif ctype == "product":
        prod = {"@type": "Product", "name": b.get("brand") or b["title"], "description": b["description"]}
        if image:
            prod["image"] = image
        graph.append(prod)  # never invent offers, prices or reviews
    elif ctype == "profile":
        graph.append({"@type": "ProfilePage", "name": b["title"], "description": b["description"], "inLanguage": lang,
                      "mainEntity": {"@type": "Person", "name": b.get("brand") or b["title"]}})
    else:
        graph.append({"@type": "WebPage", "name": b["title"], "description": b["description"], "inLanguage": lang})
    if content.get("faq"):
        graph.append({"@type": "FAQPage", "mainEntity": [
            {"@type": "Question", "name": f["question"], "acceptedAnswer": {"@type": "Answer", "text": f["answer"]}}
            for f in content["faq"]]})
    for g in graph:
        g.setdefault("@context", "https://schema.org")
    return graph


def head_meta(b: dict) -> str:
    lines = ['  <meta name="robots" content="index, follow, max-image-preview:large">']
    if b.get("canonical"):
        lines.append(f'  <link rel="canonical" href="{esc(b["canonical"])}">')
    og_type = "article" if b["content_type"] == "article" else "website"
    lines += [
        f'  <meta property="og:type" content="{og_type}">',
        f'  <meta property="og:title" content="{esc(b["title"])}">',
        f'  <meta property="og:description" content="{esc(b["description"])}">',
        f'  <meta property="og:locale" content="{LOCALES.get(b["lang"], b["lang"])}">',
        f'  <meta name="twitter:card" content="{"summary_large_image" if b.get("og_image") else "summary"}">',
    ]
    if b.get("canonical"):
        lines.append(f'  <meta property="og:url" content="{esc(b["canonical"])}">')
    if b.get("og_image"):
        lines.append(f'  <meta property="og:image" content="{esc(b["og_image"])}">')
    return "\n".join(lines)


def favicon(b: dict) -> str:
    c = b["palette"]["accent"].replace("#", "%23")
    # A plain filled mark in the accent colour (no rings: some themes forbid them).
    return ("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E"
            f"%3Crect x='7' y='7' width='18' height='18' rx='3' fill='{c}'/%3E%3C/svg%3E")


def runtime_brief(b: dict) -> dict:
    return {
        "lang": b["lang"],
        "concept": (b.get("concept") or {}).get("name", ""),
        "intensity": b["intensity"],
        "palette": b["palette"],
        "reading": b["reading"],
        "chapters": [{k: ch.get(k) for k in ("name", "composition", "side", "tone", "frame", "beat", "interaction", "params")
                      if ch.get(k) is not None} for ch in b["chapters"]],
        "chrome": {**{k: b["chrome"][k] for k in CHROME}, "sound_label": b["chrome"]["sound_label"]},
        "arrival_status": b["arrival_status"],
        "look": b.get("look") or {},
        "sound": b["sound"],
        "scene": b["scene"],
    }


def dumps_script(obj, indent=2) -> str:
    return json.dumps(obj, ensure_ascii=False, indent=indent).replace("</", "<\\/")


def render_index(b: dict, content: dict, media: Path) -> tuple[str, list[str]]:
    chapters_html, notes = render_chapters(b, content, media)
    tmpl = (RUNTIME / "index.html.tmpl").read_text(encoding="utf-8")
    ui = b["ui"]
    footer = b.get("footer") or f"{b['brand']} · {date.today().year}"
    failsafe = int(b.get("failsafe_ms", 8000))
    values = {
        "LANG": b["lang"], "SCHEME": b["palette"]["scheme"], "TITLE": esc(b["title"]),
        "DESCRIPTION": esc(b["description"]), "HEAD_META": head_meta(b), "THEME_COLOR": b["palette"]["bg"],
        "VERSION": plugin_version(), "FAVICON": favicon(b), "FONT_LINKS": font_links(b["fonts"]),
        "FAILSAFE_MS": str(failsafe), "HOLD_MS": str(min(HOLD_MS, failsafe)), "ARRIVAL": b["chrome"]["arrival"], "READING": b["reading"],
        "IMPORTMAP": dumps_script(IMPORTMAP),
        # Fetch three.js in parallel with fonts instead of after main.js parses.
        "MODULE_PRELOAD": f'  <link rel="modulepreload" href="{IMPORTMAP["imports"]["three"]}" crossorigin>', "JSONLD": dumps_script(json_ld(b, content)),
        "RUNTIME_BRIEF": dumps_script(runtime_brief(b)), "SKIP_LABEL": esc(ui["skip"]),
        "TAG_LAYER": render_tag_layer(b), "CHAPTERS": chapters_html, "FOOTER": esc(footer),
    }
    html = re.sub(r"\{\{([A-Z_]+)\}\}", lambda m: values[m.group(1)], tmpl)
    return html, notes


# ------------------------------------------------------------------ files

def copy_runtime(site: Path, refresh: bool):
    """Copy the runtime kit. On refresh, core files are updated but the
    builder-owned files (src/scene/**, css/theme.css) are never touched."""
    for src in RUNTIME.rglob("*"):
        if src.is_dir() or src.name == "index.html.tmpl" or "__pycache__" in src.parts:
            continue
        rel = src.relative_to(RUNTIME)
        dst = site / rel
        if refresh and (rel.parts[:2] == ("src", "scene") or rel.as_posix() == "css/theme.css") and dst.exists():
            continue
        if not refresh and dst.exists():
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
    theme = site / "css" / "theme.css"
    if not theme.exists():
        theme.write_text("/* Art direction for this site. Written by the openwebx builder. */\n", encoding="utf-8")


def unique_dir(root: Path, slug: str) -> Path:
    d = root / slug
    k = 2
    while d.exists():
        d = root / f"{slug}-{k}"
        k += 1
    return d


def site_readme(b: dict) -> str:
    return f"""# {b['title']}

Generated by openwebx {plugin_version()}. Concept: {(b.get('concept') or {}).get('name', 'untitled')}.

View locally (ES modules need HTTP):

    python serve.py

Deploy: upload this folder to any static host (GitHub Pages, Netlify, Cloudflare Pages).
`_openwebx/` holds the brief and content snapshot used to build the page; it is not needed at runtime.
"""


# Image "src" values are HTML URLs, not filesystem paths; only brief assets'
# "src" is a path, handled below.
PATH_KEYS = ("path", "file", "source")


def map_paths(obj, fn):
    """Apply fn to every filesystem path stored in a content/brief snapshot."""
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            if k in PATH_KEYS and isinstance(v, str):
                out[k] = fn(v)
            elif k == "unreferenced_images" and isinstance(v, list):
                out[k] = [fn(x) if isinstance(x, str) else x for x in v]
            elif k == "assets" and isinstance(v, list):
                out[k] = [{**a, "src": fn(a["src"])} if isinstance(a, dict) and isinstance(a.get("src"), str) else a for a in v]
            else:
                out[k] = map_paths(v, fn)
        return out
    if isinstance(obj, list):
        return [map_paths(v, fn) for v in obj]
    return obj


def portable(obj, site: Path):
    """Snapshots are shipped with the site: store paths relative to it, never
    absolute machine paths."""
    def rel(v: str) -> str:
        if not os.path.isabs(v):
            return v
        try:
            return Path(os.path.relpath(v, site)).as_posix()
        except ValueError:  # different drive on Windows
            return Path(v).name
    return map_paths(obj, rel)


def resolve(obj, site: Path):
    def absolute(v: str) -> str:
        if os.path.isabs(v) or re.match(r"^[a-z]+:", v):
            return v
        p = (site / v).resolve()
        return str(p) if p.exists() else v
    return map_paths(obj, absolute)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--content", type=Path)
    ap.add_argument("--brief", type=Path)
    ap.add_argument("--brief-md", type=Path)
    ap.add_argument("--out-root", type=Path, default=Path.cwd() / "openwebx-out")
    ap.add_argument("--site", type=Path, help="re-render an existing site")
    args = ap.parse_args(argv)
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    if args.site:
        site = args.site.resolve()
        meta = site / "_openwebx"
        content = resolve(json.loads((args.content or meta / "content.json").read_text(encoding="utf-8")), site)
        brief_raw = resolve(json.loads((args.brief or meta / "brief.json").read_text(encoding="utf-8")), site)
        refresh = True
    else:
        if not (args.content and args.brief):
            ap.error("--content and --brief are required for a new site")
        content = json.loads(args.content.read_text(encoding="utf-8"))
        brief_raw = json.loads(args.brief.read_text(encoding="utf-8"))
        refresh = False

    try:
        brief, warnings = normalise_brief(brief_raw, content)
    except BriefError as e:
        print(f"openwebx scaffold: brief rejected: {e}", file=sys.stderr)
        sys.exit(2)

    if not refresh:
        args.out_root.mkdir(parents=True, exist_ok=True)
        site = unique_dir(args.out_root.resolve(), brief["slug"])
        site.mkdir(parents=True)

    copy_runtime(site, refresh)
    (site / "css" / "tokens.css").write_text(tokens_css(brief), encoding="utf-8")
    html, notes = render_index(brief, content, site / "media")
    (site / "index.html").write_text(html, encoding="utf-8")
    for asset in brief.get("assets", []):
        p = Path(asset.get("src", ""))
        if p.is_file():
            asset["as"] = "media/" + copy_media(p, site / "media")
    meta = site / "_openwebx"
    meta.mkdir(exist_ok=True)
    (meta / "content.json").write_text(json.dumps(portable(content, site), ensure_ascii=False, indent=2), encoding="utf-8")
    (meta / "brief.json").write_text(json.dumps(portable(brief_raw, site), ensure_ascii=False, indent=2), encoding="utf-8")
    if args.brief_md and args.brief_md.is_file():
        shutil.copy2(args.brief_md, meta / "brief.md")
    if brief.get("assets"):
        (meta / "assets.json").write_text(json.dumps(portable({"assets": brief["assets"]}, site)["assets"], ensure_ascii=False, indent=2), encoding="utf-8")
    (meta / "manifest.json").write_text(json.dumps({
        "openwebx": plugin_version(), "three": THREE, "gsap": GSAP, "theme": brief.get("theme", ""),
        "slug": brief["slug"], "built": date.today().isoformat(),
        "sources": [portable({"file": s["file"]}, site)["file"] for s in content.get("sources", [])],
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    if not (site / "README.md").exists():
        (site / "README.md").write_text(site_readme(brief), encoding="utf-8")

    for w in warnings + notes:
        print(f"warning: {w}")
    print(f"{'refreshed' if refresh else 'created'} {site}")
    print(f"chapters: {len(brief['chapters'])}  sections: {len(content['sections'])}  lang: {brief['lang']}")
    return site


if __name__ == "__main__":
    main()
