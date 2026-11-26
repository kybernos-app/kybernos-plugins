# Traps found while building the first examples

Read this before a long build: each one cost an hour once.

## The CAD kernel

- **Booleans with a helical solid take minutes.** A thread cut into or fused with another solid is slow and sometimes fails. Make the thread a separate
  solid (a ruled sweep or an analytic mesh), keep it out of boolean unions, and check that a shaft fits its nut on cross-sections (the smallest radial
  gap between the outside of one and the bore of the other) instead of intersecting the two threads.
- **A smooth loft between twisted star sections overshoots.** Use a ruled loft.
- **A revolved cone apex, or a boolean on the axis, can leave open mesh edges.** Keep a small flat at the tip. `Kit.check()` reports it as "tessellation is not closed".
- **`from build123d import *` shadows names** such as `G`. Do not name a variable like a build123d class.
- **`ln.wire` is a method:** `ln.wire()`.
- **`Kit.add(name, shape, material, density, ...)`**: `name` is the part id. Pass the label shown on the page as `display='...'`, never `name=`.
- **Float residue at the closing of a periodic profile** (a valve-lift curve that should end at exactly 0) leaves a sliver or a tiny negative value: clamp or snap it before building anything from it.
- **Booleans are not free.** An interference test is the volume of `a & b`. Plain solids take milliseconds (the engine's 960 pair checks take seconds); anything helical takes minutes (the grinder's full test is about 2 minutes). Filter by bounding box first and run the slow tests last.

## Meshes and size

- **A coil spring is 100 000+ triangles** at the default tolerance. Build it as straight segments (a handful per turn) and give the part a looser volume tolerance (`vtol`).
- **A real thread is millions of triangles.** Generate it analytically with a modest pitch resolution; the grinder's shaft and nut are about 23 000 triangles each.
- **Budget:** about 150 000 triangles in all and 12 MB for the page. The `.glb` is base64 inside the html (a third larger).
- `Kit.write_glb` writes metres, Y up (`x, z, -y` from the CAD frame). Poses computed in CAD millimetres must go through the same conversion on the page.

## Cutaways

- Remove the half with `y < 0` from the **static** parts only; the cut face is a separate 0.4 mm slab (so the page can colour it). Moving parts stay whole,
  or the cut would pass through a piston and show an empty inside.
- A part that must not be cut (a plug, a valve) is left whole even when it sits on the cut plane.

## Fits that look right and are not

- A part that touches by a face reports a shared volume of ~0 (good). A part pushed 0.1 mm in reports a tiny volume: the tolerance of the test (0.5 mm³ for a mesh face) decides, so also test with a **negative control** pushed several mm.
- Test clearance with a sign: "the shaft clears the hole by 0.5 mm" is `gap >= 0.5`, and the negative control is `gap < 0`.
- Hubs, flywheels and cranks drawn without the case they live in intersect it. Test the moving parts against the static ones over the whole travel, not only at rest.
- A valve opened at top dead centre hits the piston unless the clearance is designed in: the sweep over the whole cycle finds it, the rest pose does not.

## The page

- A published Artifact cannot download files: Export shows the real size in a toast and also tries a download that a normal browser performs.
- OrbitControls wheel zoom traps the page scroll on a phone: the host zooms with ctrl/pinch only and sets `touch-action: pan-y` on the narrow layout. Keep it.
- The Browser pane of the desktop app renders black when it is hidden or when a phone size is emulated; show the pane, wait a few seconds (software GL is slow), and measure rectangles with the DOM when a screenshot is not available.
- A local file over about 1 MB does not open in that pane: serve the folder over http (`python3 -m http.server 0 --bind 127.0.0.1`).
- The `<title>` is the name of the object, two to four words; the explanation goes in the lede.
