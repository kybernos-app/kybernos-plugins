#!/usr/bin/env python3
"""dsh-mermaid test bench.

Two timelines, because it is the gap between them that produced the 2026-09-22 bug: the bundle is
loaded at the end of <body> in the benches, but the DSH GUI loader evaluates it from <head>.

1. test/harness.html — the DOM DSH 0.2 really renders (label "Code block", source in
   [data-code-block-content]): rendering, source kept, code/diagram toggle, invalid fence, a
   highlighted fence and a non-diagram fence left alone, the older flat DOM, theme change.
   (The bench used to copy a DOM whose label said "mermaid": it passed while the real GUI drew
   nothing. Keep the DOM faithful to the engine, see the comment at the top of src/plugin.js.)
2. test/entete.html — bundle evaluated in <head> (so `document.body` is still null and no CSS
   token is computable): the entry must ACTIVATE and render, instead of failing and leaving the
   plugin inert.
"""
import json
import pathlib
import sys

from playwright.sync_api import sync_playwright

HARNESS = pathlib.Path(__file__).with_name("harness.html").resolve()
ENTETE = pathlib.Path(__file__).with_name("entete.html").resolve()
SHOT = pathlib.Path("/tmp/dsh-mermaid-harness.png")

# What a block looks like to the plugin. "hidden" means it takes no space: its container may be the
# element that is display:none, so the <pre>'s own computed display is not enough.
STATE_JS = """(id) => {
  const b = document.getElementById(id)
  const pre = b.querySelector('pre')
  const svg = b.querySelector('svg')
  const card = b.querySelector('.dsh-mermaid')
  return {
    ready: b.getAttribute('data-dsh-mermaid'),
    cards: b.querySelectorAll('.dsh-mermaid').length,
    svgCount: b.querySelectorAll('.dsh-mermaid svg').length,
    svgNodes: svg ? svg.querySelectorAll('*').length : 0,
    labelInSvg: svg ? svg.textContent.includes('Mermaid') : null,
    cardState: card ? card.dataset.dshMermaidState : null,
    errorText: card ? (card.querySelector('.dsh-mermaid-error')?.textContent || '') : '',
    preHidden: pre ? pre.getClientRects().length === 0 : null,
    preText: pre ? pre.textContent : null,
    toggleLabel: b.querySelector('.dsh-mermaid-bar button')?.textContent,
    bannerLabel: b.querySelector('[data-code-block-banner]')?.firstElementChild?.textContent.trim(),
  }
}"""


def main() -> int:
    report: dict = {}
    errors: list[str] = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 900, "height": 1500})
        page.on(
            "console",
            lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None,
        )
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))

        page.goto(HARNESS.as_uri())
        page.wait_for_load_state("networkidle")
        page.wait_for_selector("#valid .dsh-mermaid svg", timeout=30000)
        page.wait_for_selector("#legacy .dsh-mermaid svg", timeout=30000)
        page.wait_for_selector("#invalid .dsh-mermaid-error", timeout=30000)

        report["plugin_id"] = page.evaluate("window.__PLUGIN__ && window.__PLUGIN__.id")
        report["exports"] = page.evaluate("Object.keys(window.__PLUGIN__.exports).sort()")

        report["valid"] = page.evaluate(STATE_JS, "valid")
        report["legacy"] = page.evaluate(STATE_JS, "legacy")
        report["invalid"] = page.evaluate(STATE_JS, "invalid")
        report["python"] = page.evaluate(STATE_JS, "not-mermaid")
        report["prose"] = page.evaluate(STATE_JS, "plain-text")

        # Code <-> diagram toggle: the source must stay reachable.
        page.click("#valid .dsh-mermaid-bar button")
        report["after_toggle"] = page.evaluate(STATE_JS, "valid")
        page.click("#valid .dsh-mermaid-bar button")
        report["after_toggle_back"] = page.evaluate(STATE_JS, "valid")

        # Theme change: must redraw without duplicating.
        page.evaluate(
            "document.documentElement.style.setProperty('--dsw-alias-bg-base', '#ffffff')"
        )
        page.wait_for_timeout(1500)
        report["after_theme_change"] = page.evaluate(
            """() => ({
              svgCount: document.querySelectorAll('#valid .dsh-mermaid svg').length,
              canvases: document.querySelectorAll('#valid .dsh-mermaid-canvas').length,
            })"""
        )

        page.screenshot(path=str(SHOT), full_page=True)

        # ── 2. the GUI's real timeline: bundle evaluated from <head> ───────────
        entete = browser.new_page(viewport={"width": 900, "height": 700})
        entete.on(
            "console",
            lambda m: errors.append(f"head console.{m.type}: {m.text}")
            if m.type == "error"
            else None,
        )
        entete.on("pageerror", lambda e: errors.append(f"head pageerror: {e}"))
        entete.goto(ENTETE.as_uri())
        entete.wait_for_selector("#valide .dsh-mermaid svg", timeout=30000)
        report["entete"] = entete.evaluate(
            """() => {
              const b = document.querySelector('#valide')
              const svg = b.querySelector('svg')
              const pre = b.querySelector('pre')
              return {
                bodyNullAtBoot: window.__BODY_AT_BOOT__ === true,
                applyOk: window.__APPLY_OK__ === true,
                applyErr: window.__APPLY_ERR__ ?? null,
                ready: b.getAttribute('data-dsh-mermaid'),
                svgNodes: svg ? svg.querySelectorAll('*').length : 0,
                preSourceIntact: pre ? pre.textContent.includes('graph LR') : null,
              }
            }"""
        )

        browser.close()

    report["console_errors"] = errors

    v, lg, inv = report["valid"], report["legacy"], report["invalid"]
    py, pr = report["python"], report["prose"]
    checks = {
        "plugin registered as @local/dsh-mermaid": report["plugin_id"] == "@local/dsh-mermaid",
        "exports name/inject/apply": report["exports"] == ["apply", "inject", "name"],
        "the banner of the real DOM does NOT say mermaid (the bench is faithful)": v["bannerLabel"] == "Code block",
        "real DOM: diagram drawn (non-empty SVG) although the label is generic": v["svgNodes"] > 20,
        "real DOM: block marked ready": v["ready"] == "ready",
        "real DOM: source hidden but intact": bool(v["preHidden"]) and "flowchart TD" in (v["preText"] or ""),
        "real DOM: diagram label rendered": bool(v["labelInSvg"]),
        "real DOM: toggle shows the code": report["after_toggle"]["preHidden"] is False
        and report["after_toggle"]["toggleLabel"] == "Diagramme",
        "real DOM: toggle back hides it again": bool(report["after_toggle_back"]["preHidden"]),
        "real DOM: invalid fence → error card": inv["cardState"] == "error" and len(inv["errorText"]) > 10,
        "real DOM: invalid fence → source left visible": inv["preHidden"] is False,
        "highlighted fence (pre.shiki) left alone, even if its text opens like a diagram": py["cards"] == 0
        and py["ready"] is None
        and py["preHidden"] is False,
        "unknown-language fence that is not a diagram left alone": pr["cards"] == 0
        and pr["ready"] is None
        and pr["preHidden"] is False,
        "older flat DOM (label mermaid, direct <pre>) still drawn": lg["svgNodes"] > 20
        and lg["ready"] == "ready"
        and bool(lg["preHidden"]),
        "redraw on theme change without duplicate": report["after_theme_change"]["svgCount"] == 1
        and report["after_theme_change"]["canvases"] == 1,
        "<head>: body null when the bundle is evaluated": bool(report["entete"]["bodyNullAtBoot"]),
        "<head>: the entry activates (no 'did not activate')": bool(report["entete"]["applyOk"])
        and report["entete"]["applyErr"] is None,
        "<head>: diagram drawn although tokens are absent": report["entete"]["ready"] == "ready"
        and report["entete"]["svgNodes"] > 20
        and bool(report["entete"]["preSourceIntact"]),
        "no console error": not errors,
    }

    print(json.dumps(report, indent=2, ensure_ascii=False))
    print()
    for label, ok in checks.items():
        print(f"{'✓' if ok else '✗'} {label}")
    print(f"\nscreenshot: {SHOT}")
    return 0 if all(checks.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
