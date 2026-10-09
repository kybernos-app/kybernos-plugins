#!/usr/bin/env python3
"""kybernos-terminal client test bench.

Loads test/harness.html (the DOM DSH 0.2.0-rc.2 renders: the label names a language only when DSH can
highlight it) with the real client bundle, and checks which fences are dressed, that the `$` prompt is
not clipped, and what the run button posts.

    python3 packages/kybernos-terminal/test/verify.py     # needs Python Playwright and its Chromium
"""
import json
import pathlib
import sys

from playwright.sync_api import sync_playwright

HARNESS = pathlib.Path(__file__).with_name("harness.html").resolve()
SHOT = pathlib.Path("/tmp/kybernos-terminal-harness.png")


def main() -> int:
    errors: list[str] = []
    report: dict = {}

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 900, "height": 1000})
        page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.goto(HARNESS.as_uri())
        page.wait_for_load_state("networkidle")
        page.wait_for_selector("#bash.kbtrm", timeout=10000)

        report["dressed"] = page.evaluate(
            """() => Object.fromEntries([...document.querySelectorAll('.md-code-block')].map(b => [b.id, {
                 dressed: b.classList.contains('kbtrm'),
                 prompt: b.classList.contains('kbtrm-prompt'),
                 transcript: b.dataset.kbTerminalTranscript === '1',
                 run: b.querySelectorAll('.kbtrm-run').length,
               }]))"""
        )

        # The `$` prompt: inline text at the start of the code, not an absolutely positioned box outside the <pre>.
        report["prompt_style"] = page.evaluate(
            """() => {
              const code = document.querySelector('#bash pre code')
              const cs = getComputedStyle(code, '::before')
              const pre = document.querySelector('#narrow pre')
              return {
                content: cs.content, position: cs.position, transform: cs.transform,
                inCopyText: pre.textContent.includes('$ '),
              }
            }"""
        )
        # Geometry: the first character of the code must sit to the right of the pre's content edge (room taken by `$ `).
        report["prompt_room"] = page.evaluate(
            """() => {
              const pre = document.querySelector('#narrow pre')
              const code = pre.querySelector('code')
              const range = document.createRange()
              range.setStart(code.firstChild, 0); range.setEnd(code.firstChild, 1)
              const firstChar = range.getBoundingClientRect().left
              const preBox = pre.getBoundingClientRect().left
              const pad = parseFloat(getComputedStyle(pre).paddingLeft)
              return { firstCharOffset: firstChar - preBox - pad }
            }"""
        )

        def click_run(block_id, answer=None):
            page.evaluate("window.__POSTS__.length = 0; window.__ANSWERS__.length = 0")
            if answer is not None:
                page.evaluate("(a) => window.__ANSWERS__.push(a)", answer)
            page.click(f"#{block_id} .kbtrm-run")
            page.wait_for_function(
                "(id) => document.querySelector('#' + id + ' .kbtrm-out') && !document.querySelector('#' + id + ' .kbtrm-out').hidden "
                "&& document.querySelector('#' + id + ' .kbtrm-out').dataset.kbTerminalState !== 'pending'",
                arg=block_id,
                timeout=5000,
            )
            return page.evaluate(
                """(id) => ({ posts: window.__POSTS__, out: document.querySelector('#' + id + ' .kbtrm-out').textContent,
                              state: document.querySelector('#' + id + ' .kbtrm-out').dataset.kbTerminalState })""",
                block_id,
            )

        report["run_bash"] = click_run("bash")
        report["run_dollar"] = click_run("bash-dollar")
        report["run_console"] = click_run("console")
        report["run_401"] = click_run("bash", {"status": 401, "json": {"ok": False, "erreur": "sign-in required"}})
        report["run_nojson"] = click_run("bash", {"status": 502, "nojson": True})

        page.screenshot(path=str(SHOT), full_page=True)
        browser.close()

    report["console_errors"] = errors
    d = report["dressed"]
    post = lambda r: (r["posts"][0]["body"] or {}).get("commande") if r["posts"] else None
    checks = {
        "a highlighted bash fence is dressed, with a run button": d["bash"]["dressed"] and d["bash"]["run"] == 1,
        "a bash fence already starting with `$ ` gets no second prompt": d["bash-dollar"]["dressed"] and not d["bash-dollar"]["prompt"],
        "a `console` transcript (label 'Code block') is dressed": d["console"]["dressed"] and d["console"]["transcript"],
        "an unknown-language fence that is not a transcript is left alone": not d["plain"]["dressed"] and d["plain"]["run"] == 0,
        "a highlighted python fence is left alone even if its text starts with `$ `": not d["python"]["dressed"],
        "the prompt is a pseudo-element in the flow (not absolute, not shifted out of the <pre>)": report["prompt_style"]["content"] == '"$ "'
        and report["prompt_style"]["position"] == "static"
        and report["prompt_style"]["transform"] == "none",
        "the prompt is not part of the copied/run text": report["prompt_style"]["inCopyText"] is False,
        "the prompt takes room: the first character is pushed right of the padding edge": report["prompt_room"]["firstCharOffset"] >= 8,
        "run posts the commands of the fence, with the page cookie": post(report["run_bash"]) == "echo one\necho two"
        and report["run_bash"]["posts"][0]["init"].get("credentials") == "same-origin"
        and report["run_bash"]["posts"][0]["url"].endswith("/kybernos-terminal/run"),
        "run strips a leading `$ ` from a bash fence": post(report["run_dollar"]) == "echo prompted",
        "a transcript runs only its `$` lines (and a continued line), never the output": post(report["run_console"]) == "ls\necho a \\\n  b\npwd",
        "the output of the host is shown": report["run_bash"]["out"].strip() == "done" and report["run_bash"]["state"] == "ok",
        "a 401 is shown as the host's reason": report["run_401"]["state"] == "err" and "sign-in required" in report["run_401"]["out"],
        "an answer that is not JSON is shown as an HTTP error, not as a crash": report["run_nojson"]["state"] == "err" and "HTTP 502" in report["run_nojson"]["out"],
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
