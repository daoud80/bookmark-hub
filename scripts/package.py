#!/usr/bin/env python3
"""Build installable zips from the extension folder (standard library only).

    python scripts/package.py

Writes two files to dist/:
  bookmark-hub-newtab.zip   replaces the browser's new tab page, plus a toolbar button
  bookmark-hub-toolbar.zip  toolbar button only; your new tab page is left alone
"""
import json, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXT = ROOT / "extension"
DIST = ROOT / "dist"


def build(name, keep_newtab):
    manifest = json.loads((EXT / "manifest.json").read_text(encoding="utf-8"))
    if not keep_newtab:
        manifest.pop("chrome_url_overrides", None)
    out = DIST / name
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(EXT.rglob("*")):
            if f.is_file() and f.name != "manifest.json":
                z.write(f, f.relative_to(EXT).as_posix())
        z.writestr("manifest.json", json.dumps(manifest, indent=2) + "\n")
    print(f"{out.relative_to(ROOT)}  ({out.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    DIST.mkdir(exist_ok=True)
    build("bookmark-hub-newtab.zip", True)
    build("bookmark-hub-toolbar.zip", False)
