# kybernos-miniapps

“Install as app” for the mini-apps of DSH's right sidebar (Bricks, 3D modeller,
Slides), in the spirit of the Goose apps that stay active when the main
application is closed.

## What it does

- an **App ⤓** button appears in the header of every recognised mini-app;
- on click, the panel is **serialised** (DOM + the CSS rules that apply +
  canvases frozen as images) and sent to the host;
- the host installs a **native macOS app** (a borderless floating window, always
  on top, movable, with a menu-bar icon offering Reload/Quit) in
  `~/Applications/Kybernos/`; it **survives closing DSH**;
- once installed, the button opens a menu: **Launch**, **Launch at login**
  (LaunchAgent `app.kybernos.miniapps.<id>`), **Uninstall**.

The labels follow the language of the page: French for a French interface,
English for every other language (“App”, “Launch”, “Launch at login”, “Uninstall”).

## Known limits

- the installed app is a **snapshot**: a mini-app that talks to the server live
  (animated replay, probes) lives frozen outside DSH;
- macOS only (NSPanel + codesign + launchctl); elsewhere the install is politely refused;
- the wrapper binary (`template/template.app/Contents/MacOS/miniapp`) is
  compiled for arm64 from `template/miniapp.swift`: `swiftc -O -o miniapp miniapp.swift`.

## Routes

- `POST /kybernos-miniapps/install` `{id, titre, html, largeur, hauteur, auto}`
- `POST /kybernos-miniapps/uninstall` `{id}`
- `GET /kybernos-miniapps/list`
