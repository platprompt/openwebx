#!/usr/bin/env python3
"""openwebx static QA for a generated site.

    python qa.py <site-dir> [--json] [--online]

Checks the parts a browser session cannot prove quickly: verbatim content,
SEO head, structured data, pinned CDN versions, import graph, JS syntax
(when Node is available), scene contract, theme IP terms, the originality
lint (no removed 0.1.0 chrome, no reference house style) and asset weight.
Exit code 1 when any error is found. Browser checks (console errors, FPS,
screenshots, reduced motion) are the critic's job on top of this.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
from html.parser import HTMLParser
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from ox_html import normalize_ws, to_text  # noqa: E402

KIT_SCENE = HERE.parent / "runtime" / "src" / "scene" / "scene.js"
PINNED = re.compile(r"@\d+\.\d+\.\d+/")


class Doc(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.lang = ""
        self.title = ""
        self.meta: dict[str, str] = {}
        self.h1 = 0
        self.scripts: list[tuple[dict, str]] = []
        self.refs: list[tuple[str, str]] = []
        self.imgs: list[dict] = []
        self._tag = None
        self._buf: list[str] = []
        self._attrs: dict = {}

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "html":
            self.lang = a.get("lang", "")
        if tag == "h1":
            self.h1 += 1
        if tag == "meta":
            k = (a.get("name") or a.get("property") or "").lower()
            if k:
                self.meta[k] = a.get("content") or ""
        if tag in ("title", "script"):
            self._tag, self._buf, self._attrs = tag, [], a
        if tag == "script" and a.get("src"):
            self.refs.append(("script", a["src"]))
        if tag == "link" and a.get("href"):
            self.refs.append(("link", a["href"]))
        if tag == "img":
            self.imgs.append(a)
            if a.get("src"):
                self.refs.append(("img", a["src"]))

    def handle_endtag(self, tag):
        if tag == self._tag:
            text = "".join(self._buf)
            if tag == "title":
                self.title = text.strip()
            else:
                self.scripts.append((self._attrs, text))
            self._tag = None

    def handle_data(self, data):
        if self._tag:
            self._buf.append(data)


def main_text(html: str) -> str:
    m = re.search(r"<main\b[^>]*>(.*)</main>", html, re.S)
    return to_text(m.group(1)) if m else ""


def js_files(site: Path) -> list[Path]:
    return sorted(p for p in (site / "src").rglob("*.js"))


# ------------------------------------------------------------------ originality lint
# 0.2.0 removed site chrome that followed external reference material too
# closely (docs/decisions/0.2.0-chrome-and-arrival.md). None of it may come
# back through the kit, the scaffold or a builder's scene/theme code.
END = r"(?![\w-])"
REMOVED_MARKUP = [
    (rf"\box-hud{END}", "fixed HUD (.ox-hud)"),
    (rf"\box-brand{END}", "fixed brand mark (.ox-brand)"),
    (rf"\box-readout{END}", "HUD readout (.ox-readout)"),
    (rf"\box-cue{END}", "scroll cue (.ox-cue)"),
    (rf"\box-loader\w*", "overlay loader (.ox-loader)"),
    (rf"\bdata-count{END}", "loader counter (data-count)"),
    (rf"\bdata-step{END}", "loader step line (data-step)"),
    (r"\box-nav\w*", "fixed side navigation (.ox-nav)"),
    (r"--ox-nav-clear-", "navigation clearance padding (--ox-nav-clear-*)"),
    (r"\box-(?:has-)?cursor\w*", "pointer-following cursor (.ox-cursor)"),
    (rf"\bdata-sound-label{END}", "corner sound toggle (data-sound-label)"),
]
REMOVED_API = [
    (r"\bsetSceneTarget\b", "ctx.cursor.setSceneTarget (use ctx.tags.set)"),
    (r"\bctx\.cursor\b", "ctx.cursor (use ctx.tags)"),
    (r"\bsound\.play\s*\(", "ctx.sound.play (use ctx.sound.cue)"),
    (r"openwebx:sound", "persisted sound preference"),
]
SOUND_LITERAL = re.compile(r"Sound o(?:n|ff)\b")
SOUND_LABEL = re.compile(r"""(?i)(['"`>])\s*sound\s+o(?:n|ff)\s*(?:['"`<])""")
PADDED_COUNTER = re.compile(r"""padStart\(\s*3\s*,\s*['"]0['"]\s*\)|>\s*0{3}\s*%?\s*<|\b0{2,3}%""")
CURSOR_NONE = re.compile(r"""cursor\s*[:=]\s*['"]?none\b""", re.I)
FIXED_JS = re.compile(r"""position\s*[:=]\s*['"]fixed['"]|position\s*:\s*fixed""", re.I)
FIXED_OK = re.compile(r"\.ox-(?:skip|stage|atmos|tag)(?![\w-])|^\s*canvas\b")
FONT_TRIO = ("Instrument Serif", "Inter Tight", "JetBrains Mono")


def _page_parts(html: str) -> tuple[str, str]:
    """(markup, main_text): everything that is not article text, and the
    article text itself. Content may legitimately say "sound on the ridge"."""
    m = re.search(r"<main\b[^>]*>(.*)</main>", html, re.S)
    if not m:
        return html, ""
    inner = m.group(1)
    tags = " ".join(re.findall(r"<[^>]+>", inner))
    return html[:m.start(1)] + tags + html[m.end(1):], inner


def _css_fixed(css: str) -> list[str]:
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    bad = []
    for sel, body in re.findall(r"([^{}]+)\{([^{}]*)\}", css):
        if not re.search(r"position\s*:\s*fixed", body, re.I):
            continue
        for one in sel.split(","):
            one = one.strip()
            if one and not FIXED_OK.search(one):
                bad.append(one)
    return bad


# ------------------------------------------------------------------ layout & beauty (static)
SECTION_RE = re.compile(r'<section\b[^>]*\bclass="ox-chapter[^"]*"[^>]*>.*?</section>', re.S)
CENTER_OK = re.compile(r"(?<![\w-])(?:h[1-6]|button|figcaption|img|svg|canvas)\b|\.ox-(?:display|eyebrow|folio\w*|numeral|sound\w*|tag|skip|footer)(?![\w-])")
CENTER_BAD = re.compile(r"(?<![\w.#-])(?:p|li|td|th|tr|table|tbody|ul|ol|dl|dt|dd|blockquote|section|main|body|html|article|div|figure)(?![\w-])"
                        r"|(?:^|[\s>+~(,])\*|:root|\.ox-(?:prose|chapter\w*|contents\w*|lede|quiet)(?![\w-])|\[data-(?:side|composition|reading)")


def _attr(tag: str, name: str) -> str:
    m = re.search(rf'\b{name}="([^"]*)"', tag)
    return m.group(1) if m else ""


def _split_top(text: str, seps: str) -> list[str]:
    """Split at separators outside (), [] (selector lists, compounds)."""
    out, depth, cur = [], 0, []
    for ch in text:
        if ch in "([":
            depth += 1
        elif ch in ")]":
            depth -= 1
        if depth == 0 and ch in seps:
            out.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
    out.append("".join(cur))
    return [o.strip() for o in out if o.strip()]


def center_rules(css: str) -> list[str]:
    """Q-center: selectors whose text-align: center reaches body text
    (paragraphs, list items, table cells) outside an interlude."""
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    bad = []
    for sel, body in re.findall(r"([^{}]+)\{([^{}]*)\}", css):
        if not re.search(r"text-align\s*:\s*center", body, re.I):
            continue
        for one in _split_top(sel, ","):
            if "interlude" in one:
                continue
            last = _split_top(one, " >+~")[-1]
            if CENTER_BAD.search(last) and not (CENTER_OK.search(last) and not re.search(r"(?<![\w.#-])(?:p|li|td|th)(?![\w-])", last)):
                bad.append(one)
    return bad


def layout_checks(site: Path, html: str, brief: dict) -> list[str]:
    import scaffold  # the length rules live with the scaffold
    errors: list[str] = []
    prev = None
    for k, m in enumerate(SECTION_RE.finditer(html)):
        sec = m.group(0)
        tag = sec[:sec.index(">") + 1]
        comp, side = _attr(tag, "data-composition"), _attr(tag, "data-side")
        if not comp:
            errors.append(f"chapter {k} has no data-composition (re-run scaffold --site)")
            continue
        if prev == (comp, side):
            errors.append(f"Q-repeat: chapters {k - 1} and {k} share ({comp}, {side}); give neighbours different compositions or sides")
        prev = (comp, side)
        limit = scaffold.LENGTH_LIMITS.get(comp)
        if limit is not None:
            body = re.sub(r'<(a|p) class="ox-folio".*?</\1>|<span class="ox-numeral"[^>]*>.*?</span>', "", sec, flags=re.S)
            n = scaffold.text_units(to_text(body))
            if n > limit:
                errors.append(f"Q-length: chapter {k} is a {comp} with {scaffold.describe_units(n)} (limit {limit}); use paper, spread or ledger")
    for name in ("openwebx.css", "theme.css"):
        f = site / "css" / name
        if f.is_file():
            for sel in center_rules(f.read_text(encoding="utf-8")):
                errors.append(f"Q-center: css/{name}: `{sel}` centres body text (only an interlude line may be centred)")
    if not scaffold.hero_ok((brief.get("scene") or {}).get("hero")):
        errors.append('Q-hero: brief.scene.hero must be {"source": "cc0", "id": "<asset id>"} or '
                      '{"source": "procedural", "detail": [at least 3 concrete features]}')
    return errors


def originality(site: Path) -> list[str]:
    errors: list[str] = []
    files: list[tuple[str, str, str]] = []  # (name, kind, text)
    index = site / "index.html"
    html = index.read_text(encoding="utf-8") if index.is_file() else ""
    markup, main_html = _page_parts(html)
    files.append(("index.html", "html", markup))
    for p in sorted((site / "css").glob("*.css")) if (site / "css").is_dir() else []:
        files.append((p.relative_to(site).as_posix(), "css", p.read_text(encoding="utf-8")))
    for p in js_files(site) if (site / "src").is_dir() else []:
        files.append((p.relative_to(site).as_posix(), "js", p.read_text(encoding="utf-8")))

    for name, kind, text in files:
        found = []
        for rx, what in REMOVED_MARKUP + REMOVED_API:
            m = re.search(rx, text)
            if m:
                found.append(f"{what} `{m.group(0)}`")
        if SOUND_LITERAL.search(text) or SOUND_LABEL.search(text):
            found.append('the literal sound label "Sound on"/"Sound off" (write an invitation in chrome.sound_label)')
        if kind == "js" and re.search(r"localStorage[\s\S]{0,300}sound|sound[\s\S]{0,300}localStorage", text, re.I):
            found.append("a persisted sound preference (localStorage); sound starts off on every visit")
        m = PADDED_COUNTER.search(text)
        if m:
            found.append(f"a zero-padded percentage counter `{m.group(0)}`")
        if CURSOR_NONE.search(text):
            found.append("`cursor: none` (the system cursor is never hidden or replaced)")
        if kind == "css":
            for sel in _css_fixed(text):
                found.append(f"`{sel}` is fixed to the viewport (only the skip link, canvas, atmosphere and tag layer may be)")
        elif kind == "html":
            for style in re.findall(r"""style\s*=\s*["']([^"']*)""", text):
                if re.search(r"position\s*:\s*fixed", style, re.I):
                    found.append("an inline style fixes an element to the viewport")
            for block in re.findall(r"<style\b[^>]*>(.*?)</style>", text, re.S):
                for sel in _css_fixed(block):
                    found.append(f"`{sel}` is fixed to the viewport")
        elif kind == "js" and FIXED_JS.search(text):
            found.append("script fixes an element to the viewport (position: fixed)")
        for f in found:
            errors.append(f"originality: {name}: {f}")
    # Article text may mention sound, but never as a bare on/off label element.
    if re.search(r"(?i)>\s*sound\s+o(?:n|ff)\s*<", main_html):
        errors.append('originality: index.html: an element in <main> is labelled "Sound on"/"Sound off"')

    # The reference house style: this exact trio of faces used together.
    faces = " ".join(t for _, k, t in files if k in ("html", "css")).replace("+", " ")
    if all(re.search(re.escape(f), faces, re.I) for f in FONT_TRIO):
        errors.append("originality: typefaces Instrument Serif + Inter Tight + JetBrains Mono used together "
                      "(a known reference house style); choose faces for this theme")
    return errors


def check(site: Path, online: bool = False) -> dict:
    errors: list[str] = []
    warns: list[str] = []
    info: dict = {}
    index = site / "index.html"
    if not index.is_file():
        return {"errors": [f"{index} missing"], "warnings": [], "info": {}}
    html = index.read_text(encoding="utf-8")
    doc = Doc()
    doc.feed(html)

    meta_dir = site / "_openwebx"
    content = json.loads((meta_dir / "content.json").read_text(encoding="utf-8")) if (meta_dir / "content.json").is_file() else None
    brief = json.loads((meta_dir / "brief.json").read_text(encoding="utf-8")) if (meta_dir / "brief.json").is_file() else {}

    # --- head / SEO
    if not doc.lang:
        errors.append("<html lang> missing")
    if not doc.title:
        errors.append("<title> empty")
    elif len(doc.title) > 65:
        warns.append(f"title is {len(doc.title)} chars; search results truncate around 60")
    desc = doc.meta.get("description", "")
    if not desc:
        errors.append("meta description missing")
    elif not 50 <= len(desc) <= 170:
        warns.append(f"meta description is {len(desc)} chars (aim for 70-160)")
    if doc.h1 != 1:
        errors.append(f"expected exactly one <h1>, found {doc.h1}")
    for k in ("og:title", "og:description", "og:type"):
        if k not in doc.meta:
            warns.append(f"{k} missing")

    # --- scripts: importmap, JSON-LD, runtime brief
    imports = {}
    for attrs, body in doc.scripts:
        t = attrs.get("type", "")
        if t in ("importmap", "application/ld+json", "application/json"):
            try:
                data = json.loads(body)
            except json.JSONDecodeError as e:
                errors.append(f"<script type={t}> is not valid JSON: {e}")
                continue
            if t == "importmap":
                imports = data.get("imports", {})
                for name, url in imports.items():
                    if url.startswith("http") and not PINNED.search(url):
                        errors.append(f"importmap entry '{name}' is not pinned to an exact version: {url}")
            if t == "application/ld+json":
                items = data if isinstance(data, list) else [data]
                info["jsonld_types"] = [i.get("@type") for i in items if isinstance(i, dict)]

    # --- verbatim content
    if content:
        text = normalize_ws(main_text(html))
        missing = []
        for s in content["sections"]:
            if normalize_ws(s["text"]) not in text:
                missing.append(s["id"])
        if missing:
            errors.append(f"content sections not present verbatim in <main>: {missing}")
        info["sections"] = len(content["sections"])
        h1 = normalize_ws(content.get("h1") or "")
        if h1 and h1 not in text:
            errors.append("content H1 not present verbatim")

    # --- local references
    for kind, ref in doc.refs:
        if re.match(r"^(https?:|data:|//|#|mailto:)", ref):
            continue
        if not (site / ref.split("?")[0].split("#")[0]).exists():
            errors.append(f"{kind} reference not found: {ref}")
    for a in doc.imgs:
        if "alt" not in a:
            errors.append(f"<img src={a.get('src')}> has no alt attribute")

    # --- JS import graph + syntax
    node = shutil.which("node")
    for f in js_files(site):
        src = f.read_text(encoding="utf-8")
        for m in re.finditer(r"""(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|(?:^|\n)\s*import\s+['"]([^'"]+)['"]""", src):
            spec = m.group(1) or m.group(2) or m.group(3)
            if spec.startswith("."):
                if not (f.parent / spec).resolve().is_file():
                    errors.append(f"{f.relative_to(site)} imports missing file {spec}")
            elif spec.startswith("http"):
                if not PINNED.search(spec):
                    errors.append(f"{f.relative_to(site)} imports an unpinned URL {spec}")
            else:
                ok = spec in imports or any(k.endswith("/") and spec.startswith(k) for k in imports)
                if not ok:
                    errors.append(f"{f.relative_to(site)} imports '{spec}' which the importmap does not map")
        if node:
            with tempfile.TemporaryDirectory() as tmp:
                tmpf = Path(tmp) / (f.stem + ".mjs")
                tmpf.write_text(src, encoding="utf-8")
                r = subprocess.run([node, "--check", str(tmpf)], capture_output=True, text=True)
                if r.returncode != 0:
                    msg = (r.stderr.strip().splitlines() or ["syntax error"])
                    errors.append(f"{f.relative_to(site)}: {' | '.join(msg[-3:])[:300]}")
    if not node:
        warns.append("node not found: JS syntax not checked")

    # --- scene contract & art direction
    scene = site / "src" / "scene" / "scene.js"
    is_kit_scene = False  # fidelity rules apply once the builder has written a real scene
    if not scene.is_file():
        errors.append("src/scene/scene.js missing")
    else:
        s = scene.read_text(encoding="utf-8")
        if "export default" not in s:
            errors.append("scene.js must `export default` the Scene class")
        for fn in ("update(", "resize(", "dispose("):
            if fn not in s:
                errors.append(f"scene.js has no {fn[:-1]}() method")
        is_kit_scene = KIT_SCENE.is_file() and s.replace("\r\n", "\n") == KIT_SCENE.read_text(encoding="utf-8").replace("\r\n", "\n")
        if is_kit_scene:
            warns.append("scene.js is still the kit reference scene (no theme-specific scene yet)")
    scene_src = "\n".join(p.read_text(encoding="utf-8") for p in (site / "src" / "scene").rglob("*.js")) if (site / "src" / "scene").is_dir() else ""
    if scene_src:
        if "reduced" not in scene_src:
            errors.append("scene code never reads `reduced` (prefers-reduced-motion must change behaviour)")
        if "device.scale" not in scene_src and "device.tier" not in scene_src:
            warns.append("scene code does not scale work by ctx.device.scale / tier")
        if "setPixelRatio" in scene_src:
            warns.append("scene sets the pixel ratio itself; the runtime renderer owns DPR")
        if re.search(r"\bdispose\(\)\s*\{\s*\}", scene_src):
            errors.append("scene dispose() is empty")
        # Media must go through media() so the single-file presentation can embed it.
        raw = [m for m in re.finditer(r"""['"`]media/[^'"`]+['"`]""", scene_src)
               if not re.search(r"(media|mediaBytes|useHDRI|loadPBR|loadModel|loadTexture)\([^;()]*$", scene_src[max(0, m.start() - 160):m.start()])]
        if raw:
            warns.append(f"{len(raw)} media path(s) in scene code not loaded via media()/kit loaders; present.html cannot embed them")
        fidelity = (brief.get("look") or {}).get("fidelity", "cinematic-real")
        if fidelity == "cinematic-real" and not is_kit_scene and not re.search(r"useHDRI|useSky|useStudio|scene\.environment\s*=", scene_src):
            errors.append("look.fidelity is cinematic-real but the scene sets no environment lighting (useHDRI/useSky/useStudio)")
        if fidelity == "cinematic-real" and not is_kit_scene and "createPost" not in scene_src:
            warns.append("cinematic-real without createPost: frames will lack the camera finish (grain, vignette, bloom)")
    theme = site / "css" / "theme.css"
    if not theme.is_file() or len(theme.read_text(encoding="utf-8").strip()) < 200:
        warns.append("css/theme.css is (nearly) empty: art direction missing")

    # --- originality lint (removed 0.1.0 chrome, reference house style)
    errors.extend(originality(site))

    # --- layout & beauty (Q-repeat, Q-length, Q-center, Q-hero)
    errors.extend(layout_checks(site, html, brief))

    # --- theme IP
    avoid = [t for t in (brief.get("concept", {}).get("avoid_terms") or []) if t.strip()]
    if avoid:
        authored = scene_src + (theme.read_text(encoding="utf-8") if theme.is_file() else "")
        head_and_chrome = re.sub(r"<main\b.*</main>", "", html, flags=re.S)
        authored += head_and_chrome
        content_text = normalize_ws(" ".join(s["text"] for s in content["sections"])).lower() if content else ""
        for t in avoid:
            if t.lower() in authored.lower() and t.lower() not in content_text:
                errors.append(f"avoid term '{t}' appears in authored code/copy (theme must stay inspired-by)")

    # --- weight
    code_bytes = sum(p.stat().st_size for p in site.rglob("*") if p.is_file() and "media" not in p.parts and "_openwebx" not in p.parts
                     and p.name not in ("present.html", "artifact.html"))
    info["code_kb"] = round(code_bytes / 1024)
    if code_bytes > 1_500_000:
        warns.append(f"site code is {info['code_kb']} KB (excluding media); aim for < 1500 KB")
    for p in (site / "media").rglob("*") if (site / "media").is_dir() else []:
        # CC0 HDRIs/texture maps are ~1-2.5 MB at 1k; flag only real outliers.
        limit = 3_000_000 if "cc0" in p.parts else 600_000
        if p.is_file() and p.stat().st_size > limit:
            warns.append(f"media/{p.name} is {p.stat().st_size // 1024} KB")

    info["js_files"] = len(js_files(site))

    # --- network (opt-in): every font stylesheet and CDN module must resolve
    if online:
        import urllib.request
        urls = [ref for kind, ref in doc.refs if kind == "link" and "fonts.googleapis.com/css" in ref]
        urls += [u for u in imports.values() if u.startswith("http") and not u.endswith("/")]
        for u in urls:
            u = u.replace("&amp;", "&")
            try:
                req = urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0 openwebx-qa"})
                code = urllib.request.urlopen(req, timeout=20).status
            except Exception as e:  # HTTPError carries .code
                code = getattr(e, "code", str(e))
            if code != 200:
                errors.append(f"{u} -> {code} (unavailable font weight or wrong CDN path)")
        info["online_checked"] = len(urls)
    return {"errors": errors, "warnings": warns, "info": info}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("site", type=Path)
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--online", action="store_true", help="also fetch font stylesheets and CDN modules")
    args = ap.parse_args(argv)
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    res = check(args.site.resolve(), args.online)
    if args.json:
        print(json.dumps(res, ensure_ascii=False, indent=2))
    else:
        for e in res["errors"]:
            print(f"ERROR   {e}")
        for w in res["warnings"]:
            print(f"warn    {w}")
        print(f"info    {json.dumps(res['info'], ensure_ascii=False)}")
        print("PASS" if not res["errors"] else f"FAIL ({len(res['errors'])} errors)")
    sys.exit(1 if res["errors"] else 0)


if __name__ == "__main__":
    main()
