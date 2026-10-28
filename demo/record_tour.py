from playwright.sync_api import sync_playwright
from pathlib import Path

OUT = Path("demo/tour"); OUT.mkdir(exist_ok=True)
STATE = "/Users/miled/.dsh/web-auth-state.json"
BASE = "http://127.0.0.1:3080/"
VIEW = {"width": 1600, "height": 1000}

def nav(pg, label):
    pg.wait_for_timeout(2000)
    for finder in [
        lambda: pg.get_by_role("button", name=label, exact=True),
        lambda: pg.get_by_role("button", name=label),
        lambda: pg.get_by_text(label, exact=True).last,
    ]:
        try:
            finder().first.click(timeout=12000)
            break
        except Exception:
            continue
    pg.wait_for_timeout(2500)

def slow_scroll(pg, steps=8, pause=700):
    for i in range(steps):
        pg.mouse.wheel(0, 220)
        pg.wait_for_timeout(pause)

def chapter(p, name, script):
    ctx = p.chromium.launch(headless=True).new_context(
        storage_state=STATE, viewport=VIEW, record_video_dir=str(OUT),
        record_video_size=VIEW)
    pg = ctx.new_page()
    pg.goto(BASE, wait_until="domcontentloaded", timeout=60000)
    pg.wait_for_timeout(4000)
    try:
        script(pg)
    finally:
        pg.wait_for_timeout(600)
        ctx.close()  # video finalized on close
    print("done:", name)

def chat(pg):
    box = pg.locator("div[role=textbox]").first
    box.click(timeout=15000)
    pg.wait_for_timeout(600)
    text = "Étudie les outils concurrents de veille IA et livre-moi une note comparative."
    for chunk in [text[i:i+6] for i in range(0, len(text), 6)]:
        pg.keyboard.type(chunk, delay=60)
        pg.wait_for_timeout(150)

def teams(pg):
    nav(pg, "Agent Teams")
    slow_scroll(pg, steps=6)

def autos(pg):
    nav(pg, "Automations")
    slow_scroll(pg, steps=6)

def dash(pg):
    nav(pg, "Dashboards")
    slow_scroll(pg, steps=6)

with sync_playwright() as p:
    chapter(p, "chat", chat)
    chapter(p, "teams", teams)
    chapter(p, "autos", autos)
    chapter(p, "dash", dash)
print("ALL OK")
