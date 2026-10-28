from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent
CAPTURES = ROOT.parent.parent / ".playwright-mcp"
URL = (ROOT / "index.html").as_uri() + "?motion=off"
results = []
failures = []


def check(name, condition, detail=""):
    ok = bool(condition)
    results.append((name, ok))
    print(f"{'PASS' if ok else 'FAIL'} | {name}" + (f" | {detail}" if detail != "" else ""))
    if not ok:
        failures.append((name, detail))


def shot(page, name, full=False):
    page.evaluate("window.scrollTo(0, 0)")
    page.wait_for_timeout(60)
    path = CAPTURES / name
    page.screenshot(path=str(path), full_page=full)
    print("CAPTURE | " + str(path))


def element_shot(page, selector, name):
    path = CAPTURES / name
    page.locator(selector).screenshot(path=str(path))
    print("CAPTURE | " + str(path))


def wait_text(page, selector, text):
    page.wait_for_function(
        "([selector, text]) => document.querySelector(selector)?.textContent.includes(text)",
        arg=[selector, text],
    )


def normalized(value):
    return " ".join(value.split())


def rgb(value):
    value = value.lstrip("#")
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))


def mix(fg, bg, alpha):
    return tuple(round(alpha * a + (1 - alpha) * b) for a, b in zip(rgb(fg), rgb(bg)))


def luminance(color):
    values = []
    for channel in color:
        c = channel / 255
        values.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2]


def contrast(a, b):
    la, lb = luminance(a), luminance(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


def contrast_check(name, fg, bg):
    ratio = contrast(rgb(fg), rgb(bg))
    check(name, ratio >= 4.5, f"{ratio:.2f}:1")


def contrast_mix_check(name, text, tint, bg, alpha=0.14):
    effective = mix(tint, bg, alpha)
    ratio = contrast(rgb(text), effective)
    check(name, ratio >= 4.5, f"{ratio:.2f}:1 on {effective}")


with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome", headless=True)
    context = browser.new_context(viewport={"width": 1440, "height": 1000}, device_scale_factor=1)
    page = context.new_page()
    errors = []
    external_requests = []
    page.on("pageerror", lambda exc: errors.append(str(exc)))
    page.on("request", lambda request: external_requests.append(request.url) if request.url.startswith(("http://", "https://")) else None)
    page.goto(URL)
    page.wait_for_timeout(150)

    metrics = page.evaluate("""() => {
      const ids = [...document.querySelectorAll('[id]')].map(el => el.id);
      const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
      const missing = [...document.querySelectorAll('a[href^="#"]')]
        .map(a => a.getAttribute('href')).filter(h => h.length > 1 && !document.getElementById(h.slice(1)));
      const h1 = document.querySelector('h1');
      const h1Style = getComputedStyle(h1);
      const app = document.querySelector('#product').getBoundingClientRect();
      const cta = document.querySelector('.hero-cta').getBoundingClientRect();
      return {
        title: document.title,
        lang: document.documentElement.lang,
        h1: h1.innerText.replace(/\s+/g, ' ').trim(),
        h1Lines: Math.round(h1.getBoundingClientRect().height / parseFloat(h1Style.lineHeight)),
        pageHeight: document.body.scrollHeight,
        bodyTextLength: document.body.innerText.length,
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        headerHeight: document.querySelector('#siteHeader').getBoundingClientRect().height,
        appTop: app.top,
        appVisible: Math.min(app.bottom, window.innerHeight) - app.top,
        ctaBottom: cta.bottom,
        duplicates,
        missing,
        emDash: document.body.innerText.includes('—'),
        installCount: [...document.querySelectorAll('a')].filter(a => a.textContent.trim() === 'Install free').length,
        buttonCount: document.querySelectorAll('button').length,
        sectionCount: document.querySelectorAll('main > section').length,
        appColumns: getComputedStyle(document.querySelector('#product')).gridTemplateColumns.split(' ').length,
        accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
        accentText: getComputedStyle(document.documentElement).getPropertyValue('--accent-text').trim()
      };
    }""")
    check("Document language and metadata", metrics["lang"] == "en" and metrics["title"] == "Kybernos: the open-source AI workspace")
    check("Exact two-part hero", metrics["h1"] == "From brief to reviewed work. You stay in control.", metrics["h1"])
    check("Desktop H1 uses two lines", metrics["h1Lines"] == 2, metrics["h1Lines"])
    check("Desktop CTA is above the fold", metrics["ctaBottom"] < 1000, metrics["ctaBottom"])
    check("App preview starts in the first viewport", metrics["appTop"] < 500, metrics["appTop"])
    check("At least 500px of the app is visible initially", metrics["appVisible"] >= 500, metrics["appVisible"])
    check("Desktop app uses three realistic panes", metrics["appColumns"] == 3, metrics["appColumns"])
    check("Home has six conversion-focused sections", metrics["sectionCount"] == 6, metrics["sectionCount"])
    check("Home is substantially shorter than V2", metrics["pageHeight"] < 5000, metrics["pageHeight"])
    check("Visible copy remains concise", metrics["bodyTextLength"] < 4500, metrics["bodyTextLength"])
    check("Desktop header is compact", metrics["headerHeight"] <= 68, metrics["headerHeight"])
    check("Desktop has no horizontal overflow", metrics["scrollWidth"] == metrics["innerWidth"], metrics)
    check("No duplicate ids", not metrics["duplicates"], metrics["duplicates"])
    check("Every internal anchor resolves", not metrics["missing"], metrics["missing"])
    check("No visible em dash", not metrics["emDash"])
    check("Install CTA label is consistent", metrics["installCount"] == 4, metrics["installCount"])
    check("Every one of the 27 buttons is accounted for", metrics["buttonCount"] == 27, metrics["buttonCount"])
    check("Production Cockpit light accent", metrics["accent"].lower() == "#2662c4", metrics["accent"])
    check("Accessible light small-text accent", metrics["accentText"].lower() == "#1e4f9f", metrics["accentText"])
    check("No external runtime requests", not external_requests, external_requests)
    check("No initial runtime errors", not errors, errors)
    check("V2 documentation sections are gone", page.locator("#faq, #compare, #ecosystem, #quality, #how-it-works").count() == 0)
    check("Use cases link is preserved", page.locator('a[href="https://kybernos.app/use-cases"]').inner_text() == "Explore all 9 fields")
    check("Real beta quote is preserved", "Monday morning used to be four hours of catching up. Now it's one summary and two decisions." in page.locator("#beta").inner_text())
    shot(page, "kybernos-home-v3-desktop-hero.png")
    shot(page, "kybernos-home-v3-desktop-full.png", full=True)
    element_shot(page, "#product", "kybernos-home-v3-app.png")

    page.keyboard.press("Tab")
    skip = page.evaluate("""() => {
      const el = document.activeElement, s = getComputedStyle(el);
      return {cls: el.className, outline: s.outlineStyle, width: s.outlineWidth};
    }""")
    check("First Tab reaches skip link with a visible ring", skip["cls"] == "skip" and skip["outline"] == "solid" and skip["width"] == "2px", skip)

    # Static and reduced-motion states already tell the complete story.
    check("Static app starts with completed agents", page.locator('#agentRows .tr[data-state="done"]').count() == 3)
    check("Static app starts at the human approval gate", page.locator('#agentRows .tr[data-state="waiting"]').count() == 1)
    check("Static deliverable is readable", page.locator("#paper").get_attribute("data-ready") == "1")
    check("Static review shows four criteria", page.locator("#critCount").inner_text() == "4 of 4 criteria")

    # Hero demo, revision, approval and replay.
    page.locator("#runDemo").click()
    check("Run the demo starts the simulated team", page.locator("#appBadge").inner_text() in ("Running", "Needs your approval"))
    wait_text(page, "#appNote", "Review ready")
    check("Demo returns to approval", page.locator("#appBadge").inner_text() == "Needs your approval")
    check("Demo cost adds up to €0.31", page.locator("#costVal").inner_text() == "€0.31")
    check("Demo restores the four criteria", page.locator("#critCount").inner_text() == "4 of 4 criteria")
    page.locator("#changesBtn").click()
    wait_text(page, "#appNote", "Draft 2 is ready")
    check("Ask for changes produces Draft 2", page.locator("#draftTag").inner_text() == "Draft 2")
    check("Revision updates the cost to €0.37", page.locator("#costVal").inner_text() == "€0.37")
    check("Revision adds the trend to the recap", page.locator("#paperTrend").is_visible())
    check("Only one revision is offered", page.locator("#changesBtn").is_hidden())
    page.locator("#approveBtn").click()
    check("Approval is explicitly simulated", page.locator("#appBadge").inner_text() == "Approved (simulated)")
    check("Approval says nothing was sent", "Nothing was sent" in page.locator("#gateDone").inner_text())
    check("Approval swaps the available actions", page.locator("#gateActs").is_hidden() and page.locator("#gateDone").is_visible())
    element_shot(page, "#product", "kybernos-home-v3-app-approved.png")
    page.locator("#replayBtn").click()
    wait_text(page, "#appNote", "Review ready")
    check("Replay restores Draft 1", page.locator("#draftTag").inner_text() == "Draft 1")
    check("Replay restores cost and revision action", page.locator("#costVal").inner_text() == "€0.31" and page.locator("#changesBtn").is_visible())

    # Kaby: every suggestion, Add, Not now and Undo.
    check("Kaby has four learning suggestions", page.locator("#kaby .sg").count() == 4)
    types = [normalized(page.locator(f"#sgb{i} .ty").inner_text()) for i in range(1, 5)]
    check("All requested learning types are present", types == ["Create automation", "New skill", "Fetch skill", "Enhance UI"], types)
    for i in range(1, 5):
        page.locator(f"#sgb{i}").click()
        check(f"Suggestion {i} opens its detail", page.locator(f"#sgb{i}").get_attribute("aria-pressed") == "true" and page.locator(f"#sgp{i}").is_visible())
        panel = page.locator(f"#sgp{i}")
        panel.locator("[data-add]").click()
        check(f"Suggestion {i} Add is simulated and undoable", panel.locator("[data-state]").is_visible() and "simulated" in panel.locator("[data-statetxt]").inner_text() and "Added" in page.locator(f"#sgb{i} [data-tag]").inner_text())
        panel.locator("[data-undo]").click()
        check(f"Suggestion {i} Undo restores Suggested", page.locator(f"#sgb{i} [data-tag]").inner_text() == "Suggested" and panel.locator("[data-acts]").is_visible())
        panel.locator("[data-later]").click()
        check(f"Suggestion {i} Not now works", panel.locator("[data-statetxt]").inner_text() == "Not now (simulated)" and page.locator(f"#sgb{i} [data-tag]").inner_text() == "Not now")
        panel.locator("[data-undo]").click()
        check(f"Suggestion {i} can be restored after Not now", page.locator(f"#sgb{i} [data-tag]").inner_text() == "Suggested")
    page.locator("#sgb1").click()
    element_shot(page, "#kaby", "kybernos-home-v3-kaby.png")

    # Team: keyboard tabs, both install types and reset.
    check("Team starts on Skills", page.locator("#tt1").get_attribute("aria-selected") == "true" and page.locator("#tp1").is_visible())
    page.locator("#tp1 .inst").click()
    check("Team skill installs for the member", page.locator("#tp1 .inst-done").inner_text() == "Installed" and "Personal skills stay private" in page.locator("#teamNote").inner_text())
    page.locator("#teamReset").click()
    check("Team reset restores the skill Install action", page.locator("#tp1 .inst").is_visible() and page.locator("#tp1 .inst-done").count() == 0)
    page.locator("#tt1").focus()
    page.keyboard.press("ArrowRight")
    check("Arrow key opens Automations", page.locator("#tt2").get_attribute("aria-selected") == "true" and page.locator("#tp2").is_visible())
    page.keyboard.press("Home")
    check("Home key returns to Skills", page.locator("#tt1").get_attribute("aria-selected") == "true")
    page.keyboard.press("End")
    check("End key reaches Automations", page.locator("#tt2").get_attribute("aria-selected") == "true")
    page.locator("#tp2 .inst").click()
    check("Team automation installs as a paused copy", page.locator("#tp2 .inst-done").inner_text() == "Installed · Paused copy" and "paused copy that belongs to you" in page.locator("#teamNote").inner_text())
    element_shot(page, "#teamWin", "kybernos-home-v3-team-installed.png")
    page.locator("#teamReset").click()
    check("Team reset restores the automation Install action", page.locator("#tp2 .inst").is_visible() and page.locator("#tp2 .inst-done").count() == 0)

    # Theme persistence and dark surface captures.
    before = page.locator("html").get_attribute("data-theme")
    page.locator("#themeBtn").click()
    after = page.locator("html").get_attribute("data-theme")
    check("Theme toggle changes the active theme", before != after, f"{before} -> {after}")
    check("Theme choice is persisted", page.evaluate("localStorage.getItem('kb-theme')") == after)
    page.reload()
    check("Theme survives reload", page.locator("html").get_attribute("data-theme") == after)
    dark_accent = page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()")
    check("Production Cockpit dark accent", dark_accent.lower() == "#7aaaff", dark_accent)
    shot(page, "kybernos-home-v3-dark-hero.png")
    shot(page, "kybernos-home-v3-dark-full.png", full=True)
    element_shot(page, "#kaby", "kybernos-home-v3-dark-kaby.png")
    element_shot(page, "#teamWin", "kybernos-home-v3-dark-team.png")
    page.locator("#themeBtn").click()
    check("Theme can return to light", page.locator("html").get_attribute("data-theme") == "light")

    # Contrast for small accent labels, including their tinted backgrounds.
    contrast_check("White on light primary button", "#ffffff", "#2662c4")
    contrast_check("Light accent on warm background", "#2662c4", "#f6f4ee")
    contrast_check("Light small text on warm background", "#1e4f9f", "#f6f4ee")
    contrast_check("Light small text on selected suggestion", "#1e4f9f", "#f0e7da")
    contrast_check("Dark ink on dark primary button", "#0a0b0d", "#7aaaff")
    contrast_check("Dark accent on dark background", "#7aaaff", "#17181a")
    contrast_check("Dark accent on selected suggestion", "#7aaaff", "#24211d")
    contrast_mix_check("Light tag text on app tint", "#1e4f9f", "#2662c4", "#f6f4ee")
    contrast_mix_check("Light tag text on white tint", "#1e4f9f", "#2662c4", "#ffffff")
    contrast_mix_check("Light tag text on selected suggestion tint", "#1e4f9f", "#2662c4", "#f0e7da")
    contrast_mix_check("Light before/after text on app tint", "#1e4f9f", "#2662c4", "#f6f4ee", 0.18)
    contrast_mix_check("Light before/after text on white tint", "#1e4f9f", "#2662c4", "#ffffff", 0.18)
    contrast_mix_check("Dark tag text on app tint", "#7aaaff", "#7aaaff", "#17181a")
    contrast_mix_check("Dark tag text on panel tint", "#7aaaff", "#7aaaff", "#1f2124")
    contrast_mix_check("Dark before/after text on app tint", "#7aaaff", "#7aaaff", "#17181a", 0.18)
    contrast_mix_check("Dark before/after text on panel tint", "#7aaaff", "#7aaaff", "#1f2124", 0.18)
    contrast_check("Light muted text on background", "#68655c", "#f6f4ee")
    contrast_check("Dark muted text on background", "#928f87", "#17181a")

    # Tablet.
    tablet = browser.new_context(viewport={"width": 1024, "height": 768}, device_scale_factor=1)
    tp = tablet.new_page()
    tp.goto(URL)
    tm = tp.evaluate("""() => {
      const h = document.querySelector('h1'), s = getComputedStyle(h);
      return {
        width: document.documentElement.scrollWidth,
        inner: innerWidth,
        header: document.querySelector('#siteHeader').getBoundingClientRect().height,
        lines: Math.round(h.getBoundingClientRect().height / parseFloat(s.lineHeight)),
        cta: document.querySelector('.hero-cta').getBoundingClientRect().bottom,
        appColumns: getComputedStyle(document.querySelector('#product')).gridTemplateColumns.split(' ').length
      };
    }""")
    check("1024px has no horizontal overflow", tm["width"] == tm["inner"], tm)
    check("1024px header remains compact", tm["header"] <= 68, tm["header"])
    check("1024px H1 uses two lines", tm["lines"] == 2, tm["lines"])
    check("1024px CTA remains above the fold", tm["cta"] < 768, tm["cta"])
    check("1024px retains the three-pane app", tm["appColumns"] == 3, tm["appColumns"])
    shot(tp, "kybernos-home-v3-tablet-hero.png")
    tablet.close()

    # Mobile layout and menu.
    mobile = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=1, is_mobile=True)
    mp = mobile.new_page()
    mobile_errors = []
    mp.on("pageerror", lambda exc: mobile_errors.append(str(exc)))
    mp.goto(URL)
    mm = mp.evaluate("""() => ({
      width: document.documentElement.scrollWidth,
      inner: innerWidth,
      menu: document.querySelector('#menuBtn').getAttribute('aria-expanded'),
      columns: getComputedStyle(document.querySelector('#product')).gridTemplateColumns.split(' ').length,
      mainBottom: document.querySelector('#product .main').getBoundingClientRect().bottom,
      inspectorTop: document.querySelector('#product .insp').getBoundingClientRect().top,
      cta: document.querySelector('.hero-cta').getBoundingClientRect().bottom
    })""")
    check("Mobile has no horizontal page overflow", mm["width"] == mm["inner"], mm)
    check("Mobile menu starts closed", mm["menu"] == "false")
    check("Mobile app becomes one readable column", mm["columns"] == 1 and mm["inspectorTop"] >= mm["mainBottom"] - 1, mm)
    check("Mobile CTA remains above the fold", mm["cta"] < 844, mm["cta"])
    shot(mp, "kybernos-home-v3-mobile-hero.png")
    mp.locator("#menuBtn").click()
    check("Mobile menu opens", mp.locator("#menuBtn").get_attribute("aria-expanded") == "true" and mp.locator("#mnav").is_visible())
    check("Open mobile menu does not overflow", mp.evaluate("document.documentElement.scrollWidth") == 390)
    shot(mp, "kybernos-home-v3-mobile-menu.png")
    mp.keyboard.press("Escape")
    check("Escape closes the menu and restores focus", mp.locator("#menuBtn").get_attribute("aria-expanded") == "false" and mp.evaluate("document.activeElement.id") == "menuBtn")
    mp.locator("#menuBtn").click()
    mp.locator('#mnav a[href="#learns"]').click()
    check("Mobile navigation closes after selection", mp.locator("#menuBtn").get_attribute("aria-expanded") == "false")
    shot(mp, "kybernos-home-v3-mobile-full.png", full=True)
    element_shot(mp, "#product", "kybernos-home-v3-mobile-app.png")
    check("Mobile has no runtime errors", not mobile_errors, mobile_errors)
    mobile.close()

    # Native reduced-motion path, without the explicit static query.
    reduced = browser.new_context(viewport={"width": 1440, "height": 1000}, reduced_motion="reduce")
    rp = reduced.new_page()
    rp.goto((ROOT / "index.html").as_uri())
    check("Reduced motion reveals the complete app", rp.locator("#critCount").inner_text() == "4 of 4 criteria" and rp.locator('#agentRows .tr[data-state="done"]').count() == 3)
    check("Reduced motion disables CSS animation", rp.evaluate("getComputedStyle(document.querySelector('#appBadge')).animationName") == "none")
    rp.locator("#runDemo").click()
    wait_text(rp, "#appNote", "Review ready")
    check("Reduced-motion demo completes without delay", rp.locator("#costVal").inner_text() == "€0.31")
    reduced.close()

    # Content remains visible without JavaScript.
    nojs = browser.new_context(viewport={"width": 1440, "height": 1000}, java_script_enabled=False)
    np = nojs.new_page()
    np.goto((ROOT / "index.html").as_uri())
    check("No-JS hero and app remain visible", np.locator("h1").is_visible() and np.locator("#product").is_visible())
    check("No-JS first learning detail remains visible", np.locator("#sgp1").is_visible())
    nojs.close()

    check("No runtime errors after the full desktop journey", not errors, errors)
    browser.close()

print(f"SUMMARY | {{'total': {len(results)}, 'failed': {len(failures)}, 'captures': '{CAPTURES}'}}")
if failures:
    raise SystemExit(1)
