#!/usr/bin/env python3
"""End-to-end smoke test: loads the unpacked extension in a real Chromium, creates sample
bookmarks, and checks rendering, search, folders, notes, live updates and settings.

    pip install playwright && python -m playwright install chromium
    python tests/smoke.py                      # run the checks
    python tests/smoke.py --screenshots docs   # also write sample-data screenshots

Set CHROMIUM=/path/to/chrome to use a specific browser binary.
Needs a browser that supports extensions in (new) headless mode; falls back to xvfb-run if you
have no display and the headless run fails.
"""
import argparse, hashlib, json, os, sys, tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
EXT = ROOT / "extension"

SAMPLE = {
    "bar": [
        {"title": "Team Wiki", "url": "https://wiki.example.com/home"},
        {"title": "Status Page", "url": "https://status.example.com/"},
        {"title": "Shared Calendar", "url": "https://calendar.example.com/"},
        {"title": "Design", "children": [
            {"title": "Icon Library", "url": "https://icons.example.org/"},
            {"title": "Colour Palettes", "url": "https://palettes.example.org/"},
            {"title": "Type Specimens", "url": "https://type.example.org/"},
            {"title": "Mockup Gallery", "url": "https://mockups.example.org/"},
        ]},
        {"title": "Docs", "children": [
            {"title": "API Reference", "url": "https://api.example.dev/reference"},
            {"title": "Style Guide", "url": "https://style.example.dev/"},
            {"title": "Release Notes", "url": "https://releases.example.dev/"},
            {"title": "Archive", "children": [
                {"title": "Old Handbook", "url": "https://handbook.example.dev/2019"},
            ]},
        ]},
        {"title": "Dev", "children": [
            {"title": "Build Dashboard", "url": "https://builds.example.io/"},
            {"title": "Issue Tracker", "url": "https://issues.example.io/"},
            {"title": "Package Index", "url": "https://packages.example.io/"},
            {"title": "Code Review", "url": "https://review.example.io/"},
        ]},
        # these must NOT be listed (only http/https pages are shown)
        {"title": "A bookmarklet", "url": "javascript:void(0)"},
        {"title": "Browser settings", "url": "chrome://settings/"},
    ],
    "other": [
        {"title": "Reading List", "url": "https://read.example.net/"},
        {"title": "Weekend Projects", "url": "https://projects.example.net/"},
    ],
}
LISTED = 17  # 19 bookmarks minus the 2 that must be skipped
NOTES = {
    "https://wiki.example.com/home": "Start here: how we work, who owns what",
    "https://status.example.com/": "Is it down? Check here first",
    "https://api.example.dev/reference": "Endpoints, auth and rate limits",
    "https://builds.example.io/": "Green means ship it",
    "https://icons.example.org/": "Licensed sets only",
}

CREATE_JS = """async (spec) => {
  const tree = await chrome.bookmarks.getTree();
  const bar = tree[0].children[0].id, other = tree[0].children[1].id;
  async function make(parentId, items) {
    for (const it of items) {
      if (it.children) { const f = await chrome.bookmarks.create({ parentId, title: it.title }); await make(f.id, it.children); }
      else await chrome.bookmarks.create({ parentId, title: it.title, url: it.url });
    }
  }
  await make(bar, spec.bar); await make(other, spec.other);
}"""


def fake_icon(host):
    """Small coloured PNG used only in screenshot mode, so the sample page shows icons."""
    from PIL import Image, ImageDraw
    import io
    h = int(hashlib.md5(host.encode()).hexdigest(), 16)
    palette = [(79, 70, 229), (14, 165, 233), (16, 185, 129), (245, 158, 11), (236, 72, 153), (100, 116, 139)]
    col = palette[h % len(palette)]
    S = 128
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.rounded_rectangle((8, 8, S - 8, S - 8), radius=28, fill=col + (255,))
    k = h % 3
    if k == 0: d.ellipse((38, 38, S - 38, S - 38), fill=(255, 255, 255, 255))
    elif k == 1: d.polygon([(S // 2, 34), (S - 34, S - 38), (34, S - 38)], fill=(255, 255, 255, 255))
    else: d.rectangle((38, 38, S - 38, S - 38), fill=(255, 255, 255, 255))
    out = io.BytesIO(); im.save(out, "PNG"); return out.getvalue()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--screenshots", metavar="DIR")
    args = ap.parse_args()
    shots = Path(args.screenshots) if args.screenshots else None
    if shots: shots.mkdir(parents=True, exist_ok=True)

    failures = []
    def check(name, ok, detail=""):
        print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail and not ok else ""))
        if not ok: failures.append(name)

    exe = os.environ.get("CHROMIUM") or None
    with sync_playwright() as p, tempfile.TemporaryDirectory() as profile:
        ctx = p.chromium.launch_persistent_context(
            profile, headless=True, channel=None if exe else "chromium", executable_path=exe,
            viewport={"width": 1280, "height": 800}, accept_downloads=True,
            args=[f"--disable-extensions-except={EXT}", f"--load-extension={EXT}"])
        sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker", timeout=15000)
        ext_id = sw.url.split("/")[2]
        sw.evaluate(CREATE_JS, SAMPLE)

        errors = []
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        if shots:
            page.route("**/_favicon/**", lambda r: r.fulfill(
                body=fake_icon(r.request.url.split("pageUrl=")[1].split("&")[0]), content_type="image/png"))
        url = f"chrome-extension://{ext_id}/hub.html"
        page.goto(url)
        page.wait_for_selector(".card")

        cards = page.locator(".card")
        check("lists only http(s) bookmarks", cards.count() == LISTED, f"got {cards.count()}")
        check("count text", page.inner_text("#count") == f"{LISTED} bookmarks")
        check("javascript: and chrome: pages are skipped",
              "bookmarklet" not in page.inner_text("main").lower() and "browser settings" not in page.inner_text("main").lower())
        chip_texts = page.locator(".chip").all_inner_texts()
        check("folder chips", any(t.startswith("Design") for t in chip_texts) and any(t.startswith("Other") for t in chip_texts), str(chip_texts))
        check("nested folder heading", "DOCS › ARCHIVE" in page.inner_text("main").upper())

        page.fill("#q", "wiki")
        check("search by name", page.locator(".card").count() == 1)
        page.fill("#q", "example.io")
        check("search by address", page.locator(".card").count() == 4)
        page.fill("#q", "zzzz")
        check("empty search message", "No bookmarks match" in page.inner_text("main"))
        page.fill("#q", "")

        page.locator(".chip", has_text="Design").click()
        check("folder filter", page.locator(".card").count() == 4)
        page.locator(".chip", has_text="All").click()

        # notes
        page.locator(".card", has_text="Team Wiki").locator(".edit").click(force=True)
        page.fill("#editorText", "Our team handbook")
        page.keyboard.press("Enter")
        page.wait_for_selector("text=Our team handbook")
        page.reload(); page.wait_for_selector(".card")
        check("note persists after reload", "Our team handbook" in page.inner_text("main"))
        page.fill("#q", "handbook")
        check("search finds text inside notes", page.locator(".card", has_text="Team Wiki").count() == 1)
        page.fill("#q", "")

        # live update, no reload
        sw.evaluate("() => chrome.bookmarks.create({ title: 'Brand New Site', url: 'https://new.example.com/' })")
        page.wait_for_selector("text=Brand New Site", timeout=5000)
        check("new bookmark appears live", True)
        sw.evaluate("async () => { const r = await chrome.bookmarks.search({ url: 'https://new.example.com/' }); await chrome.bookmarks.remove(r[0].id); }")
        page.wait_for_selector("text=Brand New Site", state="detached", timeout=5000)
        check("removed bookmark disappears live", True)

        # settings
        page.click("#settingsBtn")
        page.fill("#setTitle", "My Start Page")
        page.fill("#setSubtitle", "Sample Team")
        page.select_option("#setTheme", "dark")
        page.eval_on_selector("#setAccent", "e => { e.value = '#0e7490'; e.dispatchEvent(new Event('change', {bubbles: true})); }")
        check("title applies", page.text_content("#title") == "My Start Page" and page.title() == "My Start Page")
        check("theme applies", page.evaluate("document.documentElement.dataset.theme") == "dark")
        check("accent applies", page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()") == "#0e7490")
        with page.expect_download() as dl:
            page.click("#exportBtn")
        data = json.loads(Path(dl.value.path()).read_text())
        check("export has notes and settings", data.get("app") == "bookmark-hub" and data["notes"].get("https://wiki.example.com/home") == "Our team handbook" and data["settings"]["title"] == "My Start Page")
        # import a hostile-ish file: bad accent, oversize note, wrong types
        bad = Path(profile) / "bad.json"
        bad.write_text(json.dumps({"app": "bookmark-hub", "settings": {"accent": "red;}</style>", "theme": "neon", "title": 5},
                                   "notes": {"https://x.example/": "y" * 5000, "https://z.example/": 7}}))
        page.set_input_files("#importFile", str(bad))
        page.wait_for_function("document.getElementById('backupMsg').textContent.includes('Imported')")
        n = page.evaluate("chrome.storage.local.get('notes').then(r => r.notes)")
        check("import sanitises values", len(n.get("https://x.example/", "")) == 300 and "https://z.example/" not in n)
        check("import rejects bad settings", page.evaluate("document.documentElement.style.getPropertyValue('--accent')") == "#4f46e5")
        page.click("#resetBtn")
        page.keyboard.press("Escape")

        # new tab override
        nt = ctx.new_page(); nt.goto("chrome://newtab"); nt.wait_for_timeout(1500)
        check("new tab shows the hub", "Bookmark Hub" in nt.title() or nt.locator("#chips").count() == 1, nt.url)
        nt.close()

        check("no console or page errors", not errors, "; ".join(errors[:3]))

        if shots:
            for theme, name in (("light", "screenshot-light.png"), ("dark", "screenshot-dark.png")):
                page.evaluate("(v) => chrome.storage.local.set({ settings: { title: 'Bookmark Hub', subtitle: 'Sample bookmarks', accent: '#4f46e5', theme: v }, notes: %s })" % json.dumps(NOTES), theme)
                page.reload(); page.wait_for_selector(".card"); page.wait_for_timeout(600)
                page.set_viewport_size({"width": 1280, "height": 860})
                page.screenshot(path=str(shots / name))
            print("screenshots written to", shots)
        ctx.close()

    print("\n%s" % ("ALL CHECKS PASSED" if not failures else "FAILED: " + ", ".join(failures)))
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
