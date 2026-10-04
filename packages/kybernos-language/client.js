// kybernos-language — browser half (separate, removable plugin).
//
// What this plugin does:
//
//   settings section « Language » ......... settings.section (order 2)
//   language list + add (ISO 639-1) ....... one row per language, one action each
//   translation run ....................... host routes /kybernos/i18n-translate
//                                           and /kybernos/i18n-models
//   DSH language pack ..................... the translated language is registered
//                                           in DSH's own locale service, so DSH's
//                                           screens (sidebar, chat, settings…)
//                                           follow, not just Kybernos' tables
//   live translation ...................... settings pages written with hardcoded
//                                           text are translated as they appear
//   document direction and language ....... dir + lang on <html>
//
// Three sources feed a run, none of them guessed:
//   1. window.__KB_T__ / window.__KB_FR_EN__ — published by @local/kybernos
//      (French source, 2 600+ strings);
//   2. this page's own strings;
//   3. DSH's English dictionaries, read from the locale service (about 2 200
//      strings in 55 namespaces). That read goes through `LocaleRuntime.dicts`,
//      which is NOT public API: it is guarded, and when the shape is not the one
//      we know, DSH's screens are simply left out and the page says so.
//
// The `kbt()`/`kbf()` bridge of @local/kybernos reads `window.__KB_I18N_ACTIVE__`:
// it is set here as soon as the plugin activates, BEFORE the other entries render.
//
// Loaded through window.__ModuleLoader__.load — same shape as the ui-* packages.
// The factory's try/catch is vital: an evaluation error here breaks the WHOLE
// entry ("Failed to load plugins") and leaves the GUI unusable. We degrade:
// plugin disabled, GUI preserved.
window.__ModuleLoader__.load({
  id: '@local/kybernos-language',
  factory(require) {
    try {

      const React = require('react')
      const h = React.createElement

      // `styles` follows the dynamic cordis runner contract: insert(css) returns
      // a disposer.
      const styles = (() => {
        const insert = (css) => {
          const tag = document.createElement('style')
          tag.dataset.plugin = '@local/kybernos-language'
          tag.textContent = css
          document.head.append(tag)
          return () => { tag.remove() }
        }
        return { insert }
      })()

      // ══════════════════════════════════════════════════════════════════════
      // 1. STYLESHEET
      // ══════════════════════════════════════════════════════════════════════

      const css = `
/* ── Page layout (copied from kybernos-theme, NOT borrowed) ─────────────────
   This bundle is a REMOVABLE satellite: kybernos-theme can disappear from the
   profile without this page losing its layout. Same values, same DSH tokens. */
[data-slot="settings.section"]:has(.kbth-page) { width: 100%; max-width: none; }
.kbth-page{display:grid;grid-template-columns:1fr;gap:22px;max-width:760px;align-items:start}
.kbth-main{display:flex;flex-direction:column;gap:22px;min-width:0}
.kbth-head{display:flex;flex-direction:column;gap:6px}
.kbth-title{font-size:26px;line-height:32px;font-weight:800;letter-spacing:-.01em;color:var(--dsw-alias-label-primary)}
.kbth-sub{font-size:14px;line-height:1.55;color:var(--dsw-alias-label-secondary);max-width:640px}
.kbth-sec{display:flex;flex-direction:column;gap:10px}
.kbth-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.kbth-lb{font-size:13px;font-weight:500;color:var(--dsw-alias-label-secondary);width:160px;flex:none}
.kbth-hint{font-size:12px;color:var(--dsw-alias-label-tertiary);line-height:1.5}
.kbth-btn{appearance:none;font:inherit;font-size:13px;font-weight:500;padding:7px 14px;border-radius:9px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);transition:background .12s,border-color .12s;white-space:nowrap}
.kbth-btn:hover{background:var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-3));border-color:var(--dsw-alias-border-l3)}
.kbth-btn.primary{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground,#fff);border-color:var(--dsw-alias-brand-primary)}
.kbth-btn.primary:hover{opacity:.9}
.kbth-btn.quiet{border-color:transparent;background:transparent;color:var(--dsw-alias-label-secondary)}
.kbth-btn.quiet:hover{background:var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-3))}
.kbth-btn.danger{color:var(--dsw-alias-state-error, #e5484d)}
/* ── Language rows ──────────────────────────────────────────────────────── */
.kbth-langs{display:flex;flex-direction:column;gap:8px}
.kbth-lang{display:flex;flex-direction:column;gap:12px;padding:12px 14px;border-radius:12px;border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2)}
.kbth-lang.on{border:1.5px solid var(--dsw-alias-brand-primary);padding:11.25px 13.25px}
.kbth-lang-top{display:flex;align-items:center;gap:12px}
.kbth-badge{width:38px;height:38px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;letter-spacing:.02em;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary)}
.kbth-lang.on .kbth-badge{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground,#fff)}
.kbth-lang-info{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.kbth-lang-name{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary);display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.kbth-lang-en{font-weight:400;color:var(--dsw-alias-label-tertiary);font-size:12px}
.kbth-lang-meta{font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.4}
.kbth-lang-act{display:flex;align-items:center;gap:8px;flex:none;flex-wrap:wrap;justify-content:flex-end}
.kbth-pill{font-size:11px;padding:2px 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);font-weight:500;white-space:nowrap}
.kbth-pill.ok{border-color:transparent;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground,#fff)}
/* Progress, inside the row */
.kbth-prog{display:flex;flex-direction:column;gap:10px;padding-top:2px}
.kbth-bar{height:8px;border-radius:999px;background:var(--dsw-alias-bg-layer-3);overflow:hidden}
.kbth-bar>i{display:block;height:100%;border-radius:999px;background:var(--dsw-alias-brand-primary);transition:width .3s ease}
.kbth-bar.sm{height:5px}
.kbth-bar.done>i{background:var(--dsw-alias-state-success, #30a46c)}
.kbth-prog-line{display:flex;justify-content:space-between;gap:12px;font-size:12px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.kbth-areas{display:grid;grid-template-columns:minmax(0,200px) 1fr 40px;gap:6px 12px;align-items:center;font-size:12px;color:var(--dsw-alias-label-secondary)}
.kbth-areas>span:last-child,.kbth-areas>span.n{text-align:end;font-variant-numeric:tabular-nums}
.kbth-note{font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.5}
.kbth-err{display:flex;flex-direction:column;gap:6px;padding:10px 12px;border-radius:10px;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-state-error, #e5484d)}
.kbth-err code{font-size:11px;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary)}
.kbth-link{appearance:none;background:none;border:0;padding:0;font:inherit;font-size:12px;color:var(--dsw-alias-label-secondary);text-decoration:underline;cursor:pointer;align-self:flex-start}
.kbth-menu{position:relative}
.kbth-menu-pop{position:absolute;inset-inline-end:0;top:calc(100% + 4px);z-index:20;min-width:210px;padding:4px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);box-shadow:0 8px 24px rgba(0,0,0,.25);display:flex;flex-direction:column}
.kbth-menu-pop button{appearance:none;font:inherit;font-size:13px;text-align:start;padding:8px 10px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer}
.kbth-menu-pop button:hover{background:var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-3))}
.kbth-menu-pop button[disabled]{opacity:.45;cursor:default}
/* ── Add a language ─────────────────────────────────────────────────────── */
.kbth-add{display:flex;flex-direction:column;border-radius:12px;border:.5px dashed var(--dsw-alias-border-l3)}
.kbth-add-h{appearance:none;font:inherit;display:flex;align-items:center;gap:10px;padding:11px 14px;background:transparent;border:0;cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:14px;text-align:start}
.kbth-add-h:hover{color:var(--dsw-alias-brand-primary)}
.kbth-add-body{display:flex;flex-direction:column;gap:10px;padding:0 14px 14px}
.kbth-input{appearance:none;font:inherit;font-size:13px;padding:8px 12px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);outline:none;width:100%;box-sizing:border-box}
.kbth-input:focus{border-color:var(--dsw-alias-brand-primary)}
.kbth-chips{display:flex;flex-wrap:wrap;gap:6px}
.kbth-chip{appearance:none;font:inherit;font-size:12px;padding:5px 11px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);cursor:pointer}
.kbth-chip:hover:not([disabled]){border-color:var(--dsw-alias-brand-primary)}
.kbth-chip[disabled]{opacity:.4;cursor:default}
.kbth-sec-t{font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}
.kbth-iso{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:4px;max-height:280px;overflow:auto;padding-inline-end:4px}
.kbth-iso-i{appearance:none;font:inherit;font-size:13px;display:flex;align-items:baseline;gap:8px;padding:7px 10px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;text-align:start;min-width:0}
.kbth-iso-i:hover:not([disabled]){background:var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-3))}
.kbth-iso-i[disabled]{opacity:.4;cursor:default}
.kbth-iso-i b{font-weight:500}
.kbth-iso-i small{font-size:11px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kbth-iso-i code{margin-inline-start:auto;font-size:10px;color:var(--dsw-alias-label-tertiary)}
/* ── Advanced ───────────────────────────────────────────────────────────── */
.kbth-adv{border-radius:12px;border:.5px solid var(--dsw-alias-border-l2);padding:10px 14px}
.kbth-adv>summary{cursor:pointer;font-size:13px;color:var(--dsw-alias-label-secondary)}
.kbth-adv-body{display:flex;flex-direction:column;gap:12px;padding-top:12px}
.kbth-select{appearance:none;font:inherit;font-size:13px;padding:7px 28px 7px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%2381858c'/%3E%3C/svg%3E") no-repeat right 10px center;color:var(--dsw-alias-label-primary);cursor:pointer;min-width:240px;max-width:100%}
.kbth-select:focus{border-color:var(--dsw-alias-brand-primary);outline:none}
/* ── Help: a small animated walkthrough ──────────────────────────────────────
   The mock is pure CSS on a 12 s loop; the BASE style of every animated part is the
   final state (language ready and in use), which is also what reduced motion shows. */
.kbth-head-row{display:flex;align-items:center;justify-content:space-between;gap:12px}
.kbth-help-btn{appearance:none;font:inherit;font-size:12px;display:inline-flex;align-items:center;gap:6px;padding:4px 11px 4px 5px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap}
.kbth-help-btn:hover,.kbth-help-btn[aria-expanded="true"]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary)}
.kbth-help-q{width:18px;height:18px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;background:var(--dsw-alias-bg-layer-3)}
.kbth-help{display:grid;grid-template-columns:300px minmax(0,1fr);gap:20px;padding:16px;border-radius:12px;border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);align-items:center}
@media (max-width:700px){.kbth-help{grid-template-columns:minmax(0,1fr)}}
.kbth-help-text{display:flex;flex-direction:column;gap:12px;min-width:0}
.kbth-help-h{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}
.kbth-steps{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:10px}
.kbth-step{display:grid;grid-template-columns:22px minmax(0,1fr);gap:10px;align-items:start}
.kbth-step>b{width:22px;height:22px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground,#fff)}
.kbth-step-t{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
.kbth-step-b{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.kbth-step.s1{animation:kbth-k-s1 12s infinite}
.kbth-step.s2{animation:kbth-k-s2 12s infinite}
.kbth-step.s3{animation:kbth-k-s3 12s infinite}
.kbth-mm{direction:ltr;position:relative;width:300px;max-width:100%;height:176px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);overflow:hidden;font-size:10px;color:var(--dsw-alias-label-primary);user-select:none;pointer-events:none}
.kbth-mm-bar{position:absolute;left:0;right:0;top:0;height:26px;display:flex;align-items:center;justify-content:space-between;padding:0 10px;border-bottom:1px solid var(--dsw-alias-border-l2);font-weight:600}
.kbth-mm-hi{position:relative;display:inline-block;width:34px;height:12px;line-height:12px;color:var(--dsw-alias-label-secondary)}
.kbth-mm-hi i{font-style:normal;position:absolute;right:0;top:0;line-height:12px}
.kbth-mm-w1{opacity:0;animation:kbth-k-w1 12s infinite}
.kbth-mm-w2{animation:kbth-k-w2 12s infinite}
.kbth-mm-row{position:absolute;left:8px;right:8px;height:32px;display:flex;align-items:center;gap:7px;padding:0 8px;border-radius:8px;border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);box-sizing:border-box}
.kbth-mm-row.en{top:34px}
.kbth-mm-row.es{top:72px;height:40px;animation:kbth-k-es 12s infinite}
.kbth-mm-b{width:18px;height:18px;flex:none;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:8px;font-weight:700;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary)}
.kbth-mm-i{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px;position:relative}
.kbth-mm-n{font-weight:600;white-space:nowrap}
.kbth-mm-st{position:relative;height:11px;color:var(--dsw-alias-label-secondary);font-size:9px}
.kbth-mm-st>span{position:absolute;left:0;top:0;white-space:nowrap;opacity:0}
.kbth-mm-st>.t3{opacity:1;animation:kbth-k-st3 12s infinite}
.kbth-mm-st>.t1{animation:kbth-k-st1 12s infinite}
.kbth-mm-st>.t2{animation:kbth-k-st2 12s infinite}
.kbth-mm-acts{position:relative;width:92px;height:20px;flex:none}
.kbth-mm-acts>*{position:absolute;right:0;top:0;height:20px;box-sizing:border-box;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;padding:0 7px;font-size:9px;font-weight:600;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}
.kbth-mm-go,.kbth-mm-us{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground,#fff);opacity:0}
.kbth-mm-go{animation:kbth-k-go 12s infinite}
.kbth-mm-us{animation:kbth-k-us 12s infinite}
.kbth-mm-pa{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);opacity:0;animation:kbth-k-pa 12s infinite}
.kbth-mm-pill{border-radius:999px;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground,#fff)}
.kbth-mm-pill.es{opacity:1;animation:kbth-k-pes 12s infinite}
.kbth-mm-pill.en{opacity:0;animation:kbth-k-pen 12s infinite}
.kbth-mm-track{position:absolute;left:34px;right:104px;bottom:4px;height:3px;border-radius:99px;background:var(--dsw-alias-bg-layer-3);opacity:0;animation:kbth-k-track 12s infinite}
.kbth-mm-fill{display:block;height:100%;width:100%;border-radius:99px;background:var(--dsw-alias-brand-primary);animation:kbth-k-fill 12s linear infinite}
.kbth-mm-pick{position:absolute;left:8px;right:8px;top:128px;display:flex;gap:6px;opacity:0;animation:kbth-k-pick 12s infinite}
.kbth-mm-chip{padding:4px 9px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);font-size:9px}
.kbth-mm-chip.on{animation:kbth-k-chip 12s infinite}
.kbth-mm-cur{position:absolute;left:150px;top:110px;width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:11px solid var(--dsw-alias-label-primary);transform-origin:50% 100%;opacity:0;animation:kbth-k-cur 12s infinite;filter:drop-shadow(0 1px 1px rgba(0,0,0,.5))}
@keyframes kbth-k-pick{0%{opacity:0}3%,20%{opacity:1}24%,100%{opacity:0}}
@keyframes kbth-k-chip{0%,9%{background:var(--dsw-alias-bg-layer-2);color:inherit}11%,18%{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground,#fff)}22%,100%{background:var(--dsw-alias-bg-layer-2);color:inherit}}
@keyframes kbth-k-es{0%,14%{opacity:0;transform:translateY(8px)}20%,93%{opacity:1;transform:none}98%,100%{opacity:0;transform:translateY(8px)}}
@keyframes kbth-k-st1{0%,19%{opacity:0}21%,32%{opacity:1}34%,100%{opacity:0}}
@keyframes kbth-k-st2{0%,33%{opacity:0}35%,62%{opacity:1}64%,100%{opacity:0}}
@keyframes kbth-k-st3{0%,63%{opacity:0}65%,94%{opacity:1}98%,100%{opacity:0}}
@keyframes kbth-k-go{0%,19%{opacity:0}21%,32%{opacity:1;transform:none}33%{opacity:1;transform:scale(.92)}35%,100%{opacity:0}}
@keyframes kbth-k-pa{0%,34%{opacity:0}36%,62%{opacity:1}64%,100%{opacity:0}}
@keyframes kbth-k-us{0%,63%{opacity:0}65%,71%{opacity:1;transform:none}73%{opacity:1;transform:scale(.92)}76%,100%{opacity:0}}
@keyframes kbth-k-pes{0%,76%{opacity:0}79%,94%{opacity:1}98%,100%{opacity:0}}
@keyframes kbth-k-pen{0%,76%{opacity:1}79%,94%{opacity:0}98%,100%{opacity:1}}
@keyframes kbth-k-track{0%,33%{opacity:0}35%,76%{opacity:1}79%,100%{opacity:0}}
@keyframes kbth-k-fill{0%,34%{width:0}62%,100%{width:100%}}
@keyframes kbth-k-w1{0%,74%{opacity:1}77%,96%{opacity:0}99%,100%{opacity:1}}
@keyframes kbth-k-w2{0%,74%{opacity:0}77%,96%{opacity:1}99%,100%{opacity:0}}
@keyframes kbth-k-cur{0%{left:150px;top:110px;opacity:0;transform:rotate(-30deg) scale(1)}4%{left:150px;top:110px;opacity:1}9%{left:36px;top:140px}11%{left:36px;top:140px;transform:rotate(-30deg) scale(.8)}13%{transform:rotate(-30deg) scale(1)}26%{left:36px;top:140px}31%{left:238px;top:90px}33%{transform:rotate(-30deg) scale(1)}34%{transform:rotate(-30deg) scale(.8)}36%{transform:rotate(-30deg) scale(1)}70%{left:238px;top:90px}72%{transform:rotate(-30deg) scale(.8)}74%{transform:rotate(-30deg) scale(1)}90%{left:238px;top:90px;opacity:1}94%,100%{opacity:0}}
@keyframes kbth-k-s1{0%,23%{opacity:1}26%,96%{opacity:.45}99%,100%{opacity:1}}
@keyframes kbth-k-s2{0%,24%{opacity:.45}27%,64%{opacity:1}67%,100%{opacity:.45}}
@keyframes kbth-k-s3{0%,65%{opacity:.45}68%,95%{opacity:1}98%,100%{opacity:.45}}
@media (prefers-reduced-motion:reduce){.kbth-mm *,.kbth-step{animation:none !important}.kbth-step{opacity:1}}
/* The pointer under DSH's General › Language row */
/* A pointer, not a row: zero height, lifted into the bottom of the Language row above it
   (the row's own separator stays below it), so the rows after it do not move. */
.kbth-gl{height:0;position:relative;top:-27px;overflow:visible;line-height:1}
.kbth-gl-link{appearance:none;background:none;border:0;padding:0;font:inherit;font-size:12px;color:var(--dsw-alias-label-secondary);text-decoration:underline;cursor:pointer}
.kbth-gl-link:hover{color:var(--dsw-alias-brand-primary)}
.kbth-gl-link::after{content:' →'}
html[dir="rtl"] .kbth-gl-link::after{content:' ←'}
/* ── RTL-ready ──────────────────────────────────────────────────────────────
   The reading direction lives on <html dir>: flex rows and text follow on their
   own. These fixes only touch what is written with physical properties
   (left/right), which the browser does not flip. */
html[dir="rtl"] .kbth-select{background-position:left 10px center;padding:7px 10px 7px 28px}
html[dir="rtl"] .kbth-slider{background:linear-gradient(to left,var(--dsw-alias-brand-primary) 0 var(--fill,50%),var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-3)) var(--fill,50%) 100%)}
/* Digits, measures and code stay left-to-right inside a right-to-left interface */
html[dir="rtl"] .kbth-sl-vl,html[dir="rtl"] .kbth-fsmeta,html[dir="rtl"] .kbth-prog-line b,
html[dir="rtl"] code,html[dir="rtl"] pre{direction:ltr;unicode-bidi:isolate;text-align:left}
html[dir="rtl"] .kbth-page{direction:rtl}
@media (max-width:640px){.kbth-lang-top{flex-wrap:wrap}.kbth-lang-act{width:100%;justify-content:flex-start}.kbth-areas{grid-template-columns:1fr 60px}}
`

      // ══════════════════════════════════════════════════════════════════════
      // 2. LANGUAGES — built-in, added (ISO 639-1), direction, names
      // ══════════════════════════════════════════════════════════════════════

      const I18N_STORE_PREFIX = 'kybernos.i18n.'
      const I18N_META_PREFIX = 'kybernos.i18n.meta.'
      const I18N_DSH_PREFIX = 'kybernos.i18n.dsh.'
      const I18N_LIVE_PREFIX = 'kybernos.i18n.live.'
      const I18N_REGISTRY_KEY = 'kybernos.i18n.langs'
      const I18N_LABELS_KEY = 'kybernos.i18n.labels' // { id: native name } — read by the runtime too
      const I18N_MODEL_KEY = 'kybernos.i18n.provider'
      const I18N_HELP_KEY = 'kybernos.i18n.help' // 'open' | 'closed' once the user has chosen
      // A language declares itself right-to-left here (any language added later
      // whose id is in the list inherits the direction). The direction is set on
      // <html> (dir + lang) by appliquerDirection(), not on a container: that is
      // what the CSS cascade and screen readers read.
      const RTL_LANGS = ['ar', 'he', 'fa', 'ur', 'ps', 'sd', 'ug', 'yi', 'dv']
      const isRtlLang = (id) => RTL_LANGS.indexOf(String(id || '').split(/[-_]/)[0]) >= 0
      const isBuiltIn = (id) => id === 'kybernos' || id === 'en'

      // ISO 639-1: every two-letter code, with its English name. The English name is
      // NOT taken from `Intl.DisplayNames`: that depends on the browser's locale data
      // (a trimmed build knows "Afrikaans" but not "Afar" and returns the bare code),
      // and the name also goes into the translation prompt, where "Haitian Creole"
      // matters. The native name ("Español") does come from `Intl.DisplayNames`, which
      // renders each language in its own language; without it, the English name stands.
      const ISO_NAMES = 'aa Afar|ab Abkhazian|ae Avestan|af Afrikaans|ak Akan|am Amharic|an Aragonese|ar Arabic|as Assamese|av Avaric|ay Aymara|az Azerbaijani|ba Bashkir|be Belarusian|bg Bulgarian|bh Bihari|bi Bislama|bm Bambara|bn Bengali|bo Tibetan|br Breton|bs Bosnian|ca Catalan|ce Chechen|ch Chamorro|co Corsican|cr Cree|cs Czech|cu Church Slavic|cv Chuvash|cy Welsh|da Danish|de German|dv Divehi|dz Dzongkha|ee Ewe|el Greek|en English|eo Esperanto|es Spanish|et Estonian|eu Basque|fa Persian|ff Fulah|fi Finnish|fj Fijian|fo Faroese|fr French|fy Western Frisian|ga Irish|gd Scottish Gaelic|gl Galician|gn Guarani|gu Gujarati|gv Manx|ha Hausa|he Hebrew|hi Hindi|ho Hiri Motu|hr Croatian|ht Haitian Creole|hu Hungarian|hy Armenian|hz Herero|ia Interlingua|id Indonesian|ie Interlingue|ig Igbo|ii Sichuan Yi|ik Inupiaq|io Ido|is Icelandic|it Italian|iu Inuktitut|ja Japanese|jv Javanese|ka Georgian|kg Kongo|ki Kikuyu|kj Kuanyama|kk Kazakh|kl Kalaallisut|km Khmer|kn Kannada|ko Korean|kr Kanuri|ks Kashmiri|ku Kurdish|kv Komi|kw Cornish|ky Kyrgyz|la Latin|lb Luxembourgish|lg Ganda|li Limburgish|ln Lingala|lo Lao|lt Lithuanian|lu Luba-Katanga|lv Latvian|mg Malagasy|mh Marshallese|mi Māori|mk Macedonian|ml Malayalam|mn Mongolian|mr Marathi|ms Malay|mt Maltese|my Burmese|na Nauru|nb Norwegian Bokmål|nd North Ndebele|ne Nepali|ng Ndonga|nl Dutch|nn Norwegian Nynorsk|no Norwegian|nr South Ndebele|nv Navajo|ny Chichewa|oc Occitan|oj Ojibwa|om Oromo|or Odia|os Ossetian|pa Punjabi|pi Pali|pl Polish|ps Pashto|pt Portuguese|qu Quechua|rm Romansh|rn Kirundi|ro Romanian|ru Russian|rw Kinyarwanda|sa Sanskrit|sc Sardinian|sd Sindhi|se Northern Sami|sg Sango|si Sinhala|sk Slovak|sl Slovenian|sm Samoan|sn Shona|so Somali|sq Albanian|sr Serbian|ss Swati|st Southern Sotho|su Sundanese|sv Swedish|sw Swahili|ta Tamil|te Telugu|tg Tajik|th Thai|ti Tigrinya|tk Turkmen|tl Tagalog|tn Tswana|to Tongan|tr Turkish|ts Tsonga|tt Tatar|tw Twi|ty Tahitian|ug Uyghur|uk Ukrainian|ur Urdu|uz Uzbek|ve Venda|vi Vietnamese|vo Volapük|wa Walloon|wo Wolof|xh Xhosa|yi Yiddish|yo Yoruba|za Zhuang|zh Chinese|zu Zulu'
      const ISO_ENGLISH = {}
      for (const pair of ISO_NAMES.split('|')) ISO_ENGLISH[pair.slice(0, 2)] = pair.slice(3)
      const ISO_639_1 = Object.keys(ISO_ENGLISH)
      const POPULAR = ['es', 'de', 'it', 'pt', 'ar', 'zh', 'ja', 'ko', 'ru', 'tr', 'hi', 'nl', 'pl', 'he', 'fa', 'uk', 'vi', 'id', 'sv', 'th']
      const cap = (s) => (s.length > 0 ? s.charAt(0).toLocaleUpperCase() + s.slice(1) : s)
      const displayName = (code, inLang) => {
        try {
          if (typeof Intl === 'undefined' || typeof Intl.DisplayNames !== 'function') return null
          const n = new Intl.DisplayNames([inLang], { type: 'language' }).of(code)
          return typeof n === 'string' && n !== '' && n.toLowerCase() !== code ? n : null
        } catch (e) { return null }
      }
      const infoCache = new Map()
      const langInfo = (id) => {
        if (id === 'kybernos') return { id, native: 'Français', english: 'French', rtl: false }
        if (infoCache.has(id)) return infoCache.get(id)
        const english = ISO_ENGLISH[id] || displayName(id, 'en') || id
        const native = cap(displayName(id, id) || english)
        const info = { id, native, english, rtl: isRtlLang(id) }
        infoCache.set(id, info)
        return info
      }

      // ── storage ──────────────────────────────────────────────────────────
      const readJson = (key, dflt) => {
        try {
          const raw = localStorage.getItem(key)
          if (raw === null) return dflt
          const parsed = JSON.parse(raw)
          return parsed !== null && typeof parsed === 'object' ? parsed : dflt
        } catch (e) { return dflt }
      }
      // false when the browser refused the write (quota, private mode): the
      // engine stops instead of reporting progress it cannot keep.
      const writeJson = (key, value) => {
        try { localStorage.setItem(key, JSON.stringify(value)); return true } catch (e) { return false }
      }
      const i18nRead = (lang) => readJson(I18N_STORE_PREFIX + lang, {})
      const dshRead = (lang) => readJson(I18N_DSH_PREFIX + lang, {})
      const liveRead = (lang) => readJson(I18N_LIVE_PREFIX + lang, {})
      const metaRead = (lang) => readJson(I18N_META_PREFIX + lang, {})
      const registryRead = () => { const r = readJson(I18N_REGISTRY_KEY, []); return Array.isArray(r) ? r.filter((x) => typeof x === 'string') : [] }
      const registryAdd = (id) => {
        const r = registryRead()
        if (r.indexOf(id) < 0) { r.push(id); writeJson(I18N_REGISTRY_KEY, r) }
        // The native name goes with it: the runtime lists the language in DSH's own
        // selector by this name, with or without this plugin.
        const labels = readJson(I18N_LABELS_KEY, {})
        if (labels[id] === undefined) { labels[id] = langInfo(id).native; writeJson(I18N_LABELS_KEY, labels) }
      }
      const dropLanguage = (id) => {
        try {
          for (const p of [I18N_STORE_PREFIX, I18N_META_PREFIX, I18N_DSH_PREFIX, I18N_LIVE_PREFIX]) localStorage.removeItem(p + id)
          writeJson(I18N_REGISTRY_KEY, registryRead().filter((x) => x !== id))
          const labels = readJson(I18N_LABELS_KEY, {})
          delete labels[id]
          writeJson(I18N_LABELS_KEY, labels)
        } catch (e) { /* storage unavailable */ }
      }

      // Languages the page lists: the two built-ins, the ones the user added, and
      // any cached dictionary (older versions kept no registry). A key like
      // "meta.ar" or "dsh.ar" is not a language id: the pattern below has no dot.
      const ID_PATTERN = /^[a-z]{2,3}(-[A-Za-z0-9]+)?$/
      const managedIds = () => {
        const ids = registryRead().filter((x) => ID_PATTERN.test(x))
        try {
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i)
            if (key !== null && key.indexOf(I18N_STORE_PREFIX) === 0) {
              const lid = key.slice(I18N_STORE_PREFIX.length)
              if (ID_PATTERN.test(lid) && lid !== 'en' && ids.indexOf(lid) < 0) ids.push(lid)
            }
          }
        } catch (e) { /* localStorage unavailable */ }
        return ids.filter((x) => !isBuiltIn(x))
      }
      const getAvailableLangs = () => ['kybernos', 'en'].concat(managedIds()).map(langInfo)

      // ══════════════════════════════════════════════════════════════════════
      // 3. SOURCE STRINGS — what a run translates
      // ══════════════════════════════════════════════════════════════════════
      //
      // Every item is { wire, id, text, store, area }. `wire` is the key sent to
      // the host (prefixed so a Kybernos key and a DSH key can never collide), `id`
      // the key inside its store: `kb` = the Kybernos dictionary (`kybernos.i18n.<lang>`),
      // `dsh` = DSH's namespaces (`kybernos.i18n.dsh.<lang>`, keys "ns::key").
      //
      // Areas, in the order a run translates them, so a language becomes usable
      // early: core = menus, chat and settings; more = the other DSH screens;
      // phrases = long messages.
      const AREAS = ['core', 'more', 'phrases']
      const CORE_NS = /^(common|workspace|conversation|chat|command|shortcuts|model|question|plan|goal|feedback|deliverables|job|subagent|agent-team|permission\.|settings(\.|$)|sidebar|session)/
      // The host drops keys over 200 characters: leaving them out here keeps them
      // from counting as "missing" forever.
      const WIRE_MAX = 200
      const wireOf = (store, id) => store + ':' + id

      // ── this page's own strings: [French, English] ───────────────────────
      // The French is the key (and the source), like every `kbf` phrase. `{x}` are
      // variables the translation must keep.
      const S = {
        title: ['Langue', 'Language'],
        sub: ['Choisissez la langue de l’interface. Les textes pas encore traduits restent en anglais.', 'Choose the language of the interface. Texts that aren’t translated yet stay in English.'],
        inUse: ['Active', 'In use'],
        ready: ['Prête', 'Ready'],
        readyOn: ['Prête · traduite le {date} · {n} textes', 'Ready · translated on {date} · {n} texts'],
        use: ['Utiliser', 'Use'],
        useNow: ['Utiliser maintenant', 'Use now'],
        useAnyway: ['Utiliser quand même', 'Use anyway'],
        rtl: ['De droite à gauche', 'Right to left'],
        newMeta: ['Pas encore traduite · environ {n} textes · {t}', 'Not translated yet · about {n} texts · {t}'],
        partialMeta: ['Traduite à {pct} % · il reste {n} textes', '{pct}% translated · {n} texts left'],
        underMin: ['moins d’une minute', 'under a minute'],
        aboutMin: ['environ {m} min', 'around {m} min'],
        start: ['Démarrer la traduction', 'Start translation'],
        resume: ['Reprendre la traduction', 'Resume translation'],
        retryMissing: ['Réessayer les textes manquants', 'Retry the missing texts'],
        pause: ['Mettre en pause', 'Pause'],
        pausing: ['Mise en pause…', 'Pausing…'],
        translating: ['Traduction en cours…', 'Translating…'],
        counts: ['{done} sur {total} textes', '{done} of {total} texts'],
        left: ['environ {m} min restantes', 'about {m} min left'],
        estimating: ['estimation…', 'estimating…'],
        paused: ['En pause à {pct} %', 'Paused at {pct}%'],
        stopped: ['Arrêtée à {pct} %', 'Stopped at {pct}%'],
        areaCore: ['Menus, discussions et réglages', 'Menus, chat and settings'],
        areaMore: ['Écrans avancés et plugins', 'Advanced screens and plugins'],
        areaPhrases: ['Messages et détails', 'Messages and details'],
        essentials: ['L’essentiel est prêt. Le reste continue en arrière-plan : ce qui n’est pas encore traduit s’affiche en anglais.', 'The essentials are ready. The rest keeps going in the background: texts not translated yet show in English.'],
        gaps: ['{n} textes n’ont pas pu être traduits et resteront en anglais.', '{n} texts couldn’t be translated and will stay in English.'],
        model: ['Modèle', 'Model'],
        usesModel: ['Modèle : {model}', 'Model: {model}'],
        more: ['Plus d’actions', 'More actions'],
        again: ['Retraduire depuis zéro', 'Translate again from scratch'],
        remove: ['Supprimer cette langue', 'Remove this language'],
        removeActive: ['Choisissez une autre langue d’abord', 'Switch to another language first'],
        addLang: ['Ajouter une langue', 'Add a language'],
        search: ['Rechercher une langue, ex. Español', 'Search a language, e.g. Español'],
        popular: ['Les plus courantes', 'Most common'],
        allLangs: ['Toutes les langues (ISO 639-1)', 'All languages (ISO 639-1)'],
        noMatch: ['Aucune langue ne correspond. Essayez le nom en anglais.', 'No language matches. Try the English name.'],
        added: ['Déjà ajoutée', 'Already added'],
        advanced: ['Avancé', 'Advanced'],
        modelLabel: ['Modèle de traduction', 'Translation model'],
        modelHint: ['Les traductions sont générées par ce modèle, puis gardées sur cet ordinateur. Elles s’appliquent à l’interface de Kybernos et à celle de DSH.', 'Translations are generated by this model, then kept on this computer. They apply to Kybernos and to DSH’s own screens.'],
        noModels: ['Aucun modèle détecté. Configurez un fournisseur dans settings.yaml pour activer la traduction.', 'No model detected. Set up a provider in settings.yaml to enable translation.'],
        noDsh: ['Les écrans de DSH ne peuvent pas être traduits avec cette version : seul Kybernos le sera.', 'DSH’s own screens can’t be translated with this version: only Kybernos will be.'],
        zhNative: ['DSH traduit déjà ses écrans dans cette langue : seul Kybernos reste à traduire.', 'DSH already translates its own screens in this language: only Kybernos is left to translate.'],
        showDetails: ['Afficher les détails', 'Show details'],
        hideDetails: ['Masquer les détails', 'Hide details'],
        chooseModel: ['Choisir un autre modèle', 'Choose another model'],
        errTitle: ['La traduction s’est arrêtée.', 'The translation stopped.'],
        errKey: ['Le modèle de traduction a besoin d’une clé d’API qui n’est pas définie sur cet ordinateur.', 'The translation model needs an API key that isn’t set on this computer.'],
        errAuth: ['Le fournisseur a refusé la clé d’API de ce modèle.', 'The provider rejected this model’s API key.'],
        errNoModel: ['Ce modèle n’est pas disponible dans votre configuration.', 'This model isn’t available in your setup.'],
        errRate: ['Le fournisseur limite le nombre de requêtes. Attendez une minute, puis reprenez.', 'The provider is limiting requests. Wait a minute, then resume.'],
        errSlow: ['Le modèle a mis trop de temps à répondre.', 'The model took too long to answer.'],
        errHost: ['Impossible de joindre l’hôte Kybernos. DSH est-il toujours lancé ?', 'Can’t reach the Kybernos host. Is DSH still running?'],
        errOld: ['Le plugin Kybernos principal est trop ancien pour traduire. Mettez-le à jour.', 'The main Kybernos plugin is too old to translate. Update it.'],
        errStore: ['L’espace de stockage du navigateur est plein.', 'The browser’s storage is full.'],
        kept: ['Ce qui est déjà traduit est conservé : « Reprendre » repart d’où ça s’est arrêté.', 'What’s already translated is kept: Resume starts where it stopped.'],
        confirmRemove: ['Supprimer', 'Remove'],
        cancel: ['Annuler', 'Cancel'],
        removeAsk: ['Supprimer la traduction « {name} » de cet ordinateur ?', 'Remove the “{name}” translation from this computer?'],
        manageLink: ['Gérer les langues et les traductions ici', 'Manage languages and translations here'],
        helpBtn: ['Comment ça marche', 'How it works'],
        helpTitle: ['Traduire l’interface en trois étapes', 'Translate the interface in three steps'],
        mockCaption: ['Aperçu animé des trois étapes', 'Animated preview of the three steps'],
        mockNew: ['Pas encore traduite', 'Not translated yet'],
        step1Body: ['Ouvrez « Ajouter une langue » et choisissez-en une dans la liste ISO.', 'Open “Add a language” and pick one from the ISO list.'],
        step2Body: ['La barre de progression montre l’avancement. Vous pouvez mettre en pause et reprendre à tout moment.', 'The progress bar shows how far it is. You can pause and resume at any time.'],
        step3Body: ['Kybernos et DSH passent dans cette langue. Pour revenir en arrière, utilisez une autre langue.', 'Kybernos and DSH switch to this language. To go back, use another language.'],
        helpNote: ['Les textes pas encore traduits restent en anglais. C’est le même choix que dans Réglages › Général › Langue.', 'Texts not translated yet stay in English. It is the same choice as in Settings › General › Language.'],
        tipHelp: ['Afficher ou masquer l’aide', 'Show or hide the help'],
        tipStart: ['Traduit l’interface dans cette langue avec le modèle choisi dans « Avancé ». Vous pouvez mettre en pause à tout moment.', 'Translates the interface into this language with the model chosen in “Advanced”. You can pause at any time.'],
        tipResume: ['Reprend là où ça s’est arrêté : ce qui est déjà traduit est conservé.', 'Continues where it stopped: what is already translated is kept.'],
        tipRetry: ['Ne retraduit que les textes qui ont échoué.', 'Translates only the texts that failed.'],
        tipPause: ['S’arrête après les textes en cours. Rien n’est perdu : « Reprendre » continue.', 'Stops after the texts in progress. Nothing is lost: Resume continues.'],
        tipUse: ['Passe Kybernos et DSH dans cette langue. La page se recharge.', 'Switches Kybernos and DSH to this language. The page reloads.'],
        tipUseNow: ['L’essentiel est traduit : utilisez la langue maintenant, le reste continue en arrière-plan.', 'The essentials are translated: use the language now while the rest continues in the background.'],
        tipInUse: ['La langue que Kybernos et DSH utilisent en ce moment.', 'The language Kybernos and DSH are using right now.'],
        tipRtl: ['Cette langue se lit de droite à gauche : toute la mise en page est inversée.', 'This language reads right to left: the whole layout is mirrored.'],
        tipProgress: ['Textes traduits jusqu’ici.', 'Texts translated so far.'],
        tipAreaCore: ['Les écrans de tous les jours : menus, navigation, discussions et réglages.', 'The everyday screens: menus, navigation, chat and settings.'],
        tipAreaMore: ['Les écrans moins courants et les pages des plugins.', 'Less common screens and plugin pages.'],
        tipAreaPhrases: ['Les messages longs et les explications détaillées.', 'Long messages and detailed explanations.'],
        tipEstimate: ['Estimation d’après le nombre de textes et la vitesse habituelle du modèle.', 'Estimated from the number of texts and the model’s usual speed.'],
        tipAdd: ['Choisissez n’importe quelle langue de la liste ISO 639-1.', 'Pick any language from the ISO 639-1 list.'],
        tipAddLang: ['Ajouter {name} ({code})', 'Add {name} ({code})'],
        tipModel: ['Le modèle qui écrit les traductions. N’importe quel modèle configuré dans DSH convient ; un modèle rapide suffit.', 'The model that writes the translations. Any model configured in DSH works; a fast one is enough.'],
        tipAdvanced: ['Choix du modèle de traduction.', 'Translation model choice.'],
        tipAgain: ['Efface cette traduction et recommence depuis zéro.', 'Discards this translation and starts over from scratch.'],
        tipRemove: ['Supprime cette langue et ses traductions de cet ordinateur.', 'Removes this language and its translations from this computer.'],
        tipChooseModel: ['Ouvre « Avancé » pour choisir un autre modèle.', 'Opens “Advanced” so you can pick another model.'],
        tipDetails: ['Affiche le message technique renvoyé par le modèle.', 'Shows the technical message the model returned.'],
      }
      const PAGE_SOURCES = Object.keys(S).map((k) => S[k][0])

      // ── UI language of THIS page: French, English, or the translated language
      // itself (looked up by its French text, like any kbf phrase) ───────────
      const uiLang = () => {
        try { return String(typeof window.__KB_LANG_RESOLVE__ === 'function' ? window.__KB_LANG_RESOLVE__() : 'en') } catch (e) { return 'en' }
      }
      const L = (key, params) => {
        const pair = S[key]
        if (pair === undefined) return String(key) // a typo must show, not blank the whole page
        const l = uiLang()
        let out = pair[1]
        if (l === 'kybernos') out = pair[0]
        else if (l !== 'en') {
          const a = window.__KB_I18N_ACTIVE__
          const d = a !== null && a !== undefined && a.dict !== null && typeof a.dict === 'object' ? a.dict : null
          if (d !== null && typeof d[pair[0]] === 'string') out = d[pair[0]]
        }
        if (params !== undefined) out = out.replace(/\{(\w+)\}/g, (m, k) => (params[k] !== undefined ? String(params[k]) : m))
        return out
      }

      // ── Kybernos sources ─────────────────────────────────────────────────
      // Memoized per pair of published tables: `isComplete` runs for every
      // language on every render, and the tables only change on a plugin reload.
      let _kb = null
      let _kbFrom = null
      const kbSources = () => {
        const kbT = typeof window !== 'undefined' ? window.__KB_T__ : null
        if (kbT === null || kbT === undefined || typeof kbT !== 'object') return null
        const from = window.__KB_FR_EN__
        if (_kb !== null && _kbFrom !== null && _kbFrom.t === kbT && _kbFrom.f === from) return _kb
        const seen = new Set()
        const out = []
        const push = (id, text, area) => {
          if (seen.has(id) || id.length === 0 || wireOf('kb', id).length > WIRE_MAX) return
          seen.add(id)
          out.push({ wire: wireOf('kb', id), id, text, store: 'kb', area })
        }
        for (const k of Object.keys(kbT)) {
          const entry = kbT[k]
          push(k, entry !== null && entry !== undefined && typeof entry.kybernos === 'string' && entry.kybernos.length > 0 ? entry.kybernos : k, 'core')
        }
        // The kbf phrases (KB_FR_EN keys are French SENTENCES) and this page's
        // own strings: the sentence is the key and the source, so kbf renders it
        // in the target language too.
        for (const p of PAGE_SOURCES) push(p, p, 'core')
        if (from !== null && from !== undefined && typeof from === 'object') {
          for (const phrase of Object.keys(from)) push(phrase, phrase, 'phrases')
        }
        if (out.length === 0) return null
        _kb = out
        _kbFrom = { t: kbT, f: from }
        return _kb
      }

      // ── DSH sources ──────────────────────────────────────────────────────
      let locSvc = null // DSH's locale service, set by apply()
      // The always-on language RUNTIME (published by @local/kybernos) owns every DSH
      // registration and the follow of DSH's selector: it has to keep working when
      // this optional plugin is switched off. Here we only ask it.
      const runtime = () => {
        const r = typeof window !== 'undefined' ? window.__KB_LANG_RUNTIME__ : null
        return r !== undefined && r !== null && r.version === 1 ? r : null
      }
      const ours = { has: (id) => { const r = runtime(); return r !== null && r.ours.has(id) } } // languages registered in DSH by the runtime
      const dshNative = (lang) => {
        try {
          if (locSvc === null || ours.has(lang)) return false
          return locSvc.getLocale().locales.some((l) => String(l.id).toLowerCase() === lang)
        } catch (e) { return false }
      }
      let _dsh = null
      let _dshRev = null
      // null = DSH's dictionaries can't be read in this version.
      const dshSources = () => {
        try {
          if (locSvc === null || typeof locSvc.getLocale !== 'function') return null
          const dicts = locSvc.dicts
          if (!(dicts instanceof Map)) return null
          const rev = locSvc.getLocale().revision
          if (_dsh !== null && _dshRev === rev) return _dsh
          const out = []
          for (const [ns, locales] of dicts) {
            const en = locales instanceof Map ? locales.get('en') : null
            if (en === null || en === undefined || typeof en !== 'object') continue
            const area = CORE_NS.test(ns) ? 'core' : 'more'
            for (const key of Object.keys(en)) {
              const text = en[key]
              const id = ns + '::' + key
              if (typeof text !== 'string' || !/\p{L}/u.test(text) || wireOf('dsh', id).length > WIRE_MAX) continue
              out.push({ wire: wireOf('dsh', id), id, text, store: 'dsh', area })
            }
          }
          if (out.length === 0) return null
          _dsh = out
          _dshRev = rev
          return _dsh
        } catch (e) { return null }
      }

      // The plan of one language: everything a complete translation contains.
      const buildPlan = (lang) => {
        const kb = kbSources()
        if (kb === null) return null
        // DSH's half is only worth translating when the runtime is there to register it.
        const dsh = dshNative(lang) || runtime() === null ? null : dshSources()
        const items = dsh === null ? kb : kb.concat(dsh)
        const areas = {}
        for (const a of AREAS) areas[a] = { total: 0 }
        for (const it of items) areas[it.area].total += 1
        return { items, total: items.length, areas, dshAvailable: dsh !== null, dshNative: dshNative(lang) }
      }

      // A language is usable as is when it is built in, or when a finished run
      // covered at least as many strings as the plan has today. A plugin update
      // that adds strings makes the language incomplete again; the next run
      // translates just those.
      //
      // A handful of strings is not "grown": DSH namespaces that register late make
      // the total move by a few between sessions, and a finished language must not
      // flip to "99 %" for that. Past the tolerance (0.5 %, at least 5), it is
      // incomplete again and "Resume" translates only what was added.
      const COMPLETE_TOLERANCE = (total) => Math.max(5, Math.floor(total * 0.005))
      const isComplete = (lang) => {
        if (isBuiltIn(lang)) return true
        const meta = metaRead(lang)
        if (meta.complete !== true) return false
        const plan = buildPlan(lang)
        return plan === null || (typeof meta.total === 'number' && meta.total >= plan.total - COMPLETE_TOLERANCE(plan.total))
      }

      // ══════════════════════════════════════════════════════════════════════
      // 4. THE ENGINE
      // ══════════════════════════════════════════════════════════════════════

      // The host's translation models, from the catalog (nothing guessed here).
      const fetchModels = async () => {
        try {
          const res = await fetch('/kybernos/i18n-models', { credentials: 'same-origin' })
          if (res.ok) {
            const json = await res.json()
            if (json !== null && typeof json === 'object' && json.ok === true && Array.isArray(json.models)) {
              return { models: json.models, preferred: typeof json.default === 'string' ? json.default : null }
            }
          }
        } catch (e) { /* host route absent or unreachable: empty list */ }
        return { models: [], preferred: null }
      }

      // One batch through the host (POST /kybernos/i18n-translate). The host
      // resolves model and key; the browser never talks to a provider (CORS, and
      // the key lives in the host environment). Never throws: `{ ok, … }`.
      const hostTranslate = async (lang, batch, route, signal, source) => {
        try {
          const res = await fetch('/kybernos/i18n-translate', {
            method: 'POST', credentials: 'same-origin', signal,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              lang, langName: langInfo(lang).english, source,
              provider: route !== null && route !== undefined ? route.provider : undefined,
              model: route !== null && route !== undefined ? route.model : undefined,
              batch,
            }),
          })
          if (res.status === 404) return { ok: false, error: 'ROUTE_ABSENT : route hôte absente — mettez à jour le plugin Kybernos principal' }
          if (!res.ok) return { ok: false, error: 'HTTP_' + res.status + ' : route hôte' }
          const json = await res.json()
          if (json !== null && typeof json === 'object' && json.ok === true && json.translations !== null && typeof json.translations === 'object') {
            return { ok: true, translations: json.translations, provider: json.provider, model: json.model }
          }
          return { ok: false, error: json !== null && typeof json === 'object' && typeof json.error === 'string' && json.error !== '' ? json.error : 'réponse inattendue de la route hôte' }
        } catch (e) {
          if (signal !== null && signal !== undefined && signal.aborted) return { ok: false, aborted: true, error: 'annulée' }
          return { ok: false, error: 'UNREACHABLE : route hôte injoignable — ' + String((e !== null && e !== undefined && e.message) || e) }
        }
      }

      // 40 = the host route's ceiling (I18N_BATCH_MAX in the plugin). Batches are
      // ALSO capped in characters: the expected output grows with the source, and
      // a truncated JSON is rejected whole. 2 600 source characters fit in 4 000
      // output tokens.
      const BATCH_SIZE = 40
      const CHAR_BUDGET = 2600
      // Calls in flight at once. The host route is stateless; 3 cuts a 5 000-string
      // run from about 30 minutes to about 10 without tripping provider limits.
      const CONCURRENCY = 3
      // Stop after this many failed batches in a row: the cause is then the model
      // or the host, not one unlucky batch, and going on would only burn calls.
      // Whatever was translated stays cached, so a retry resumes.
      const MAX_FAILED_IN_A_ROW = 3
      // The 2nd pass re-sends what the 1st left untranslated (a model that skipped
      // keys, a rejected variable, a transient failure).
      const PASSES = 2
      const SECONDS_PER_BATCH = 10 // a prior, until a run has measured its own

      const planBatches = (items) => {
        const batches = []
        let cur = []
        let curLen = 0
        for (const it of items) {
          const len = it.text.length
          if (cur.length >= BATCH_SIZE || (cur.length > 0 && curLen + len > CHAR_BUDGET)) { batches.push(cur); cur = []; curLen = 0 }
          cur.push(it)
          curLen += len
        }
        if (cur.length > 0) batches.push(cur)
        return batches
      }
      const estimateMinutes = (itemCount) => Math.max(1, Math.round((itemCount / 32) * SECONDS_PER_BATCH / CONCURRENCY / 60))

      // The engine. `done` counts strings that really HAVE a translation — a failed
      // batch never counts as progress. Progress reports per area, so the page can
      // say "usable" as soon as the core area is complete. Resolves
      // `{ ok:true, done, total, missing }`, `{ ok:false, paused:true, … }` or
      // `{ ok:false, error, done, total }`.
      const runTranslation = async (lang, opts) => {
        const plan = buildPlan(lang)
        if (plan === null) return { ok: false, error: 'SOURCE_MISSING : chaînes sources introuvables — mettez à jour le plugin Kybernos principal', done: 0, total: 0 }
        const stores = { kb: i18nRead(lang), dsh: dshRead(lang) }
        const has = (it) => typeof stores[it.store][it.id] === 'string'
        const counts = {}
        for (const a of AREAS) counts[a] = { done: 0, total: plan.areas[a].total }
        let done = 0
        for (const it of plan.items) if (has(it)) { counts[it.area].done += 1; done += 1 }
        const startedWith = done
        const startedAt = Date.now()
        const report = (model) => {
          if (opts.onProgress) opts.onProgress({ done, total: plan.total, areas: JSON.parse(JSON.stringify(counts)), model, essentials: counts.core.done >= counts.core.total, startedWith, elapsedMs: Date.now() - startedAt })
        }
        // Writes are throttled: stringifying ~500 KB after every batch is wasted work.
        let dirty = false
        let lastFlush = 0
        // What the browser actually kept: a write it refused must not show as progress.
        let persisted = done
        const flush = (force) => {
          if (!dirty || (!force && Date.now() - lastFlush < 1500)) return true
          const ok = writeJson(I18N_STORE_PREFIX + lang, stores.kb)
            && (plan.dshAvailable === false || writeJson(I18N_DSH_PREFIX + lang, stores.dsh))
          if (ok) {
            writeJson(I18N_META_PREFIX + lang, { complete: done >= plan.total, total: plan.total, done, essentials: counts.core.done >= counts.core.total, at: Date.now() })
            dirty = false
            lastFlush = Date.now()
            persisted = done
          }
          return ok
        }
        let route = opts.route
        let model = null
        let lastError = null
        let stop = null
        report(model)
        for (let pass = 0; pass < PASSES && stop === null; pass++) {
          // Areas in order: a language becomes usable as early as possible.
          const missing = []
          for (const a of AREAS) for (const it of plan.items) if (it.area === a && !has(it)) missing.push(it)
          if (missing.length === 0) break
          const queue = planBatches(missing)
          let next = 0
          let failedInARow = 0
          const worker = async () => {
            while (stop === null) {
              if (opts.signal.aborted) { stop = { paused: true }; return }
              const i = next
              next += 1
              if (i >= queue.length) return
              const batch = queue[i]
              const wire = {}
              for (const it of batch) wire[it.wire] = it.text
              const result = await hostTranslate(lang, wire, route, opts.signal, 'fr')
              if (result.aborted) { if (stop === null) stop = { paused: true }; return }
              if (!result.ok) {
                lastError = result.error
                failedInARow += 1
                if (failedInARow >= MAX_FAILED_IN_A_ROW && stop === null) stop = { error: lastError }
                continue
              }
              failedInARow = 0
              // Keep the model the host actually used (it may have fallen back
              // from the requested one) so the next batches do not retry a dead route.
              if (typeof result.provider === 'string' && typeof result.model === 'string') {
                route = { provider: result.provider, model: result.model }
                model = result.provider + '/' + result.model
              }
              for (const it of batch) {
                const v = result.translations[it.wire]
                if (typeof v === 'string' && v !== '' && !has(it)) {
                  stores[it.store][it.id] = v
                  counts[it.area].done += 1
                  done += 1
                  dirty = true
                }
              }
              if (!flush(false) && stop === null) stop = { error: 'STORAGE_FULL : stockage local plein ou indisponible' }
              report(model)
            }
          }
          await Promise.all(Array.from({ length: CONCURRENCY }, worker))
        }
        const flushed = flush(true)
        if (stop !== null && stop.paused) return { ok: false, paused: true, done, total: plan.total }
        if (!flushed && (stop === null || stop.error === undefined)) stop = { error: 'STORAGE_FULL : stockage local plein ou indisponible' }
        if (stop !== null && stop.error !== undefined) return { ok: false, error: stop.error, done: persisted, total: plan.total }
        if (done === 0) return { ok: false, error: lastError || 'aucune chaîne traduite', done, total: plan.total }
        return { ok: true, done, total: plan.total, missing: plan.total - done }
      }

      // A readable cause for the error the host (or the engine) reported.
      // Returns a key of S; the raw text stays available under "Show details".
      const friendlyError = (raw) => {
        const e = String(raw || '')
        if (/MISSING_CREDENTIAL|INVALID_CREDENTIAL/.test(e)) return 'errKey'
        if (/\bAUTH\b|ACCOUNT_QUOTA|\bQUOTA\b/.test(e)) return 'errAuth'
        if (/NO_ADAPTER|aucun modele disponible/.test(e)) return 'errNoModel'
        if (/RATE_LIMIT/.test(e)) return 'errRate'
        if (/TIMEOUT/.test(e)) return 'errSlow'
        if (/UNREACHABLE/.test(e)) return 'errHost'
        if (/ROUTE_ABSENT|SOURCE_MISSING/.test(e)) return 'errOld'
        if (/STORAGE_FULL/.test(e)) return 'errStore'
        return 'errTitle'
      }

      // ── The run (outlives the page) ──────────────────────────────────────
      // ONE translation run per page load, kept OUT of the React component: the
      // page can be left, the run goes on, and coming back re-attaches to it. A
      // second start is refused while one runs (two runs would race on the same
      // cache key and double the LLM bill).
      let run = { state: 'idle', lang: null, done: 0, total: 0, areas: null, model: null, error: null, missing: 0, essentials: false, startedWith: 0, elapsedMs: 0 }
      let runControl = null
      const runListeners = new Set()
      const setRun = (patch) => {
        run = Object.assign({}, run, patch)
        for (const fn of Array.from(runListeners)) { try { fn(run) } catch (e) { /* a dead listener must not stop the run */ } }
      }
      const subscribeRun = (fn) => { runListeners.add(fn); return () => { runListeners.delete(fn) } }
      const startRun = (lang, route) => {
        if (run.state === 'running' || run.state === 'pausing') return false
        registryAdd(lang)
        runControl = new AbortController()
        setRun({ state: 'running', lang, done: 0, total: 0, areas: null, model: route !== null && route !== undefined ? route.model : null, error: null, missing: 0, essentials: false, startedWith: 0, elapsedMs: 0 })
        runTranslation(lang, {
          route, signal: runControl.signal,
          onProgress: (p) => setRun({ done: p.done, total: p.total, areas: p.areas, essentials: p.essentials, startedWith: p.startedWith, elapsedMs: p.elapsedMs, model: p.model !== null && p.model !== undefined ? p.model : run.model }),
        }).then((result) => {
          if (result.paused) return setRun({ state: 'paused', done: result.done, total: result.total })
          if (!result.ok) return setRun({ state: 'failed', error: result.error || 'échec inconnu', done: result.done, total: result.total })
          setRun({ state: result.missing > 0 ? 'partial' : 'done', done: result.done, total: result.total, missing: result.missing })
        }).catch((e) => setRun({ state: 'failed', error: String((e !== null && e !== undefined && e.message) || e) }))
        return true
      }
      const pauseRun = () => {
        if (run.state !== 'running' || runControl === null) return
        setRun({ state: 'pausing' })
        try { runControl.abort() } catch (e) { /* already finished */ }
      }

      // ══════════════════════════════════════════════════════════════════════
      // 5. DIRECTION, ACTIVATION AND THE DSH LANGUAGE PACK
      // ══════════════════════════════════════════════════════════════════════

      // Sets reading direction and language on <html>. Idempotent — called at
      // boot (reload) and on every language change, so the CSS cascade
      // (`html[dir="rtl"]`) and the Platform API follow.
      const appliquerDirection = (lang) => {
        try {
          const doc = document.documentElement
          doc.setAttribute('dir', isRtlLang(lang) ? 'rtl' : 'ltr')
          doc.setAttribute('lang', lang === 'kybernos' ? 'fr' : String(lang))
        } catch (e) { /* no document (render outside a browser) */ }
      }

      // Guard for `lang`: the DSH shell (dsh-client-locale) ALSO sets lang on
      // <html>, after boot — it overwrites 'ar' with the shell locale. While a
      // non-native Kybernos language is active we take it back; for 'kybernos'
      // we hand it back to the shell.
      let _langGardien = null
      const surveillerLang = () => {
        if (typeof MutationObserver === 'undefined') return
        const actif = (typeof window !== 'undefined' && window.__KB_I18N_ACTIVE__ ? window.__KB_I18N_ACTIVE__.lang : null) || 'kybernos'
        if (actif === 'kybernos' || actif === 'en') {
          if (_langGardien !== null) { try { _langGardien.disconnect() } catch (e) { /* */ } _langGardien = null }
          return
        }
        if (_langGardien !== null) return
        _langGardien = new MutationObserver(() => {
          const courant = (window.__KB_I18N_ACTIVE__ || {}).lang || 'kybernos'
          const attendu = courant === 'kybernos' ? 'fr' : String(courant)
          if (document.documentElement.getAttribute('lang') !== attendu) document.documentElement.setAttribute('lang', attendu)
        })
        _langGardien.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
      }

      // Apply the active language: exposes the translations on window so the
      // main plugin can read them.
      const applyLanguage = (lang) => {
        try {
          const dict = i18nRead(lang)
          window.__KB_I18N_ACTIVE__ = { lang, dict, rtl: isRtlLang(lang) }
          appliquerDirection(lang)
          surveillerLang()
          window.dispatchEvent(new CustomEvent('kybernos-lang-change', { detail: { lang, dict, rtl: isRtlLang(lang) } }))
        } catch (e) { /* silent */ }
      }

      const readActiveLang = () => {
        try {
          const raw = localStorage.getItem('kybernos.theme.lang')
          if (raw !== null) return raw
        } catch (e) { /* fallback */ }
        // (01/10) Without an explicit Kybernos choice, follow the shell when it
        // speaks English: a user who sets DSH to English must read English tabs,
        // not the French mockup by default (KB_T is fully bilingual).
        try {
          const loc = String(document.documentElement.getAttribute('lang') || '').split(/[-_]/)[0].toLowerCase()
          if (loc === 'en') return 'en'
        } catch (e2) { /* no document */ }
        return 'kybernos'
      }
      const writeActiveLang = (lang) => {
        try { localStorage.setItem('kybernos.theme.lang', lang) } catch (e) { /* quota */ }
      }

      // Activating = remember + expose + tell DSH + RELOAD. The screens (main
      // plugin included) read the language when they render and no global
      // re-render signal exists — the reload applies direction (rtl) and the
      // cached translations everywhere at once. DSH's own locale is switched too
      // (it persists the choice): a language DSH doesn't know sends it back to en.
      const activateLanguage = (langId) => {
        writeActiveLang(langId)
        applyLanguage(langId)
        try {
          registerDshPack(langId)
          // The built-ins keep DSH in English (the main plugin deliberately does not
          // force its `kybernos` DSH language); only a language we registered, or
          // one DSH ships itself, is switched to by name.
          const target = isBuiltIn(langId) ? 'en' : (ours.has(langId) || dshNative(langId) ? langId : 'en')
          if (locSvc !== null && typeof locSvc.setLocale === 'function') locSvc.setLocale(target)
        } catch (e) { /* the locale is not registered: Kybernos alone follows */ }
        window.setTimeout(() => { try { location.reload() } catch (e) { /* silent */ } }, 300)
      }

      // Registers ONE translated language in DSH's own locale service, so its screens
      // follow — delegated to the runtime (see above). Called at activation for a
      // language translated during THIS page session: it was not registered at boot,
      // and DSH can only switch to a registered language. Boot-time registration of
      // every language, and following DSH's selector, are the runtime's own job.
      const registerDshPack = (id) => { const r = runtime(); return r === null ? null : r.registerPack(id) }

      // ══════════════════════════════════════════════════════════════════════
      // 6. LIVE TRANSLATION — settings pages written with hardcoded text
      // ══════════════════════════════════════════════════════════════════════
      //
      // Many settings pages carry their text in the code (French in some
      // plugins, English in others), outside any table, so a run can't know them.
      // While a translated language is active, text that appears in a settings
      // page and has no translation yet is queued, translated through the same
      // host route (source: auto), cached under `kybernos.i18n.live.<lang>`, and
      // swapped in place. The first visit to a page shows the original for a
      // moment; every later one is instant. The chat, session titles and other
      // content are never touched: only settings pages, menus and the sidebar
      // footer (the account menu and the mobile-app button are rendered by another
      // plugin, with its own French/English table). Dialogs are left out on
      // purpose: they quote session and file names.
      const LIVE_ROOTS = '[data-slot="settings.section"],[role="menu"],[data-slot="sidebar.footer.action"]'
      const LIVE_BATCH = 30
      const LIVE_DELAY_MS = 500
      // Two calls in flight: a settings page can carry 100+ new strings.
      const LIVE_PARALLEL = 2
      const LIVE_MAX_PER_PAGE = 800
      const LIVE_COOLDOWN_MS = 5 * 60 * 1000

      // Is this text interface copy worth translating? Not identifiers, paths,
      // versions, e-mails, slugs, brand-cased names or text already translated.
      const isLiveCandidate = (raw) => {
        const t = String(raw).trim()
        if (t.length < 2 || t.length > 400) return false
        if (!/\p{Script=Latin}{2}/u.test(t)) return false
        if (t.indexOf('⟦') >= 0) return false
        if (/^[\w.+-]+@[\w.-]+$/.test(t)) return false
        if (/^(https?:|www\.|\/|~|\.{1,2}\/|[A-Za-z]:\\)/.test(t)) return false
        if (!/\s/.test(t)) {
          if (/[\d_/\\@:#=]/.test(t)) return false
          if (/\p{Ll}\p{Lu}/u.test(t)) return false
          if (/^\p{Lu}{2,}$/u.test(t)) return false
          if (t.indexOf('-') >= 0 || /\.\p{L}/u.test(t)) return false
        }
        return true
      }

      const startLiveLayer = (ctx) => {
        if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return
        ctx.effect(() => {
          const lang = readActiveLang()
          if (isBuiltIn(lang)) return () => {}
          let live = liveRead(lang)
          // Everything already translated by the run counts as "done": its text
          // must never be sent again.
          const known = new Set()
          for (const d of [i18nRead(lang), dshRead(lang), live]) for (const k of Object.keys(d)) if (typeof d[k] === 'string') known.add(d[k])
          const queued = new Set()
          let pending = []
          let timer = null
          let scanTimer = null
          let sentThisPage = 0
          let failures = 0
          let coolUntil = 0
          const saved = () => { try { return localStorage.getItem(I18N_MODEL_KEY) } catch (e) { return null } }

          let inFlight = 0
          const flush = async () => {
            timer = null
            if (pending.length === 0 || Date.now() < coolUntil) return
            if (inFlight >= LIVE_PARALLEL) { timer = window.setTimeout(flush, LIVE_DELAY_MS); return }
            const take = pending.splice(0, LIVE_BATCH)
            inFlight += 1
            if (pending.length > 0) timer = window.setTimeout(flush, 50)
            const wire = {}
            take.forEach((t, i) => { wire['l' + i] = t })
            // Same model the user picked on the page, when it is still offered.
            const res = await hostTranslate(lang, wire, liveRoute(), null, 'auto')
            inFlight -= 1
            if (!res.ok) {
              for (const t of take) queued.delete(t)
              failures += 1
              if (failures >= 3) { coolUntil = Date.now() + LIVE_COOLDOWN_MS; failures = 0 }
              return
            }
            failures = 0
            let changed = false
            take.forEach((t, i) => {
              const v = res.translations['l' + i]
              if (typeof v === 'string' && v !== '') { live[t] = v; known.add(v); changed = true } else queued.delete(t)
            })
            if (changed) { writeJson(I18N_LIVE_PREFIX + lang, live); scan() }
          }
          let cachedRoute = null
          const liveRoute = () => {
            if (cachedRoute !== null) return cachedRoute
            const id = saved()
            if (typeof id === 'string' && id.indexOf('/') > 0) cachedRoute = { provider: id.slice(0, id.indexOf('/')), model: id.slice(id.indexOf('/') + 1) }
            return cachedRoute
          }
          const enqueue = (t) => {
            if (queued.has(t) || sentThisPage >= LIVE_MAX_PER_PAGE) return
            queued.add(t)
            pending.push(t)
            sentThisPage += 1
            if (timer === null) timer = window.setTimeout(flush, LIVE_DELAY_MS)
          }
          // The text of a node keeps its surrounding whitespace.
          const swap = (node) => {
            const v = node.nodeValue
            if (v === null) return
            const t = v.trim()
            if (t === '') return
            const hit = live[t]
            if (typeof hit === 'string') { node.nodeValue = v.replace(t, hit); return }
            if (!known.has(t) && isLiveCandidate(t)) enqueue(t)
          }
          const swapAttr = (el, attr) => {
            const v = el.getAttribute(attr)
            if (v === null || v.trim() === '') return
            const hit = live[v.trim()]
            if (typeof hit === 'string') el.setAttribute(attr, hit)
            else if (!known.has(v.trim()) && isLiveCandidate(v)) enqueue(v.trim())
          }
          const scan = () => {
            scanTimer = null
            for (const root of document.querySelectorAll(LIVE_ROOTS)) {
              const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
              for (let n = w.nextNode(); n !== null; n = w.nextNode()) {
                const p = n.parentElement
                if (p !== null && p.closest('pre,textarea,code,script,style,[contenteditable="true"]') === null) swap(n)
              }
              for (const el of root.querySelectorAll('[placeholder],[title],[aria-label]')) for (const a of ['placeholder', 'title', 'aria-label']) swapAttr(el, a)
            }
          }
          const schedule = () => { if (scanTimer === null) scanTimer = window.setTimeout(scan, 150) }
          const observer = new MutationObserver(schedule)
          observer.observe(document.body, { childList: true, subtree: true, characterData: true })
          schedule()
          return () => {
            observer.disconnect()
            if (timer !== null) window.clearTimeout(timer)
            if (scanTimer !== null) window.clearTimeout(scanTimer)
          }
        }, 'kybernos-language: live translation of settings pages')
      }

      // ══════════════════════════════════════════════════════════════════════
      // 7. THE PAGE
      // ══════════════════════════════════════════════════════════════════════

      const fmtDate = (ms) => { try { return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) } catch (e) { return '' } }
      const fmtN = (n) => { try { return Number(n).toLocaleString() } catch (e) { return String(n) } }
      const minutesLeft = (r) => {
        const fresh = r.done - r.startedWith
        if (fresh < 40 || r.elapsedMs < 4000) return null
        const perItem = r.elapsedMs / fresh
        return Math.max(1, Math.round(((r.total - r.done) * perItem) / 60000))
      }

      // The help: an animated mini-mock of the three steps (CSS only — see the stylesheet)
      // next to the steps themselves, which light up in step with it. The mock is an
      // illustration: hidden from assistive technology behind its caption.
      function HelpPanel() {
        const step = (n, title, body) => h('li', { key: n, className: 'kbth-step s' + n },
          h('b', { 'aria-hidden': 'true' }, String(n)),
          h('div', null, h('div', { className: 'kbth-step-t' }, title), h('div', { className: 'kbth-step-b' }, body)))
        const badge = (t) => h('span', { className: 'kbth-mm-b' }, t)
        return h('section', { id: 'kbth-help', className: 'kbth-help', 'data-help': 'panel', 'aria-label': L('helpTitle') },
          h('div', { className: 'kbth-mm', role: 'img', 'aria-label': L('mockCaption') },
            h('div', { className: 'kbth-mm-bar' }, h('span', null, L('title')), h('span', { className: 'kbth-mm-hi' }, h('i', { className: 'kbth-mm-w1' }, 'Hello'), h('i', { className: 'kbth-mm-w2' }, 'Hola'))),
            h('div', { className: 'kbth-mm-row en' }, badge('EN'),
              h('div', { className: 'kbth-mm-i' }, h('span', { className: 'kbth-mm-n' }, 'English')),
              h('div', { className: 'kbth-mm-acts' }, h('span', { className: 'kbth-mm-pill en' }, L('inUse')))),
            h('div', { className: 'kbth-mm-row es' }, badge('ES'),
              h('div', { className: 'kbth-mm-i' }, h('span', { className: 'kbth-mm-n' }, 'Español'),
                h('div', { className: 'kbth-mm-st' }, h('span', { className: 't1' }, L('mockNew')), h('span', { className: 't2' }, L('translating')), h('span', { className: 't3' }, L('ready')))),
              h('div', { className: 'kbth-mm-acts' },
                h('span', { className: 'kbth-mm-go' }, L('start')), h('span', { className: 'kbth-mm-pa' }, L('pause')),
                h('span', { className: 'kbth-mm-us' }, L('use')), h('span', { className: 'kbth-mm-pill es' }, L('inUse'))),
              h('div', { className: 'kbth-mm-track' }, h('i', { className: 'kbth-mm-fill' }))),
            h('div', { className: 'kbth-mm-pick' }, h('span', { className: 'kbth-mm-chip on' }, 'Español'), h('span', { className: 'kbth-mm-chip' }, 'Deutsch'), h('span', { className: 'kbth-mm-chip' }, '日本語')),
            h('div', { className: 'kbth-mm-cur' })),
          h('div', { className: 'kbth-help-text' },
            h('div', { className: 'kbth-help-h' }, L('helpTitle')),
            h('ol', { className: 'kbth-steps' }, step(1, L('addLang'), L('step1Body')), step(2, L('start'), L('step2Body')), step(3, L('use'), L('step3Body'))),
            h('div', { className: 'kbth-note' }, L('helpNote'))))
      }

      function Page() {
        const [activeLang, setActiveLang] = React.useState(readActiveLang())
        const [snap, setSnap] = React.useState(run)
        const [models, setModels] = React.useState([])
        const [selectedModel, setSelectedModel] = React.useState('')
        const [pickerOpen, setPickerOpen] = React.useState(false)
        const [query, setQuery] = React.useState('')
        const [menuFor, setMenuFor] = React.useState(null)
        const [askRemove, setAskRemove] = React.useState(null)
        const [details, setDetails] = React.useState(false)
        const [, setTick] = React.useState(0)
        // Open the first time (nothing translated yet), then as the user left it.
        const [helpOpen, setHelpOpen] = React.useState(() => {
          try { const v = localStorage.getItem(I18N_HELP_KEY); if (v === 'open') return true; if (v === 'closed') return false } catch (e) { /* storage unavailable */ }
          return managedIds().length === 0
        })
        const toggleHelp = () => {
          const next = !helpOpen
          setHelpOpen(next)
          try { localStorage.setItem(I18N_HELP_KEY, next ? 'open' : 'closed') } catch (e) { /* storage unavailable */ }
        }
        const advRef = React.useRef(null)

        React.useEffect(() => { setSnap(run); return subscribeRun(setSnap) }, [])
        React.useEffect(() => {
          let off = false
          fetchModels().then((res) => {
            if (off) return
            setModels(res.models)
            let saved = ''
            try { saved = localStorage.getItem(I18N_MODEL_KEY) || '' } catch (e) { /* storage unavailable */ }
            // A saved choice the catalog no longer has gives way to the host's pick.
            setSelectedModel(res.models.some((m) => m.id === saved) ? saved : (res.preferred || ''))
          })
          return () => { off = true }
        }, [])
        React.useEffect(() => { applyLanguage(activeLang) }, [activeLang])
        // The plan only exists once DSH has registered its dictionaries: look again shortly.
        React.useEffect(() => { const t = window.setTimeout(() => setTick((n) => n + 1), 1500); return () => window.clearTimeout(t) }, [])
        React.useEffect(() => {
          if (menuFor === null) return undefined
          const close = () => setMenuFor(null)
          document.addEventListener('click', close)
          return () => document.removeEventListener('click', close)
        }, [menuFor])

        const langs = getAvailableLangs()
        const route = () => {
          const m = models.find((x) => x.id === selectedModel)
          return m !== undefined ? { provider: m.provider, model: m.model } : null
        }
        const modelName = () => { const m = models.find((x) => x.id === selectedModel); return m !== undefined ? m.name : null }
        const activate = (id) => { setActiveLang(id); activateLanguage(id) }
        const start = (id) => { setDetails(false); startRun(id, route()) }
        const addLanguage = (id) => { registryAdd(id); setPickerOpen(false); setQuery(''); setTick((n) => n + 1) }
        const chooseModel = () => {
          if (advRef.current !== null) { advRef.current.open = true; try { advRef.current.scrollIntoView({ block: 'center' }) } catch (e) { /* no layout */ } }
        }

        // ── one row ────────────────────────────────────────────────────────
        const row = (info) => {
          const id = info.id
          const isRun = snap.lang === id && snap.state !== 'idle'
          const meta = metaRead(id)
          const plan = isBuiltIn(id) ? null : buildPlan(id)
          const complete = isComplete(id)
          const inUse = activeLang === id
          const st = isRun ? snap.state : null
          const running = st === 'running' || st === 'pausing'
          const staticDone = typeof meta.done === 'number' ? meta.done : 0
          const total = running ? (snap.total || (plan !== null ? plan.total : 0)) : (plan !== null ? plan.total : (typeof meta.total === 'number' ? meta.total : 0))
          const done = isRun ? snap.done : staticDone
          const pct = total > 0 ? Math.min(100, Math.floor(done / total * 100)) : 0
          // `meta.done` is written with every save; only a cache from before it
          // existed needs its dictionary read to know whether it holds anything.
          const hasProgress = !complete && !isBuiltIn(id) && (done > 0 || (typeof meta.done !== 'number' && Object.keys(i18nRead(id)).length > 0))
          const essentialsOk = isRun ? (snap.essentials === true) : (meta.essentials === true)
          const canUseNow = !isBuiltIn(id) && !complete && essentialsOk && !inUse

          // status line
          let metaLine
          if (id === 'kybernos' || id === 'en') metaLine = L('ready')
          else if (running) metaLine = L(st === 'pausing' ? 'pausing' : 'translating')
          else if (st === 'paused') metaLine = L('paused', { pct })
          else if (st === 'failed') metaLine = L('stopped', { pct })
          else if (complete || st === 'done') metaLine = L('readyOn', { date: fmtDate(meta.at), n: fmtN(meta.total || total) })
          else if (st === 'partial') metaLine = L('gaps', { n: fmtN(snap.missing) })
          else if (hasProgress) metaLine = L('partialMeta', { pct, n: fmtN(Math.max(0, total - done)) })
          else metaLine = L('newMeta', { n: total > 0 ? fmtN(total) : '…', t: total > 0 ? L('aboutMin', { m: estimateMinutes(total) }) : '' })

          // actions
          const acts = []
          if (inUse) acts.push(h('span', { key: 'use', className: 'kbth-pill ok', 'data-act': 'in-use', title: L('tipInUse') }, L('inUse')))
          else if (running) {
            if (canUseNow) acts.push(h('button', { key: 'now', className: 'kbth-btn', type: 'button', 'data-act': 'use-now', title: L('tipUseNow'), onClick: () => activate(id) }, L('useNow')))
            acts.push(h('button', { key: 'pause', className: 'kbth-btn', type: 'button', 'data-act': 'pause', title: L('tipPause'), disabled: st === 'pausing', onClick: pauseRun }, L(st === 'pausing' ? 'pausing' : 'pause')))
          } else if (complete || st === 'done') acts.push(h('button', { key: 'use', className: 'kbth-btn primary', type: 'button', 'data-act': 'use', title: L('tipUse'), onClick: () => activate(id) }, L('use')))
          else {
            if (canUseNow) acts.push(h('button', { key: 'now', className: 'kbth-btn', type: 'button', 'data-act': 'use-now', title: L('tipUseNow'), onClick: () => activate(id) }, L(st === 'partial' ? 'useAnyway' : 'useNow')))
            else if (st === 'partial') acts.push(h('button', { key: 'any', className: 'kbth-btn', type: 'button', 'data-act': 'use-now', title: L('tipUseNow'), onClick: () => activate(id) }, L('useAnyway')))
            acts.push(h('button', { key: 'go', className: 'kbth-btn primary', type: 'button', 'data-act': 'start', disabled: snap.state === 'running' || snap.state === 'pausing' || models.length === 0, title: models.length === 0 ? L('noModels') : (st === 'partial' ? L('tipRetry') : (hasProgress || st === 'paused' || st === 'failed') ? L('tipResume') : L('tipStart')), onClick: () => start(id) },
              st === 'partial' ? L('retryMissing') : (hasProgress || st === 'paused' || st === 'failed') ? L('resume') : L('start')))
          }
          if (!isBuiltIn(id) && !running) {
            acts.push(h('div', { key: 'menu', className: 'kbth-menu' },
              h('button', { className: 'kbth-btn quiet', type: 'button', 'data-act': 'menu', 'aria-label': L('more'), title: L('more'), 'aria-haspopup': 'menu', onClick: (e) => { e.stopPropagation(); setMenuFor(menuFor === id ? null : id) } }, '⋯'),
              menuFor === id
                ? h('div', { className: 'kbth-menu-pop', role: 'menu', onClick: (e) => e.stopPropagation() },
                    h('button', { role: 'menuitem', type: 'button', 'data-act': 'again', title: L('tipAgain'), onClick: () => { setMenuFor(null); try { localStorage.removeItem(I18N_STORE_PREFIX + id); localStorage.removeItem(I18N_DSH_PREFIX + id); localStorage.removeItem(I18N_LIVE_PREFIX + id); localStorage.removeItem(I18N_META_PREFIX + id) } catch (e2) { /* */ } start(id) } }, L('again')),
                    h('button', { role: 'menuitem', type: 'button', 'data-act': 'remove', disabled: inUse, title: inUse ? L('removeActive') : L('tipRemove'), onClick: () => { setMenuFor(null); setAskRemove(id) } }, L('remove')))
                : null))
          }

          // body: progress, errors, remove confirmation
          const body = []
          // A failure before anything was translated shows the cause only: no empty bars.
          if (running || st === 'paused' || (st === 'failed' && snap.done > 0)) {
            const mins = running ? minutesLeft(snap) : null
            body.push(h('div', { key: 'prog', className: 'kbth-prog' },
              h('div', { className: 'kbth-bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct, title: L('tipProgress') },
                h('i', { style: { width: pct + '%' } })),
              h('div', { className: 'kbth-prog-line' },
                h('span', null, L('counts', { done: fmtN(done), total: fmtN(total) })),
                h('b', { style: { fontWeight: 500 } }, running ? (mins === null ? L('estimating') : L('left', { m: mins })) : pct + ' %')),
              snap.areas !== null && snap.areas !== undefined
                ? h('div', { className: 'kbth-areas' },
                    AREAS.filter((a) => snap.areas[a].total > 0).map((a) => {
                      const ar = snap.areas[a]
                      const p = Math.min(100, Math.floor(ar.done / ar.total * 100))
                      return [
                        h('span', { key: a + 't', title: L(a === 'core' ? 'tipAreaCore' : a === 'more' ? 'tipAreaMore' : 'tipAreaPhrases') }, L(a === 'core' ? 'areaCore' : a === 'more' ? 'areaMore' : 'areaPhrases')),
                        h('div', { key: a + 'b', className: 'kbth-bar sm' + (p >= 100 ? ' done' : '') }, h('i', { style: { width: p + '%' } })),
                        h('span', { key: a + 'n', className: 'n' }, p + '%'),
                      ]
                    }))
                : null,
              running && snap.essentials ? h('div', { className: 'kbth-note' }, L('essentials')) : null))
          }
          if (st === 'failed') {
            const key = friendlyError(snap.error)
            body.push(h('div', { key: 'err', className: 'kbth-err', role: 'alert' },
              h('div', null, L(key)),
              snap.done > 0 ? h('div', { className: 'kbth-note' }, L('kept')) : null,
              h('div', { className: 'kbth-row', style: { gap: 8 } },
                h('button', { className: 'kbth-btn', type: 'button', 'data-act': 'choose-model', title: L('tipChooseModel'), onClick: chooseModel }, L('chooseModel')),
                h('button', { className: 'kbth-link', type: 'button', 'data-act': 'details', title: L('tipDetails'), onClick: () => setDetails(!details) }, L(details ? 'hideDetails' : 'showDetails'))),
              details ? h('code', null, String(snap.error)) : null))
          }
          if (st === 'partial') body.push(h('div', { key: 'gaps', className: 'kbth-note' }, L('gaps', { n: fmtN(snap.missing) })))
          if (!isBuiltIn(id) && !complete && !running && st === null && plan !== null && !hasProgress) {
            const lines = []
            if (!plan.dshAvailable && !plan.dshNative) lines.push(L('noDsh'))
            if (plan.dshNative) lines.push(L('zhNative'))
            if (modelName() !== null) lines.push(L('usesModel', { model: modelName() }))
            if (lines.length > 0) body.push(h('div', { key: 'info', className: 'kbth-note' }, lines.join(' · ')))
          }
          if (askRemove === id) {
            body.push(h('div', { key: 'rm', className: 'kbth-err', role: 'alertdialog' },
              h('div', null, L('removeAsk', { name: info.native })),
              h('div', { className: 'kbth-row', style: { gap: 8 } },
                h('button', { className: 'kbth-btn danger', type: 'button', 'data-act': 'confirm-remove', onClick: () => { dropLanguage(id); setAskRemove(null); setTick((n) => n + 1) } }, L('confirmRemove')),
                h('button', { className: 'kbth-btn', type: 'button', onClick: () => setAskRemove(null) }, L('cancel')))))
          }

          const badge = info.id === 'kybernos' ? 'FR' : info.id.toUpperCase()
          return h('div', { key: id, className: 'kbth-lang' + (inUse ? ' on' : ''), 'data-lang': id },
            h('div', { className: 'kbth-lang-top' },
              h('div', { className: 'kbth-badge', 'aria-hidden': 'true' }, badge),
              h('div', { className: 'kbth-lang-info' },
                h('div', { className: 'kbth-lang-name' },
                  h('span', { lang: id === 'kybernos' ? 'fr' : id }, info.native),
                  info.english !== info.native ? h('span', { className: 'kbth-lang-en' }, info.english) : null,
                  info.rtl ? h('span', { className: 'kbth-pill', title: L('tipRtl') }, L('rtl')) : null),
                h('div', { className: 'kbth-lang-meta', title: !complete && !running && st === null && !hasProgress && !isBuiltIn(id) ? L('tipEstimate') : undefined }, metaLine)),
              h('div', { className: 'kbth-lang-act' }, acts)),
            body)
        }

        // ── the ISO picker ─────────────────────────────────────────────────
        const taken = new Set(['kybernos', 'en', 'fr'].concat(managedIds()))
        const q = query.trim().toLocaleLowerCase()
        const all = ISO_639_1.filter((c) => c !== 'en' && c !== 'fr').map(langInfo)
        const filtered = q === '' ? all : all.filter((i) => (i.id + ' ' + i.native + ' ' + i.english).toLocaleLowerCase().indexOf(q) >= 0)
        filtered.sort((a, b) => a.english.localeCompare(b.english))
        const isoBtn = (i) => h('button', { key: i.id, type: 'button', className: 'kbth-iso-i', 'data-iso': i.id, disabled: taken.has(i.id), title: taken.has(i.id) ? L('added') : L('tipAddLang', { name: i.english, code: i.id }), onClick: () => addLanguage(i.id) },
          h('b', { lang: i.id }, i.native), i.english !== i.native ? h('small', null, i.english) : null, h('code', null, i.id))
        const picker = pickerOpen
          ? h('div', { className: 'kbth-add-body' },
              h('input', { className: 'kbth-input', type: 'search', autoFocus: true, placeholder: L('search'), value: query, 'aria-label': L('search'), onChange: (e) => setQuery(e.target.value) }),
              q === '' ? h('div', { className: 'kbth-sec-t' }, L('popular')) : null,
              q === '' ? h('div', { className: 'kbth-chips' }, POPULAR.map(langInfo).map((i) => h('button', { key: i.id, type: 'button', className: 'kbth-chip', 'data-iso': i.id, title: taken.has(i.id) ? L('added') : L('tipAddLang', { name: i.english, code: i.id }), disabled: taken.has(i.id), onClick: () => addLanguage(i.id) }, i.native))) : null,
              h('div', { className: 'kbth-sec-t' }, L('allLangs')),
              filtered.length > 0 ? h('div', { className: 'kbth-iso' }, filtered.map(isoBtn)) : h('div', { className: 'kbth-note' }, L('noMatch')))
          : null

        return h('div', { className: 'kbth-page' },
          h('div', { className: 'kbth-main' },
            h('div', { className: 'kbth-head' },
              h('div', { className: 'kbth-head-row' },
                h('div', { className: 'kbth-title' }, L('title')),
                h('button', { className: 'kbth-help-btn', type: 'button', 'data-act': 'help', 'aria-expanded': helpOpen ? 'true' : 'false', 'aria-controls': 'kbth-help', title: L('tipHelp'), onClick: toggleHelp },
                  h('span', { className: 'kbth-help-q', 'aria-hidden': 'true' }, '?'), L('helpBtn'))),
              h('div', { className: 'kbth-sub' }, L('sub'))),
            helpOpen ? h(HelpPanel, null) : null,
            h('div', { className: 'kbth-sec' },
              h('div', { className: 'kbth-langs' }, langs.map(row)),
              h('div', { className: 'kbth-add' },
                h('button', { className: 'kbth-add-h', type: 'button', 'data-act': 'add-language', title: L('tipAdd'), 'aria-expanded': pickerOpen ? 'true' : 'false', onClick: () => setPickerOpen(!pickerOpen) },
                  h('span', { 'aria-hidden': 'true' }, pickerOpen ? '−' : '+'), L('addLang')),
                picker),
              h('details', { className: 'kbth-adv', ref: advRef },
                h('summary', { title: L('tipAdvanced') }, L('advanced')),
                h('div', { className: 'kbth-adv-body' },
                  models.length > 0
                    ? h('div', { className: 'kbth-row' },
                        h('span', { className: 'kbth-lb' }, L('modelLabel')),
                        h('select', {
                          className: 'kbth-select', value: selectedModel, disabled: snap.state === 'running',
                          'aria-label': L('modelLabel'), title: L('tipModel'),
                          onChange: (e) => { setSelectedModel(e.target.value); try { localStorage.setItem(I18N_MODEL_KEY, e.target.value) } catch (ex) { /* */ } },
                        }, models.map((m) => h('option', { key: m.id, value: m.id }, m.name + ' (' + m.provider + ')'))))
                    : null,
                  h('div', { className: 'kbth-hint' }, models.length > 0 ? L('modelHint') : L('noModels')))))))
      }

      // Opens this page from anywhere in the settings: the nav entry is found by its
      // label (the one registered at boot, or either of its two source spellings).
      const openLanguagePage = () => {
        const plain = (t) => String(t || '').replace(/[⟦⟧]/g, '').trim()
        const names = [plain(L('title')), S.title[0], S.title[1]]
        const entry = Array.from(document.querySelectorAll('button,[role="tab"],a')).find((b) => {
          const own = plain(b.innerText).split('\n')[0]
          return names.indexOf(own) >= 0 && b.closest('.kbth-page') === null && b.closest('[data-slot="settings.general.item"]') === null
        })
        if (entry !== undefined) entry.click()
        return entry !== undefined
      }
      function GeneralLink() {
        return h('div', { className: 'kbth-gl' },
          h('button', { type: 'button', className: 'kbth-gl-link', 'data-act': 'manage-languages', onClick: openLanguagePage }, L('manageLink')))
      }

      // ══════════════════════════════════════════════════════════════════════
      // 8. MOUNTING
      // ══════════════════════════════════════════════════════════════════════

      // The export contract of a cordis entry: the list of services the context
      // MUST expose — the ctx guard refuses any ctx.<service> not declared here.
      // Without it the entry stays "loading" and never activates.
      return {
        inject: ['slots', 'locale'],
        // Pure pieces, exposed for test-client.mjs.
        __test: {
          kbSources, dshSources, buildPlan, runTranslation, hostTranslate, planBatches, isComplete, metaRead, i18nRead, dshRead, liveRead,
          startRun, pauseRun, subscribeRun, getRun: () => run, friendlyError, langInfo, ISO_639_1, POPULAR, isLiveCandidate,
          managedIds, registryAdd, registryRead, dropLanguage, registerDshPack, activateLanguage, startLiveLayer, openLanguagePage,
          setLocale: (svc) => { locSvc = svc; _dsh = null; _dshRev = null }, L, estimateMinutes, minutesLeft,
        },
        apply(ctx) {
          // (01/10) Label from the language state itself: an English shell reads
          // « Language », a French shell reads « Langue ».
          const kblLabel = () => L('title')
          // Language + reading direction FROM ACTIVATION: after a reload, the
          // direction (rtl for Arabic) and the active dict are set before the
          // user opens the settings — `kbt` in the main plugin reads
          // `__KB_I18N_ACTIVE__` from its first render.
          // (01/10) Without an explicit choice (no kybernos.theme.lang), an
          // English shell is followed: apply « en » rather than the French
          // mockup default, for English tabs under an English shell.
          let kbBootLang = null
          try {
            locSvc = (ctx !== null && ctx !== undefined && typeof ctx.get === 'function') ? ctx.get('locale') : null
            if (locSvc === undefined) locSvc = null
          } catch (e0) { locSvc = null }
          try {
            if (localStorage.getItem('kybernos.theme.lang') === null) {
              const snapshot = (locSvc !== null && typeof locSvc.getLocale === 'function') ? locSvc.getLocale() : null
              const loc = (snapshot !== null && snapshot.active !== null && snapshot.active !== undefined) ? String(snapshot.active).split(/[-_]/)[0].toLowerCase() : ''
              if (loc === 'en') kbBootLang = 'en'
            }
          } catch (e1) { /* service absent: historical behaviour */ }
          try { applyLanguage(kbBootLang !== null ? kbBootLang : readActiveLang()) } catch (e) { /* silent */ }

          if (ctx !== null && ctx !== undefined && ctx.slots !== null && ctx.slots !== undefined) {
            ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register(
              { name: 'settings.section', id: 'kybernos-language', order: 2, label: kblLabel() },
              (props) => h(Page, props))), 'kybernos-language: language settings section')

            ctx.effect(() => styles.insert(css), 'kybernos-language: styles')
            // Under DSH's own General › Language row (order 0; the next native row is
            // order 10): a pointer to this page. It exists only while THIS plugin is
            // active — without it, DSH's row alone lists the translations, which the
            // runtime in the core keeps registered.
            ctx.effect(() => ctx.slots.inject('settings.general.item', () => ctx.slots.register(
              { name: 'settings.general.item', id: 'kybernos-language-link', order: 1 },
              () => h(GeneralLink))), 'kybernos-language: pointer under General › Language')
            // Optional: a failure here must not take DSH down with it.
            try { startLiveLayer(ctx) } catch (e5) { /* */ }
          }
        }
      }
    } catch (kbLangBootError) {
      try {
        console.error('[kybernos-language] load failed — plugin disabled, GUI preserved', kbLangBootError)
      } catch (e2) { /* console unavailable */ }
      return { apply() { /* plugin disabled after a load error */ } }
    }
  },
})
