from playwright.sync_api import sync_playwright
from pathlib import Path

OUT = Path("demo/tour2"); OUT.mkdir(exist_ok=True)
STATE = "/Users/miled/.dsh/web-auth-state.json"
BASE = "http://127.0.0.1:3080/"
VIEW = {"width": 1600, "height": 1000}
CLICK = """(lbl) => { const btn=[...document.querySelectorAll('button')]
  .find(b => b.getAttribute('aria-label')===lbl || (b.innerText||'').trim().startsWith(lbl));
  if(btn){ btn.click(); return true; } return false; }"""

def slow_scroll(pg, steps=6, pause=650):
    for _ in range(steps):
        pg.mouse.wheel(0, 250)
        pg.wait_for_timeout(pause)

def chapter(p, name, script):
    ctx = p.chromium.launch(headless=True).new_context(
        storage_state=STATE, viewport=VIEW, record_video_dir=str(OUT),
        record_video_size=VIEW)
    pg = ctx.new_page()
    pg.goto(BASE, wait_until="domcontentloaded", timeout=60000)
    pg.wait_for_timeout(5000)
    try:
        script(pg)
    finally:
        pg.wait_for_timeout(700)
        ctx.close()
    print("done:", name)

def chat(pg):
    box = pg.locator("div[role=textbox]").first
    box.click(timeout=15000)
    pg.wait_for_timeout(600)
    text = "Étudie les outils concurrents de veille IA et livre-moi une note comparative."
    for chunk in [text[i:i+6] for i in range(0, len(text), 6)]:
        pg.keyboard.type(chunk, delay=60)
        pg.wait_for_timeout(150)

def make_page(label):
    def run(pg):
        print(label, "clicked:", pg.evaluate(CLICK, label))
        pg.wait_for_timeout(3000)
        slow_scroll(pg)
    return run

with sync_playwright() as p:
    chapter(p, "chat", chat)
    chapter(p, "teams", make_page("Agent Teams"))
    chapter(p, "autos", make_page("Automations"))
    chapter(p, "dash",  make_page("Dashboards"))
print("ALL OK")
