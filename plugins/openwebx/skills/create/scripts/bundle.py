#!/usr/bin/env python3
"""openwebx bundle: pack a site into ONE self-contained presentation file.

    python bundle.py <site> [--out <site>/present.html] [--max-mb 15]

Used for sharing: a Claude Artifact, ChatGPT Canvas, Gemini Canvas, email,
or any place that takes a single HTML file. What changes:
  - local stylesheets are inlined;
  - src/**/*.js is bundled into one inline <script type="module"> (local
    imports become scoped module objects; CDN imports stay on the importmap);
  - every file under media/ is embedded (base64) and served to scene code
    through media() from src/core/assets.js; glTF buffers/images are inlined;
  - <img src="media/..."> and CSS url(media/...) become data: URIs.
three.js, GSAP and Google Fonts still load from their CDNs (allowed by
Claude Artifacts and the Canvas hosts). Standard library only.
"""
from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

MIME = {".hdr": "image/vnd.radiance", ".exr": "image/x-exr", ".gltf": "model/gltf+json", ".glb": "model/gltf-binary",
        ".bin": "application/octet-stream", ".webp": "image/webp", ".avif": "image/avif", ".svg": "image/svg+xml",
        ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".mp3": "audio/mpeg",
        ".ogg": "audio/ogg", ".wav": "audio/wav", ".json": "application/json", ".ktx2": "image/ktx2"}


class BundleError(Exception):
    pass


def mime(p: Path) -> str:
    return MIME.get(p.suffix.lower()) or mimetypes.guess_type(p.name)[0] or "application/octet-stream"


def data_uri(p: Path) -> str:
    return f"data:{mime(p)};base64,{base64.b64encode(p.read_bytes()).decode()}"


# ------------------------------------------------------------------ JS

IMPORT_RE = re.compile(
    # Side-effect imports first, so `import './x.js'` never swallows a later statement.
    r"""^[ \t]*import\s+['"](?P<bare>[^'"]+)['"]\s*;?[ \t]*$|^[ \t]*import\s+(?P<clause>[\w$*{][^;'"]*?)\s+from\s+['"](?P<spec>[^'"]+)['"]\s*;?[ \t]*$""",
    re.M,
)
EXPORT_DECL = re.compile(r"^([ \t]*)export\s+(default\s+)?(async\s+)?(function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)", re.M)
EXPORT_LIST = re.compile(r"^[ \t]*export\s*\{([^}]*)\}\s*;?[ \t]*$", re.M)
# `export default <expr>` and anonymous `export default class {` / `function (`.
EXPORT_DEFAULT_EXPR = re.compile(r"^([ \t]*)export\s+default\s+(?!(?:async\s+)?(?:function\*?|class)\s+[A-Za-z_$])", re.M)


def parse_clause(clause: str):
    """Return (default_name, namespace_name, [(imported, local)])."""
    clause = clause.strip()
    default = ns = None
    named: list[tuple[str, str]] = []
    m = re.match(r"^\*\s+as\s+([\w$]+)$", clause)
    if m:
        return None, m.group(1), []
    m = re.match(r"^([\w$]+)\s*(?:,\s*(.*))?$", clause, re.S)
    if m and not clause.startswith("{"):
        default = m.group(1)
        clause = (m.group(2) or "").strip()
        m2 = re.match(r"^\*\s+as\s+([\w$]+)$", clause)
        if m2:
            return default, m2.group(1), []
    if clause.startswith("{"):
        for part in clause.strip("{} \n").split(","):
            part = part.strip()
            if not part:
                continue
            bits = re.split(r"\s+as\s+", part)
            named.append((bits[0].strip(), (bits[1] if len(bits) > 1 else bits[0]).strip()))
    return default, ns, named


def module_id(site: Path, p: Path) -> str:
    return p.resolve().relative_to(site.resolve()).as_posix()


def transform(site: Path, path: Path, bare_imports: dict, graph: dict):
    src = path.read_text(encoding="utf-8")
    mid = module_id(site, path)
    deps: list[str] = []
    header: list[str] = []

    def repl(m):
        spec = m.group("spec") or m.group("bare")
        if m.group("bare"):
            if spec.startswith("."):
                dep = (path.parent / spec).resolve()
                deps.append(module_id(site, dep))
                return ""
            bare_imports.setdefault(spec, {"default": set(), "ns": set(), "named": {}})
            return ""
        default, ns, named = parse_clause(m.group("clause"))
        if spec.startswith("."):
            dep = (path.parent / spec).resolve()
            if not dep.is_file():
                raise BundleError(f"{mid}: cannot resolve {spec}")
            did = module_id(site, dep)
            deps.append(did)
            ref = f"__ox[{json.dumps(did)}]"
            lines = []
            if default:
                lines.append(f"const {default} = {ref}.default;")
            if ns:
                lines.append(f"const {ns} = {ref};")
            if named:
                lines.append("const { " + ", ".join(i if i == l else f"{i}: {l}" for i, l in named) + f" }} = {ref};")
            header.extend(lines)
            return ""
        # CDN / importmap specifier: hoisted to one merged import per
        # specifier, so two modules importing the same name never collide.
        entry = bare_imports.setdefault(spec, {"default": set(), "ns": set(), "named": {}})
        if default:
            entry["default"].add(default)
        if ns:
            entry["ns"].add(ns)
        for imported, local in named:
            if entry["named"].get(local, imported) != imported:
                raise BundleError(f"{mid}: '{local}' is imported as two different names from {spec}")
            entry["named"][local] = imported
        return ""

    body = IMPORT_RE.sub(repl, src)
    if re.search(r"^\s*export\s*\*", body, re.M):
        raise BundleError(f"{mid}: `export * from` is not supported by the presentation bundler")
    if re.search(r"\bimport\s*\(\s*['\"]\.", body):
        raise BundleError(f"{mid}: dynamic import of a local module is not supported; use a static import")

    exports: dict[str, str] = {}

    def decl(m):
        indent, is_default, is_async, kind, name = m.groups()
        exports["default" if is_default else name] = name
        if kind in ("const", "let", "var") and not is_default:
            # `export const a = 1, b = 2`: collect declarators separated by
            # commas at bracket depth 0 only (not default params inside `(...)`).
            depth, i, text = 0, m.end(), body
            while i < len(text):
                ch = text[i]
                if ch in "([{":
                    depth += 1
                elif ch in ")]}":
                    depth -= 1
                elif ch in "'\"`":
                    j = i + 1
                    while j < len(text) and text[j] != ch:
                        j += 2 if text[j] == "\\" else 1
                    i = j
                elif depth == 0 and (ch == ";" or ch == "\n" and not text[i - 1].rstrip() .endswith((",", "=", "(", "?", ":"))):
                    break
                elif depth == 0 and ch == ",":
                    em = re.match(r"\s*([A-Za-z_$][\w$]*)\s*=", text[i + 1:])
                    if em:
                        exports[em.group(1)] = em.group(1)
                i += 1
        return f"{indent}{is_async or ''}{kind} {name}"

    body = EXPORT_DECL.sub(decl, body)

    def elist(m):
        for part in m.group(1).split(","):
            part = part.strip()
            if not part:
                continue
            bits = re.split(r"\s+as\s+", part)
            exports[(bits[1] if len(bits) > 1 else bits[0]).strip()] = bits[0].strip()
        return ""

    body = EXPORT_LIST.sub(elist, body)
    if EXPORT_DEFAULT_EXPR.search(body):
        body = EXPORT_DEFAULT_EXPR.sub(lambda m: f"{m.group(1)}const __default = ", body, count=1)
        exports["default"] = "__default"
    ret = ", ".join(f"{json.dumps(k)}: {v}" for k, v in exports.items())
    wrapped = f"__ox[{json.dumps(mid)}] = (() => {{\n" + "\n".join(header) + "\n" + body + f"\nreturn {{ {ret} }};\n}})();\n"
    graph[mid] = {"deps": deps, "code": wrapped}
    for d in deps:
        if d not in graph:
            transform(site, site / d, bare_imports, graph)


def bundle_js(site: Path, entry: Path) -> str:
    bare: dict = {}
    graph: dict = {}
    transform(site, entry, bare, graph)
    order, state = [], {}

    def visit(n, stack=()):
        if state.get(n) == 2:
            return
        if state.get(n) == 1:
            raise BundleError("circular import: " + " -> ".join(stack + (n,)))
        state[n] = 1
        for d in graph[n]["deps"]:
            visit(d, stack + (n,))
        state[n] = 2
        order.append(n)

    visit(module_id(site, entry))
    stmts, bound = [], {}
    for spec, e in bare.items():
        for name in sorted(e["ns"]):
            stmts.append(f"import * as {name} from '{spec}';")
            bound.setdefault(name, []).append(spec)
        defaults = sorted(e["default"])
        named = ", ".join(i if i == l else f"{i} as {l}" for l, i in sorted(e["named"].items()))
        head = defaults[0] if defaults else ""
        if head or named:
            stmts.append(f"import {', '.join(p for p in (head, '{ ' + named + ' }' if named else '') if p)} from '{spec}';")
        for extra in defaults[1:]:  # same default under several local names
            stmts.append(f"const {extra} = {head};")
        for name in defaults + list(e["named"]):
            bound.setdefault(name, []).append(spec)
        if not (e["ns"] or defaults or named):
            stmts.append(f"import '{spec}';")
    clash = {n: s for n, s in bound.items() if len(s) > 1}
    if clash:
        raise BundleError(f"the same local name is imported from different modules: {clash}")
    js = "\n".join(stmts) + "\nconst __ox = {};\n" + "".join(graph[n]["code"] for n in order)
    node = shutil.which("node")
    if node:  # prove the bundle parses before anyone ships it
        with tempfile.TemporaryDirectory() as tmp:
            f = Path(tmp) / "bundle.mjs"
            f.write_text(js, encoding="utf-8")
            r = subprocess.run([node, "--check", str(f)], capture_output=True, text=True)
            if r.returncode:
                raise BundleError("bundled JS does not parse: " + " | ".join(r.stderr.strip().splitlines()[-4:]))
    return js


# ------------------------------------------------------------------ media

def read_uri(base: Path, uri: str) -> tuple[bytes, str]:
    if uri.startswith("data:"):
        head, b64 = uri.split(",", 1)
        return base64.b64decode(b64), head[5:].split(";")[0]
    p = (base / uri).resolve()
    return p.read_bytes(), mime(p)


def gltf_to_glb(g: Path) -> tuple[bytes, set[Path]]:
    """Pack a .gltf with external buffers/images into one GLB, so hosts that
    block fetch (Artifacts, Canvas) can parse it from memory."""
    import struct
    doc = json.loads(g.read_text(encoding="utf-8"))
    parts: set[Path] = set()
    blob = bytearray()

    def append(data: bytes) -> int:
        off = len(blob)
        blob.extend(data)
        while len(blob) % 4:
            blob.append(0)
        return off

    offsets = []
    for buf in doc.get("buffers", []):
        data, _ = read_uri(g.parent, buf["uri"])
        if not buf["uri"].startswith("data:"):
            parts.add((g.parent / buf["uri"]).resolve())
        offsets.append(append(data))
    for bv in doc.get("bufferViews", []):
        bv["byteOffset"] = bv.get("byteOffset", 0) + offsets[bv["buffer"]]
        bv["buffer"] = 0
    for img in doc.get("images", []):
        if "uri" in img:
            data, mtype = read_uri(g.parent, img["uri"])
            if not img["uri"].startswith("data:"):
                parts.add((g.parent / img["uri"]).resolve())
            doc.setdefault("bufferViews", []).append({"buffer": 0, "byteOffset": append(data), "byteLength": len(data)})
            img["bufferView"] = len(doc["bufferViews"]) - 1
            img["mimeType"] = img.get("mimeType") or mtype
            del img["uri"]
    doc["buffers"] = [{"byteLength": len(blob)}]
    js = json.dumps(doc, separators=(",", ":")).encode()
    js += b" " * ((4 - len(js) % 4) % 4)
    total = 12 + 8 + len(js) + 8 + len(blob)
    out = struct.pack("<4sII", b"glTF", 2, total) + struct.pack("<I4s", len(js), b"JSON") + js
    out += struct.pack("<I4s", len(blob), b"BIN\x00") + bytes(blob)
    return out, parts


def embed_media(site: Path) -> tuple[dict, int]:
    media = site / "media"
    out, total = {}, 0
    if not media.is_dir():
        return out, 0
    gltf_parts: set[Path] = set()
    for g in media.rglob("*.gltf"):
        raw, parts = gltf_to_glb(g)
        gltf_parts |= parts
        # Keyed by the .gltf path so scene code stays unchanged.
        out[g.relative_to(site).as_posix()] = {"type": "model/gltf-binary", "b64": base64.b64encode(raw).decode()}
        total += len(raw)
    for p in media.rglob("*"):
        if not p.is_file() or p.suffix == ".gltf" or p.resolve() in gltf_parts or p.name == "cc0.json":
            continue
        raw = p.read_bytes()
        out[p.relative_to(site).as_posix()] = {"type": mime(p), "b64": base64.b64encode(raw).decode()}
        total += len(raw)
    return out, total


def build(site: Path, out: Path, max_mb: float) -> dict:
    html = (site / "index.html").read_text(encoding="utf-8")

    def css_inline(m):
        href = m.group(1)
        css = (site / href).read_text(encoding="utf-8")
        css = re.sub(r"url\((['\"]?)(media/[^)'\"]+)\1\)", lambda u: f"url({data_uri(site / u.group(2))})", css)
        return f"<style>\n{css}\n</style>"

    html = re.sub(r'<link rel="stylesheet" href="((?!https?:)[^"]+\.css)">', css_inline, html)
    html = re.sub(r'(<img\b[^>]*\bsrc=")(media/[^"]+)(")', lambda m: m.group(1) + data_uri(site / m.group(2)) + m.group(3), html)

    js = bundle_js(site, site / "src" / "main.js")
    media, media_bytes = embed_media(site)
    media_script = ""
    if media:
        media_script = "<script>window.__OX_MEDIA__ = " + json.dumps(media).replace("</", "<\\/") + ";</script>\n  "
    module = media_script + '<script type="module">\n' + js.replace("</script", "<\\/script") + "\n</script>"
    html, n = re.subn(r'<script type="module" src="src/main\.js"></script>', lambda _: module, html)
    if n != 1:
        raise BundleError("index.html does not load src/main.js as expected")
    html = html.replace('<meta name="generator"', '<meta name="openwebx-build" content="presentation">\n  <meta name="generator"', 1)
    out.write_text(html, encoding="utf-8")
    size = out.stat().st_size
    info = {"out": str(out), "mb": round(size / 1e6, 2), "media_files": len(media), "media_mb": round(media_bytes / 1e6, 2)}
    if size > max_mb * 1e6:
        info["warning"] = f"bundle is {info['mb']} MB (limit {max_mb} MB): use 1k CC0 assets or fewer sets"
    return info


def to_artifact(present: str) -> str:
    """Claude Artifacts wrap the file in their own document skeleton: emit the
    page as a fragment (title first), and restore <html>/<body> attributes
    from a boot script."""
    html_tag = re.search(r"<html\b([^>]*)>", present).group(1)
    body_tag = re.search(r"<body\b([^>]*)>", present).group(1)
    head = re.search(r"<head>(.*?)</head>", present, re.S).group(1)
    body = re.search(r"<body\b[^>]*>(.*)</body>", present, re.S).group(1)
    title = re.search(r"<title>.*?</title>", head, re.S).group(0)
    head = head.replace(title, "")
    head = re.sub(r'\s*<meta (charset|name="viewport")[^>]*>', "", head)
    head = head.replace("classList.replace('no-js', 'js')", "classList.add('js')")
    attrs = dict(re.findall(r'([\w-]+)="([^"]*)"', html_tag))
    body_cls = dict(re.findall(r'([\w-]+)="([^"]*)"', body_tag)).get("class", "")
    boot = ("<script>(function(h){" + "".join(
        f"h.setAttribute({json.dumps(k)},{json.dumps(v)});" for k, v in attrs.items() if k != "class"
    ) + "h.classList.add('js');" + (f"document.body&&document.body.classList.add({', '.join(json.dumps(c) for c in body_cls.split())});" if body_cls else "")
        + "})(document.documentElement);</script>")
    return f"{title}\n{boot}\n{head}\n{body}"


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("site", type=Path)
    ap.add_argument("--out", type=Path)
    ap.add_argument("--max-mb", type=float, default=15)
    ap.add_argument("--artifact", action="store_true", help="also write artifact.html (fragment form for Claude Artifacts)")
    args = ap.parse_args(argv)
    site = args.site.resolve()
    try:
        out = (args.out or site / "present.html").resolve()
        info = build(site, out, args.max_mb)
        if args.artifact:
            art = out.with_name("artifact.html")
            art.write_text(to_artifact(out.read_text(encoding="utf-8")), encoding="utf-8")
            info["artifact"] = str(art)
    except BundleError as e:
        sys.exit(f"openwebx bundle: {e}")
    print(json.dumps(info, indent=2))
    return info


if __name__ == "__main__":
    main()
