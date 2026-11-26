// Holds the stored colour mode through the first moments of a page load (C-01 of the 2026-10-16 audit).
//
// The measured flash: with the mode stored as « light », the page's own bootstrap (the inline script DSH writes at the end of <body>) sets the
// source to « light » on the first frame; then, about 350 ms later, the engine's theme store mounts, resolves « system » for ~30 ms (a dark
// frame when the machine is dark), and applies the stored « light » again. 3 reloads out of 3, in a fresh browser profile. The boot sheet
// (boot-store.mjs) cannot help: it carries tokens as { light, dark } pairs and does not know the mode, and the mode itself is the engine's.
//
// This is a few lines of script, put into the head through the same `webserver/index-inject` seam as the boot sheet. It watches the two
// attributes the bootstrap writes (`data-ds-theme-source` on <html>, `data-ds-dark-theme` on <body>), remembers what the bootstrap set, and for the
// first 2.5 s puts those two attributes back whenever something else rewrites them: a mutation observer's callback runs before the browser paints,
// so the dark frame is never drawn. The engine's own, correct write (« light » again) then finds nothing to change. Nothing is held when the stored
// mode is « system » (there is nothing to protect) and after 2.5 s the observer is gone, so a person's own choice is never fought.
// No engine patch: the same seam, a script instead of a style. It can only fail silently (every path is in a try).
export const HOLD_MS = 2500

export const HOLD_SCRIPT = `(function(){try{var d=document.documentElement,S='data-ds-theme-source',K='data-ds-dark-theme',end=Date.now()+${HOLD_MS},held=null;var o=new MutationObserver(function(){try{var b=document.body,s=d.getAttribute(S);if(held===null){if(s==='light'||s==='dark'){held={s:s,k:b!==null&&b.hasAttribute(K)}}else if(s!==null){o.disconnect()}return}if(Date.now()>end){o.disconnect();return}if(s!==held.s){d.setAttribute(S,held.s)}if(b!==null&&b.hasAttribute(K)!==held.k){if(held.k){b.setAttribute(K,'')}else{b.removeAttribute(K)}}}catch(e){try{o.disconnect()}catch(f){}}});o.observe(d,{attributes:true,subtree:true,attributeFilter:[S,K]});setTimeout(function(){try{o.disconnect()}catch(e){}},${HOLD_MS + 100})}catch(e){}})()`

/** The one head row per index render. */
export const holdRows = () => [{ kind: 'html', placement: 'head', html: '<script id="kbth-hold">' + HOLD_SCRIPT + '</script>' }]
