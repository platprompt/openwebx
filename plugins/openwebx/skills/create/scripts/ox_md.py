"""A small, dependency-free Markdown to HTML converter for openwebx.

Covers what real content folders contain: YAML-ish front matter, ATX and
setext headings, paragraphs with hard breaks, nested ordered/unordered
lists, blockquotes, fenced code, pipe tables, horizontal rules, images,
inline and reference links, emphasis, strikethrough, inline code, autolinks
and safe inline/block HTML (sanitised afterwards).

parse(text, shift=0) -> (front_matter: dict, blocks: list[str])
Each block is one top-level HTML element, which is what lets the ingester
split content into sections without re-parsing.
"""
from __future__ import annotations

import re

from ox_html import esc, safe_url, sanitize

FM = re.compile(r"\A---\s*\n(.*?)\n---\s*(\n|\Z)", re.S)
ATX = re.compile(r"^\s{0,3}(#{1,6})(?:\s+(.*?))?\s*#*\s*$")
HR = re.compile(r"^\s{0,3}([-*_])(?:\s*\1){2,}\s*$")
FENCE = re.compile(r"^(\s{0,3})(`{3,}|~{3,})\s*([\w+#.-]*)")
LIST = re.compile(r"^(\s*)([-*+]|\d{1,9}[.)])(\s+|$)")
QUOTE = re.compile(r"^\s{0,3}>\s?")
TABLE_SEP = re.compile(r"^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$")
REFDEF = re.compile(r"^\s{0,3}\[([^\]]+)\]:\s*<?(\S+?)>?(?:\s+[\"'(](.*)[\"')])?\s*$")
HTML_BLOCK = re.compile(
    r"^\s{0,3}<(/?)(div|figure|figcaption|table|details|summary|section|article|aside|p|img|picture|"
    r"video|iframe|ul|ol|li|blockquote|h[1-6]|pre|dl|hr|br|center|address)\b",
    re.I,
)
SETEXT1 = re.compile(r"^\s{0,3}=+\s*$")
SETEXT2 = re.compile(r"^\s{0,3}-+\s*$")


def parse_front_matter(text: str) -> tuple[dict, str]:
    m = FM.match(text)
    if not m:
        return {}, text
    data: dict = {}
    key = None
    for line in m.group(1).splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        item = re.match(r"^\s+-\s+(.*)$", line)
        if item and key:
            if not isinstance(data.get(key), list):
                data[key] = []
            data[key].append(_unquote(item.group(1)))
            continue
        kv = re.match(r"^([\w.-]+)\s*:\s*(.*)$", line)
        if kv:
            key = kv.group(1).strip()
            val = kv.group(2).strip()
            if val.startswith("[") and val.endswith("]"):
                data[key] = [_unquote(v) for v in val[1:-1].split(",") if v.strip()]
            else:
                data[key] = _unquote(val) if val else ""
    return data, text[m.end():]


def _unquote(v: str) -> str:
    v = v.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
        return v[1:-1]
    return v


# ---------------------------------------------------------------- inline

class Inline:
    def __init__(self, refs: dict):
        self.refs = refs

    def render(self, text: str) -> str:
        store: list[str] = []

        def keep(html: str) -> str:
            store.append(html)
            return f"\x00{len(store) - 1}\x00"

        # 1. code spans
        text = re.sub(r"(`+)(.+?)\1", lambda m: keep(f"<code>{esc(m.group(2).strip())}</code>"), text)
        # 2. autolinks <https://...>
        text = re.sub(
            r"<((?:https?://|mailto:)[^>\s]+)>",
            lambda m: keep(f'<a href="{esc(m.group(1))}">{esc(m.group(1))}</a>'),
            text,
        )
        # 3. inline html tags (sanitised later as part of the block)
        text = re.sub(
            r"</?(?:br|em|strong|b|i|u|s|sub|sup|mark|small|abbr|kbd|span|a|del|ins|q|cite|time)\b[^>]*>",
            lambda m: keep(m.group(0)),
            text,
            flags=re.I,
        )
        # 4. images
        def image(m):
            alt, url, title = m.group(1), m.group(2), m.group(3)
            url = safe_url(url)
            if not url:
                return keep(esc(alt))
            t = f' title="{esc(title)}"' if title else ""
            return keep(f'<img src="{esc(url)}" alt="{esc(alt)}"{t}>')

        text = re.sub(r"!\[([^\]]*)\]\(\s*<?([^\s)>]+)>?(?:\s+[\"'](.*?)[\"'])?\s*\)", image, text)
        text = re.sub(
            r"!\[([^\]]*)\]\[([^\]]*)\]",
            lambda m: image(_RefMatch(m.group(1), *self._ref(m.group(2) or m.group(1)))),
            text,
        )

        # 5. links (text rendered recursively for emphasis)
        def link(label, url, title):
            url = safe_url(url or "")
            inner = self._emphasis(esc_keep(label))
            if not url:
                return keep(inner)
            t = f' title="{esc(title)}"' if title else ""
            return keep(f'<a href="{esc(url)}"{t}>{inner}</a>')

        def esc_keep(s):
            return re.sub(r"[^\x00]+|\x00\d+\x00", lambda m: m.group(0) if m.group(0).startswith("\x00") else esc(m.group(0)).replace("&#x27;", "'"), s)

        text = re.sub(
            r"\[((?:[^\[\]]|\x00\d+\x00)+)\]\(\s*<?([^\s)>]*)>?(?:\s+[\"'](.*?)[\"'])?\s*\)",
            lambda m: link(m.group(1), m.group(2), m.group(3)),
            text,
        )
        text = re.sub(
            r"\[((?:[^\[\]]|\x00\d+\x00)+)\]\[([^\]]*)\]",
            lambda m: link(m.group(1), *self._ref(m.group(2) or m.group(1))),
            text,
        )
        text = re.sub(
            r"\[([^\[\]]+)\](?!\()",
            lambda m: link(m.group(1), *self._ref(m.group(1))) if m.group(1).lower() in self.refs else m.group(0),
            text,
        )
        # 6. bare URLs
        text = re.sub(
            r"(?<![\"'=\w/])(https?://[^\s<>\x00]+[^\s<>\x00.,;:!?)\]'\"])",
            lambda m: keep(f'<a href="{esc(m.group(1))}">{esc(m.group(1))}</a>'),
            text,
        )
        # 7. escape the rest, then emphasis
        text = esc_keep(text)
        text = self._emphasis(text)
        # hard breaks
        text = re.sub(r"(?: {2,}|\\)\n", "<br>\n", text)
        # restore placeholders (nested placeholders resolve in order)
        for _ in range(3):
            text = re.sub(r"\x00(\d+)\x00", lambda m: store[int(m.group(1))], text)
        return text

    def _ref(self, key: str):
        ref = self.refs.get(key.strip().lower())
        return (ref or (None, None))

    @staticmethod
    def _emphasis(t: str) -> str:
        t = re.sub(r"~~(?=\S)(.+?)(?<=\S)~~", r"<del>\1</del>", t)
        t = re.sub(r"\*\*\*(?=\S)(.+?)(?<=\S)\*\*\*", r"<strong><em>\1</em></strong>", t)
        t = re.sub(r"\*\*(?=\S)(.+?)(?<=\S)\*\*", r"<strong>\1</strong>", t)
        t = re.sub(r"(?<![\w\\])__(?=\S)(.+?)(?<=\S)__(?!\w)", r"<strong>\1</strong>", t)
        t = re.sub(r"(?<![\*\w\\])\*(?=[^\s*])(.+?)(?<=[^\s*])\*(?!\*)", r"<em>\1</em>", t)
        t = re.sub(r"(?<![\w\\])_(?=\S)(.+?)(?<=\S)_(?!\w)", r"<em>\1</em>", t)
        return t


class _RefMatch:
    def __init__(self, alt, url, title):
        self._g = (None, alt, url, title)

    def group(self, i):
        return self._g[i]


# ---------------------------------------------------------------- blocks

def _lead(line: str) -> int:
    return len(line) - len(line.lstrip(" "))


class Parser:
    def __init__(self, shift: int = 0):
        self.shift = shift
        self.refs: dict = {}
        self.inline = Inline(self.refs)

    def h(self, level: int) -> str:
        return f"h{min(6, level + self.shift)}"

    def parse(self, text: str) -> list[str]:
        text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\t", "    ")
        lines = text.split("\n")
        kept = []
        for line in lines:
            m = REFDEF.match(line)
            if m:
                self.refs[m.group(1).strip().lower()] = (m.group(2), m.group(3))
            else:
                kept.append(line)
        return self.blocks(kept)

    def is_block_start(self, line: str) -> bool:
        return bool(
            ATX.match(line) or HR.match(line) or FENCE.match(line) or QUOTE.match(line)
            or LIST.match(line) or HTML_BLOCK.match(line)
        )

    def blocks(self, lines: list[str]) -> list[str]:
        out: list[str] = []
        i, n = 0, len(lines)
        while i < n:
            line = lines[i]
            if not line.strip():
                i += 1
                continue
            m = FENCE.match(line)
            if m:
                fence, lang = m.group(2), m.group(3)
                body = []
                i += 1
                while i < n and not lines[i].strip().startswith(fence[0] * len(fence)):
                    body.append(lines[i])
                    i += 1
                i += 1
                cls = f' class="language-{esc(lang)}"' if lang else ""
                out.append(f"<pre><code{cls}>{esc(chr(10).join(body))}</code></pre>")
                continue
            m = ATX.match(line)
            if m:
                tag = self.h(len(m.group(1)))
                out.append(f"<{tag}>{self.inline.render(m.group(2) or '')}</{tag}>")
                i += 1
                continue
            if HR.match(line):
                out.append("<hr>")
                i += 1
                continue
            if QUOTE.match(line):
                body = []
                while i < n and lines[i].strip() and (QUOTE.match(lines[i]) or not self.is_block_start(lines[i])):
                    body.append(QUOTE.sub("", lines[i], count=1))
                    i += 1
                inner = Parser(self.shift)
                inner.refs.update(self.refs)
                out.append("<blockquote>" + "".join(inner.blocks(body)) + "</blockquote>")
                continue
            if LIST.match(line) and not (HR.match(line)):
                html, i = self.list(lines, i)
                out.append(html)
                continue
            if "|" in line and i + 1 < n and TABLE_SEP.match(lines[i + 1]) and "-" in lines[i + 1]:
                html, i = self.table(lines, i)
                out.append(html)
                continue
            if HTML_BLOCK.match(line):
                body = []
                while i < n and lines[i].strip():
                    body.append(lines[i])
                    i += 1
                out.append(sanitize("\n".join(body), shift=self.shift))
                continue
            # paragraph (with setext heading detection)
            para = [line]
            i += 1
            while i < n and lines[i].strip():
                if SETEXT1.match(lines[i]) or (SETEXT2.match(lines[i]) and len(para) >= 1):
                    level = 1 if SETEXT1.match(lines[i]) else 2
                    tag = self.h(level)
                    out.append(f"<{tag}>{self.inline.render(' '.join(p.strip() for p in para))}</{tag}>")
                    para = []
                    i += 1
                    break
                if self.is_block_start(lines[i]):
                    break
                para.append(lines[i])
                i += 1
            if para:
                # Trim each line but keep a trailing double space (hard break).
                text = "\n".join(p.strip() + ("  " if p.endswith("  ") else "") for p in para).rstrip()
                out.append(f"<p>{self.inline.render(text)}</p>")
        return out

    def list(self, lines: list[str], i: int) -> tuple[str, int]:
        n = len(lines)
        first = LIST.match(lines[i])
        indent = len(first.group(1))
        ordered = first.group(2)[0].isdigit()
        start = int(first.group(2)[:-1]) if ordered else 1
        items: list[list[str]] = []
        loose = False
        while i < n:
            m = LIST.match(lines[i])
            if not m or len(m.group(1)) != indent or m.group(2)[0].isdigit() != ordered:
                break
            spaces = len(m.group(3))
            offset = len(m.group(0)) if 0 < spaces <= 4 else len(m.group(1)) + len(m.group(2)) + 1
            item = [lines[i][offset:] if len(lines[i]) > offset else ""]
            i += 1
            while i < n:
                line = lines[i]
                if not line.strip():
                    j = i + 1
                    while j < n and not lines[j].strip():
                        j += 1
                    if j < n and _lead(lines[j]) >= offset:
                        item.extend([""] * (j - i))
                        loose = True
                        i = j
                        continue
                    break
                lead = _lead(line)
                if lead >= offset:
                    item.append(line[offset:])
                    i += 1
                    continue
                if LIST.match(line) and lead > indent:
                    # Nested list indented less than the parent's content offset.
                    item.append(line[lead:])
                    i += 1
                    continue
                if LIST.match(line) or self.is_block_start(line):
                    break
                item.append(line.strip())  # lazy continuation
                i += 1
            items.append(item)
            if i < n and not lines[i].strip():
                j = i
                while j < n and not lines[j].strip():
                    j += 1
                m2 = LIST.match(lines[j]) if j < n else None
                if m2 and len(m2.group(1)) == indent and m2.group(2)[0].isdigit() == ordered:
                    loose = True
                    i = j
                    continue
                break
        tag = "ol" if ordered else "ul"
        attr = f' start="{start}"' if ordered and start != 1 else ""
        parts = []
        for item in items:
            sub = Parser(self.shift)
            sub.refs.update(self.refs)
            blocks = sub.blocks(item)
            if not loose:
                blocks = [b[3:-4] if b.startswith("<p>") and b.endswith("</p>") else b for b in blocks]
            parts.append("<li>" + "".join(blocks) + "</li>")
        return f"<{tag}{attr}>" + "".join(parts) + f"</{tag}>", i

    def table(self, lines: list[str], i: int) -> tuple[str, int]:
        def cells(row: str) -> list[str]:
            row = row.strip()
            if row.startswith("|"):
                row = row[1:]
            if row.endswith("|"):
                row = row[:-1]
            return [c.strip() for c in re.split(r"(?<!\\)\|", row)]

        head = cells(lines[i])
        aligns = []
        for c in cells(lines[i + 1]):
            left, right = c.startswith(":"), c.endswith(":")
            aligns.append("center" if left and right else "right" if right else "")
        i += 2
        body = []
        while i < len(lines) and lines[i].strip() and "|" in lines[i]:
            body.append(cells(lines[i]))
            i += 1
        th = "".join(f"<th>{self.inline.render(c)}</th>" for c in head)
        rows = []
        for r in body:
            tds = "".join(f"<td>{self.inline.render(c)}</td>" for c in (r + [""] * (len(head) - len(r)))[: len(head)])
            rows.append(f"<tr>{tds}</tr>")
        return f"<table><thead><tr>{th}</tr></thead><tbody>{''.join(rows)}</tbody></table>", i


def parse(text: str, shift: int = 0) -> tuple[dict, list[str]]:
    fm, body = parse_front_matter(text.lstrip("﻿"))
    blocks = Parser(shift).parse(body)
    # Final pass: sanitise every block so inline HTML is safe too.
    return fm, [sanitize(b) for b in blocks]
