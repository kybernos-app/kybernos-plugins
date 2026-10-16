# @local/dsh-media-player — a universal media player in the DSH preview

When you click an `.mp3` (or a video) in the **Files** right sidebar of the DSH
GUI, the preview area used to show:

> Preview is not available for this file type yet.

This plugin replaces that message with a **real player**: the native `<audio>` /
`<video>` element with its controls, the file name, its size and an
"Open separately" link to open it in an external application.

## Recognised formats

| Type  | Extensions                                                                      |
| ----- | ------------------------------------------------------------------------------- |
| Audio | `mp3` `wav` `m4a` `aac` `ogg` `oga` `opus` `flac` `aif` `aiff` `weba` `wma`       |
| Video | `mp4` `m4v` `webm` `ogv` `mov` `mkv` `avi` `wmv` `3gp` `mpeg` `mpg` `mts` `ts`    |

The plugin declares itself with the `extension` priority (the strip of external
extensions), which makes it win over the `UNVIEWABLE_BINARY_EXTENSIONS` list of the
official document-preview plugin, without patching it.

## How it works

Two public extension points of
`@deepseek-ai/dsh-client-ui-sidebar-documentpreview`:

1. `ctx.documentPreviews.register({ id, extensions, binaryExtensions, priority,
   title, loading: 'bytes-complete', wrap: false })` — the bytes of the file
   (`{ kind: 'bytes', data: Uint8Array }`) are received once the document is complete;
2. `ctx.slots.register({ name: 'sidebar.right.tab.document', key: <id> }, Body)`
   — the React body, which builds a **Blob URL** from the bytes and mounts
   `<audio>` or `<video controls preload="metadata" playsInline>`.

Useful implementation details:

- the registration is done in a `ctx.inject(['documentPreviews'], …)` backed by a
  bounded wait (250 ms × 40): the service can be provided by
  `ctx.reflect.provide` and is not always available on the first tick;
- `binaryExtensions` = the same extensions as `extensions`: an mp3 is
  never offered as "plain text";
- a CSS rule `html[data-ds-theme-source='dark'] .dsh-media-el
  { color-scheme: dark }` makes the native controls follow the theme, otherwise they
  stay white in the middle of the dark interface;
- if decoding fails, the body shows `<p data-state="failed">` instead of a
  silent player; if the content is not binary, it shows an
  "unreadable" message.

## Files

| Path                        | Role                                                      |
| --------------------------- | --------------------------------------------------------- |
| `src/plugin.js`             | readable source (React + the plugin declaration)          |
| `client/client.js`          | generated browser bundle (`__ModuleLoader__.load`)        |
| `index.js`                  | host half: no-op (`apply`)                                |
| `cordis.patch.yml`          | insertion into the profile's cordis tree                  |
| `scripts/build.mjs`         | `src/plugin.js` → `client/client.js`                      |
| `scripts/build-harness.mjs` | `test/driver.js` → `test/harness.bundle.js` (esbuild)     |
| `test/harness.html`         | page outside the application (simulated `--dsw-*` tokens) |
| `test/verify.py`            | 20 Playwright checks + a capture                          |

## Install

```bash
dsh plugin --profile web add link:<your checkout>/packages/dsh-media-player
```

The profile manager adds the dependency **and** the entry
`@local/dsh-media-player` in `dsh.profile.bundles`
(`~/.dsh/profiles/web/package.json`). If the command hangs or is
interrupted, the profile's `package.json.lock` file may be left behind:
delete it, check that the link `node_modules/@local/dsh-media-player` exists and
add the `bundles` entry by hand — that is all `reconcile()` does.

With `patchReload: live`, the host **recomposes hot**: the open page receives
the new module through the HMR transport, without restarting `dsh web`. It can be checked
in the page with `performance.getEntriesByType('resource')` or by the presence
of `<style id="dsh-media-player-styles">` in the `<head>`.

## Check

```bash
cd <your checkout>/packages/dsh-media-player
node scripts/build.mjs           # rebuilds the browser bundle
node scripts/build-harness.mjs   # rebuilds the test harness (not versioned)
python3 test/verify.py           # 20/20 expected, capture /tmp/dsh-media-player-harness.png
```

`test/verify.py` drives headless Chromium, mounts the React body with a real
React 18 and checks: registration, exports, metadata, formats, slot key,
`fr`/`zh` labels, helpers (MIME, `dsh-resource://` address, size), decoding
of a synthetic WAV (duration > 0.3 s), following the dark theme, the video failure case,
the "non-binary content" case, and zero console errors.

Proof in real conditions: open an `.mp3` in the right sidebar →
**Files** tab of the GUI (`http://127.0.0.1:3080/`).

## Uninstall

```bash
dsh plugin --profile web remove @local/dsh-media-player
```

The package lives in this repository (like `kybernos-plugin`): removing it from the
profile is enough to restore the original behaviour.
