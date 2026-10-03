#!/usr/bin/env python3
"""Banc d'essai dsh-media-player.

Charge test/harness.html dans Chromium avec le vrai client/client.js sous un
faux chargeur de modules DSH, monte le renderer avec React dans un DOM réel et
vérifie le contrat + le rendu :

  · objet plugin (id, inject, name) et enregistrement du registre d'aperçus ;
  · métadonnées : extensions, binaires, loading bytes-complete ;
  · corps enregistré sous la bonne clé de slot, même id ;
  · helpers purs : type MIME, décodage d'adresse, taille ;
  · audio WAV réellement décodé (Blob URL + durée) ;
  · vidéo aux octets illisibles → message d'échec, jamais un écran vide ;
  · contenu non binaire → message « non lisible ».

Usage : node scripts/build-harness.mjs && python3 test/verify.py
"""
import json
import pathlib
import sys

from playwright.sync_api import sync_playwright

HARNESS = pathlib.Path(__file__).with_name("harness.html").resolve()
SHOT = pathlib.Path("/tmp/dsh-media-player-harness.png")

KEY_EXTENSIONS = ["mp3", "wav", "m4a", "ogg", "flac", "mp4", "webm", "mov", "mkv"]


def main() -> int:
    errors: list[str] = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 460, "height": 900})
        page.on(
            "console",
            lambda m: errors.append(f"console.{m.type}: {m.text}")
            if m.type == "error"
            else None,
        )
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))

        page.goto(HARNESS.as_uri())
        page.wait_for_function("() => window.__RESULT__ !== undefined", timeout=30000)
        report = page.evaluate("() => window.__RESULT__")
        page.wait_for_timeout(300)
        page.screenshot(path=str(SHOT), full_page=True)
        browser.close()

    if "fatal" in report:
        print(json.dumps(report, indent=2, ensure_ascii=False))
        print("\n✗ le driver a échoué")
        return 1

    declared = report.get("declared") or {}
    slot = report.get("slot") or {}
    audio = report.get("audio") or {}
    video = report.get("video") or {}
    helpers = report.get("helpers") or {}
    text_case = report.get("textContent") or {}

    checks = {
        "plugin enregistré sous @local/dsh-media-player": report.get("plugin_id")
        == "@local/dsh-media-player",
        "exports name/inject/apply": all(
            key in report.get("exports", []) for key in ("name", "inject", "apply")
        ),
        "inject = slots + locale": report.get("inject") == ["slots", "locale"],
        "métadonnées : id, bytes-complete, priorité extension": declared.get("id")
        == "@local/dsh-media-player/media"
        and declared.get("loading") == "bytes-complete"
        and declared.get("priority") == "extension"
        and declared.get("wrap") is False,
        "formats déclarés (audio + vidéo)": all(
            ext in (declared.get("extensions") or []) for ext in KEY_EXTENSIONS
        ),
        "binaires = extensions (pas d'option texte brut)": declared.get(
            "binaryExtensions"
        )
        == declared.get("extensions"),
        "corps enregistré sous la clé du même id": slot.get("name")
        == "sidebar.right.tab.document"
        and slot.get("key") == declared.get("id"),
        "libellés en + zh": report.get("locale_languages") == ["en", "zh"],
        "helper MIME : mp3/wav/mp4/webm": helpers.get("mp3")
        == {"kind": "audio", "mime": "audio/mpeg"}
        and helpers.get("upper") == {"kind": "video", "mime": "video/mp4"}
        and helpers.get("webm") == {"kind": "video", "mime": "video/webm"},
        "helper MIME : extension inconnue → rien": helpers.get("text") is None,
        "helper adresse : chemin décodé": helpers.get("decoded")
        == "un dossier/mon fichier.mp3",
        "helper taille lisible": helpers.get("bytes") == "10 KB",
        "audio : <audio controls> sur Blob URL": audio.get("tag") == "audio"
        and audio.get("controls") is True
        and audio.get("blob") is True,
        "audio : WAV réellement décodé (durée > 0,3 s)": isinstance(
            audio.get("duration"), (int, float)
        )
        and audio["duration"] > 0.3,
        "audio : en-tête + téléchargement du même nom": audio.get("hasHead") is True
        and audio.get("download") == "bonjour.wav",
        "audio : contrôles natifs au thème sombre": audio.get("colorScheme")
        == "dark",
        "vidéo : <video controls> sur Blob URL": video.get("tag") == "video"
        and video.get("controls") is True
        and video.get("blob") is True,
        "vidéo illisible : message d'échec affiché": video.get("failureText")
        == "failed",
        "contenu non binaire : message « non lisible »": text_case.get("text")
        == "unsupported",
        "aucune erreur console": not errors,
    }

    print(json.dumps(report, indent=2, ensure_ascii=False))
    print()
    for label, ok in checks.items():
        print(f"{'✓' if ok else '✗'} {label}")
    print(f"\ncapture : {SHOT}")
    return 0 if all(checks.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
