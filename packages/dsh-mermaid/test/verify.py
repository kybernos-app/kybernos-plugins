#!/usr/bin/env python3
"""Banc d'essai dsh-mermaid.

Deux chronologies, parce que c'est leur écart qui a produit le bug du 22/09 :
le bundle est chargé en fin de <body> dans les bancs, mais le chargeur de la
GUI DSH l'évalue depuis <head>.

1. test/harness.html — DOM fidèle à CodeBlock : rendu, source préservée,
   bascule code/diagramme, fence invalide, fence d'un autre langage intacte,
   thème.
2. test/entete.html — bundle évalué dans <head> (donc `document.body` encore
   nul et aucun jeton CSS calculable) : l'entrée doit ACTIVER et rendre, au
   lieu d'échouer en laissant le plugin inerte.
"""
import json
import pathlib
import sys

from playwright.sync_api import sync_playwright

HARNESS = pathlib.Path(__file__).with_name("harness.html").resolve()
ENTETE = pathlib.Path(__file__).with_name("entete.html").resolve()
SHOT = pathlib.Path("/tmp/dsh-mermaid-harness.png")


def main() -> int:
    report: dict = {}
    errors: list[str] = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 900, "height": 1100})
        page.on(
            "console",
            lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None,
        )
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))

        page.goto(HARNESS.as_uri())
        page.wait_for_load_state("networkidle")
        page.wait_for_selector("#valid .dsh-mermaid svg", timeout=30000)

        report["plugin_id"] = page.evaluate("window.__PLUGIN__ && window.__PLUGIN__.id")
        report["exports"] = page.evaluate("Object.keys(window.__PLUGIN__.exports).sort()")

        report["valid"] = page.evaluate(
            """() => {
              const b = document.querySelector('#valid')
              const svg = b.querySelector('svg')
              const pre = b.querySelector('pre')
              return {
                ready: b.getAttribute('data-dsh-mermaid'),
                svgCount: b.querySelectorAll('.dsh-mermaid svg').length,
                svgNodes: svg ? svg.querySelectorAll('*').length : 0,
                preHidden: pre ? getComputedStyle(pre).display === 'none' : null,
                preSourceIntact: pre ? pre.textContent.includes('flowchart TD') : null,
                labelInSvg: svg ? svg.textContent.includes('Mermaid') : null,
                toggleLabel: b.querySelector('.dsh-mermaid-bar button')?.textContent,
              }
            }"""
        )

        # Bascule code <-> diagramme : la source doit rester accessible.
        page.click("#valid .dsh-mermaid-bar button")
        report["after_toggle"] = page.evaluate(
            """() => {
              const b = document.querySelector('#valid')
              const pre = b.querySelector('pre')
              return {
                preVisible: pre ? getComputedStyle(pre).display !== 'none' : null,
                toggleLabel: b.querySelector('.dsh-mermaid-bar button')?.textContent,
              }
            }"""
        )
        page.click("#valid .dsh-mermaid-bar button")

        report["invalid"] = page.evaluate(
            """() => {
              const b = document.querySelector('#invalid')
              const card = b.querySelector('.dsh-mermaid')
              const pre = b.querySelector('pre')
              return {
                state: card ? card.dataset.dshMermaidState : null,
                hasErrorText: card ? (card.querySelector('.dsh-mermaid-error')?.textContent || '').length > 10 : null,
                hasSvg: card ? card.querySelectorAll('svg').length : null,
                preVisible: pre ? getComputedStyle(pre).display !== 'none' : null,
              }
            }"""
        )

        report["untouched"] = page.evaluate(
            """() => {
              const b = document.querySelector('#not-mermaid')
              return {
                cards: b.querySelectorAll('.dsh-mermaid').length,
                ready: b.getAttribute('data-dsh-mermaid'),
                preVisible: getComputedStyle(b.querySelector('pre')).display !== 'none',
              }
            }"""
        )

        # Changement de thème : doit redessiner sans dupliquer.
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

        # ── 2. chronologie réelle de la GUI : bundle évalué dans <head> ────────
        entete = browser.new_page(viewport={"width": 900, "height": 700})
        entete.on(
            "console",
            lambda m: errors.append(f"entête console.{m.type}: {m.text}")
            if m.type == "error"
            else None,
        )
        entete.on("pageerror", lambda e: errors.append(f"entête pageerror: {e}"))
        entete.goto(ENTETE.as_uri())
        entete.wait_for_selector("#valide .dsh-mermaid svg", timeout=30000)
        report["entete"] = entete.evaluate(
            """() => {
              const b = document.querySelector('#valide')
              const svg = b.querySelector('svg')
              const pre = b.querySelector('pre')
              return {
                bodyNulAuBoot: window.__BODY_AT_BOOT__ === true,
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

    checks = {
        "plugin enregistré sous @local/dsh-mermaid": report["plugin_id"] == "@local/dsh-mermaid",
        "exports name/inject/apply": report["exports"] == ["apply", "inject", "name"],
        "diagramme rendu (SVG non vide)": (report["valid"] or {}).get("svgNodes", 0) > 20,
        "bloc marqué ready": (report["valid"] or {}).get("ready") == "ready",
        "source masquée mais intacte": bool((report["valid"] or {}).get("preHidden"))
        and bool((report["valid"] or {}).get("preSourceIntact")),
        "label du diagramme rendu": bool((report["valid"] or {}).get("labelInSvg")),
        "bascule vers le code visible": bool((report["after_toggle"] or {}).get("preVisible")),
        "fence invalide → carte d'erreur": (report["invalid"] or {}).get("state") == "error"
        and bool((report["invalid"] or {}).get("hasErrorText")),
        "fence invalide → source laissée visible": bool((report["invalid"] or {}).get("preVisible")),
        "fence python non touchée": (report["untouched"] or {}).get("cards") == 0
        and (report["untouched"] or {}).get("ready") is None,
        "re-rendu au changement de thème sans doublon": (report["after_theme_change"] or {}).get("svgCount") == 1
        and (report["after_theme_change"] or {}).get("canvases") == 1,
        "<head> : body nul à l'évaluation du bundle": bool((report["entete"] or {}).get("bodyNulAuBoot")),
        "<head> : l'entrée active (pas de « did not activate »)": bool((report["entete"] or {}).get("applyOk"))
        and (report["entete"] or {}).get("applyErr") is None,
        "<head> : diagramme rendu malgré les jetons absents": (report["entete"] or {}).get("ready") == "ready"
        and (report["entete"] or {}).get("svgNodes", 0) > 20
        and bool((report["entete"] or {}).get("preSourceIntact")),
        "aucune erreur console": not errors,
    }

    print(json.dumps(report, indent=2, ensure_ascii=False))
    print()
    for label, ok in checks.items():
        print(f"{'✓' if ok else ''} {label}")
    print(f"\ncapture : {SHOT}")
    return 0 if all(checks.values()) else 1


if __name__ == "__main__":
    sys.exit(main())