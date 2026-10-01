"""openwebx pipeline tests (stdlib unittest; also runs under pytest).

    python -m unittest discover -s tests -v
"""
import json
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLUGIN = ROOT / "plugins" / "openwebx"
SCRIPTS = PLUGIN / "skills" / "create" / "scripts"
EXAMPLES = PLUGIN / "examples" / "content"
sys.path.insert(0, str(SCRIPTS))

import bundle  # noqa: E402
import ingest  # noqa: E402
import ox_html  # noqa: E402
import ox_md  # noqa: E402
import qa  # noqa: E402
import scaffold  # noqa: E402

BRIEF = {
    "theme": "test",
    "slug": "t",
    "palette": {"bg": "#000000", "ink": "#ffffff", "accent": "#c9a45c"},
    "concept": {"form": "path", "avoid_terms": ["Forbiddenland"]},
    "chrome": {
        "contents": "list", "folio": "value-name", "values": ["05:30", "06:00", "07:10"],
        "arrival": "veil", "tags": "anchored", "sound": "offer",
        "sound_label": {"off": "ฟังลมบนสันดอย", "on": "พักเสียงไว้ก่อน"},
        "reasons": {"contents": "c", "folio": "f", "arrival": "a", "tags": "t", "sound": "s"},
    },
    "scene": {"hero": {"source": "procedural", "detail": ["worn brass hinges", "etched contour lines", "felt-lined drawer"]}},
}


def mini_content(*sections, lang="en"):
    """content.json stand-in: one section per text (str) given."""
    secs = [{"id": f"s{k:02d}", "heading": "", "level": 2, "text": t, "html": f"<p>{t}</p>", "images": []}
            for k, t in enumerate(sections)]
    return {"lang": lang, "title": "T", "description": "d", "sections": secs, "faq": [], "stats": {}}


def words(n):
    return " ".join(["word"] * n)


class Markdown(unittest.TestCase):
    def test_blocks_and_inline(self):
        fm, blocks = ox_md.parse("---\ntitle: T\ntags: [a, b]\n---\n# H\n\nSome **b** and *i* `c` [l](https://x.y).\n\n- a\n- b\n  - c\n\n| A | B |\n|---|---|\n| 1 | 2 |\n")
        self.assertEqual(fm, {"title": "T", "tags": ["a", "b"]})
        self.assertEqual(blocks[0], "<h1>H</h1>")
        self.assertIn("<strong>b</strong>", blocks[1])
        self.assertIn('<a href="https://x.y">l</a>', blocks[1])
        self.assertEqual(blocks[2], "<ul><li>a</li><li>b<ul><li>c</li></ul></li></ul>")
        self.assertTrue(blocks[3].startswith("<table><thead><tr><th>A</th>"))

    def test_sanitises(self):
        _, blocks = ox_md.parse('<div onclick="x()"><script>alert(1)</script>ok</div>\n\n[bad](javascript:alert(1)) <img src=x onerror=y>')
        joined = "".join(blocks)
        tags = re.findall(r"<[^>]+>", joined)  # escaped text like &lt;img&gt; is harmless
        self.assertFalse([t for t in tags if re.search(r"script|onclick|onerror|javascript:", t, re.I)], tags)
        self.assertNotIn("alert(1)</script>", joined)

    def test_heading_shift(self):
        _, blocks = ox_md.parse("# A\n## B", shift=1)
        self.assertEqual(blocks, ["<h2>A</h2>", "<h3>B</h3>"])

    def test_html_extract_drops_chrome(self):
        main, info = ox_html.extract_main("<html lang='th'><title>X</title><body><nav>menu</nav><main><h2>K</h2><p>v</p></main></body></html>")
        clean = ox_html.sanitize(main, drop_chrome=True)
        self.assertEqual(info["lang"], "th")
        self.assertEqual(clean, "<h2>K</h2><p>v</p>")

    def test_lang_detection(self):
        self.assertEqual(ox_html.detect_lang("สวัสดีครับ นี่คือการทดสอบภาษาไทย"), "th")
        self.assertEqual(ox_html.detect_lang("Hello there, this is English."), "en")


class Ingest(unittest.TestCase):
    def test_thai_article(self):
        c = ingest.build([EXAMPLES / "seo-article-th"], None)
        self.assertEqual(c["lang"], "th")
        self.assertEqual(len(c["sections"]), 8)
        self.assertEqual(len(c["faq"]), 4)
        self.assertTrue(c["images"][0]["exists"])
        self.assertEqual(c["title_from"], "front_matter")

    def test_portfolio(self):
        c = ingest.build([EXAMPLES / "portfolio" / "projects.json"], None)
        self.assertEqual(c["kind_hint"], "collection")
        self.assertEqual([s["heading"] for s in c["sections"]][:2], ["Ōra Lamp", "Salt House"])


class Scaffold(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.content = ingest.build([EXAMPLES / "seo-article-th"], None)
        cls.ids = [s["id"] for s in cls.content["sections"]]

    def brief(self, **extra):
        b = json.loads(json.dumps(BRIEF))
        b["chapters"] = [{"sections": self.ids[:1]}, {"composition": "interlude", "display": "x"},
                         {"sections": self.ids[1:]}]
        b.update(extra)
        return b

    def test_rejects_missing_and_order(self):
        b = self.brief()
        b["chapters"][2]["sections"] = self.ids[2:]
        with self.assertRaises(scaffold.BriefError):
            scaffold.normalise_brief(b, self.content)
        b["chapters"][2]["sections"] = list(reversed(self.ids[1:]))
        with self.assertRaises(scaffold.BriefError):
            scaffold.normalise_brief(b, self.content)

    def test_rejects_avoid_terms_in_copy(self):
        b = self.brief(hero={"eyebrow": "Welcome to Forbiddenland"})
        with self.assertRaises(scaffold.BriefError):
            scaffold.normalise_brief(b, self.content)
        for chrome in ({"sound_label": {"off": "Forbiddenland wind", "on": "rest"}},
                       {"contents_lead": "Through Forbiddenland"},
                       {"values": ["a", "Forbiddenland", "c"]}):
            b = self.brief()
            b["chrome"].update(chrome)
            with self.assertRaises(scaffold.BriefError, msg=chrome):
                scaffold.normalise_brief(b, self.content)
        with self.assertRaises(scaffold.BriefError):
            scaffold.normalise_brief(self.brief(arrival_status="Forbiddenland is ready."), self.content)

    def test_removed_chrome_keys_have_migration_hints(self):
        hints = {"nav": "chrome.contents", "nav_labels": "chrome.values", "loader": "chrome.arrival",
                 "cursor": "chrome.tags", "hold": "chrome.tags", "readout": "chrome.folio"}
        for key, hint in hints.items():
            b = self.brief()
            b["chrome"][key] = "x"
            with self.assertRaises(scaffold.BriefError) as cm:
                scaffold.normalise_brief(b, self.content)
            self.assertIn("removed in 0.2.0", str(cm.exception))
            self.assertIn(hint, str(cm.exception))
        for key, hint in {"loader": "chrome.arrival", "cursor": "chrome.tags"}.items():
            with self.assertRaises(scaffold.BriefError) as cm:
                scaffold.normalise_brief(self.brief(**{key: {}}), self.content)
            self.assertIn(hint, str(cm.exception))
        b = self.brief()
        b["chrome"]["sound"] = "icon"
        with self.assertRaises(scaffold.BriefError) as cm:
            scaffold.normalise_brief(b, self.content)
        self.assertIn("sound_label", str(cm.exception))

    def test_reading_default_by_length(self):
        def reading(content, chapters):
            b = json.loads(json.dumps(BRIEF))
            b["chrome"] = {}
            b["chapters"] = chapters
            return scaffold.normalise_brief(b, content)[0]["reading"]
        short = mini_content(words(40), words(100))
        self.assertEqual(reading(short, [{"sections": ["s00"]}, {"sections": ["s01"]}]), "overlay")
        one_long = mini_content(words(40), words(190))
        self.assertEqual(reading(one_long, [{"sections": ["s00"]}, {"sections": ["s01"]}]), "interleave")
        many = mini_content(*[words(170)] * 6)
        self.assertEqual(reading(many, [{"sections": [f"s{k:02d}"]} for k in range(6)]), "interleave")
        thai = mini_content("ก" * 40, "ข" * 760, lang="th")  # 760 Thai characters > 720
        self.assertEqual(reading(thai, [{"sections": ["s00"]}, {"sections": ["s01"]}]), "interleave")
        # an explicit reading wins
        b = json.loads(json.dumps(BRIEF))
        b.update(chrome={}, reading="beside", chapters=[{"sections": ["s00"]}, {"sections": ["s01"]}])
        self.assertEqual(scaffold.normalise_brief(b, one_long)[0]["reading"], "beside")

    def test_neighbour_rule(self):
        content = mini_content(words(30), words(30), words(30))
        b = json.loads(json.dumps(BRIEF))
        b["chrome"] = {}
        b["chapters"] = [{"sections": ["s00"]}, {"sections": ["s01"]}, {"sections": ["s02"]}]
        norm, _ = scaffold.normalise_brief(b, content)
        pairs = [(c["composition"], c["side"]) for c in norm["chapters"]]
        self.assertEqual(pairs[1][0], "caption")
        self.assertTrue(all(pairs[k] != pairs[k + 1] for k in range(len(pairs) - 1)), pairs)
        b["chapters"][1].update(composition="caption", side="left")
        b["chapters"][2].update(composition="caption", side="left")
        with self.assertRaises(scaffold.BriefError) as cm:
            scaffold.normalise_brief(b, content)
        self.assertIn("neighbours", str(cm.exception))
        b["chapters"][2]["side"] = "center"
        with self.assertRaises(scaffold.BriefError):  # center only for opening / interlude
            scaffold.normalise_brief(b, content)

    def test_length_limit(self):
        content = mini_content(words(30), words(100))
        b = json.loads(json.dumps(BRIEF))
        b["chrome"] = {}
        b["chapters"] = [{"sections": ["s00"]}, {"sections": ["s01"], "composition": "caption"}]
        with self.assertRaises(scaffold.BriefError) as cm:
            scaffold.normalise_brief(b, content)
        self.assertIn("paper, spread or ledger", str(cm.exception))
        b["chapters"][1]["composition"] = "paper"
        scaffold.normalise_brief(b, content)

    def test_layout_and_panel_migration(self):
        for key, value, hint in (("layout", "hero", "opening"), ("layout", "breath", "interlude"),
                                 ("layout", "wide", "ledger"), ("layout", "left", "side"), ("panel", "glass", "drop it")):
            b = self.brief()
            b["chapters"][2][key] = value
            with self.assertRaises(scaffold.BriefError, msg=(key, value)) as cm:
                scaffold.normalise_brief(b, self.content)
            self.assertIn("removed in 0.2.0", str(cm.exception))
            self.assertIn(hint, str(cm.exception))

    def test_chrome_defaults_and_rules(self):
        b = self.brief()
        del b["chrome"]
        norm, _ = scaffold.normalise_brief(b, self.content)
        c = norm["chrome"]
        self.assertEqual({k: c[k] for k in scaffold.CHROME},
                         {"contents": "list", "folio": "name", "arrival": "veil", "tags": "anchored", "sound": "offer"})
        self.assertEqual(c["sound_label"], scaffold.UI_DEFAULTS["th"]["sound_label"])
        self.assertNotRegex(json.dumps(scaffold.UI_DEFAULTS, ensure_ascii=False), r"(?i)sound o(n|ff)")
        self.assertEqual(norm["arrival_status"], scaffold.UI_DEFAULTS["th"]["ready"])
        bad_cases = ({"folio": "value-name", "values": None}, {"values": ["one"]}, {"contents": "none"},
                     {"sound_label": {"off": "Sound off", "on": "Sound on"}}, {"arrival": "loader"})
        for bad in bad_cases:
            b = self.brief()
            b["chrome"].update(bad)
            if "values" in bad and bad["values"] is None:
                del b["chrome"]["values"]
            with self.assertRaises(scaffold.BriefError, msg=bad):
                scaffold.normalise_brief(b, self.content)

    def test_build_and_qa(self):
        tmp = Path(tempfile.mkdtemp())
        try:
            (tmp / "content.json").write_text(json.dumps(self.content, ensure_ascii=False), encoding="utf-8")
            (tmp / "brief.json").write_text(json.dumps(self.brief(), ensure_ascii=False), encoding="utf-8")
            site = scaffold.main(["--content", str(tmp / "content.json"), "--brief", str(tmp / "brief.json"), "--out-root", str(tmp / "out")])
            res = qa.check(site)
            self.assertEqual(res["errors"], [])
            html = (site / "index.html").read_text(encoding="utf-8")
            self.assertIn('lang="th"', html)
            self.assertIn("FAQPage", html)
            # 0.2.0 chrome: contents nav in chapter 0 (after the content, before
            # the sound offer), a folio at the top of every chapter, no fixed HUD
            ch0 = re.search(r'<section[^>]*id="ch-0".*?</section>', html, re.S).group(0)
            self.assertIn('<nav id="contents"', ch0)
            self.assertIn('<a href="#ch-2">', ch0)
            self.assertNotIn('href="#ch-1"', ch0)  # breath interludes are not listed
            self.assertLess(ch0.index("<!-- s00 -->"), ch0.index('id="contents"'))
            self.assertLess(ch0.index('id="contents"'), ch0.index('class="ox-sound"'))
            self.assertIn('<button class="ox-sound" type="button" aria-pressed="false" hidden>'
                          '<span class="ox-sound__label">ฟังลมบนสันดอย</span>', ch0)
            for i, value in enumerate(["05:30", "06:00", "07:10"]):
                first = re.search(rf'<section[^>]*id="ch-{i}"[^>]*>\s*(<[^>]+>)', html).group(1)
                self.assertIn('class="ox-folio"', first)
                self.assertIn(f'<span class="ox-folio__value">{value}</span>', html)
            self.assertIn('<main id="content">', html)  # aria-busy comes from the head script only
            self.assertIn("setAttribute('aria-busy', 'true')", html)
            self.assertIn('data-reading="interleave"', html)
            self.assertIn('data-composition="opening" data-side="left"', html)
            self.assertIn('data-composition="interlude" data-side="center" aria-hidden="true"', html)
            self.assertIn('class="ox-chapter ox-chapter--ledger"', html)  # it holds a table
            self.assertIn('<p class="ox-status ox-sr-only" role="status"></p>', html)
            self.assertIn('<div class="ox-tag" aria-hidden="true"></div>', html)
            self.assertIn('data-arrival="veil"', html)
            for gone in ("ox-hud", "ox-loader", "ox-nav", "ox-cursor", "data-sound-label", "Sound off", "is-loading"):
                self.assertNotIn(gone, html)
            self.assertEqual(qa._css_fixed((site / "css" / "openwebx.css").read_text(encoding="utf-8")), [])
            self.assertTrue(any(p.suffix == ".svg" for p in (site / "media").iterdir()))
            # snapshots shipped with the site never hold absolute machine paths
            snap = (site / "_openwebx" / "content.json").read_text(encoding="utf-8")
            self.assertNotIn(str(EXAMPLES.parent.parent), snap)
            self.assertNotRegex(snap, r'"(path|file|source)": "([A-Za-z]:\\\\|/)')
            # refresh keeps builder-owned files and still resolves content images
            (site / "css" / "theme.css").write_text("/* mine */", encoding="utf-8")
            scaffold.main(["--site", str(site)])
            self.assertEqual((site / "css" / "theme.css").read_text(encoding="utf-8"), "/* mine */")
            self.assertRegex((site / "index.html").read_text(encoding="utf-8"), r'src="media/trail-profile-[0-9a-f]{6}\.svg"')
            # the single-file presentation bundles, parses and embeds media
            info = bundle.build(site, site / "present.html", 15)
            present = (site / "present.html").read_text(encoding="utf-8")
            self.assertNotIn('src="src/main.js"', present)
            self.assertIn("window.__OX_MEDIA__", present)
            self.assertIn('"media/trail-profile-', present)
            self.assertNotIn('"min": min', present)  # default params are not exports
            self.assertLess(info["mb"], 15)
            frag = bundle.to_artifact(present)
            self.assertTrue(frag.lstrip().startswith("<title>"))
            self.assertNotRegex(frag, r"<(!doctype|html|head|body)\b")
            self.assertIn("h.setAttribute(\"lang\",\"th\")", frag)
            self.assertIn("h.setAttribute(\"data-arrival\",\"veil\")", frag)
            self.assertIn("classList.add('js')", frag)
            self.assertEqual(qa.originality(site), [])
            # a second build never overwrites the first
            site2 = scaffold.main(["--content", str(tmp / "content.json"), "--brief", str(tmp / "brief.json"), "--out-root", str(tmp / "out")])
            self.assertNotEqual(site, site2)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


class Originality(unittest.TestCase):
    """The originality lint flags removed 0.1.0 chrome and the reference house style."""

    def site(self, html="", css="", js=""):
        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, tmp, True)
        (tmp / "css").mkdir()
        (tmp / "src" / "scene").mkdir(parents=True)
        (tmp / "index.html").write_text(f"<!doctype html><html><head>{html}</head><body><main id=content><p>ok</p></main></body></html>", encoding="utf-8")
        (tmp / "css" / "theme.css").write_text(css, encoding="utf-8")
        (tmp / "src" / "scene" / "scene.js").write_text(js, encoding="utf-8")
        return tmp

    def test_clean(self):
        self.assertEqual(qa.originality(self.site(css=".ox-stage { position: fixed; } .x { color: red }")), [])

    def test_legacy_identifier(self):
        errs = qa.originality(self.site(css=".ox-loader__bar { transform: scaleX(0); }"))
        self.assertTrue(any("ox-loader" in e for e in errs), errs)
        errs = qa.originality(self.site(js="ctx.cursor.setSceneTarget('x');"))
        self.assertTrue(any("setSceneTarget" in e for e in errs), errs)

    def test_sound_literal(self):
        errs = qa.originality(self.site(js="button.textContent = on ? 'Sound on' : 'Sound off';"))
        self.assertTrue(any("Sound off" in e for e in errs), errs)
        # article text may talk about sound
        tmp = self.site()
        (tmp / "index.html").write_text("<html><body><main><p>The sound on the ridge was wind.</p></main></body></html>", encoding="utf-8")
        self.assertEqual(qa.originality(tmp), [])

    def test_font_trio(self):
        head = ('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Serif&amp;display=swap">'
                '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400&amp;display=swap">')
        self.assertEqual(qa.originality(self.site(html=head)), [])  # two of the three is fine
        errs = qa.originality(self.site(html=head, css=":root { --ox-font-mono: 'JetBrains Mono', monospace; }"))
        self.assertTrue(any("Instrument Serif + Inter Tight + JetBrains Mono" in e for e in errs), errs)

    def test_cursor_counter_and_fixed(self):
        errs = qa.originality(self.site(css="html { cursor: none; } .hud { position: fixed; top: 0; }",
                                        js="el.textContent = String(p).padStart(3, '0');"))
        text = " ".join(errs)
        self.assertIn("cursor: none", text)
        self.assertIn("`.hud` is fixed", text)
        self.assertIn("zero-padded", text)


class Beauty(unittest.TestCase):
    """Static layout and beauty checks (qa.py) and the ?ox-qa probe guard."""

    def test_q_center(self):
        self.assertTrue(qa.center_rules(".ox-prose p { text-align: center; }"))
        self.assertTrue(qa.center_rules(".ox-chapter__inner { text-align:center }"))
        self.assertTrue(qa.center_rules("@media (min-width: 1px) { .x li, h2 { text-align: center } }"))
        self.assertEqual(qa.center_rules(".ox-chapter--interlude .ox-chapter__inner { text-align: center; }"), [])
        self.assertEqual(qa.center_rules(".ox-prose h2, .ox-display { text-align: center; }"), [])
        kit = (SCRIPTS.parent / "runtime" / "css" / "openwebx.css").read_text(encoding="utf-8")
        self.assertEqual(qa.center_rules(kit), [])

    def test_q_hero(self):
        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, tmp, True)
        (tmp / "css").mkdir()
        html = "<main></main>"
        self.assertTrue(any(e.startswith("Q-hero") for e in qa.layout_checks(tmp, html, {})))
        weak = {"scene": {"hero": {"source": "procedural", "detail": ["a box"]}}}
        self.assertTrue(any(e.startswith("Q-hero") for e in qa.layout_checks(tmp, html, weak)))
        self.assertEqual(qa.layout_checks(tmp, html, {"scene": {"hero": {"source": "cc0", "id": "brass_goblets"}}}), [])
        self.assertEqual(qa.layout_checks(tmp, html, BRIEF), [])

    def test_q_repeat_and_length(self):
        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, tmp, True)
        sec = '<section class="ox-chapter ox-chapter--{0}" data-composition="{0}" data-side="{1}"><div class="ox-chapter__inner"><p>{2}</p></div></section>'
        html = sec.format("caption", "left", words(10)) + sec.format("caption", "left", words(80))
        errs = " ".join(qa.layout_checks(tmp, html, BRIEF))
        self.assertIn("Q-repeat", errs)
        self.assertIn("Q-length", errs)

    @unittest.skipUnless(shutil.which("node"), "node not available")
    def test_qa_probe_fields_are_guarded(self):
        probe = (SCRIPTS.parent / "runtime" / "src" / "core" / "probe.js").as_uri()
        script = ("globalThis.window = globalThis; globalThis.addEventListener = () => {};"
                  "globalThis.location = { search: process.argv[1] };"
                  f"const m = await import({json.dumps(probe)});"
                  "const p = m.createProbe();"
                  "console.log(JSON.stringify({ qa: m.QA, layout: 'layout' in p, light: 'light' in p }));")
        out = {}
        for search in ("", "?ox-qa", "?a=1&ox-qa=1", "?ox-qaa"):
            r = subprocess.run(["node", "--input-type=module", "-e", script, search], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)
            out[search] = json.loads(r.stdout)
        self.assertEqual(out[""], {"qa": False, "layout": False, "light": False})
        self.assertEqual(out["?ox-qaa"], {"qa": False, "layout": False, "light": False})
        self.assertEqual(out["?ox-qa"], {"qa": True, "layout": True, "light": True})
        self.assertEqual(out["?a=1&ox-qa=1"]["qa"], True)
        # the runtime writes the QA fields only through QA-guarded code
        core = SCRIPTS.parent / "runtime" / "src" / "core"
        app = (core / "app.js").read_text(encoding="utf-8")
        self.assertIn("const meter = QA ? createLightMeter(probe) : null;", app)
        self.assertIn("qa: QA", app)
        layout = (core / "layout.js").read_text(encoding="utf-8")
        self.assertIn("if (this.qa && ", layout)
        self.assertIn("if (!p || !p.layout", layout)
        self.assertIn("if (!probe || !probe.light) return null;", layout)


class Glb(unittest.TestCase):
    def test_gltf_packs_into_glb(self):
        import struct
        tmp = Path(tempfile.mkdtemp())
        try:
            (tmp / "m.bin").write_bytes(b"\x01\x02\x03")
            (tmp / "t.png").write_bytes(b"\x89PNG....")
            (tmp / "m.gltf").write_text(json.dumps({
                "asset": {"version": "2.0"}, "buffers": [{"uri": "m.bin", "byteLength": 3}],
                "bufferViews": [{"buffer": 0, "byteLength": 3}], "images": [{"uri": "t.png"}]}), encoding="utf-8")
            glb, parts = bundle.gltf_to_glb(tmp / "m.gltf")
            magic, version, total = struct.unpack("<4sII", glb[:12])
            self.assertEqual((magic, version, total), (b"glTF", 2, len(glb)))
            jlen = struct.unpack("<I", glb[12:16])[0]
            doc = json.loads(glb[20:20 + jlen])
            self.assertEqual(doc["images"][0]["bufferView"], 1)
            self.assertNotIn("uri", doc["buffers"][0])
            self.assertEqual(len(parts), 2)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
