#!/usr/bin/env python3
"""Validate the openwebx repository and plugin bundle.

    python scripts/validate.py [--json]

Mirrors the agent-framework project-control validator for this bundle:
dual Claude/Codex manifests, version lock-step, skill/agent frontmatter,
references, license copies, no absolute paths, Python compiles and runtime
JS parses (when Node is available). Exit code 1 on any error.
"""
from __future__ import annotations

import argparse
import json
import py_compile
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLUGIN = ROOT / "plugins" / "openwebx"
SEMVER = re.compile(r"^\d+\.\d+\.\d+$")
ABS_PATH = re.compile(r"([A-Za-z]:[\\/](?:Users|AI Project|Program Files)|/Users/[A-Za-z]|/home/[a-z])")


def frontmatter(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    m = re.match(r"^---\s*\n(.*?)\n---\s*\n", text, re.S)
    if not m:
        return {}
    data, key = {}, None
    for line in m.group(1).splitlines():
        kv = re.match(r"^([\w-]+):\s*(.*)$", line)
        if kv:
            key, val = kv.group(1), kv.group(2).strip()
            data[key] = "" if val in (">", "|", ">-", "|-") else val.strip("\"'")
        elif key and line.startswith("  "):
            data[key] = (data[key] + " " + line.strip()).strip()
    return data


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)
    errors: list[str] = []
    warns: list[str] = []

    def load(p: Path):
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception as e:
            errors.append(f"{p.relative_to(ROOT)}: {e}")
            return {}

    # --- versions
    root_ver = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
    plug_ver = (PLUGIN / "VERSION").read_text(encoding="utf-8").strip()
    claude = load(PLUGIN / ".claude-plugin" / "plugin.json")
    codex = load(PLUGIN / ".codex-plugin" / "plugin.json")
    market = load(ROOT / ".claude-plugin" / "marketplace.json")
    probe = (PLUGIN / "skills/create/runtime/src/core/probe.js").read_text(encoding="utf-8")
    runtime_ver = re.search(r"RUNTIME_VERSION = '([^']+)'", probe)
    entry = next((p for p in market.get("plugins", []) if p.get("name") == "openwebx"), {})
    versions = {
        "VERSION": root_ver, "plugins/openwebx/VERSION": plug_ver, "claude plugin.json": claude.get("version"),
        "codex plugin.json": codex.get("version"), "marketplace entry": entry.get("version"),
        "runtime probe": runtime_ver.group(1) if runtime_ver else None,
    }
    if not SEMVER.match(root_ver):
        errors.append(f"VERSION '{root_ver}' is not semver")
    if len(set(versions.values())) != 1:
        errors.append(f"versions out of lock-step: {versions}")

    # --- manifests
    for name, m in (("claude", claude), ("codex", codex)):
        if m.get("name") != PLUGIN.name:
            errors.append(f"{name} manifest name '{m.get('name')}' != directory '{PLUGIN.name}'")
    if claude.get("skills") != ["./skills/"]:
        errors.append('claude manifest must declare "skills": ["./skills/"]')
    if codex.get("skills") != "./skills/":
        errors.append('codex manifest must declare "skills": "./skills/"')
    prompts = codex.get("interface", {}).get("defaultPrompt", [])
    if not 1 <= len(prompts) <= 3:
        errors.append("codex interface.defaultPrompt needs 1-3 entries")
    if entry.get("source") != "./plugins/openwebx" or not (ROOT / entry.get("source", "x")).is_dir():
        errors.append("marketplace entry source must be ./plugins/openwebx")
    if claude.get("description") != codex.get("description"):
        warns.append("claude and codex descriptions differ")

    # --- skills
    skills = sorted(p for p in (PLUGIN / "skills").iterdir() if p.is_dir())
    for s in skills:
        md = s / "SKILL.md"
        if not md.is_file():
            errors.append(f"skills/{s.name}: SKILL.md missing")
            continue
        fm = frontmatter(md)
        if fm.get("name") != s.name:
            errors.append(f"skills/{s.name}: frontmatter name '{fm.get('name')}' != directory")
        desc = fm.get("description", "")
        if not desc:
            errors.append(f"skills/{s.name}: description missing")
        elif len(desc) > 1024:
            errors.append(f"skills/{s.name}: description is {len(desc)} chars (max 1024)")
        if fm.get("disable-model-invocation") != "true" and not (s / "agents" / "openai.yaml").is_file():
            warns.append(f"skills/{s.name}: no agents/openai.yaml for Codex")
        body = md.read_text(encoding="utf-8")
        for ref in sorted(set(re.findall(r"(?<![\w/.])((?:\.\./create/)?references/[\w.-]+\.md)", body))):
            if not (s / ref).resolve().is_file():
                errors.append(f"skills/{s.name}: referenced {ref} not found")

    # --- agents
    agent_names = []
    for a in sorted((PLUGIN / "agents").glob("*.md")):
        fm = frontmatter(a)
        agent_names.append(fm.get("name"))
        if fm.get("name") != a.stem:
            errors.append(f"agents/{a.name}: name '{fm.get('name')}' != file stem")
        if not fm.get("description"):
            errors.append(f"agents/{a.name}: description missing")
    create = (PLUGIN / "skills/create/SKILL.md").read_text(encoding="utf-8")
    for n in agent_names:
        if f"openwebx:{n}" not in create:
            warns.append(f"agent {n} is not referenced as openwebx:{n} in the create skill")

    # --- license copies
    lic_root, lic_plug = ROOT / "LICENSE", PLUGIN / "LICENSE"
    if not (lic_root.is_file() and lic_plug.is_file()):
        errors.append("LICENSE missing at repo root or plugin root")
    elif lic_root.read_bytes() != lic_plug.read_bytes():
        errors.append("plugin LICENSE differs from repo LICENSE")

    # --- absolute paths & residue
    for f in PLUGIN.rglob("*"):
        if not f.is_file() or f.suffix.lower() not in {".md", ".json", ".js", ".py", ".css", ".yaml", ".tmpl", ".html"}:
            continue
        text = f.read_text(encoding="utf-8", errors="replace")
        m = ABS_PATH.search(text)
        if m:
            errors.append(f"{f.relative_to(ROOT)} contains an absolute path: {m.group(0)}")
    for junk in list(PLUGIN.rglob("__pycache__")):
        warns.append(f"residue: {junk.relative_to(ROOT)}")

    # --- python compiles
    for py in list(PLUGIN.rglob("*.py")) + list((ROOT / "scripts").glob("*.py")):
        if "__pycache__" in py.parts:
            continue
        try:
            with tempfile.TemporaryDirectory() as tmp:
                py_compile.compile(str(py), cfile=str(Path(tmp) / "x.pyc"), doraise=True)
        except py_compile.PyCompileError as e:
            errors.append(f"{py.relative_to(ROOT)}: {e.msg.strip().splitlines()[-1]}")

    # --- runtime JS parses
    node = shutil.which("node")
    js = sorted((PLUGIN / "skills/create/runtime").rglob("*.js"))
    if node:
        for f in js:
            with tempfile.TemporaryDirectory() as tmp:
                t = Path(tmp) / (f.stem + ".mjs")
                t.write_text(f.read_text(encoding="utf-8"), encoding="utf-8")
                r = subprocess.run([node, "--check", str(t)], capture_output=True, text=True)
                if r.returncode:
                    errors.append(f"{f.relative_to(ROOT)}: {r.stderr.strip().splitlines()[-1] if r.stderr.strip() else 'syntax error'}")
    else:
        warns.append("node not found: runtime JS not syntax-checked")

    result = {"errors": errors, "warnings": warns,
              "info": {"version": root_ver, "skills": [s.name for s in skills], "agents": agent_names, "runtime_js": len(js)}}
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        for e in errors:
            print(f"ERROR  {e}")
        for w in warns:
            print(f"warn   {w}")
        print(f"info   {json.dumps(result['info'])}")
        print("PASS" if not errors else f"FAIL ({len(errors)} errors)")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
