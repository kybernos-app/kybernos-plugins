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
//   disk copy ............................. every write below also reaches the user's
//                                           disk (~/.dsh/kybernos/i18n/<lang>.json) through
//                                           window.__KB_LANG_RUNTIME__.disk, which belongs
//                                           to @local/kybernos and so works with this
//                                           plugin off; the page states where they are kept
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
[data-slot="settings.section"]:has(.kbln-page) { width: 100%; max-width: none; }
.kbln-page{display:grid;grid-template-columns:1fr;gap:22px;max-width:760px;align-items:start}
.kbln-main{display:flex;flex-direction:column;gap:22px;min-width:0}
.kbln-head{display:flex;flex-direction:column;gap:6px}
.kbln-title{font-size:26px;line-height:32px;font-weight:800;letter-spacing:-.01em;color:var(--dsw-alias-label-primary)}
.kbln-sub{font-size:14px;line-height:1.55;color:var(--dsw-alias-label-secondary);max-width:640px}
.kbln-sec{display:flex;flex-direction:column;gap:10px}
.kbln-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.kbln-lb{font-size:13px;font-weight:500;color:var(--dsw-alias-label-secondary);width:160px;flex:none}
.kbln-hint{font-size:12px;color:var(--dsw-alias-label-tertiary);line-height:1.5}
.kbln-btn{appearance:none;font:inherit;font-size:13px;font-weight:500;padding:7px 14px;border-radius:9px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);transition:background .12s,border-color .12s;white-space:nowrap}
.kbln-btn:hover{background:var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-3));border-color:var(--dsw-alias-border-l3)}
.kbln-btn.primary{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground,#fff);border-color:var(--dsw-alias-brand-primary)}
.kbln-btn.primary:hover{opacity:.9}
.kbln-btn.quiet{border-color:transparent;background:transparent;color:var(--dsw-alias-label-secondary)}
.kbln-btn.quiet:hover{background:var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-3))}
.kbln-btn.danger{color:var(--dsw-alias-state-error, #e5484d)}
/* ── Language rows ──────────────────────────────────────────────────────── */
.kbln-langs{display:flex;flex-direction:column;gap:8px}
.kbln-lang{display:flex;flex-direction:column;gap:12px;padding:12px 14px;border-radius:12px;border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2)}
.kbln-lang.on{border:1.5px solid var(--dsw-alias-brand-primary);padding:11.25px 13.25px}
.kbln-lang-top{display:flex;align-items:center;gap:12px}
.kbln-badge{width:38px;height:38px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;letter-spacing:.02em;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary)}
.kbln-lang.on .kbln-badge{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground,#fff)}
.kbln-lang-info{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.kbln-lang-name{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary);display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.kbln-lang-en{font-weight:400;color:var(--dsw-alias-label-tertiary);font-size:12px}
body:not([data-ds-dark-theme]) .kbln-lang-en{color:var(--dsw-alias-label-secondary)}
.kbln-lang-meta{font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.4}
.kbln-lang-act{display:flex;align-items:center;gap:8px;flex:none;flex-wrap:wrap;justify-content:flex-end}
.kbln-pill{font-size:11px;padding:2px 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);font-weight:500;white-space:nowrap}
.kbln-pill.ok{border-color:transparent;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground,#fff)}
/* Progress, inside the row */
.kbln-prog{display:flex;flex-direction:column;gap:10px;padding-top:2px}
.kbln-bar{height:8px;border-radius:999px;background:var(--dsw-alias-bg-layer-3);overflow:hidden}
.kbln-bar>i{display:block;height:100%;border-radius:999px;background:var(--dsw-alias-brand-primary);transition:width .3s ease}
.kbln-bar.sm{height:5px}
.kbln-bar.done>i{background:var(--dsw-alias-state-success, #30a46c)}
.kbln-prog-line{display:flex;justify-content:space-between;gap:12px;font-size:12px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.kbln-areas{display:grid;grid-template-columns:minmax(0,200px) 1fr 40px;gap:6px 12px;align-items:center;font-size:12px;color:var(--dsw-alias-label-secondary)}
.kbln-areas>span:last-child,.kbln-areas>span.n{text-align:end;font-variant-numeric:tabular-nums}
.kbln-note{font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.5}
.kbln-err{display:flex;flex-direction:column;gap:6px;padding:10px 12px;border-radius:10px;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-state-error, #e5484d)}
.kbln-err code{font-size:11px;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary)}
.kbln-link{appearance:none;background:none;border:0;padding:0;font:inherit;font-size:12px;color:var(--dsw-alias-label-secondary);text-decoration:underline;cursor:pointer;align-self:flex-start}
.kbln-menu{position:relative}
.kbln-menu-pop{position:absolute;inset-inline-end:0;top:calc(100% + 4px);z-index:20;min-width:210px;padding:4px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);box-shadow:0 8px 24px rgba(0,0,0,.25);display:flex;flex-direction:column}
.kbln-menu-pop button{appearance:none;font:inherit;font-size:13px;text-align:start;padding:8px 10px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer}
.kbln-menu-pop button:hover{background:var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-3))}
.kbln-menu-pop button[disabled]{opacity:.45;cursor:default}
/* ── Add a language ─────────────────────────────────────────────────────── */
.kbln-add{display:flex;flex-direction:column;border-radius:12px;border:.5px dashed var(--dsw-alias-border-l3)}
.kbln-add-h{appearance:none;font:inherit;display:flex;align-items:center;gap:10px;padding:11px 14px;background:transparent;border:0;cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:14px;text-align:start}
.kbln-add-h:hover{color:var(--dsw-alias-brand-primary)}
.kbln-add-body{display:flex;flex-direction:column;gap:10px;padding:0 14px 14px}
.kbln-input{appearance:none;font:inherit;font-size:13px;padding:8px 12px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);outline:none;width:100%;box-sizing:border-box}
.kbln-input:focus{border-color:var(--dsw-alias-brand-primary)}
.kbln-chips{display:flex;flex-wrap:wrap;gap:6px}
.kbln-chip{appearance:none;font:inherit;font-size:12px;padding:5px 11px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);cursor:pointer}
.kbln-chip:hover:not([disabled]){border-color:var(--dsw-alias-brand-primary)}
.kbln-chip[disabled]{opacity:.4;cursor:default}
.kbln-chip-tag{font-size:11px;font-weight:500;color:var(--dsw-alias-state-success-primary);margin-inline-start:2px}
body:not([data-ds-dark-theme]) .kbln-chip-tag{color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 55%,var(--dsw-alias-label-primary))}
.kbln-sec-t{font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}
.kbln-iso{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:4px;max-height:280px;overflow:auto;padding-inline-end:4px}
.kbln-iso-i{appearance:none;font:inherit;font-size:13px;display:flex;align-items:baseline;gap:8px;padding:7px 10px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;text-align:start;min-width:0}
.kbln-iso-i:hover:not([disabled]){background:var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-3))}
.kbln-iso-i[disabled]{opacity:.4;cursor:default}
.kbln-iso-i b{font-weight:500}
.kbln-iso-i small{font-size:11px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kbln-iso-i code{margin-inline-start:auto;font-size:10px;color:var(--dsw-alias-label-tertiary)}
/* ── Advanced ───────────────────────────────────────────────────────────── */
.kbln-adv{border-radius:12px;border:.5px solid var(--dsw-alias-border-l2);padding:10px 14px}
.kbln-adv>summary{cursor:pointer;font-size:13px;color:var(--dsw-alias-label-secondary)}
.kbln-adv-body{display:flex;flex-direction:column;gap:12px;padding-top:12px}
.kbln-select{appearance:none;font:inherit;font-size:13px;padding:7px 28px 7px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%2381858c'/%3E%3C/svg%3E") no-repeat right 10px center;color:var(--dsw-alias-label-primary);cursor:pointer;min-width:240px;max-width:100%}
.kbln-select:focus{border-color:var(--dsw-alias-brand-primary);outline:none}
/* ── Help: a small animated walkthrough ──────────────────────────────────────
   The mock is pure CSS on a 12 s loop; the BASE style of every animated part is the
   final state (language ready and in use), which is also what reduced motion shows. */
.kbln-head-row{display:flex;align-items:center;justify-content:space-between;gap:12px}
/* The « ? How it works » pill: the same look as the Suite's (kybernos-hub), so every page has one form of the button; the panel it opens is this page's own. */
.kbln-help-btn{appearance:none;display:inline-flex;align-items:center;gap:8px;height:30px;padding:0 12px 0 6px;border-radius:16px;border:1px solid var(--dsw-alias-border-l3);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12.5px;cursor:pointer;white-space:nowrap}
.kbln-help-btn:hover,.kbln-help-btn[aria-expanded="true"]{border-color:var(--dsw-alias-label-tertiary);color:var(--dsw-alias-label-primary)}
.kbln-help-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.kbln-help-q{width:18px;height:18px;border-radius:50%;display:grid;place-items:center;font-size:11px;font-weight:700;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary)}
.kbln-help{display:grid;grid-template-columns:300px minmax(0,1fr);gap:20px;padding:16px;border-radius:12px;border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);align-items:center}
@media (max-width:700px){.kbln-help{grid-template-columns:minmax(0,1fr)}}
.kbln-help-text{display:flex;flex-direction:column;gap:12px;min-width:0}
.kbln-help-h{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}
.kbln-steps{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:10px}
.kbln-step{display:grid;grid-template-columns:22px minmax(0,1fr);gap:10px;align-items:start}
.kbln-step>b{width:22px;height:22px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground,#fff)}
.kbln-step-t{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
.kbln-step-b{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.kbln-step.s1{animation:kbln-k-s1 12s infinite}
.kbln-step.s2{animation:kbln-k-s2 12s infinite}
.kbln-step.s3{animation:kbln-k-s3 12s infinite}
.kbln-mm{direction:ltr;position:relative;width:300px;max-width:100%;height:176px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);overflow:hidden;font-size:10px;color:var(--dsw-alias-label-primary);user-select:none;pointer-events:none}
.kbln-mm-bar{position:absolute;left:0;right:0;top:0;height:26px;display:flex;align-items:center;justify-content:space-between;padding:0 10px;border-bottom:1px solid var(--dsw-alias-border-l2);font-weight:600}
.kbln-mm-hi{position:relative;display:inline-block;width:34px;height:12px;line-height:12px;color:var(--dsw-alias-label-secondary)}
.kbln-mm-hi i{font-style:normal;position:absolute;right:0;top:0;line-height:12px}
.kbln-mm-w1{opacity:0;animation:kbln-k-w1 12s infinite}
.kbln-mm-w2{animation:kbln-k-w2 12s infinite}
.kbln-mm-row{position:absolute;left:8px;right:8px;height:32px;display:flex;align-items:center;gap:7px;padding:0 8px;border-radius:8px;border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);box-sizing:border-box}
.kbln-mm-row.en{top:34px}
.kbln-mm-row.es{top:72px;height:40px;animation:kbln-k-es 12s infinite}
.kbln-mm-b{width:18px;height:18px;flex:none;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:8px;font-weight:700;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary)}
.kbln-mm-i{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px;position:relative}
.kbln-mm-n{font-weight:600;white-space:nowrap}
.kbln-mm-st{position:relative;height:11px;color:var(--dsw-alias-label-secondary);font-size:9px}
.kbln-mm-st>span{position:absolute;left:0;top:0;white-space:nowrap;opacity:0}
.kbln-mm-st>.t3{opacity:1;animation:kbln-k-st3 12s infinite}
.kbln-mm-st>.t1{animation:kbln-k-st1 12s infinite}
.kbln-mm-st>.t2{animation:kbln-k-st2 12s infinite}
.kbln-mm-acts{position:relative;width:92px;height:20px;flex:none}
.kbln-mm-acts>*{position:absolute;right:0;top:0;height:20px;box-sizing:border-box;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;padding:0 7px;font-size:9px;font-weight:600;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}
.kbln-mm-go,.kbln-mm-us{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground,#fff);opacity:0}
.kbln-mm-go{animation:kbln-k-go 12s infinite}
.kbln-mm-us{animation:kbln-k-us 12s infinite}
.kbln-mm-pa{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);opacity:0;animation:kbln-k-pa 12s infinite}
.kbln-mm-pill{border-radius:999px;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground,#fff)}
.kbln-mm-pill.es{opacity:1;animation:kbln-k-pes 12s infinite}
.kbln-mm-pill.en{opacity:0;animation:kbln-k-pen 12s infinite}
.kbln-mm-track{position:absolute;left:34px;right:104px;bottom:4px;height:3px;border-radius:99px;background:var(--dsw-alias-bg-layer-3);opacity:0;animation:kbln-k-track 12s infinite}
.kbln-mm-fill{display:block;height:100%;width:100%;border-radius:99px;background:var(--dsw-alias-brand-primary);animation:kbln-k-fill 12s linear infinite}
.kbln-mm-pick{position:absolute;left:8px;right:8px;top:128px;display:flex;gap:6px;opacity:0;animation:kbln-k-pick 12s infinite}
.kbln-mm-chip{padding:4px 9px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);font-size:9px}
.kbln-mm-chip.on{animation:kbln-k-chip 12s infinite}
.kbln-mm-cur{position:absolute;left:150px;top:110px;width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:11px solid var(--dsw-alias-label-primary);transform-origin:50% 100%;opacity:0;animation:kbln-k-cur 12s infinite;filter:drop-shadow(0 1px 1px rgba(0,0,0,.5))}
@keyframes kbln-k-pick{0%{opacity:0}3%,20%{opacity:1}24%,100%{opacity:0}}
@keyframes kbln-k-chip{0%,9%{background:var(--dsw-alias-bg-layer-2);color:inherit}11%,18%{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground,#fff)}22%,100%{background:var(--dsw-alias-bg-layer-2);color:inherit}}
@keyframes kbln-k-es{0%,14%{opacity:0;transform:translateY(8px)}20%,93%{opacity:1;transform:none}98%,100%{opacity:0;transform:translateY(8px)}}
@keyframes kbln-k-st1{0%,19%{opacity:0}21%,32%{opacity:1}34%,100%{opacity:0}}
@keyframes kbln-k-st2{0%,33%{opacity:0}35%,62%{opacity:1}64%,100%{opacity:0}}
@keyframes kbln-k-st3{0%,63%{opacity:0}65%,94%{opacity:1}98%,100%{opacity:0}}
@keyframes kbln-k-go{0%,19%{opacity:0}21%,32%{opacity:1;transform:none}33%{opacity:1;transform:scale(.92)}35%,100%{opacity:0}}
@keyframes kbln-k-pa{0%,34%{opacity:0}36%,62%{opacity:1}64%,100%{opacity:0}}
@keyframes kbln-k-us{0%,63%{opacity:0}65%,71%{opacity:1;transform:none}73%{opacity:1;transform:scale(.92)}76%,100%{opacity:0}}
@keyframes kbln-k-pes{0%,76%{opacity:0}79%,94%{opacity:1}98%,100%{opacity:0}}
@keyframes kbln-k-pen{0%,76%{opacity:1}79%,94%{opacity:0}98%,100%{opacity:1}}
@keyframes kbln-k-track{0%,33%{opacity:0}35%,76%{opacity:1}79%,100%{opacity:0}}
@keyframes kbln-k-fill{0%,34%{width:0}62%,100%{width:100%}}
@keyframes kbln-k-w1{0%,74%{opacity:1}77%,96%{opacity:0}99%,100%{opacity:1}}
@keyframes kbln-k-w2{0%,74%{opacity:0}77%,96%{opacity:1}99%,100%{opacity:0}}
@keyframes kbln-k-cur{0%{left:150px;top:110px;opacity:0;transform:rotate(-30deg) scale(1)}4%{left:150px;top:110px;opacity:1}9%{left:36px;top:140px}11%{left:36px;top:140px;transform:rotate(-30deg) scale(.8)}13%{transform:rotate(-30deg) scale(1)}26%{left:36px;top:140px}31%{left:238px;top:90px}33%{transform:rotate(-30deg) scale(1)}34%{transform:rotate(-30deg) scale(.8)}36%{transform:rotate(-30deg) scale(1)}70%{left:238px;top:90px}72%{transform:rotate(-30deg) scale(.8)}74%{transform:rotate(-30deg) scale(1)}90%{left:238px;top:90px;opacity:1}94%,100%{opacity:0}}
@keyframes kbln-k-s1{0%,23%{opacity:1}26%,96%{opacity:.45}99%,100%{opacity:1}}
@keyframes kbln-k-s2{0%,24%{opacity:.45}27%,64%{opacity:1}67%,100%{opacity:.45}}
@keyframes kbln-k-s3{0%,65%{opacity:.45}68%,95%{opacity:1}98%,100%{opacity:.45}}
@media (prefers-reduced-motion:reduce){.kbln-mm *,.kbln-step{animation:none !important}.kbln-step{opacity:1}}
/* A run lives in the tab: what to expect, a stale bar for a language that is not running, test marks */
.kbln-banner{display:flex;flex-direction:column;gap:8px;padding:10px 12px;border-radius:10px;font-size:12.5px;line-height:1.5;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-3)}
.kbln-banner b{color:var(--dsw-alias-label-primary);font-weight:600}
.kbln-banner.warn{border:1px solid var(--dsw-alias-state-warn-primary,#f59e0b)}
.kbln-fold>summary{display:flex;align-items:center;gap:6px;cursor:pointer;list-style:none;font-weight:600;color:var(--dsw-alias-label-primary)}
.kbln-fold>summary::-webkit-details-marker{display:none}
.kbln-fold>summary .kbln-chev{display:inline-block;transition:transform .15s ease}
.kbln-fold[open]>summary .kbln-chev{transform:rotate(90deg)}
.kbln-bar.stale>i{background:var(--dsw-alias-label-tertiary)}
.kbln-ex{font:11.5px/1.6 ui-monospace,Menlo,monospace;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.kbln-check{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--dsw-alias-label-secondary);cursor:pointer}
.kbln-check input{width:16px;height:16px;margin:0;accent-color:var(--dsw-alias-brand-primary)}
/* The footer indicator: a ring that fills while a translation runs, with the percentage inside */
.kbln-ring{appearance:none;--p:0;position:relative;display:inline-grid;place-items:center;flex:none;width:30px;height:30px;padding:0;border:0;border-radius:50%;cursor:pointer;font:inherit;background:conic-gradient(var(--dsw-alias-brand-primary) calc(var(--p) * 1%),var(--dsw-alias-border-l3) 0)}
.kbln-ring::before{content:"";position:absolute;inset:3px;border-radius:50%;background:var(--dsw-alias-bg-layer-2)}
.kbln-ring-n{position:relative;font-size:10px;font-weight:600;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}
.kbln-ring:hover::before{background:var(--dsw-alias-bg-layer-3)}
.kbln-ring:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
/* The pointer under DSH's General › Language row */
/* A pointer, not a row: zero height, lifted into the bottom of the Language row above it
   (the row's own separator stays below it), so the rows after it do not move. */
.kbln-gl{height:0;position:relative;top:-27px;overflow:visible;line-height:1}
.kbln-gl-link{appearance:none;background:none;border:0;padding:0;font:inherit;font-size:12px;color:var(--dsw-alias-label-secondary);text-decoration:underline;cursor:pointer}
.kbln-gl-link:hover{color:var(--dsw-alias-brand-primary)}
.kbln-gl-link::after{content:' →'}
html[dir="rtl"] .kbln-gl-link::after{content:' ←'}
/* ── RTL-ready ──────────────────────────────────────────────────────────────
   The reading direction lives on <html dir>: flex rows and text follow on their
   own. These fixes only touch what is written with physical properties
   (left/right), which the browser does not flip. */
html[dir="rtl"] .kbln-select{background-position:left 10px center;padding:7px 10px 7px 28px}
html[dir="rtl"] .kbln-slider{background:linear-gradient(to left,var(--dsw-alias-brand-primary) 0 var(--fill,50%),var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-3)) var(--fill,50%) 100%)}
/* Digits, measures and code stay left-to-right inside a right-to-left interface */
html[dir="rtl"] .kbln-sl-vl,html[dir="rtl"] .kbln-fsmeta,html[dir="rtl"] .kbln-prog-line b,
html[dir="rtl"] code,html[dir="rtl"] pre{direction:ltr;unicode-bidi:isolate;text-align:left}
html[dir="rtl"] .kbln-page{direction:rtl}
@media (max-width:640px){.kbln-lang-top{flex-wrap:wrap}.kbln-lang-act{width:100%;justify-content:flex-start}.kbln-areas{grid-template-columns:1fr 60px}}
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
      // The two keys below must NOT look like a language id (2-3 letters): the page lists every
      // `kybernos.i18n.<id>` key as a language, and `run` would show up as "Rundi".
      const I18N_RUN_KEY = 'kybernos.i18n.runstate' // { lang, model, beat } while a run goes on: lets a tab that was closed pick it up again
      const I18N_AUTO_KEY = 'kybernos.i18n.autoresume' // 'off' once the user switched automatic resume off
      const RUN_BEAT_MS = 5000 // a live run writes its heartbeat this often…
      const RUN_STALE_MS = 20000 // …and a heartbeat older than this means no tab runs it any more
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
      // The browser's copy is what this page reads. The always-on runtime (@local/kybernos)
      // keeps the copy on the user's DISK in step: every write below tells it which
      // language changed (it pushes the difference a moment later), and a removal is
      // passed on. Without the runtime, or without the host route, both are no-ops.
      const diskRuntime = () => {
        const rt = window.__KB_LANG_RUNTIME__
        return rt !== undefined && rt !== null && rt.disk !== undefined && rt.disk !== null ? rt.disk : null
      }
      const diskTouch = (id) => { const d = diskRuntime(); if (d !== null) { try { d.touch(id) } catch (e) { /* the disk copy must never break the page */ } } }
      // `kybernos.i18n.<id>`, `.meta.<id>`, `.dsh.<id>`, `.live.<id>` -> id; anything else (labels, registry, model…) -> null
      const langOfKey = (key) => {
        if (key.indexOf('kybernos.i18n.') !== 0) return null
        const m = /^(?:meta\.|dsh\.|live\.)?([a-z]{2,3}(?:-[A-Za-z0-9]+)?)$/.exec(key.slice('kybernos.i18n.'.length))
        return m === null ? null : m[1]
      }
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
        try { localStorage.setItem(key, JSON.stringify(value)) } catch (e) { return false }
        const lid = langOfKey(key)
        if (lid !== null) diskTouch(lid)
        return true
      }
      const i18nRead = (lang) => readJson(I18N_STORE_PREFIX + lang, {})
      const dshRead = (lang) => readJson(I18N_DSH_PREFIX + lang, {})
      const liveRead = (lang) => readJson(I18N_LIVE_PREFIX + lang, {})
      const metaRead = (lang) => readJson(I18N_META_PREFIX + lang, {})
      // A text wrapped in ⟦…⟧ is a PSEUDO-translation: what a test run writes when it swaps the model for a
      // stub (scripts/lib-language-flow.mjs). It is never a real translation. One reached a real disk once and
      // the page counted it as translated: « Resume » then translated nothing and « Use » showed the brackets.
      // So it counts as missing, unless the page is told that pseudo-translations are the point of the run
      // (`window.__KB_I18N_PSEUDO_OK__`, set by the live checks and by the unit tests of the engine).
      const isTestMark = (v) => typeof v === 'string' && v.length > 2 && v.charAt(0) === '⟦' && v.charAt(v.length - 1) === '⟧'
      const pseudoAllowed = () => window.__KB_I18N_PSEUDO_OK__ === true
      const holds = (v) => typeof v === 'string' && (pseudoAllowed() || !isTestMark(v))
      const registryRead = () => { const r = readJson(I18N_REGISTRY_KEY, []); return Array.isArray(r) ? r.filter((x) => typeof x === 'string') : [] }
      const registryAdd = (id) => {
        const r = registryRead()
        if (r.indexOf(id) < 0) { r.push(id); writeJson(I18N_REGISTRY_KEY, r) }
        // The native name goes with it: the runtime lists the language in DSH's own
        // selector by this name, with or without this plugin.
        const labels = readJson(I18N_LABELS_KEY, {})
        if (labels[id] === undefined) { labels[id] = langInfo(id).native; writeJson(I18N_LABELS_KEY, labels) }
        diskTouch(id)
      }
      const dropLanguage = (id) => {
        try {
          for (const p of [I18N_STORE_PREFIX, I18N_META_PREFIX, I18N_DSH_PREFIX, I18N_LIVE_PREFIX]) localStorage.removeItem(p + id)
          writeJson(I18N_REGISTRY_KEY, registryRead().filter((x) => x !== id))
          const labels = readJson(I18N_LABELS_KEY, {})
          delete labels[id]
          writeJson(I18N_LABELS_KEY, labels)
        } catch (e) { /* storage unavailable */ }
        // A run the host has for it stops (its texts would bring the language back), and so does the page's watch.
        if (hostLang === id) stopWatching()
        if (hostJobOn()) jobCall({ op: 'cancel', lang: id }).catch(() => { /* the host route may be absent */ })
        // The disk copy goes too — otherwise the next boot would bring the language back.
        const d = diskRuntime()
        if (d !== null) { try { d.remove(id) } catch (e) { /* the disk copy must never break the page */ } }
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
        sub: ['Choisis la langue de l’interface. Les textes pas encore traduits restent en anglais ; les pages des plugins (compétences, connecteurs, tableaux de bord, pastilles du chat) se traduisent à leur première ouverture, puis restent traduites.', 'Choose the language of the interface. Texts that aren’t translated yet stay in English; plugin pages (skills, connectors, dashboards, chat chips) are translated the first time you open them, then kept.'],
        inUse: ['Active', 'In use'],
        ready: ['Prête', 'Ready'],
        readyOn: ['Prête · traduite le {date} · {n} textes', 'Ready · translated on {date} · {n} texts'],
        readyOn1: ['Prête · traduite le {date} · 1 texte', 'Ready · translated on {date} · 1 text'],
        use: ['Utiliser', 'Use'],
        useNow: ['Utiliser maintenant', 'Use now'],
        useAnyway: ['Utiliser quand même', 'Use anyway'],
        rtl: ['De droite à gauche', 'Right to left'],
        newMeta: ['Pas encore traduite · environ {n} textes · {t}', 'Not translated yet · about {n} texts · {t}'],
        newMeta1: ['Pas encore traduite · environ 1 texte · {t}', 'Not translated yet · about 1 text · {t}'],
        partialMeta: ['Traduite à {pct} % · il reste {n} textes', '{pct}% translated · {n} texts left'],
        partialMeta1: ['Traduite à {pct} % · il reste 1 texte', '{pct}% translated · 1 text left'],
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
        essentials: ['L’essentiel est prêt. Le reste continue dans cet onglet : ce qui n’est pas encore traduit s’affiche en anglais.', 'The essentials are ready. The rest keeps going in this tab: texts not translated yet show in English.'],
        runsInTab: ['Ça tourne dans cet onglet. Tu peux quitter cette page et travailler ailleurs : le rond en bas de la barre latérale suit l’avancement. Ne ferme pas l’onglet : s’il se ferme, la traduction reprend toute seule à la prochaine ouverture de Kybernos.', 'This runs in this tab. You can leave this page and work elsewhere: the ring at the bottom of the sidebar follows the progress. Do not close the tab: if it closes, the translation resumes by itself the next time Kybernos opens.'],
        runsInTabManual: ['Ça tourne dans cet onglet. Tu peux quitter cette page et travailler ailleurs : le rond en bas de la barre latérale suit l’avancement. Ne ferme pas l’onglet : s’il se ferme, la traduction s’arrête et il faudra appuyer sur Reprendre.', 'This runs in this tab. You can leave this page and work elsewhere: the ring at the bottom of the sidebar follows the progress. Do not close the tab: if it closes, the translation stops and you will have to press Resume.'],
        cutNote: ['La traduction s’est arrêtée avec l’onglet. Ce qui est déjà traduit est conservé : appuie sur Reprendre.', 'The translation stopped with the tab. What is already translated is kept: press Resume.'],
        pseudoSummary: ['{n} textes à vérifier · marques de test', '{n} texts to check · test marks'],
        pseudoSummary1: ['1 texte à vérifier · marques de test', '1 text to check · test marks'],
        pseudoTitle: ['{n} textes ressemblent à des marques de test.', '{n} texts look like test marks.'],
        pseudoTitle1: ['1 texte ressemble à une marque de test.', '1 text looks like a test mark.'],
        pseudoBody: ['Ce ne sont pas de vraies traductions : ils ne sont pas comptés, et utilisés tels quels ils s’afficheraient entourés de crochets. « Retraduire » les remplace par de vraies traductions.', 'They are not real translations: they are not counted, and used as they are they would show up wrapped in brackets. “Translate again” replaces them with real translations.'],
        repair: ['Retraduire ces textes', 'Translate these texts again'],
        tipRepair: ['Retire les marques de test de cette langue, puis traduit ces textes avec le modèle choisi. Le reste est conservé.', 'Removes the test marks from this language, then translates those texts with the chosen model. Everything else is kept.'],
        autoLabel: ['Reprendre automatiquement une traduction coupée, à l’ouverture de Kybernos', 'Resume an interrupted translation automatically when Kybernos opens'],
        tipAuto: ['Si l’onglet est fermé pendant une traduction, elle reprend toute seule à la prochaine ouverture. Décoche pour reprendre à la main.', 'If the tab is closed during a translation, it resumes by itself the next time Kybernos opens. Untick to resume by hand.'],
        chipTitle: ['Traduction en {name} : {pct} %. Clique pour ouvrir la page Langue.', 'Translating {name}: {pct}%. Click to open the Language page.'],
        gaps: ['{n} textes n’ont pas pu être traduits et resteront en anglais.', '{n} texts couldn’t be translated and will stay in English.'],
        gaps1: ['1 texte n’a pas pu être traduit et restera en anglais.', '1 text couldn’t be translated and will stay in English.'],
        model: ['Modèle', 'Model'],
        usesModel: ['Modèle : {model}', 'Model: {model}'],
        more: ['Plus d’actions', 'More actions'],
        again: ['Retraduire depuis zéro', 'Translate again from scratch'],
        remove: ['Supprimer cette langue', 'Remove this language'],
        removeActive: ['Choisis une autre langue d’abord', 'Switch to another language first'],
        addLang: ['Ajouter une langue', 'Add a language'],
        search: ['Rechercher une langue, ex. Español', 'Search a language, e.g. Español'],
        popular: ['Les plus courantes', 'Most common'],
        allLangs: ['Toutes les langues (ISO 639-1)', 'All languages (ISO 639-1)'],
        noMatch: ['Aucune langue ne correspond. Essaie le nom en anglais.', 'No language matches. Try the English name.'],
        added: ['Déjà ajoutée', 'Already added'],
        advanced: ['Avancé', 'Advanced'],
        modelLabel: ['Modèle de traduction', 'Translation model'],
        modelHint: ['Les traductions sont générées par ce modèle, puis gardées sur cet ordinateur. Elles s’appliquent à l’interface de Kybernos et à celle de DSH.', 'Translations are generated by this model, then kept on this computer. They apply to Kybernos and to DSH’s own screens.'],
        noModels: ['Aucun modèle détecté. Configure un fournisseur dans settings.yaml pour activer la traduction.', 'No model detected. Set up a provider in settings.yaml to enable translation.'],
        noDsh: ['Les écrans de DSH ne peuvent pas être traduits avec cette version : seul Kybernos le sera.', 'DSH’s own screens can’t be translated with this version: only Kybernos will be.'],
        zhNative: ['DSH traduit déjà ses écrans dans cette langue : seul Kybernos reste à traduire.', 'DSH already translates its own screens in this language: only Kybernos is left to translate.'],
        showDetails: ['Afficher les détails', 'Show details'],
        hideDetails: ['Masquer les détails', 'Hide details'],
        chooseModel: ['Choisir un autre modèle', 'Choose another model'],
        errTitle: ['La traduction s’est arrêtée.', 'The translation stopped.'],
        errKey: ['Le modèle de traduction a besoin d’une clé d’API qui n’est pas définie sur cet ordinateur.', 'The translation model needs an API key that isn’t set on this computer.'],
        errAuth: ['Le fournisseur a refusé la clé d’API de ce modèle.', 'The provider rejected this model’s API key.'],
        errNoModel: ['Ce modèle n’est pas disponible dans ta configuration.', 'This model isn’t available in your setup.'],
        errRate: ['Le fournisseur limite le nombre de requêtes. Attends une minute, puis reprends.', 'The provider is limiting requests. Wait a minute, then resume.'],
        errSlow: ['Le modèle a mis trop de temps à répondre.', 'The model took too long to answer.'],
        errHost: ['Impossible de joindre l’hôte Kybernos. DSH est-il toujours lancé ?', 'Can’t reach the Kybernos host. Is DSH still running?'],
        errOld: ['Le plugin Kybernos principal est trop ancien pour traduire. Mets-le à jour.', 'The main Kybernos plugin is too old to translate. Update it.'],
        errBusy: ['Une autre langue est en cours de traduction. Attends la fin ou mets-la en pause.', 'Another language is being translated. Wait for it to finish or pause it.'],
        jobReady: ['{name} est prête.', '{name} is ready.'],
        jobReadyBody: ['{n} textes traduits. Tu peux passer dessus quand tu veux.', '{n} texts translated. You can switch to it whenever you like.'],
        jobReadyBody1: ['1 texte traduit. Tu peux passer dessus quand tu veux.', '1 text translated. You can switch to it whenever you like.'],
        jobPartial: ['{name} : {n} textes restent en anglais.', '{name}: {n} texts stay in English.'],
        jobPartial1: ['{name} : 1 texte reste en anglais.', '{name}: 1 text stays in English.'],
        jobPartialBody: ['La langue est utilisable. Réessaie les textes manquants depuis Réglages › Langue.', 'The language is usable. Retry the missing texts from Settings › Language.'],
        jobFailed: ['La traduction en {name} s’est arrêtée.', 'The translation to {name} stopped.'],
        packInstall: ['Installer la traduction prête', 'Install the ready-made translation'],
        packInstalling: ['Installation…', 'Installing…'],
        packNote: ['Une traduction prête à l’emploi existe pour cette langue ({n} textes) : elle s’installe tout de suite, sans modèle ni clé. Ce qui manque est ensuite traduit par ton modèle.', 'A ready-made translation exists for this language ({n} texts): it installs at once, with no model and no key. What it lacks is then translated by your model.'],
        packReviewed: ['relue', 'reviewed'],
        packTag: ['prête', 'ready'],
        packDone: ['Traduction installée : {added} textes ajoutés, {kept} déjà là.', 'Translation installed: {added} texts added, {kept} already there.'],
        packFailed: ['La traduction prête n’a pas pu être installée ({why}).', 'The ready-made translation could not be installed ({why}).'],
        staleSummary: ['{n} textes ont changé depuis cette traduction', '{n} texts changed since this translation'],
        staleSummary1: ['1 texte a changé depuis cette traduction', '1 text changed since this translation'],
        staleBody: ['Ces textes ont été modifiés dans cette version de Kybernos ou de DSH : seuls eux seront retraduits, le reste est conservé.', 'These texts were changed in this version of Kybernos or DSH: only they are translated again, the rest is kept.'],
        staleUpdate: ['Mettre à jour la traduction', 'Update translation'],
        doubtSummary: ['{n} textes à vérifier', '{n} texts to double-check'],
        doubtSummary1: ['1 texte à vérifier', '1 text to double-check'],
        doubtBody: ['Ces traductions sont gardées, mais elles ressemblent à la source ou ont perdu un nom de produit. Vérifie-les si l’écran te paraît étrange.', 'These translations are kept, but they look like the source or lost a product name. Check them if a screen looks odd.'],
        doubtWhy_unchanged: ['identique à la source', 'same as the source'],
        doubtWhy_glossary: ['nom de produit disparu', 'a product name is missing'],
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
        step1Body: ['Ouvre « Ajouter une langue » et choisis-en une dans la liste ISO.', 'Open “Add a language” and pick one from the ISO list.'],
        step2Body: ['La barre de progression montre l’avancement. Tu peux mettre en pause et reprendre à tout moment.', 'The progress bar shows how far it is. You can pause and resume at any time.'],
        step3Body: ['Kybernos et DSH passent dans cette langue. Pour revenir en arrière, utilise une autre langue.', 'Kybernos and DSH switch to this language. To go back, use another language.'],
        helpNote: ['Les textes pas encore traduits restent en anglais. C’est le même choix que dans Réglages › Général › Langue.', 'Texts not translated yet stay in English. It is the same choice as in Settings › General › Language.'],
        tipHelp: ['Afficher ou masquer l’aide', 'Show or hide the help'],
        tipStart: ['Traduit l’interface dans cette langue avec le modèle choisi dans « Avancé ». Tu peux mettre en pause à tout moment.', 'Translates the interface into this language with the model chosen in “Advanced”. You can pause at any time.'],
        tipResume: ['Reprend là où ça s’est arrêté : ce qui est déjà traduit est conservé.', 'Continues where it stopped: what is already translated is kept.'],
        tipRetry: ['Ne retraduit que les textes qui ont échoué.', 'Translates only the texts that failed.'],
        tipPause: ['S’arrête après les textes en cours. Rien n’est perdu : « Reprendre » continue.', 'Stops after the texts in progress. Nothing is lost: Resume continues.'],
        tipUse: ['Passe Kybernos et DSH dans cette langue. La page se recharge.', 'Switches Kybernos and DSH to this language. The page reloads.'],
        tipUseAnyway: ['Utilise la langue telle quelle : les textes pas encore traduits s’affichent en anglais. Tu pourras reprendre la traduction plus tard.', 'Uses the language as it is: texts not translated yet show in English. You can resume the translation later.'],
        tipUseNow: ['L’essentiel est traduit : utilise la langue maintenant, le reste continue en arrière-plan.', 'The essentials are translated: use the language now while the rest continues in the background.'],
        tipInUse: ['La langue que Kybernos et DSH utilisent en ce moment.', 'The language Kybernos and DSH are using right now.'],
        tipRtl: ['Cette langue se lit de droite à gauche : toute la mise en page est inversée.', 'This language reads right to left: the whole layout is mirrored.'],
        tipProgress: ['Textes traduits jusqu’ici.', 'Texts translated so far.'],
        tipAreaCore: ['Les écrans de tous les jours : menus, navigation, discussions et réglages.', 'The everyday screens: menus, navigation, chat and settings.'],
        tipAreaMore: ['Les écrans moins courants et les pages des plugins.', 'Less common screens and plugin pages.'],
        tipAreaPhrases: ['Les messages longs et les explications détaillées.', 'Long messages and detailed explanations.'],
        tipEstimate: ['Estimation d’après le nombre de textes et la vitesse habituelle du modèle.', 'Estimated from the number of texts and the model’s usual speed.'],
        tipAdd: ['Choisis n’importe quelle langue de la liste ISO 639-1.', 'Pick any language from the ISO 639-1 list.'],
        tipAddLang: ['Ajouter {name} ({code})', 'Add {name} ({code})'],
        tipModel: ['Le modèle qui écrit les traductions. N’importe quel modèle configuré dans DSH convient ; un modèle rapide suffit.', 'The model that writes the translations. Any model configured in DSH works; a fast one is enough.'],
        tipAdvanced: ['Choix du modèle de traduction.', 'Translation model choice.'],
        diskOn: ['Traductions enregistrées sur cet ordinateur : {dir}', 'Translations saved on this computer: {dir}'],
        diskOff: ['Traductions gardées dans ce navigateur seulement. Relance DSH pour les enregistrer aussi sur le disque de cet ordinateur.', 'Translations kept in this browser only. Restart DSH to save them on this computer’s disk too.'],
        diskErr: ['Enregistrement sur le disque impossible ({err}). Nouvel essai automatique.', 'Could not save to the disk ({err}). Trying again automatically.'],
        tipDiskOn: ['Ce dossier contient une copie de chaque langue traduite. Elle reste disponible dans tous tes navigateurs, même si tu effaces les données de celui-ci. C’est ce dossier qu’il faut sauvegarder.', 'This folder holds a copy of every translated language. It stays available in all your browsers, even if you clear this one’s data. This is the folder to back up.'],
        tipDiskOff: ['Le navigateur garde la traduction, mais effacer ses données ou changer de navigateur la ferait perdre. Après un redémarrage de DSH, elle est copiée sur le disque automatiquement.', 'The browser keeps the translation, but clearing its data or switching browser would lose it. After DSH restarts it is copied to the disk automatically.'],
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
        // A row can have a « 1 » twin (« 1 text », not « 1 texts »): it is used when the count n is 1.
        const pair = params !== undefined && String(params.n) === '1' && S[key + '1'] !== undefined ? S[key + '1'] : S[key]
        if (pair === undefined) return String(key) // a typo must show, not blank the whole page
        const l = uiLang()
        let out = pair[1]
        if (l === 'kybernos' || l.split(/[-_]/)[0] === 'fr') out = pair[0]
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
        // The packs other bundles publish at factory time
        // (window.__KB_I18N_PACKS__ = [{ id, keys: { key: { fr, en } } }]) join the
        // corpus: their French is the source, their id is namespaced
        // ('cloud.<key>') so the shared per-language store never collides with kbt
        // keys or another bundle's. Counted into the memo key so a late pack (or a
        // reloaded bundle) is picked up instead of served the stale cache.
        let packs = []
        let packStamp = ''
        try {
          const p = window.__KB_I18N_PACKS__
          if (Array.isArray(p)) {
            packs = p
            for (const it of p) { if (it && typeof it.id === 'string') packStamp += it.id + ':' + Object.keys(it.keys || {}).length + ';' }
          }
        } catch (e) { /* no window */ }
        if (_kb !== null && _kbFrom !== null && _kbFrom.t === kbT && _kbFrom.f === from && _kbFrom.p === packStamp) return _kb
        const seen = new Set()
        const out = []
        const push = (id, text, area) => {
          if (seen.has(id) || id.length === 0 || wireOf('kb', id).length > WIRE_MAX) return
          seen.add(id)
          out.push({ wire: wireOf('kb', id), id, text, store: 'kb', area })
        }
        for (const pack of packs) {
          if (pack === null || pack === undefined || typeof pack.id !== 'string' || pack.keys === null || typeof pack.keys !== 'object') continue
          const pfx = pack.id.replace(/^kybernos-/, '') + '.'
          for (const k of Object.keys(pack.keys)) {
            const entry = pack.keys[k]
            if (entry === null || entry === undefined || typeof entry !== 'object') continue
            if (typeof entry.fr !== 'string' || entry.fr === '') continue
            push(pfx + k, entry.fr, 'more')
          }
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
        _kbFrom = { t: kbT, f: from, p: packStamp }
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

      // What a language already HOLDS, counted from the stores themselves. The
      // bilan (`meta`) is only as old as the engine that wrote it: an installation
      // from before it existed has a dictionary and no meta, and must not read as
      // "0 % translated" — that would look like the translation had vanished.
      // Memoized on the size of the stores, since a page render calls it per row.
      const _held = new Map()
      const heldBy = (lang, plan) => {
        if (plan === null) return null
        let rawKb = ''
        let rawDsh = ''
        try { rawKb = localStorage.getItem(I18N_STORE_PREFIX + lang) || ''; rawDsh = localStorage.getItem(I18N_DSH_PREFIX + lang) || '' } catch (e) { /* storage unavailable */ }
        const key = rawKb.length + ':' + rawDsh.length + ':' + plan.total + ':' + (pseudoAllowed() ? 1 : 0)
        const hit = _held.get(lang)
        if (hit !== undefined && hit.key === key) return hit.value
        const kb = i18nRead(lang)
        const dsh = dshRead(lang)
        let done = 0
        let coreMissing = 0
        for (const it of plan.items) {
          if (holds((it.store === 'kb' ? kb : dsh)[it.id])) done += 1
          else if (it.area === 'core') coreMissing += 1
        }
        const value = { done, essentials: coreMissing === 0 }
        _held.set(lang, { key, value })
        return value
      }

      // The pseudo-translations a language holds, counted on the three stores (memoized on their sizes: a page
      // render asks for every language).
      const _pseudo = new Map()
      const pseudoStats = (lang) => {
        const none = { n: 0, examples: [] }
        if (pseudoAllowed()) return none
        let key = ''
        try { key = [I18N_STORE_PREFIX, I18N_DSH_PREFIX, I18N_LIVE_PREFIX].map((p) => (localStorage.getItem(p + lang) || '').length).join(':') } catch (e) { return none }
        const hit = _pseudo.get(lang)
        if (hit !== undefined && hit.key === key) return hit.value
        let n = 0
        const examples = []
        for (const [store, read] of [['kb', i18nRead], ['dsh', dshRead], ['live', liveRead]]) {
          const data = read(lang)
          for (const id of Object.keys(data)) if (isTestMark(data[id])) { n += 1; if (examples.length < 4) examples.push({ store, id, text: data[id] }) }
        }
        const value = { n, examples }
        _pseudo.set(lang, { key, value })
        return value
      }

      // Takes the pseudo-translations out of the three stores of a language, then writes the true count of what
      // is left, so that the next run translates exactly those texts. The disk copy follows: the runtime sends a
      // section whose texts were taken away as a whole (a plain delta could never remove them, and the next boot
      // would merge them back from the disk).
      const repairPseudo = (lang) => {
        let removed = 0
        for (const [prefix, read] of [[I18N_STORE_PREFIX, i18nRead], [I18N_DSH_PREFIX, dshRead], [I18N_LIVE_PREFIX, liveRead]]) {
          const data = read(lang)
          let changed = false
          for (const id of Object.keys(data)) if (isTestMark(data[id])) { delete data[id]; removed += 1; changed = true }
          if (changed && !writeJson(prefix + lang, data)) return { ok: false, removed }
        }
        _held.delete(lang)
        _pseudo.delete(lang)
        const plan = buildPlan(lang)
        const meta = Object.assign({}, metaRead(lang), { complete: false, at: Date.now() })
        if (plan !== null) {
          const held = heldBy(lang, plan)
          meta.total = plan.total
          meta.done = held.done
          meta.essentials = held.essentials
        }
        writeJson(I18N_META_PREFIX + lang, meta)
        return { ok: true, removed }
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
        if (pseudoStats(lang).n > 0) return false
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
          if (res.status === 404) return { ok: false, error: 'ROUTE_ABSENT: host route missing — update the main Kybernos plugin' }
          if (!res.ok) return { ok: false, error: 'HTTP_' + res.status + ': host route' }
          const json = await res.json()
          if (json !== null && typeof json === 'object' && json.ok === true && json.translations !== null && typeof json.translations === 'object') {
            return { ok: true, translations: json.translations, provider: json.provider, model: json.model }
          }
          return { ok: false, error: json !== null && typeof json === 'object' && typeof json.error === 'string' && json.error !== '' ? json.error : 'unexpected answer from the host route' }
        } catch (e) {
          if (signal !== null && signal !== undefined && signal.aborted) return { ok: false, aborted: true, error: 'cancelled' }
          return { ok: false, error: 'UNREACHABLE: host route unreachable — ' + String((e !== null && e !== undefined && e.message) || e) }
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
        if (plan === null) return { ok: false, error: 'SOURCE_MISSING: source strings not found — update the main Kybernos plugin', done: 0, total: 0 }
        const stores = { kb: i18nRead(lang), dsh: dshRead(lang) }
        const has = (it) => holds(stores[it.store][it.id])
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
              if (!flush(false) && stop === null) stop = { error: 'STORAGE_FULL: local storage full or unavailable' }
              report(model)
            }
          }
          await Promise.all(Array.from({ length: CONCURRENCY }, worker))
        }
        const flushed = flush(true)
        if (stop !== null && stop.paused) return { ok: false, paused: true, done, total: plan.total }
        if (!flushed && (stop === null || stop.error === undefined)) stop = { error: 'STORAGE_FULL: local storage full or unavailable' }
        if (stop !== null && stop.error !== undefined) return { ok: false, error: stop.error, done: persisted, total: plan.total }
        if (done === 0) return { ok: false, error: lastError || 'no string translated', done, total: plan.total }
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
        if (/^BUSY/.test(e)) return 'errBusy'
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
      // A run lives in THIS tab. While it goes on it writes a heartbeat; a tab that is closed leaves it behind,
      // and the next tab that opens takes the run over once the heartbeat is stale (a live one in another tab
      // keeps writing it, so two tabs never run the same language and never double the model bill).
      const intentRead = () => {
        const v = readJson(I18N_RUN_KEY, null)
        return v !== null && typeof v.lang === 'string' && Number.isFinite(Number(v.beat)) ? v : null
      }
      const intentWrite = (lang, route) => {
        try { localStorage.setItem(I18N_RUN_KEY, JSON.stringify({ lang, model: route !== null && route !== undefined ? route : null, beat: Date.now() })) } catch (e) { /* storage unavailable: the run goes on, it just cannot be picked up again */ }
      }
      const intentClear = () => { try { localStorage.removeItem(I18N_RUN_KEY) } catch (e) { /* storage unavailable */ } }
      const autoResumeOn = () => { try { return localStorage.getItem(I18N_AUTO_KEY) !== 'off' } catch (e) { return true } }
      const setAutoResume = (on) => { try { if (on) localStorage.removeItem(I18N_AUTO_KEY); else localStorage.setItem(I18N_AUTO_KEY, 'off') } catch (e) { /* storage unavailable */ } }
      // Pure: should a tab that just opened take over the run `it` describes?
      const shouldTakeOver = (it, now, auto) => it !== null && auto === true && now - Number(it.beat) >= RUN_STALE_MS
      let beatTimer = null
      const stopBeat = () => { if (beatTimer !== null) { clearInterval(beatTimer); beatTimer = null } }
      // The in-tab engine: what runs when the host cannot (a host that does not know the job route yet, i.e. DSH not restarted
      // since the update, or a plan too big for it). Same engine as before, with the heartbeat that lets a later tab take over.
      const startLocalRun = (lang, route) => {
        runControl = new AbortController()
        intentWrite(lang, route)
        stopBeat()
        beatTimer = setInterval(() => intentWrite(lang, route), RUN_BEAT_MS)
        runTranslation(lang, {
          route, signal: runControl.signal,
          onProgress: (p) => setRun({ done: p.done, total: p.total, areas: p.areas, essentials: p.essentials, startedWith: p.startedWith, elapsedMs: p.elapsedMs, model: p.model !== null && p.model !== undefined ? p.model : run.model }),
        }).then((result) => {
          // Finished, paused on purpose or failed: nothing to pick up again. Only a closed tab leaves the intent.
          stopBeat(); intentClear()
          if (result.paused) return setRun({ state: 'paused', done: result.done, total: result.total })
          if (!result.ok) return setRun({ state: 'failed', error: result.error || 'unknown failure', done: result.done, total: result.total })
          setRun({ state: result.missing > 0 ? 'partial' : 'done', done: result.done, total: result.total, missing: result.missing })
        }).catch((e) => { stopBeat(); intentClear(); setRun({ state: 'failed', error: String((e !== null && e !== undefined && e.message) || e) }) })
      }

      // ── The run on the HOST (packages/kybernos-plugin/i18n-job.mjs) ─────────
      // The page hands the texts that are still missing over ONCE; the host translates them, retries what is transient, writes
      // each batch to the disk as it lands and keeps the state in a file: closing the tab changes nothing, and a DSH that is
      // restarted picks the run up again. The page only watches (a poll every 2 s while it knows of a run), pulls what landed
      // into this browser's copy, and says so when it is over — a toast and a note in the bell, until someone has seen it.
      const JOB_PATH = '/kybernos/i18n-job'
      const JOB_POLL_MS = 2000
      const JOB_PULL_MS = 6000
      const JOB_LOST_AFTER = 6 // polls in a row without an answer before the page stops believing the run is going on
      const hostJobOn = () => window.__KB_I18N_HOST_JOB__ !== false
      // The JSON answer of the job route, or { ok:false, absent:true }: route absent (404 / HTML), host down, refused.
      const jobCall = async (body, query) => {
        try {
          const init = body === undefined ? { credentials: 'same-origin' }
            : { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
          const res = await fetch(JOB_PATH + (query || ''), init)
          if (res.status === 404 || res.status === 405) return { ok: false, absent: true }
          const json = await res.json()
          return json !== null && typeof json === 'object' ? json : { ok: false, absent: true }
        } catch (e) { return { ok: false, absent: true } }
      }
      // What the browser lacks, in the order a run translates it (core first), with the per-area bilan the host starts from.
      const missingFor = (lang, plan) => {
        const stores = { kb: i18nRead(lang), dsh: dshRead(lang) }
        const items = []
        const areas = {}
        for (const a of AREAS) areas[a] = { total: plan.areas[a].total, done: 0 }
        for (const a of AREAS) {
          for (const it of plan.items) {
            if (it.area !== a) continue
            if (holds(stores[it.store][it.id])) areas[a].done += 1
            else items.push({ wire: it.wire, text: it.text, area: a })
          }
        }
        return { items, areas }
      }
      // What the last host run of a language kept but doubts (a count and a few { wire, why }), and how many of its texts changed at
      // the source since it was translated: both are read from the host, never computed here.
      const doubtful = new Map()
      const staleOf = new Map()
      // Ready-made translations the project publishes, signed (kybernos-plugin/i18n-packs.mjs): which languages have one.
      // Read from the host's disk cache; asked of the network once per load, and only by the page that can offer them.
      const PACKS_PATH = '/kybernos/i18n-packs'
      let packs = new Map()
      let packsAsked = false
      const packsListeners = new Set()
      const packCall = async (body) => {
        try {
          const init = body === undefined ? { credentials: 'same-origin' }
            : { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
          const res = await fetch(PACKS_PATH, init)
          if (res.status === 404 || res.status === 405) return { ok: false, absent: true }
          const json = await res.json()
          return json !== null && typeof json === 'object' ? json : { ok: false, absent: true }
        } catch (e) { return { ok: false, absent: true } }
      }
      const takePacks = (r) => {
        if (r.ok !== true || !Array.isArray(r.packs)) return false
        packs = new Map(r.packs.filter((p) => p !== null && typeof p.lang === 'string').map((p) => [p.lang, p]))
        for (const fn of Array.from(packsListeners)) { try { fn(packs) } catch (e) { /* a dead listener must not stop the others */ } }
        return true
      }
      const loadPacks = async () => {
        if (!hostJobOn()) return false
        const r = await packCall()
        const got = takePacks(r)
        // Never asked the network (or it was unreachable): ask once; the answer is the signed index, or nothing.
        if (!packsAsked && r.ok === true && r.online !== undefined && (r.online.state === 'never' || r.online.state === 'offline')) {
          packsAsked = true
          takePacks(await packCall({ op: 'refresh' }))
        }
        return got
      }
      // Fill a language from its pack, then bring what the host wrote into this browser.
      const installPack = async (lang) => {
        const r = await packCall({ op: 'install', lang })
        if (r.ok !== true) return r
        registryAdd(lang)
        await pullDisk(lang)
        staleOf.delete(lang)
        takePacks(await packCall())
        return r
      }
      let hostLang = null // the language whose host run this page is watching
      let hostTimer = null
      let hostLost = 0
      let hostPulled = { at: 0, done: -1 }
      const stopWatching = () => { if (hostTimer !== null) { clearInterval(hostTimer); hostTimer = null } hostLang = null; hostLost = 0 }
      const notify = (n) => { try { const api = window.__KB_NOTIFY__; if (api !== undefined && api !== null && typeof api.push === 'function') api.push(n) } catch (e) { /* no bell: the page itself says it */ } }
      // The run is over (or stopped by itself): tell the person once, then mark it seen so no tab announces it again.
      const announceJob = (job) => {
        const name = langInfo(job.lang).native
        if (job.outcome === 'done') {
          notify({ id: 'lang:' + job.lang, kind: 'success', title: L('jobReady', { name }), body: L('jobReadyBody', { n: job.total }), action: { label: L('use'), event: 'kb-lang-use', detail: { lang: job.lang } } })
        } else if (job.outcome === 'partial') {
          notify({ id: 'lang:' + job.lang, kind: 'warn', title: L('jobPartial', { name, n: job.missing }), body: L('jobPartialBody'), action: { label: L('use'), event: 'kb-lang-use', detail: { lang: job.lang } } })
        } else if (job.outcome === 'failed') {
          notify({ id: 'lang:' + job.lang, kind: 'error', title: L('jobFailed', { name }), body: L(friendlyError(job.error)) })
        }
        return jobCall({ op: 'ack', lang: job.lang })
      }
      const pullDisk = async (lang) => { const d = diskRuntime(); if (d === null || typeof d.pull !== 'function') return false; try { return await d.pull(lang) } catch (e) { return false } }
      // One look at the run: reflect it in `run`, bring what landed into this browser, finish when it is over.
      const watchOnce = async () => {
        const lang = hostLang
        if (lang === null) return
        const r = await jobCall(undefined, '?lang=' + encodeURIComponent(lang))
        if (lang !== hostLang) return
        if (r.absent === true || r.ok !== true) {
          hostLost += 1
          if (hostLost >= JOB_LOST_AFTER) { stopWatching(); setRun({ state: 'failed', error: 'UNREACHABLE: host route unreachable — the translation may still be running on the host: reopen this page' }) }
          return
        }
        hostLost = 0
        const job = r.job
        if (job === null || job === undefined) { stopWatching(); if (run.state === 'running' || run.state === 'pausing') setRun({ state: 'idle' }); return }
        const live = job.state === 'running' || job.state === 'pausing'
        const patch = {
          lang, done: job.done, total: job.total, areas: job.areas, model: job.model !== null && job.model !== undefined ? job.model : run.model,
          essentials: job.areas !== null && job.areas !== undefined && job.areas.core !== undefined && job.areas.core.done >= job.areas.core.total,
          startedWith: Number.isFinite(Number(job.runFrom)) ? Number(job.runFrom) : run.startedWith, elapsedMs: Number.isFinite(Number(job.runAt)) ? Math.max(0, Date.now() - Number(job.runAt)) : run.elapsedMs,
        }
        if (live) {
          setRun(Object.assign(patch, { state: job.state }))
          if (job.done !== hostPulled.done && Date.now() - hostPulled.at >= JOB_PULL_MS) { hostPulled = { at: Date.now(), done: job.done }; await pullDisk(lang) }
          return
        }
        // Over: paused, done, partial or failed. Take the last of it, then say how it ended.
        stopWatching()
        if (job.flagged !== undefined && job.flagged !== null) doubtful.set(lang, job.flagged)
        staleOf.delete(lang)
        await pullDisk(lang)
        hostPulled = { at: 0, done: -1 }
        if (job.state === 'paused') { setRun(Object.assign(patch, { state: 'paused' })); return }
        if (job.state === 'failed') setRun(Object.assign(patch, { state: 'failed', error: job.error || 'unknown failure' }))
        else setRun(Object.assign(patch, { state: job.state === 'partial' ? 'partial' : 'done', missing: job.missing }))
        if (job.acked !== true) await announceJob(job)
      }
      const watchJob = (lang) => {
        stopWatching()
        hostLang = lang
        hostTimer = setInterval(() => { watchOnce().catch(() => { /* a poll that fails is counted by the next one */ }) }, JOB_POLL_MS)
        watchOnce().catch(() => { /* idem */ })
      }
      // Hand the run to the host. Resolves { mode: 'host' } (it runs there now), { mode: 'local' } (the host cannot: the
      // in-tab engine takes over) or { mode: 'error', error } (a refusal the person has to know about).
      const hostStart = async (lang, route) => {
        if (!hostJobOn()) return { mode: 'local' }
        const plan = buildPlan(lang)
        if (plan === null) return { mode: 'local' } // the engine reports SOURCE_MISSING itself
        // A host that speaks protocol 2 is sent the WHOLE plan, with the translation this browser holds for each text: it
        // adopts what its disk lacks, then works out what is missing or changed at the source. An older host (it would
        // translate every text it is sent) gets the missing ones only, as before.
        const probe = await jobCall()
        const full = probe.ok === true && Number(probe.v) >= 2
        const miss = missingFor(lang, plan)
        let body
        if (full) {
          const stores = { kb: i18nRead(lang), dsh: dshRead(lang) }
          const items = plan.items.map((it) => {
            const have = stores[it.store][it.id]
            const o = { wire: it.wire, text: it.text, area: it.area }
            if (holds(have) && typeof have === 'string') o.have = have
            return o
          })
          body = { op: 'start', lang, langName: langInfo(lang).english, source: 'fr', full: true, items }
        } else {
          if (miss.items.length === 0) return { mode: 'local' } // nothing to do: the engine says « done » on its own
          body = { op: 'start', lang, langName: langInfo(lang).english, source: 'fr', total: plan.total, areas: miss.areas, items: miss.items }
        }
        body.route = route !== null && route !== undefined && typeof route.provider === 'string' ? { provider: route.provider, model: route.model } : null
        const r = await jobCall(body)
        if (r.absent === true) return { mode: 'local' }
        if (r.ok === true) return { mode: 'host' }
        if (r.error === 'busy') return { mode: 'error', error: 'BUSY : ' + langInfo(String(r.lang || '')).native, busy: String(r.lang || '') }
        return { mode: 'local' } // a plan the host does not accept: the engine can still do it
      }
      // How many texts of a translated language changed at the source since it was translated. One question per language
      // and page load (the host answers from the hash it kept of each source), cached until a run ends.
      const checkStale = async (lang) => {
        if (!hostJobOn() || staleOf.has(lang)) return staleOf.get(lang)
        const plan = buildPlan(lang)
        if (plan === null) return 0
        staleOf.set(lang, 0)
        const r = await jobCall({ op: 'stale', lang, items: plan.items.map((it) => ({ wire: it.wire, text: it.text })) })
        const n = r.ok === true && Number.isInteger(r.stale) ? r.stale : 0
        staleOf.set(lang, n)
        return n
      }
      // A pause asked for while the page is still handing the run over (a few milliseconds) is kept and applied right after.
      let starting = false
      let pauseWanted = false
      const applyPause = () => {
        if (hostLang !== null) {
          jobCall({ op: 'pause', lang: hostLang }).then(() => { watchOnce().catch(() => { /* the poll goes on */ }) })
          return
        }
        if (runControl !== null) { try { runControl.abort() } catch (e) { /* already finished */ } }
      }
      const startRun = (lang, route) => {
        if (run.state === 'running' || run.state === 'pausing') return false
        registryAdd(lang)
        setRun({ state: 'running', lang, done: 0, total: 0, areas: null, model: route !== null && route !== undefined ? route.model : null, error: null, missing: 0, essentials: false, startedWith: 0, elapsedMs: 0 })
        // A page that keeps the run in the tab (tests, live checks, a host that does not know the route) starts at once.
        if (!hostJobOn()) { startLocalRun(lang, route); return true }
        starting = true
        pauseWanted = false
        hostStart(lang, route).then((out) => {
          starting = false
          if (out.mode === 'host') watchJob(lang)
          else if (out.mode === 'error') { pauseWanted = false; setRun({ state: 'failed', error: out.error }); return }
          else startLocalRun(lang, route)
          if (pauseWanted) { pauseWanted = false; applyPause() }
        }).catch(() => { starting = false; startLocalRun(lang, route); if (pauseWanted) { pauseWanted = false; applyPause() } })
        return true
      }
      const pauseRun = () => {
        if (run.state !== 'running') return
        if (starting) { pauseWanted = true; setRun({ state: 'pausing' }); return }
        if (hostLang === null && runControl === null) return
        setRun({ state: 'pausing' })
        applyPause()
      }
      // At load: a run the HOST has (it went on while no tab was open, or it ended and nobody has seen how): watch it, or say
      // how it ended. Before that, a plan may not exist yet (DSH registers its dictionaries a little later): the watch itself
      // does not need one.
      const bootJobs = async () => {
        if (!hostJobOn()) return false
        const r = await jobCall()
        if (r.ok !== true || !Array.isArray(r.jobs)) return false
        for (const job of r.jobs) {
          if (typeof job.lang !== 'string') continue
          if (job.state === 'running' || job.state === 'pausing') {
            if (run.state === 'idle') { setRun({ state: job.state, lang: job.lang, done: job.done, total: job.total, areas: job.areas, model: job.model, essentials: false, startedWith: Number(job.runFrom) || 0, elapsedMs: 0 }); watchJob(job.lang) }
          } else if (job.acked === false && (job.outcome === 'done' || job.outcome === 'partial' || job.outcome === 'failed')) {
            await pullDisk(job.lang)
            await announceJob(job)
          }
        }
        return true
      }
      // At load: a run the previous tab left behind goes on by itself (unless the user switched that off). The
      // plan exists only once DSH has registered its dictionaries, so look again for a while; and look again at
      // the heartbeat just before starting, a second tab may have taken the run over in the meantime.
      const autoResume = async (o) => {
        const sleep = o !== undefined && typeof o.sleep === 'function' ? o.sleep : () => new Promise((r) => setTimeout(r, 1000))
        const now = o !== undefined && typeof o.now === 'function' ? o.now : Date.now
        const it = intentRead()
        if (!shouldTakeOver(it, now(), autoResumeOn()) || run.state !== 'idle') return false
        const lang = it.lang
        if (managedIds().indexOf(lang) < 0 || isComplete(lang)) { intentClear(); return false }
        for (let i = 0; i < 90 && buildPlan(lang) === null; i += 1) await sleep()
        if (buildPlan(lang) === null) return false
        let route = it.model !== null && typeof it.model === 'object' && typeof it.model.model === 'string' ? it.model : null
        if (route === null) {
          const res = await fetchModels()
          let saved = ''
          try { saved = localStorage.getItem(I18N_MODEL_KEY) || '' } catch (e) { /* storage unavailable */ }
          const m = res.models.find((x) => x.id === saved) || res.models.find((x) => x.id === res.preferred)
          if (m !== undefined) route = { provider: m.provider, model: m.model }
        }
        if (!shouldTakeOver(intentRead(), now(), autoResumeOn()) || run.state !== 'idle') return false
        return startRun(lang, route)
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
      // Many pages carry their text in the code, outside any table, so a run can't know it.
      // While a translated language is active, text that appears in one of the
      // LIVE_ROOTS below and has no translation yet is queued, translated through the
      // same host route (source: auto), cached under `kybernos.i18n.live.<lang>`, and
      // swapped in place. The first visit to a page shows the original for a
      // moment; every later one is instant. The chat messages, session titles and
      // other content are never touched (the account menu and the mobile-app button
      // are rendered by another plugin, with its own English/French table). Dialogs
      // are left out on purpose: they quote session and file names.
      // Settings pages, menus, the sidebar footer, the language pickers — and (A2-23) the pages and cards the Kybernos plugins draw outside Settings:
      // the Skills and Connectors pages, Dashboards, the cards of the chat chips (Changes, Usage, Summary, Calls, Motion), Kaby and the computer page, and the
      // sidebar's section headers (the « Search everywhere » button). A text the plugin has no table for in this language is learned there on first view.
      const LIVE_ROOTS = [
        '[data-slot="settings.section"]', '[role="menu"]', '[data-slot="sidebar.footer.action"]', '[data-kb="ld-picker"]', '[data-kb="ld-pack"]',
        '.kbs-root', '.kb7-root', '[data-kb="dashboards-page"]', '.kbdb-pop',
        '[data-kb="changes-card"]', '[data-kb="kybernos-usage-card"]', '.kbsm-card', '[data-kb="kybernos-call-panel"]', '[data-kb="motion-panel"]',
        '[data-kb="kybernos-kyber-page"]', '[data-kb="computers-page"]', '[class*="sectionHeader"]',
      ].join(',')
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
        const step = (n, title, body) => h('li', { key: n, className: 'kbln-step s' + n },
          h('b', { 'aria-hidden': 'true' }, String(n)),
          h('div', null, h('div', { className: 'kbln-step-t' }, title), h('div', { className: 'kbln-step-b' }, body)))
        const badge = (t) => h('span', { className: 'kbln-mm-b' }, t)
        return h('section', { id: 'kbln-help', className: 'kbln-help', 'data-help': 'panel', 'aria-label': L('helpTitle') },
          h('div', { className: 'kbln-mm', role: 'img', 'aria-label': L('mockCaption') },
            h('div', { className: 'kbln-mm-bar' }, h('span', null, L('title')), h('span', { className: 'kbln-mm-hi' }, h('i', { className: 'kbln-mm-w1' }, 'Hello'), h('i', { className: 'kbln-mm-w2' }, 'Hola'))),
            h('div', { className: 'kbln-mm-row en' }, badge('EN'),
              h('div', { className: 'kbln-mm-i' }, h('span', { className: 'kbln-mm-n' }, 'English')),
              h('div', { className: 'kbln-mm-acts' }, h('span', { className: 'kbln-mm-pill en' }, L('inUse')))),
            h('div', { className: 'kbln-mm-row es' }, badge('ES'),
              h('div', { className: 'kbln-mm-i' }, h('span', { className: 'kbln-mm-n' }, 'Español'),
                h('div', { className: 'kbln-mm-st' }, h('span', { className: 't1' }, L('mockNew')), h('span', { className: 't2' }, L('translating')), h('span', { className: 't3' }, L('ready')))),
              h('div', { className: 'kbln-mm-acts' },
                h('span', { className: 'kbln-mm-go' }, L('start')), h('span', { className: 'kbln-mm-pa' }, L('pause')),
                h('span', { className: 'kbln-mm-us' }, L('use')), h('span', { className: 'kbln-mm-pill es' }, L('inUse'))),
              h('div', { className: 'kbln-mm-track' }, h('i', { className: 'kbln-mm-fill' }))),
            h('div', { className: 'kbln-mm-pick' }, h('span', { className: 'kbln-mm-chip on' }, 'Español'), h('span', { className: 'kbln-mm-chip' }, 'Deutsch'), h('span', { className: 'kbln-mm-chip' }, '日本語')),
            h('div', { className: 'kbln-mm-cur' })),
          h('div', { className: 'kbln-help-text' },
            h('div', { className: 'kbln-help-h' }, L('helpTitle')),
            h('ol', { className: 'kbln-steps' }, step(1, L('addLang'), L('step1Body')), step(2, L('start'), L('step2Body')), step(3, L('use'), L('step3Body'))),
            h('div', { className: 'kbln-note' }, L('helpNote'))))
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
        const [autoOn, setAutoOn] = React.useState(autoResumeOn)
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
        // Where the translations are kept (disk or browser only) can change after the page opened.
        React.useEffect(() => { const d = diskRuntime(); return d !== null ? d.watch(() => setTick((n) => n + 1)) : undefined }, [])
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
        // Where the translations are kept: on the disk (shared by every browser), or in this
        // browser only (DSH not restarted since the disk copy was added, or the host is down).
        const diskLine = () => {
          const d = diskRuntime()
          if (d === null) return null
          const st = d.status()
          if (st.state === 'on' && st.error === '') return h('div', { key: 'disk', className: 'kbln-note', 'data-disk': 'on', title: L('tipDiskOn') }, L('diskOn', { dir: st.dir }))
          if (st.state === 'on') return h('div', { key: 'disk', className: 'kbln-note', 'data-disk': 'error', role: 'status', title: L('tipDiskOff') }, L('diskErr', { err: st.error }))
          if (st.state === 'off' && st.error !== 'disabled') return h('div', { key: 'disk', className: 'kbln-note', 'data-disk': 'off', role: 'status', title: L('tipDiskOff') }, L('diskOff'))
          return null
        }
        const route = () => {
          const m = models.find((x) => x.id === selectedModel)
          return m !== undefined ? { provider: m.provider, model: m.model } : null
        }
        const modelName = () => { const m = models.find((x) => x.id === selectedModel); return m !== undefined ? m.name : null }
        const activate = (id) => { setActiveLang(id); activateLanguage(id) }
        // Test marks are taken out first: they would otherwise count as translated and nothing would be redone.
        const start = (id) => { setDetails(false); if (pseudoStats(id).n > 0) repairPseudo(id); startRun(id, route()) }
        // Ready-made translations: which languages have one (signed, from the project), and the install in progress.
        const [packBusy, setPackBusy] = React.useState(null)
        const [packNote, setPackNote] = React.useState(null) // { id, ok, text } after an install
        React.useEffect(() => {
          const redraw = () => setTick((k) => k + 1)
          packsListeners.add(redraw)
          loadPacks().then((got) => { if (got) redraw() }).catch(() => { /* no packs: nothing to offer */ })
          return () => { packsListeners.delete(redraw) }
        }, [])
        const installReady = async (id) => {
          setPackBusy(id); setPackNote(null)
          let r = { ok: false, error: 'unreachable' }
          try { r = await installPack(id) } catch (e) { /* r says it */ }
          setPackBusy(null)
          setPackNote(r.ok === true
            ? { id, ok: true, text: L('packDone', { added: fmtN(r.added), kept: fmtN(r.kept) }) }
            : { id, ok: false, text: L('packFailed', { why: String(r.error || 'unreachable') }) })
          setTick((k) => k + 1)
        }
        // Texts that changed at the source since a language was translated: asked of the host for the languages that are
        // complete, once per load (the answer is cached until a run ends); the page redraws when it comes.
        React.useEffect(() => {
          let alive = true
          const ids = managedIds().filter((x) => !isBuiltIn(x) && isComplete(x))
          ;(async () => { for (const id of ids) { if (!alive) return; try { const before = staleOf.get(id); const n = await checkStale(id); if (alive && n !== before) setTick((k) => k + 1) } catch (e) { /* the host cannot say: nothing to show */ } } })()
          return () => { alive = false }
        }, [snap.state])
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
          const pseudo = isBuiltIn(id) ? { n: 0, examples: [] } : pseudoStats(id)
          const inUse = activeLang === id
          const st = isRun ? snap.state : null
          const running = st === 'running' || st === 'pausing'
          const held = typeof meta.done === 'number' || isBuiltIn(id) ? null : heldBy(id, plan)
          const staticDone = typeof meta.done === 'number' ? meta.done : (held !== null ? held.done : 0)
          const total = running ? (snap.total || (plan !== null ? plan.total : 0)) : (plan !== null ? plan.total : (typeof meta.total === 'number' ? meta.total : 0))
          const done = isRun ? snap.done : staticDone
          const pct = total > 0 ? Math.min(100, Math.floor(done / total * 100)) : 0
          const hasProgress = !complete && !isBuiltIn(id) && done > 0
          const essentialsOk = isRun ? (snap.essentials === true) : (typeof meta.essentials === 'boolean' ? meta.essentials : (held !== null && held.essentials))
          const canUseNow = !isBuiltIn(id) && !complete && essentialsOk && !inUse && pseudo.n === 0

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
          const pack = isBuiltIn(id) ? undefined : packs.get(id)
          const offerPack = pack !== undefined && !complete && !running && packBusy !== id
          const goButton = () => h('button', { key: 'go', className: 'kbln-btn' + (offerPack ? '' : ' primary'), type: 'button', 'data-act': 'start', disabled: snap.state === 'running' || snap.state === 'pausing' || models.length === 0, title: models.length === 0 ? L('noModels') : (st === 'partial' ? L('tipRetry') : (hasProgress || st === 'paused' || st === 'failed') ? L('tipResume') : L('tipStart')), onClick: () => start(id) },
              st === 'partial' ? L('retryMissing') : (hasProgress || st === 'paused' || st === 'failed') ? L('resume') : L('start'))
          if (inUse) {
            acts.push(h('span', { key: 'use', className: 'kbln-pill ok', 'data-act': 'in-use', title: L('tipInUse') }, L('inUse')))
            // In use but not finished (an older translation, a paused run): it can still be completed.
            if (!complete && !running) acts.push(goButton())
          }
          else if (running) {
            if (canUseNow) acts.push(h('button', { key: 'now', className: 'kbln-btn', type: 'button', 'data-act': 'use-now', title: L('tipUseNow'), onClick: () => activate(id) }, L('useNow')))
            acts.push(h('button', { key: 'pause', className: 'kbln-btn', type: 'button', 'data-act': 'pause', title: L('tipPause'), disabled: st === 'pausing', onClick: pauseRun }, L(st === 'pausing' ? 'pausing' : 'pause')))
          } else if (complete || st === 'done') acts.push(h('button', { key: 'use', className: 'kbln-btn primary', type: 'button', 'data-act': 'use', title: L('tipUse'), onClick: () => activate(id) }, L('use')))
          else {
            if (canUseNow) acts.push(h('button', { key: 'now', className: 'kbln-btn', type: 'button', 'data-act': 'use-now', title: L('tipUseNow'), onClick: () => activate(id) }, L(st === 'partial' ? 'useAnyway' : 'useNow')))
            else if (done > 0 && pseudo.n === 0) acts.push(h('button', { key: 'any', className: 'kbln-btn', type: 'button', 'data-act': 'use-now', title: L('tipUseAnyway'), onClick: () => activate(id) }, L('useAnyway')))
            if (offerPack) acts.push(h('button', { key: 'pack', className: 'kbln-btn primary', type: 'button', 'data-act': 'install-pack', onClick: () => installReady(id) }, L('packInstall')))
            acts.push(goButton())
          }
          if (!isBuiltIn(id) && !running) {
            acts.push(h('div', { key: 'menu', className: 'kbln-menu' },
              h('button', { className: 'kbln-btn quiet', type: 'button', 'data-act': 'menu', 'aria-label': L('more'), title: L('more'), 'aria-haspopup': 'menu', onClick: (e) => { e.stopPropagation(); setMenuFor(menuFor === id ? null : id) } }, '⋯'),
              menuFor === id
                ? h('div', { className: 'kbln-menu-pop', role: 'menu', onClick: (e) => e.stopPropagation() },
                    h('button', { role: 'menuitem', type: 'button', 'data-act': 'again', title: L('tipAgain'), onClick: () => { setMenuFor(null); try { localStorage.removeItem(I18N_STORE_PREFIX + id); localStorage.removeItem(I18N_DSH_PREFIX + id); localStorage.removeItem(I18N_LIVE_PREFIX + id); localStorage.removeItem(I18N_META_PREFIX + id) } catch (e2) { /* */ } start(id) } }, L('again')),
                    h('button', { role: 'menuitem', type: 'button', 'data-act': 'remove', disabled: inUse, title: inUse ? L('removeActive') : L('tipRemove'), onClick: () => { setMenuFor(null); setAskRemove(id) } }, L('remove')))
                : null))
          }

          // body: progress, errors, remove confirmation
          const body = []
          // A failure before anything was translated shows the cause only: no empty bars.
          // Also for a language that is not running but holds some progress (after a reload, a closed tab): the bar
          // is the one place that says how far it is.
          if (running || st === 'paused' || (st === 'failed' && snap.done > 0) || (st === null && hasProgress)) {
            const mins = running ? minutesLeft(snap) : null
            body.push(h('div', { key: 'prog', className: 'kbln-prog' },
              h('div', { className: 'kbln-bar' + (running ? '' : ' stale'), role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct, title: L('tipProgress') },
                h('i', { style: { width: pct + '%' } })),
              h('div', { className: 'kbln-prog-line' },
                h('span', null, L('counts', { done: fmtN(done), total: fmtN(total) })),
                h('b', { style: { fontWeight: 500 } }, running ? (mins === null ? L('estimating') : L('left', { m: mins })) : pct + ' %')),
              isRun && snap.areas !== null && snap.areas !== undefined
                ? h('div', { className: 'kbln-areas' },
                    AREAS.filter((a) => snap.areas[a].total > 0).map((a) => {
                      const ar = snap.areas[a]
                      const p = Math.min(100, Math.floor(ar.done / ar.total * 100))
                      return [
                        h('span', { key: a + 't', title: L(a === 'core' ? 'tipAreaCore' : a === 'more' ? 'tipAreaMore' : 'tipAreaPhrases') }, L(a === 'core' ? 'areaCore' : a === 'more' ? 'areaMore' : 'areaPhrases')),
                        h('div', { key: a + 'b', className: 'kbln-bar sm' + (p >= 100 ? ' done' : '') }, h('i', { style: { width: p + '%' } })),
                        h('span', { key: a + 'n', className: 'n' }, p + '%'),
                      ]
                    }))
                : null,
              running && snap.essentials ? h('div', { className: 'kbln-note' }, L('essentials')) : null))
          }
          if (running) body.push(h('div', { key: 'tab', className: 'kbln-banner', role: 'status', 'data-note': 'in-tab' }, L(autoOn ? 'runsInTab' : 'runsInTabManual')))
          // The tab was closed during a run and the automatic resume is off: say why it stopped.
          if (!running && st === null && !complete && !autoOn && !isBuiltIn(id)) {
            const left = intentRead()
            if (left !== null && left.lang === id) body.push(h('div', { key: 'cut', className: 'kbln-banner warn', role: 'status', 'data-note': 'cut' }, L('cutNote')))
          }
          if (pseudo.n > 0 && !running) {
            // Collapsed by default: one summary line with the count and a chevron
            // (native <details>). Blocking errors stay outside this fold.
            body.push(h('details', { key: 'pseudo', className: 'kbln-banner warn kbln-fold', 'data-note': 'pseudo' },
              h('summary', null,
                h('span', { className: 'kbln-chev', 'aria-hidden': true }, '▸'),
                L('pseudoSummary', { n: fmtN(pseudo.n) })),
              h('div', null, h('b', null, L('pseudoTitle', { n: fmtN(pseudo.n) })), ' ', L('pseudoBody')),
              h('div', { className: 'kbln-row', style: { gap: 8 } },
                h('button', { className: 'kbln-btn primary', type: 'button', 'data-act': 'repair', title: L('tipRepair'), disabled: models.length === 0, onClick: () => start(id) }, L('repair'))),
              h('div', { className: 'kbln-ex' }, pseudo.examples.map((x) => h('div', { key: x.store + x.id }, x.id + ' → ' + x.text)))))
          }
          if (st === 'failed') {
            const key = friendlyError(snap.error)
            body.push(h('div', { key: 'err', className: 'kbln-err', role: 'alert' },
              h('div', null, L(key)),
              snap.done > 0 ? h('div', { className: 'kbln-note' }, L('kept')) : null,
              h('div', { className: 'kbln-row', style: { gap: 8 } },
                h('button', { className: 'kbln-btn', type: 'button', 'data-act': 'choose-model', title: L('tipChooseModel'), onClick: chooseModel }, L('chooseModel')),
                h('button', { className: 'kbln-link', type: 'button', 'data-act': 'details', title: L('tipDetails'), onClick: () => setDetails(!details) }, L(details ? 'hideDetails' : 'showDetails'))),
              details ? h('code', null, String(snap.error)) : null))
          }
          if (st === 'partial') body.push(h('div', { key: 'gaps', className: 'kbln-note' }, L('gaps', { n: fmtN(snap.missing) })))
          // A ready-made translation the project published for this language: offered above, explained here.
          if (pack !== undefined && !complete && !running) {
            body.push(h('div', { key: 'pack', className: 'kbln-note', 'data-note': 'pack' },
              L('packNote', { n: fmtN(pack.counts.kb + pack.counts.dsh) }) + (pack.reviewed ? ' (' + L('packReviewed') + ')' : '')))
          }
          if (packBusy === id) body.push(h('div', { key: 'packbusy', className: 'kbln-note', role: 'status' }, L('packInstalling')))
          if (packNote !== null && packNote.id === id) body.push(h('div', { key: 'packnote', className: packNote.ok ? 'kbln-note' : 'kbln-err', role: packNote.ok ? 'status' : 'alert', 'data-note': 'pack-result' }, packNote.text))
          // Texts of a translated language whose source changed since: only those are translated again.
          const staleN = !isBuiltIn(id) && !running && complete ? (staleOf.get(id) || 0) : 0
          if (staleN > 0) {
            body.push(h('details', { key: 'stale', className: 'kbln-banner warn kbln-fold', 'data-note': 'stale' },
              h('summary', null, h('span', { className: 'kbln-chev', 'aria-hidden': true }, '▸'), L('staleSummary', { n: fmtN(staleN) })),
              h('div', null, L('staleBody')),
              h('div', { className: 'kbln-row', style: { gap: 8 } },
                h('button', { className: 'kbln-btn primary', type: 'button', 'data-act': 'update', disabled: models.length === 0, title: models.length === 0 ? L('noModels') : undefined, onClick: () => start(id) }, L('staleUpdate')))))
          }
          // Texts the host kept but doubts (identical to the source, a product name that vanished): listed, never refused.
          const doubt = !isBuiltIn(id) && !running ? doubtful.get(id) : undefined
          if (doubt !== undefined && doubt.count > 0) {
            body.push(h('details', { key: 'doubt', className: 'kbln-banner kbln-fold', 'data-note': 'doubt' },
              h('summary', null, h('span', { className: 'kbln-chev', 'aria-hidden': true }, '▸'), L('doubtSummary', { n: fmtN(doubt.count) })),
              h('div', null, L('doubtBody')),
              h('div', { className: 'kbln-ex' }, doubt.examples.map((x) => h('div', { key: x.wire }, x.wire.replace(/^(kb|dsh):/, '') + ' — ' + String(x.why).split('+').map((w) => { const k = 'doubtWhy_' + w.split(':')[0]; return S[k] !== undefined ? L(k) + (w.indexOf(':') > 0 ? ' (' + w.split(':')[1] + ')' : '') : w }).join(', '))))))
          }
          if (!isBuiltIn(id) && !complete && !running && st === null && plan !== null && !hasProgress) {
            const lines = []
            if (!plan.dshAvailable && !plan.dshNative) lines.push(L('noDsh'))
            if (plan.dshNative) lines.push(L('zhNative'))
            if (modelName() !== null) lines.push(L('usesModel', { model: modelName() }))
            if (lines.length > 0) body.push(h('div', { key: 'info', className: 'kbln-note' }, lines.join(' · ')))
          }
          if (askRemove === id) {
            body.push(h('div', { key: 'rm', className: 'kbln-err', role: 'alertdialog' },
              h('div', null, L('removeAsk', { name: info.native })),
              h('div', { className: 'kbln-row', style: { gap: 8 } },
                h('button', { className: 'kbln-btn danger', type: 'button', 'data-act': 'confirm-remove', onClick: () => { dropLanguage(id); setAskRemove(null); setTick((n) => n + 1) } }, L('confirmRemove')),
                h('button', { className: 'kbln-btn', type: 'button', onClick: () => setAskRemove(null) }, L('cancel')))))
          }

          const badge = info.id === 'kybernos' ? 'FR' : info.id.toUpperCase()
          return h('div', { key: id, className: 'kbln-lang' + (inUse ? ' on' : ''), 'data-lang': id },
            h('div', { className: 'kbln-lang-top' },
              h('div', { className: 'kbln-badge', 'aria-hidden': 'true' }, badge),
              h('div', { className: 'kbln-lang-info' },
                h('div', { className: 'kbln-lang-name' },
                  h('span', { lang: id === 'kybernos' ? 'fr' : id }, info.native),
                  info.english !== info.native ? h('span', { className: 'kbln-lang-en' }, info.english) : null,
                  info.rtl ? h('span', { className: 'kbln-pill', title: L('tipRtl') }, L('rtl')) : null),
                h('div', { className: 'kbln-lang-meta', title: !complete && !running && st === null && !hasProgress && !isBuiltIn(id) ? L('tipEstimate') : undefined }, metaLine)),
              h('div', { className: 'kbln-lang-act' }, acts)),
            body)
        }

        // ── the ISO picker ─────────────────────────────────────────────────
        const taken = new Set(['kybernos', 'en', 'fr'].concat(managedIds()))
        const q = query.trim().toLocaleLowerCase()
        const all = ISO_639_1.filter((c) => c !== 'en' && c !== 'fr').map(langInfo)
        const filtered = q === '' ? all : all.filter((i) => (i.id + ' ' + i.native + ' ' + i.english).toLocaleLowerCase().indexOf(q) >= 0)
        filtered.sort((a, b) => a.english.localeCompare(b.english))
        const isoBtn = (i) => h('button', { key: i.id, type: 'button', className: 'kbln-iso-i', 'data-iso': i.id, disabled: taken.has(i.id), title: taken.has(i.id) ? L('added') : L('tipAddLang', { name: i.english, code: i.id }), onClick: () => addLanguage(i.id) },
          h('b', { lang: i.id }, i.native), i.english !== i.native ? h('small', null, i.english) : null, packs.has(i.id) ? h('small', { className: 'kbln-chip-tag' }, L('packTag')) : null, h('code', null, i.id))
        const picker = pickerOpen
          ? h('div', { className: 'kbln-add-body' },
              h('input', { className: 'kbln-input', type: 'search', autoFocus: true, placeholder: L('search'), value: query, 'aria-label': L('search'), onChange: (e) => setQuery(e.target.value) }),
              q === '' ? h('div', { className: 'kbln-sec-t' }, L('popular')) : null,
              q === '' ? h('div', { className: 'kbln-chips' }, POPULAR.map(langInfo).map((i) => h('button', { key: i.id, type: 'button', className: 'kbln-chip', 'data-iso': i.id, title: taken.has(i.id) ? L('added') : L('tipAddLang', { name: i.english, code: i.id }), disabled: taken.has(i.id), onClick: () => addLanguage(i.id) }, i.native, packs.has(i.id) ? h('small', { className: 'kbln-chip-tag' }, ' · ' + L('packTag')) : null))) : null,
              h('div', { className: 'kbln-sec-t' }, L('allLangs')),
              filtered.length > 0 ? h('div', { className: 'kbln-iso' }, filtered.map(isoBtn)) : h('div', { className: 'kbln-note' }, L('noMatch')))
          : null

        return h('div', { className: 'kbln-page', 'data-kb': 'language-page' },
          h('div', { className: 'kbln-main' },
            h('div', { className: 'kbln-head' },
              h('div', { className: 'kbln-head-row' },
                h('div', { className: 'kbln-title' }, L('title')),
                h('button', { className: 'kbln-help-btn', type: 'button', 'data-act': 'help', 'aria-expanded': helpOpen ? 'true' : 'false', 'aria-controls': 'kbln-help', title: L('tipHelp'), onClick: toggleHelp },
                  h('span', { className: 'kbln-help-q', 'aria-hidden': 'true' }, '?'), L('helpBtn'))),
              h('div', { className: 'kbln-sub' }, L('sub'))),
            helpOpen ? h(HelpPanel, null) : null,
            h('div', { className: 'kbln-sec' },
              h('div', { className: 'kbln-langs' }, langs.map(row)),
              h('div', { className: 'kbln-add' },
                h('button', { className: 'kbln-add-h', type: 'button', 'data-act': 'add-language', title: L('tipAdd'), 'aria-expanded': pickerOpen ? 'true' : 'false', onClick: () => setPickerOpen(!pickerOpen) },
                  h('span', { 'aria-hidden': 'true' }, pickerOpen ? '−' : '+'), L('addLang')),
                picker),
              h('details', { className: 'kbln-adv', ref: advRef },
                h('summary', { title: L('tipAdvanced') }, L('advanced')),
                h('div', { className: 'kbln-adv-body' },
                  models.length > 0
                    ? h('div', { className: 'kbln-row' },
                        h('span', { className: 'kbln-lb' }, L('modelLabel')),
                        h('select', {
                          className: 'kbln-select', value: selectedModel, disabled: snap.state === 'running',
                          'aria-label': L('modelLabel'), title: L('tipModel'),
                          onChange: (e) => { setSelectedModel(e.target.value); try { localStorage.setItem(I18N_MODEL_KEY, e.target.value) } catch (ex) { /* */ } },
                        }, models.map((m) => h('option', { key: m.id, value: m.id }, m.name + ' (' + m.provider + ')'))))
                    : null,
                  h('div', { className: 'kbln-hint' }, models.length > 0 ? L('modelHint') : L('noModels')),
                  h('label', { className: 'kbln-check', title: L('tipAuto') },
                    h('input', { type: 'checkbox', 'data-act': 'autoresume', checked: autoOn, onChange: (e) => { setAutoResume(e.target.checked); setAutoOn(e.target.checked) } }),
                    L('autoLabel')))),
              diskLine())))
      }

      // Opens this page from anywhere in the settings: the nav entry is found by its
      // label (the one registered at boot, or either of its two source spellings).
      const openLanguagePage = () => {
        const plain = (t) => String(t || '').replace(/[⟦⟧]/g, '').trim()
        const names = [plain(L('title')), S.title[0], S.title[1]]
        const entry = Array.from(document.querySelectorAll('button,[role="tab"],a')).find((b) => {
          const own = plain(b.innerText).split('\n')[0]
          return names.indexOf(own) >= 0 && b.closest('.kbln-page') === null && b.closest('[data-slot="settings.general.item"]') === null
        })
        if (entry !== undefined) entry.click()
        return entry !== undefined
      }
      // From outside Settings (the footer ring): open the dialog with its own trigger, then the Language entry.
      // Same two anchors as the account menu of the cloud plugin; the hashed class prefixes change at every
      // build, their suffixes do not.
      const openLanguageFromAnywhere = async () => {
        // Not `.kbln-page`: the Theme page uses the same class prefix.
        const shown = () => document.querySelector('[data-kb="language-page"]') !== null
        const settle = (ms) => new Promise((r) => setTimeout(r, ms))
        if (shown()) return true
        const opened = openLanguagePage() // Settings are already open on another section
        if (!opened) {
          const trigger = document.querySelector('[class*="settingsArea"] button[class*="trigger"]') || document.querySelector('button[aria-label="Settings"]')
          if (trigger === null) return false
          trigger.click()
          // The dialog restores the section it was last on while it mounts: a click on the nav entry that comes
          // first is overwritten. Wait for it to settle, then click until the page is really there.
          await settle(600)
        }
        for (let i = 0; i < 100; i += 1) {
          if (shown()) return true
          openLanguagePage()
          await settle(150)
        }
        return shown()
      }
      // A ring in the sidebar footer, only while a translation runs: it is visible from every page, so the
      // run no longer hides behind the Language page.
      function RunRing() {
        const [snap, setSnap] = React.useState(run)
        React.useEffect(() => { setSnap(run); return subscribeRun(setSnap) }, [])
        if (snap.state !== 'running' && snap.state !== 'pausing') return null
        const pct = snap.total > 0 ? Math.min(100, Math.floor(snap.done / snap.total * 100)) : 0
        const label = L('chipTitle', { name: langInfo(snap.lang).native, pct })
        return h('button', { type: 'button', className: 'kbln-ring', 'data-act': 'run-ring', 'aria-label': label, title: label, style: { '--p': pct }, onClick: () => { openLanguageFromAnywhere() } },
          h('span', { className: 'kbln-ring-n', 'aria-hidden': 'true' }, String(pct)))
      }
      function GeneralLink() {
        return h('div', { className: 'kbln-gl' },
          h('button', { type: 'button', className: 'kbln-gl-link', 'data-act': 'manage-languages', onClick: openLanguagePage }, L('manageLink')))
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
          isTestMark, holds, pseudoStats, repairPseudo, intentRead, intentWrite, intentClear, shouldTakeOver, autoResume, autoResumeOn, setAutoResume,
          resetRun: () => { stopBeat(); stopWatching(); run = { state: 'idle', lang: null, done: 0, total: 0, areas: null, model: null, error: null, missing: 0, essentials: false, startedWith: 0, elapsedMs: 0 } },
          startRun, pauseRun, subscribeRun, getRun: () => run, friendlyError, langInfo, ISO_639_1, POPULAR, isLiveCandidate,
          bootJobs, watchOnce, missingFor, stopWatching, hostStart, announceJob, JOB_LOST_AFTER, checkStale, staleOf, doubtful,
          loadPacks, installPack, getPacks: () => packs,
          managedIds, registryAdd, registryRead, dropLanguage, registerDshPack, activateLanguage, startLiveLayer, openLanguagePage, heldBy,
          __writeJson: writeJson, setLocale: (svc) => { locSvc = svc; _dsh = null; _dshRev = null }, L, estimateMinutes, minutesLeft,
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
            ctx.effect(() => ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register(
              { name: 'sidebar.footer.action', id: 'kybernos-language-run', order: 19 },
              () => h(RunRing))), 'kybernos-language: footer ring while a translation runs')
            // Optional: a failure here must not take DSH down with it.
            try { startLiveLayer(ctx) } catch (e5) { /* */ }
          }
          // A run the previous tab left behind goes on by itself, once DSH has had time to register its dictionaries.
          try { window.setTimeout(() => { autoResume().catch(() => { /* never breaks the boot */ }) }, 3000) } catch (e6) { /* no timers */ }
          // The host's own run, if it has one: watch it or say how it ended (see bootJobs). A note in the bell offers « Use ».
          try { window.setTimeout(() => { bootJobs().catch(() => { /* never breaks the boot */ }) }, 3500) } catch (e7) { /* no timers */ }
          try {
            window.addEventListener('kb-lang-use', (ev) => {
              const id = ev !== null && ev !== undefined && ev.detail !== null && ev.detail !== undefined && typeof ev.detail.lang === 'string' ? ev.detail.lang : ''
              if (id !== '' && managedIds().indexOf(id) >= 0) activateLanguage(id)
            })
          } catch (e8) { /* no window */ }
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
