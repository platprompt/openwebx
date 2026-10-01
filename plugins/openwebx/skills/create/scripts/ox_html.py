"""HTML helpers for openwebx: sanitising, top-level block splitting, text
extraction. Standard library only."""
from __future__ import annotations

import html
import re
from html.parser import HTMLParser

VOID = {"br", "hr", "img", "wbr"}
ALLOWED = {
    "h1", "h2", "h3", "h4", "h5", "h6", "p", "ul", "ol", "li", "a", "strong", "em", "b", "i", "u",
    "s", "del", "ins", "mark", "small", "sub", "sup", "code", "pre", "kbd", "abbr", "time", "q", "cite",
    "blockquote", "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "img", "figure",
    "figcaption", "hr", "br", "dl", "dt", "dd", "details", "summary", "span", "article", "section",
    "div", "address",
}
# Dropped together with everything inside them.
DROP_WITH_CONTENT = {
    "script", "style", "noscript", "iframe", "object", "embed", "template", "svg", "canvas",
    "form", "button", "select", "textarea", "input", "video", "audio", "map",
}
# Page chrome dropped when extracting the main content of a full HTML page.
CHROME = {"nav", "header", "footer", "aside"}
ATTRS = {
    "a": {"href", "title", "hreflang"},
    "img": {"src", "alt", "title", "width", "height"},
    "td": {"colspan", "rowspan"},
    "th": {"colspan", "rowspan", "scope"},
    "ol": {"start", "reversed"},
    "code": {"class"},
    "abbr": {"title"},
    "time": {"datetime"},
    "q": {"cite"},
    "blockquote": {"cite"},
    "article": {"class"},
    "ul": {"class"},
    "p": {"class"},
}
BLOCK = {
    "h1", "h2", "h3", "h4", "h5", "h6", "p", "ul", "ol", "blockquote", "table", "figure", "hr", "dl",
    "details", "pre", "article", "section", "div", "address", "img",
}
SAFE_URL = re.compile(r"^(https?:|mailto:|tel:|#|/|\.{0,2}/|[^:]*$)", re.I)


def esc(s: str) -> str:
    return html.escape(s, quote=True)


def safe_url(u: str) -> str | None:
    u = (u or "").strip()
    if not u or not SAFE_URL.match(u):
        return None
    return u


class _Sanitizer(HTMLParser):
    def __init__(self, drop_chrome: bool, shift: int):
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        self.drop_depth = 0
        self.drop_chrome = drop_chrome
        self.shift = shift
        self.stack: list[str] = []

    def _tag(self, tag: str) -> str:
        if self.shift and re.fullmatch(r"h[1-6]", tag):
            return f"h{min(6, int(tag[1]) + self.shift)}"
        return tag

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if self.drop_depth:
            if tag not in VOID:
                self.drop_depth += 1
            return
        if tag in DROP_WITH_CONTENT or (self.drop_chrome and tag in CHROME):
            if tag not in VOID:
                self.drop_depth = 1
            return
        if tag not in ALLOWED:
            return
        keep = []
        allowed = ATTRS.get(tag, set())
        for k, v in attrs:
            k = k.lower()
            if k not in allowed or v is None:
                continue
            if k in ("href", "src", "cite"):
                v = safe_url(v)
                if v is None:
                    continue
            if k == "class" and tag == "code" and not v.startswith("language-"):
                continue
            if k == "class" and tag != "code" and not re.fullmatch(r"ox-[a-z-]+( ox-[a-z-]+)*", v):
                continue
            keep.append(f' {k}="{esc(v)}"')
        t = self._tag(tag)
        self.out.append(f"<{t}{''.join(keep)}>")
        if tag not in VOID:
            self.stack.append(t)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag.lower() not in VOID and not self.drop_depth and tag.lower() in ALLOWED:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        tag = tag.lower()
        if self.drop_depth:
            if tag not in VOID:
                self.drop_depth -= 1
            return
        if tag not in ALLOWED or tag in VOID:
            return
        t = self._tag(tag)
        if t in self.stack:
            while self.stack:
                top = self.stack.pop()
                self.out.append(f"</{top}>")
                if top == t:
                    break

    def handle_data(self, data):
        if not self.drop_depth:
            self.out.append(esc(data).replace("&#x27;", "'"))

    def close(self):
        super().close()
        while self.stack:
            self.out.append(f"</{self.stack.pop()}>")


def sanitize(fragment: str, drop_chrome: bool = False, shift: int = 0) -> str:
    p = _Sanitizer(drop_chrome, shift)
    p.feed(fragment)
    p.close()
    return "".join(p.out)


class _MainFinder(HTMLParser):
    """Locate the main content region of a full HTML document."""

    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.title = ""
        self.meta: dict[str, str] = {}
        self.lang = ""
        self._in_title = False

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "html" and a.get("lang"):
            self.lang = a["lang"]
        if tag == "title":
            self._in_title = True
        if tag == "meta":
            key = (a.get("name") or a.get("property") or "").lower()
            if key in ("description", "og:description", "keywords", "author", "og:title"):
                self.meta[key] = a.get("content") or ""

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False

    def handle_data(self, data):
        if self._in_title:
            self.title += data


def extract_main(doc: str) -> tuple[str, dict]:
    finder = _MainFinder()
    finder.feed(doc)
    info = {"title": finder.title.strip(), "meta": finder.meta, "lang": finder.lang}
    for tag in ("main", "article"):
        m = re.search(rf"<{tag}\b[^>]*>(.*)</{tag}>", doc, re.S | re.I)
        if m:
            return m.group(1), info
    m = re.search(r"<body\b[^>]*>(.*)</body>", doc, re.S | re.I)
    return (m.group(1) if m else doc), info


class _Blocks(HTMLParser):
    """Split sanitised HTML into top-level blocks, grouping loose inline
    content into paragraphs."""

    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.blocks: list[tuple[str, str]] = []
        self.depth = 0
        self.cur: list[str] = []
        self.cur_tag = ""
        self.inline: list[str] = []

    def _flush_inline(self):
        text = "".join(self.inline).strip()
        if text:
            self.blocks.append(("p", f"<p>{text}</p>"))
        self.inline = []

    def handle_starttag(self, tag, attrs):
        raw = self.get_starttag_text()
        if self.depth == 0 and tag in BLOCK:
            self._flush_inline()
            self.cur_tag = tag
            self.cur = [raw]
            if tag in VOID:
                self.blocks.append((tag, raw))
                self.cur = []
                return
            self.depth = 1
            return
        target = self.cur if self.depth else self.inline
        target.append(raw)
        if self.depth and tag == self.cur_tag and tag not in VOID:
            self.depth += 1

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        if self.depth:
            self.cur.append(f"</{tag}>")
            if tag == self.cur_tag:
                self.depth -= 1
                if self.depth == 0:
                    self.blocks.append((self.cur_tag, "".join(self.cur)))
                    self.cur = []
            return
        self.inline.append(f"</{tag}>")

    def handle_data(self, data):
        (self.cur if self.depth else self.inline).append(data)

    def handle_entityref(self, name):
        self.handle_data(f"&{name};")

    def handle_charref(self, name):
        self.handle_data(f"&#{name};")

    def close(self):
        super().close()
        if self.cur:
            self.blocks.append((self.cur_tag, "".join(self.cur)))
        self._flush_inline()


def split_blocks(clean_html: str) -> list[tuple[str, str]]:
    p = _Blocks()
    p.feed(clean_html)
    p.close()
    return [(t, h) for t, h in p.blocks if h.strip()]


class _Text(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "template"):
            self.skip += 1
        if tag in BLOCK or tag in ("li", "br", "tr", "td", "th", "dt", "dd", "figcaption", "summary"):
            self.parts.append(" ")

    def handle_endtag(self, tag):
        if tag in ("script", "style", "template"):
            self.skip = max(0, self.skip - 1)
        if tag in BLOCK or tag in ("li", "td", "th", "dt", "dd"):
            self.parts.append(" ")

    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)


def to_text(fragment: str) -> str:
    p = _Text()
    p.feed(fragment)
    p.close()
    return normalize_ws("".join(p.parts))


def normalize_ws(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


THAI = re.compile(r"[฀-๿]")
CJK = re.compile(r"[぀-ヿ一-鿿가-힯]")


def detect_lang(text: str) -> str:
    sample = text[:20000]
    letters = len(re.findall(r"\w", sample)) or 1
    thai = len(THAI.findall(sample))
    if thai / letters > 0.15:
        return "th"
    cjk = CJK.findall(sample)
    if len(cjk) / letters > 0.15:
        joined = "".join(cjk)
        if re.search(r"[぀-ヿ]", joined):
            return "ja"
        if re.search(r"[가-힯]", joined):
            return "ko"
        return "zh"
    return "en"


def word_count(text: str, lang: str) -> int:
    if lang in ("th", "ja", "zh"):
        # No spaces between words: approximate with characters / 4 (Thai) or / 2 (CJK).
        chars = len(re.sub(r"\s", "", text))
        return round(chars / (4 if lang == "th" else 2))
    return len(re.findall(r"\S+", text))


def slugify(s: str, fallback: str = "site") -> str:
    s = s.lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return (s[:48].strip("-")) or fallback
