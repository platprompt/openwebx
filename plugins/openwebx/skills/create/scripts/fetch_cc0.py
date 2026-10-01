#!/usr/bin/env python3
"""openwebx CC0 assets: search and fetch HDRIs, PBR textures and glTF models
from Poly Haven (all assets CC0; asset search powered by Poly Haven).

Search (the director picks ids from here):
    python fetch_cc0.py search hdris "sunrise mountain" [--limit 12]
    python fetch_cc0.py search textures "forest ground"
    python fetch_cc0.py search models "pine tree"

Fetch into a site (writes media/cc0/... and media/cc0/cc0.json):
    python fetch_cc0.py get <site> --hdri <id> [--res 1k|2k]
    python fetch_cc0.py get <site> --texture <id> [--res 1k|2k]
    python fetch_cc0.py get <site> --model <id> [--res 1k|2k]
    python fetch_cc0.py get <site> --from-brief      # fetch everything listed in brief.look.cc0

Budget: prefer 1k (web). HDRIs ~1.5 MB at 1k, ~6 MB at 2k. A texture set at
1k is ~1-3 MB. Keep a site's total media under ~12 MB.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.request
from pathlib import Path

API = "https://api.polyhaven.com"
UA = {"User-Agent": "openwebx/0.1 (open-source creative web generator; CC0 asset fetch)"}
TYPES = {"hdris", "textures", "models"}
TEXTURE_MAPS = {"Diffuse": "diff", "nor_gl": "nor_gl", "Rough": "rough", "arm": "arm", "AO": "ao", "Displacement": "disp"}
# ARM packs AO + roughness + metalness, so diff + nor_gl + arm is a complete
# PBR set. Ask for others (rough, ao, disp) per asset with "maps" in the brief.
DEFAULT_MAPS = ("diff", "nor_gl", "arm")


def get_json(url: str):
    for attempt in range(3):
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30))
        except Exception:
            if attempt == 2:
                raise
            time.sleep(1.5)


def download(url: str, dest: Path) -> int:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 0:
        return dest.stat().st_size
    data = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120).read()
    dest.write_bytes(data)
    return len(data)


def search(kind: str, query: str, limit: int):
    if kind not in TYPES:
        sys.exit(f"type must be one of {sorted(TYPES)}")
    assets = get_json(f"{API}/assets?t={kind}")
    words = [w for w in query.lower().split() if w]
    scored = []
    for aid, a in assets.items():
        hay = " ".join([aid, a.get("name", "")] + a.get("tags", []) + a.get("categories", [])).lower()
        score = sum(2 if w in (a.get("name", "").lower() + aid) else 1 for w in words if w in hay)
        if score:
            scored.append((score, a.get("download_count", 0), aid, a))
    scored.sort(key=lambda s: (-s[0], -s[1]))
    for score, _, aid, a in scored[:limit]:
        cats = ", ".join(c for c in a.get("categories", []) if not c.startswith("collection"))[:70]
        tags = ", ".join(a.get("tags", [])[:6])
        print(f"{aid:34s} {a.get('name', '')[:30]:30s} | {cats} | {tags}")
    if not scored:
        print("no matches; try broader words (e.g. 'sunset', 'forest', 'studio', 'rock')")


def record(site: Path, entry: dict):
    manifest = site / "media" / "cc0" / "cc0.json"
    data = json.loads(manifest.read_text(encoding="utf-8")) if manifest.exists() else {"license": "CC0 1.0", "source": "polyhaven.com", "assets": []}
    data["assets"] = [a for a in data["assets"] if a["id"] != entry["id"]] + [entry]
    manifest.write_text(json.dumps(data, indent=2), encoding="utf-8")


def fetch_hdri(site: Path, aid: str, res: str) -> dict:
    files = get_json(f"{API}/files/{aid}")
    f = files["hdri"][res]["hdr"]
    rel = f"media/cc0/hdri/{aid}_{res}.hdr"
    size = download(f["url"], site / rel)
    return {"id": aid, "type": "hdri", "res": res, "files": {"hdr": rel}, "bytes": size}


def fetch_texture(site: Path, aid: str, res: str, maps=DEFAULT_MAPS) -> dict:
    files = get_json(f"{API}/files/{aid}")
    out, total = {}, 0
    for key, short in TEXTURE_MAPS.items():
        if short not in maps:
            continue
        node = files.get(key, {}).get(res, {})
        f = node.get("jpg") or node.get("png")
        if not f:
            continue
        ext = "jpg" if node.get("jpg") else "png"
        rel = f"media/cc0/tex/{aid}/{aid}_{short}_{res}.{ext}"
        total += download(f["url"], site / rel)
        out[short] = rel
    if not out:
        sys.exit(f"{aid}: no {res} texture maps found")
    return {"id": aid, "type": "texture", "res": res, "files": out, "bytes": total}


def fetch_model(site: Path, aid: str, res: str) -> dict:
    files = get_json(f"{API}/files/{aid}")
    node = files["gltf"][res]["gltf"]
    base = site / "media" / "cc0" / "models" / aid
    total = download(node["url"], base / Path(node["url"]).name)
    for rel_path, inc in (node.get("include") or {}).items():
        total += download(inc["url"], base / rel_path)
    rel = f"media/cc0/models/{aid}/{Path(node['url']).name}"
    return {"id": aid, "type": "model", "res": res, "files": {"gltf": rel}, "bytes": total}


FETCH = {"hdri": fetch_hdri, "texture": fetch_texture, "model": fetch_model}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("search")
    s.add_argument("type", choices=sorted(TYPES))
    s.add_argument("query")
    s.add_argument("--limit", type=int, default=12)
    g = sub.add_parser("get")
    g.add_argument("site", type=Path)
    g.add_argument("--hdri", action="append", default=[])
    g.add_argument("--texture", action="append", default=[])
    g.add_argument("--model", action="append", default=[])
    g.add_argument("--res", default="1k", choices=["1k", "2k", "4k"])
    g.add_argument("--from-brief", action="store_true")
    args = ap.parse_args(argv)
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    if args.cmd == "search":
        search(args.type, args.query, args.limit)
        print("\nAssets are CC0. Search powered by Poly Haven (polyhaven.com).")
        return

    site = args.site.resolve()
    jobs = [("hdri", i, args.res, None) for i in args.hdri] + [("texture", i, args.res, None) for i in args.texture] + [("model", i, args.res, None) for i in args.model]
    if args.from_brief:
        brief = json.loads((site / "_openwebx" / "brief.json").read_text(encoding="utf-8"))
        for item in (brief.get("look") or {}).get("cc0", []):
            jobs.append((item["type"], item["id"], item.get("res", "1k"), item.get("maps")))
    if not jobs:
        sys.exit("nothing to fetch (use --hdri/--texture/--model or --from-brief)")
    total = 0
    for kind, aid, res, maps in jobs:
        entry = FETCH[kind](site, aid, res, maps) if kind == "texture" and maps else FETCH[kind](site, aid, res)
        record(site, entry)
        total += entry["bytes"]
        print(f"{kind:8s} {aid:30s} {entry['bytes'] / 1e6:6.2f} MB  {json.dumps(entry['files'])}")
    print(f"total {total / 1e6:.2f} MB -> {site / 'media' / 'cc0'}  (CC0; via Poly Haven)")
    if total > 12e6:
        print("warning: media above 12 MB; prefer 1k resolutions or fewer sets")


if __name__ == "__main__":
    main()
