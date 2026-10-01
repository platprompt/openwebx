#!/usr/bin/env python3
"""openwebx ingest: turn a content file or folder into content.json.

    python ingest.py <file-or-folder> [more paths...] --out <dir>/content.json [--title "..."]

Supported: .md .markdown .txt .html .htm .json .csv (folders are read
recursively, in natural sort order). Images next to the content are
collected so the scene can use them. The text of every section is kept
verbatim: later steps may regroup sections into chapters but never rewrite
them. Prints a compact summary for the director on stdout.
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ox_html import (  # noqa: E402
    detect_lang, esc, extract_main, normalize_ws, safe_url, sanitize, split_blocks, to_text, word_count,
)
import ox_md  # noqa: E402

TEXT_EXT = {".md", ".markdown", ".mdx", ".txt", ".html", ".htm", ".json", ".csv"}
IMG_EXT = {".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif", ".svg"}
UNSUPPORTED_HINT = {
    ".docx": "convert to Markdown first (e.g. with the docx skill or `pandoc -t gfm`)",
    ".pdf": "extract to Markdown first (e.g. with the pdf skill)",
    ".pptx": "export slide text to Markdown first",
    ".xlsx": "export the sheet to CSV first",
}
QUESTION = re.compile(r"(\?|？|ไหม\s*$|หรือไม่\s*$|อย่างไร\s*$|อะไร\s*$|ทำไม|เท่าไร|เท่าไหร่\s*$|ที่ไหน\s*$|เมื่อไร|เมื่อไหร่\s*$)")


def natural_key(p: Path):
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", str(p))]


# ------------------------------------------------------------- readers

def read_text(path: Path) -> str:
    raw = path.read_bytes()
    for enc in ("utf-8-sig", "utf-16", "cp874", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", "replace")


def from_markdown(path: Path, shift: int) -> dict:
    fm, blocks = ox_md.parse(read_text(path), shift=shift)
    return {"front_matter": fm, "blocks": blocks}


def from_html(path: Path, shift: int) -> dict:
    main, info = extract_main(read_text(path))
    clean = sanitize(main, drop_chrome=True, shift=shift)
    fm = {}
    if info["title"]:
        fm["title"] = normalize_ws(info["title"])
    if info["meta"].get("description"):
        fm["description"] = info["meta"]["description"]
    if info["meta"].get("author"):
        fm["author"] = info["meta"]["author"]
    if info["lang"]:
        fm["lang"] = info["lang"]
    return {"front_matter": fm, "blocks": [h for _, h in split_blocks(clean)]}


ITEM_KEYS = {
    "title": ("title", "name", "heading", "project", "product"),
    "meta": ("subtitle", "role", "category", "client", "type", "year", "date", "location"),
    "body": ("description", "summary", "body", "text", "content", "details", "excerpt", "about"),
    "tags": ("tags", "stack", "keywords", "skills", "tools", "labels"),
    "url": ("url", "link", "href", "website"),
    "image": ("image", "cover", "thumbnail", "img", "photo", "picture"),
    "group": ("section", "group", "chapter"),
}


def pick(item: dict, kind: str):
    lower = {str(k).lower(): v for k, v in item.items()}
    for k in ITEM_KEYS[kind]:
        v = lower.get(k)
        if v not in (None, "", []):
            return v
    return None


def render_item(item: dict, level: int) -> str:
    title = pick(item, "title")
    parts = [f'<article class="ox-item">']
    if title:
        parts.append(f"<h{level}>{esc(str(title))}</h{level}>")
    metas = []
    lower = {str(k).lower(): v for k, v in item.items()}
    for k in ITEM_KEYS["meta"]:
        if lower.get(k) not in (None, ""):
            metas.append(esc(str(lower[k])))
    if metas:
        parts.append(f'<p class="ox-meta">{" · ".join(metas)}</p>')
    img = pick(item, "image")
    if isinstance(img, str) and safe_url(img):
        parts.append(f'<figure><img src="{esc(img)}" alt="{esc(str(title or ""))}"></figure>')
    body = pick(item, "body")
    if isinstance(body, str):
        _, blocks = ox_md.parse(body)
        parts.extend(blocks)
    elif isinstance(body, list):
        parts.append("<ul>" + "".join(f"<li>{esc(str(b))}</li>" for b in body) + "</ul>")
    tags = pick(item, "tags")
    if isinstance(tags, str):
        tags = [t.strip() for t in re.split(r"[,;|]", tags) if t.strip()]
    if isinstance(tags, list) and tags:
        parts.append('<ul class="ox-tags">' + "".join(f"<li>{esc(str(t))}</li>" for t in tags) + "</ul>")
    url = pick(item, "url")
    if isinstance(url, str) and safe_url(url):
        label = re.sub(r"^https?://(www\.)?", "", url).rstrip("/")
        parts.append(f'<p><a href="{esc(url)}">{esc(label)}</a></p>')
    # Remaining scalar fields are content too: keep them as a definition list.
    used = {k for group in ITEM_KEYS.values() for k in group}
    rest = [(k, v) for k, v in item.items() if str(k).lower() not in used and isinstance(v, (str, int, float)) and str(v).strip()]
    if rest:
        parts.append("<dl>" + "".join(f"<dt>{esc(str(k))}</dt><dd>{esc(str(v))}</dd>" for k, v in rest) + "</dl>")
    parts.append("</article>")
    return "".join(parts)


def items_to_blocks(items: list[dict], shift: int) -> list[str]:
    groups: dict[str, list[dict]] = {}
    order: list[str] = []
    for it in items:
        g = str(pick(it, "group") or "")
        if g not in groups:
            groups[g] = []
            order.append(g)
        groups[g].append(it)
    blocks: list[str] = []
    grouped = not (len(order) == 1 and order[0] == "")
    for g in order:
        if grouped and g:
            blocks.append(f"<h{2 + shift}>{esc(g)}</h{2 + shift}>")
        level = (3 if grouped else 2) + shift
        for it in groups[g]:
            html = render_item(it, min(6, level))
            # Each item heading must start a section when items are ungrouped.
            blocks.append(html)
    return blocks


def from_json(path: Path, shift: int) -> dict:
    data = json.loads(read_text(path))
    fm: dict = {}
    items = None
    if isinstance(data, list):
        items = data
    elif isinstance(data, dict):
        for k in ("title", "name", "description", "summary", "author", "lang", "date"):
            if isinstance(data.get(k), str):
                fm["title" if k == "name" else "description" if k == "summary" else k] = data[k]
        for k in ("items", "projects", "products", "entries", "works", "posts", "cards", "sections"):
            if isinstance(data.get(k), list):
                items = data[k]
                break
    if items is not None and all(isinstance(i, dict) for i in items):
        return {"front_matter": fm, "blocks": items_to_blocks(items, shift)}
    # Generic object: headings for nested keys, definition lists for scalars.
    blocks: list[str] = []

    def walk(obj, level):
        if isinstance(obj, dict):
            scalars = [(k, v) for k, v in obj.items() if not isinstance(v, (dict, list))]
            if scalars:
                blocks.append("<dl>" + "".join(f"<dt>{esc(str(k))}</dt><dd>{esc(str(v))}</dd>" for k, v in scalars) + "</dl>")
            for k, v in obj.items():
                if isinstance(v, (dict, list)):
                    blocks.append(f"<h{min(6, level)}>{esc(str(k))}</h{min(6, level)}>")
                    walk(v, level + 1)
        elif isinstance(obj, list):
            if all(not isinstance(v, (dict, list)) for v in obj):
                blocks.append("<ul>" + "".join(f"<li>{esc(str(v))}</li>" for v in obj) + "</ul>")
            else:
                for v in obj:
                    walk(v, level)

    walk(data, 2 + shift)
    return {"front_matter": fm, "blocks": blocks}


def from_csv(path: Path, shift: int) -> dict:
    text = read_text(path)
    try:
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel
    rows = list(csv.DictReader(io.StringIO(text), dialect=dialect))
    if rows and any(pick(r, "title") for r in rows):
        return {"front_matter": {}, "blocks": items_to_blocks(rows, shift)}
    if not rows:
        return {"front_matter": {}, "blocks": []}
    head = list(rows[0].keys())
    th = "".join(f"<th>{esc(h)}</th>" for h in head)
    body = "".join("<tr>" + "".join(f"<td>{esc(str(r.get(h, '')))}</td>" for h in head) + "</tr>" for r in rows)
    return {"front_matter": {}, "blocks": [f"<table><thead><tr>{th}</tr></thead><tbody>{body}</tbody></table>"]}


READERS = {
    ".md": from_markdown, ".markdown": from_markdown, ".mdx": from_markdown, ".txt": from_markdown,
    ".html": from_html, ".htm": from_html, ".json": from_json, ".csv": from_csv,
}


# ------------------------------------------------------------- assembly

def heading_level(block: str) -> int | None:
    # Collection items (<article class="ox-item"><hN>) count as headed blocks.
    m = re.match(r"<h([1-6])\b", block) or re.match(r'<article class="ox-item"><h([1-6])\b', block)
    return int(m.group(1)) if m else None


def heading_text(block: str) -> str:
    m = re.search(r"<h([1-6])\b[^>]*>(.*?)</h\1>", block, re.S)
    return to_text(m.group(2)) if m else to_text(block)


def collect_images(block: str, base: Path) -> list[dict]:
    found = []
    for m in re.finditer(r'<img\b[^>]*\bsrc="([^"]+)"[^>]*>', block):
        src = m.group(1)
        alt = re.search(r'\balt="([^"]*)"', m.group(0))
        entry = {"src": src, "alt": alt.group(1) if alt else ""}
        if not re.match(r"^(https?:)?//", src) and not src.startswith("data:"):
            p = (base / src).resolve()
            entry["path"] = str(p)
            entry["exists"] = p.is_file()
        found.append(entry)
    return found


def build(paths: list[Path], title_override: str | None) -> dict:
    files: list[Path] = []
    images: list[Path] = []
    skipped: list[dict] = []
    for p in paths:
        if p.is_dir():
            for f in sorted(p.rglob("*"), key=natural_key):
                if any(part.startswith((".", "_", "node_modules", "openwebx-out")) for part in f.relative_to(p).parts):
                    continue
                if f.suffix.lower() in TEXT_EXT:
                    files.append(f)
                elif f.suffix.lower() in IMG_EXT:
                    images.append(f)
                elif f.is_file() and f.suffix.lower() in UNSUPPORTED_HINT:
                    skipped.append({"file": str(f), "hint": UNSUPPORTED_HINT[f.suffix.lower()]})
        elif p.is_file():
            if p.suffix.lower() in TEXT_EXT:
                files.append(p)
            elif p.suffix.lower() in UNSUPPORTED_HINT:
                skipped.append({"file": str(p), "hint": UNSUPPORTED_HINT[p.suffix.lower()]})
        else:
            raise SystemExit(f"openwebx ingest: not found: {p}")
    if not files:
        msg = "openwebx ingest: no readable content files"
        if skipped:
            msg += "\n" + "\n".join(f"  {s['file']}: {s['hint']}" for s in skipped)
        raise SystemExit(msg)

    multi = len(files) > 1
    sources = []
    stream: list[tuple[str, str, Path]] = []  # (html, source, base dir)
    fm_all: dict = {}
    first_h1 = None
    for f in files:
        # With several files each file's top heading becomes a section (H1 -> H2).
        shift = 1 if multi else 0
        doc = READERS[f.suffix.lower()](f, shift)
        fm = doc["front_matter"]
        if not fm_all:
            fm_all = dict(fm)
        sources.append({"file": str(f), "front_matter": fm, "blocks": len(doc["blocks"])})
        if multi and fm.get("title") and not any(heading_level(b) in (1, 2) for b in doc["blocks"][:1]):
            stream.append((f"<h2>{esc(fm['title'])}</h2>", str(f), f.parent))
        for b in doc["blocks"]:
            if not multi and heading_level(b) == 1 and first_h1 is None:
                first_h1 = to_text(b)
                continue  # the H1 is rendered by the scaffold in the hero
            stream.append((b, str(f), f.parent))

    all_text = " ".join(to_text(b) for b, _, _ in stream)
    lang = (fm_all.get("lang") or "").split("-")[0].lower() or detect_lang(all_text)

    levels = [heading_level(b) for b, _, _ in stream]
    split_at = 2 if 2 in levels else 3 if 3 in levels else None

    sections: list[dict] = []
    cur: dict | None = None

    def open_section(heading_block: str | None, src: str):
        sid = f"s{len(sections):02d}"
        sec = {"id": sid, "heading": heading_text(heading_block) if heading_block else "", "level": heading_level(heading_block) if heading_block else 0,
               "source": src, "blocks": []}
        sections.append(sec)
        return sec

    for block, src, base in stream:
        lvl = heading_level(block)
        if split_at and lvl == split_at:
            cur = open_section(block, src)
        elif cur is None:
            cur = open_section(None, src)
        cur["blocks"].append(block)
        cur.setdefault("_bases", []).append(base)

    # Without headings, chunk long flows so chapters stay digestible.
    if split_at is None and len(sections) == 1 and len(sections[0]["blocks"]) > 8:
        blocks, bases = sections[0]["blocks"], sections[0]["_bases"]
        sections.clear()
        for k in range(0, len(blocks), 6):
            s = open_section(None, sections[0]["source"] if sections else str(files[0]))
            s["blocks"], s["_bases"] = blocks[k:k + 6], bases[k:k + 6]

    all_images = []
    faq = []
    for s in sections:
        html = "".join(s["blocks"])
        s["html"] = html
        s["text"] = to_text(html)
        s["chars"] = len(s["text"])
        s["words"] = word_count(s["text"], lang)
        imgs = []
        for b, base in zip(s["blocks"], s.pop("_bases")):
            imgs.extend(collect_images(b, base))
        s["images"] = imgs
        all_images.extend(imgs)
        s["kinds"] = sorted({re.match(r"<(\w+)", b).group(1) for b in s["blocks"] if re.match(r"<(\w+)", b)})
        del s["blocks"]
        # FAQ: question-shaped headings (any level) followed by an answer.
        for m in re.finditer(r"<h([2-4])>(.*?)</h\1>(.*?)(?=<h[1-4]>|$)", html, re.S):
            q = to_text(m.group(2))
            a = to_text(m.group(3))
            if QUESTION.search(q) and len(a) > 20:
                faq.append({"question": q, "answer": a[:1200], "section": s["id"]})

    referenced = {i.get("path") for i in all_images if i.get("path")}
    unreferenced = [str(p.resolve()) for p in images if str(p.resolve()) not in referenced]

    first_para = next((s["text"] for s in sections if s["text"]), "")
    title = title_override or fm_all.get("title") or first_h1 or (sections[0]["heading"] if sections and sections[0]["heading"] else files[0].stem)
    description = fm_all.get("description") or fm_all.get("excerpt") or ""

    ext = {f.suffix.lower() for f in files}
    kind_hint = "collection" if ext <= {".json", ".csv"} else "article"
    if any('class="ox-item"' in s["html"] for s in sections) and kind_hint != "collection":
        kind_hint = "mixed"

    return {
        "openwebx": "content/1",
        "title": title,
        "title_from": "override" if title_override else "front_matter" if fm_all.get("title") else "h1" if first_h1 else "fallback",
        "h1": first_h1 or title,
        "description": description,
        "lang": lang,
        "kind_hint": kind_hint,
        "front_matter": fm_all,
        "sources": sources,
        "sections": sections,
        "faq": faq,
        "images": all_images,
        "unreferenced_images": unreferenced,
        "skipped": skipped,
        "stats": {
            "files": len(files),
            "sections": len(sections),
            "chars": sum(s["chars"] for s in sections),
            "words": sum(s["words"] for s in sections),
            "images": len(all_images),
            "lead_text": first_para[:280],
        },
    }


def summary(c: dict) -> str:
    lines = [
        f"title: {c['title']}  (from {c['title_from']})",
        f"lang: {c['lang']}   kind_hint: {c['kind_hint']}   files: {c['stats']['files']}   "
        f"sections: {c['stats']['sections']}   words~{c['stats']['words']}   chars: {c['stats']['chars']}",
        f"description: {c['description'][:160] or '(none - director should write one from the content)'}",
        f"images: {len(c['images'])} referenced, {len(c['unreferenced_images'])} unreferenced   faq: {len(c['faq'])}",
        "sections:",
    ]
    for s in c["sections"]:
        img = f" img:{len(s['images'])}" if s["images"] else ""
        lines.append(f"  {s['id']}  h{s['level'] or '-'}  {s['words']:>5}w{img}  {s['heading'][:70] or '(untitled) ' + s['text'][:50]}")
    for s in c["skipped"]:
        lines.append(f"skipped {s['file']}: {s['hint']}")
    missing = [i for i in c["images"] if i.get("path") and not i.get("exists")]
    for i in missing[:5]:
        lines.append(f"missing image: {i['src']}")
    return "\n".join(lines)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("paths", nargs="+", type=Path)
    ap.add_argument("--out", type=Path, required=True, help="where to write content.json")
    ap.add_argument("--title", help="override the site title")
    args = ap.parse_args(argv)
    content = build([p.expanduser() for p in args.paths], args.title)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(content, ensure_ascii=False, indent=2), encoding="utf-8")
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    print(summary(content))
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
