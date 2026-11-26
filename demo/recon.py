from playwright.sync_api import sync_playwright
import json, sys

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    ctx = b.new_context(storage_state="/Users/miled/.dsh/web-auth-state.json", viewport={"width":1600,"height":1000})
    pg = ctx.new_page()
    pg.goto("http://127.0.0.1:3080/", wait_until="networkidle")
    print("TITLE:", pg.title())
    # links and buttons in sidebar/nav
    items = pg.eval_on_selector_all("a, button", "els => els.slice(0,120).map(e => ({tag:e.tagName, text:(e.innerText||'').trim().slice(0,40), href:e.getAttribute('href')}))")
    for it in items:
        if it["text"]:
            print(json.dumps(it, ensure_ascii=False))
    pg.screenshot(path="demo/gui-recon.png")
    b.close()
