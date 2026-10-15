// src/plugin.js: body of the browser factory (assembled by scripts/build.mjs, which pastes model.mjs and chart-core.mjs
// in front of it as `model` and `chart`). In scope: `require` (DSH's module loader), `model`, `chart`.
//
// Sections, in order: css (the stylesheet and its motion), data (language, host access, the source reader), paint (charts
// as SVG strings), widgets (the React components), page (the Dashboards page, the right-pane tab, the MiniApp player),
// main (registration with DSH; the last lines return the plugin).
// ════════════════════════════════════════════════════════════════════════════
// css
// ════════════════════════════════════════════════════════════════════════════
// src/css.js: the stylesheet of the page, the pane and the player (assembled by scripts/build.mjs).
// Colours come from the DSH tokens, with a fallback; the six series hues are the only new colours (validated in both themes).
// Motion: every animation is gated by `[data-inview]` (it starts when the widget scrolls into view) and by
// `prefers-reduced-motion` (nothing moves, everything is at rest). `animation-fill-mode: both` + a paused state keep a
// widget at its start frame until it is in view, and at its final frame once the animation has played.
const CSS = `
.kbdb{--kbdb-bg:var(--dsw-alias-bg-base,#fff);--kbdb-l1:var(--dsw-alias-bg-layer-1,#fff);--kbdb-l2:var(--dsw-alias-bg-layer-2,#f5f6f7);--kbdb-l3:var(--dsw-alias-bg-layer-3,#fff);
  --kbdb-b1:var(--dsw-alias-border-l1,#0000000a);--kbdb-b2:var(--dsw-alias-border-l2,#0000001a);--kbdb-b3:var(--dsw-alias-border-l3,#0000001f);
  --kbdb-t1:var(--dsw-alias-label-primary,#0f1115);--kbdb-t2:var(--dsw-alias-label-secondary,#61666b);--kbdb-t3:var(--dsw-alias-label-tertiary,#81858c);--kbdb-t4:var(--dsw-alias-label-caption,#adb2b8);
  --kbdb-fg:var(--dsw-alias-label-primary-foreground,#fff);--kbdb-brand:var(--dsw-alias-brand-primary,#0f1115);--kbdb-accent:var(--dsw-alias-brand-primary-new-color,#4176e6);
  --kbdb-hover:var(--dsw-alias-interactive-bg-hover,#2631480f);--kbdb-hover2:var(--dsw-alias-interactive-bg-hover-accent,#26314824);
  --kbdb-err:var(--dsw-alias-state-error-primary,#ec1313);--kbdb-warn:var(--dsw-alias-state-warn-primary,#f59e0b);--kbdb-ok:var(--dsw-alias-state-success-primary,#22c55e);
  --kbdb-ok-t:var(--dsw-alias-state-success-tertiary,#e6faed);--kbdb-warn-t:var(--dsw-alias-state-warn-tertiary,#fef5e7);--kbdb-biz-t:var(--dsw-alias-state-business-tertiary,#e4edfd);
  --kbdb-bone:var(--dsw-alias-bg-skeleton,#0000000a);
  --kbdb-s1:#2a78d6;--kbdb-s2:#eb6834;--kbdb-s3:#1baf7a;--kbdb-s4:#eda100;--kbdb-s5:#e87ba4;--kbdb-s6:#4a3aa7;
  --kbdb-ease:cubic-bezier(.2,.9,.25,1);--kbdb-spring:cubic-bezier(.2,.9,.25,1.18);
  color:var(--kbdb-t1);font-size:13px;line-height:1.5;box-sizing:border-box}
body[data-ds-dark-theme] .kbdb,[data-ds-dark-theme] .kbdb{--kbdb-s1:#3987e5;--kbdb-s2:#d95926;--kbdb-s3:#199e70;--kbdb-s4:#c98500;--kbdb-s5:#d55181;--kbdb-s6:#9085e9}
.kbdb *,.kbdb *::before,.kbdb *::after{box-sizing:border-box}
.kbdb button{font:inherit;color:inherit;cursor:pointer}
.kbdb button:focus-visible,.kbdb [tabindex]:focus-visible{outline:2px solid var(--kbdb-accent);outline-offset:2px}
.kbdb .kbdb-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.kbdb .kbdb-mono{font-family:var(--ds-font-family-code,ui-monospace,Menlo,monospace);font-size:11.5px}

/* page header */
.kbdb-page{display:flex;flex-direction:column;gap:14px;padding-bottom:48px;min-width:0}
.kbdb-ph{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:10px 20px}
.kbdb-ph-l{min-width:0}
.kbdb-crumb{display:flex;align-items:center;gap:6px;color:var(--kbdb-t3);font-size:12px;min-height:18px}
.kbdb-crumb button{border:0;background:none;padding:0;color:inherit;text-decoration:underline;text-underline-offset:3px}
.kbdb-title{margin:0;font-size:26px;line-height:1.25;font-weight:800;letter-spacing:-.01em;display:flex;align-items:center;gap:8px}
.kbdb-title button{border:0;background:none;padding:0;display:inline-flex;align-items:center;gap:8px;font:inherit;letter-spacing:inherit;color:inherit}
.kbdb-title button svg{color:var(--kbdb-t3)}
.kbdb-sub{margin:2px 0 0;color:var(--kbdb-t2);max-width:70ch}
.kbdb-ph-r{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.kbdb-built{display:inline-flex;align-items:center;gap:8px;color:var(--kbdb-t2);font-size:12px}
.kbdb-dot{width:8px;height:8px;border-radius:50%;background:var(--kbdb-ok);flex:none;display:inline-block}
.kbdb-dot.warn{background:var(--kbdb-warn)}.kbdb-dot.err{background:var(--kbdb-err)}
.kbdb-dot.idle{background:transparent;border:1.5px solid var(--kbdb-t3)}.kbdb-dot.pause{background:var(--kbdb-t4)}
.kbdb-dot.live{animation:kbdb-breathe 2.4s ease-in-out infinite}
.kbdb-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;padding-inline:14px;border-radius:16px;border:1px solid var(--kbdb-b2);background:transparent;color:var(--kbdb-t1);white-space:nowrap;transition:background-color .15s,transform .15s,box-shadow .15s}
.kbdb-btn:hover:not(:disabled){background:var(--kbdb-hover)}
.kbdb-btn:active:not(:disabled){transform:scale(.97)}
.kbdb-btn.primary{background:var(--kbdb-brand);color:var(--kbdb-fg);border-color:transparent}
.kbdb-btn.primary:hover:not(:disabled){background:var(--kbdb-brand);opacity:.88}
.kbdb-btn[aria-pressed="true"]{background:var(--kbdb-hover2)}
.kbdb-btn:disabled{opacity:.5;cursor:default}
.kbdb-btn.sm{height:26px;padding-inline:10px;font-size:12px}
.kbdb-btn .kbdb-spin{display:inline-flex}
.kbdb-btn.busy .kbdb-spin{animation:kbdb-spin .7s linear infinite}
.kbdb-ib{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:13px;border:0;background:transparent;color:var(--kbdb-t3);transition:background-color .15s,color .15s,transform .15s}
.kbdb-ib:hover{background:var(--kbdb-hover);color:var(--kbdb-t1)}
.kbdb-ib:active{transform:scale(.9)}
.kbdb-ib[aria-pressed="true"]{background:var(--kbdb-hover2);color:var(--kbdb-t1)}
.kbdb-pill{display:inline-flex;align-items:center;gap:6px;height:22px;padding-inline:8px;border-radius:11px;background:var(--kbdb-hover);color:var(--kbdb-t2);font-size:12px;white-space:nowrap}
.kbdb-pill.def{background:var(--kbdb-hover2);color:var(--kbdb-t1)}
.kbdb-chip{display:inline-flex;align-items:center;gap:6px;height:28px;padding-inline:12px;border-radius:14px;border:1px solid var(--kbdb-b2);background:transparent;font-size:12px;color:var(--kbdb-t2);white-space:nowrap}
.kbdb-chip:hover{background:var(--kbdb-hover);color:var(--kbdb-t1)}
.kbdb-chip[aria-pressed="true"]{background:var(--kbdb-hover2);color:var(--kbdb-t1)}
.kbdb-banner{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:10px 14px;border-radius:12px;border:1px solid var(--kbdb-b2);background:var(--kbdb-warn-t)}
.kbdb-banner .sp{flex:1;min-width:0}
.kbdb-rel{position:relative;display:inline-block}
.kbdb-pop{position:absolute;z-index:40;top:calc(100% + 6px);left:0;width:min(340px,calc(100vw - 32px));max-height:min(420px,70vh);overflow:auto;padding:6px;border-radius:12px;border:1px solid var(--kbdb-b2);background:var(--kbdb-l3);box-shadow:0 12px 32px #0003;animation:kbdb-pop-in .16s var(--kbdb-ease)}
.kbdb-pop.r{left:auto;right:0}
.kbdb-pop .hd{display:block;padding:8px 8px 4px;color:var(--kbdb-t3);font-size:12px}
.kbdb-pop .o{display:flex;align-items:center;gap:8px;width:100%;padding:7px 8px;border:0;border-radius:8px;background:transparent;text-align:left;font-size:13px}
.kbdb-pop .o:hover,.kbdb-pop .o[aria-current="true"]{background:var(--kbdb-hover)}
.kbdb-pop .o .sub{margin-left:auto;color:var(--kbdb-t3);font-size:12px}
.kbdb-pop .foot{display:block;padding:8px;color:var(--kbdb-t3);font-size:12px;border-top:1px solid var(--kbdb-b1);margin-top:4px}
.kbdb-pop .src{display:flex;align-items:flex-start;gap:8px;padding:7px 8px}
.kbdb-pop .src .tx{min-width:0;flex:1}
.kbdb-pop .src .tx i{display:block;font-style:normal;color:var(--kbdb-t3);font-size:12px}

/* grid + widgets */
.kbdb-grid{container-type:inline-size;container-name:kbdb;display:grid;grid-template-columns:repeat(12,minmax(0,1fr));grid-auto-rows:76px;grid-auto-flow:row dense;gap:12px}
.kbdb-w{grid-column:span var(--w);grid-row:span var(--h);display:flex;flex-direction:column;min-width:0;min-height:0;position:relative;padding:12px 14px 10px;border:1px solid var(--kbdb-b2);border-radius:14px;background:var(--kbdb-l1);
  animation:kbdb-w-in .5s var(--kbdb-ease) both;animation-delay:calc(var(--wi,0) * 45ms);animation-play-state:paused;transition:box-shadow .2s,border-color .2s}
.kbdb-w[data-inview]{animation-play-state:running}
.kbdb-w:hover{border-color:var(--kbdb-b3)}
.kbdb-w.flash{animation:kbdb-w-in .5s var(--kbdb-ease) both,kbdb-ring 1.6s ease-out 1}
.kbdb-w.dragging{opacity:.45}
.kbdb-w.over{box-shadow:0 0 0 2px var(--kbdb-accent)}
.kbdb-wh{display:flex;align-items:center;gap:6px;min-height:26px;flex:none}
.kbdb-wh h3{margin:0;font-size:13px;font-weight:600;min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kbdb-wb{flex:1;min-height:0;display:flex;flex-direction:column;margin-top:6px;min-width:0}
.kbdb-wf{display:flex;align-items:center;gap:8px;flex:none;margin-top:8px;color:var(--kbdb-t3);font-size:11.5px;min-width:0}
.kbdb-wf .sp{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kbdb-wf .rt{border:0;background:none;padding:0;color:var(--kbdb-t2);text-decoration:underline;text-underline-offset:3px;font-size:11.5px}
.kbdb-we{display:none;position:absolute;z-index:5;right:8px;top:8px;gap:2px;padding:2px;border-radius:14px;background:var(--kbdb-l3);border:1px solid var(--kbdb-b3);box-shadow:0 4px 12px #0002}
.kbdb-edit .kbdb-we{display:flex}
.kbdb-edit .kbdb-w{border-style:dashed;border-color:var(--kbdb-b3)}
.kbdb-edit .kbdb-w .kbdb-tools{visibility:hidden}
.kbdb-edit .kbdb-w{animation:kbdb-wiggle .5s ease-in-out 1}
.kbdb-chart{position:relative;flex:1;min-height:0;width:100%}
.kbdb-chart svg{display:block;overflow:visible}
.kbdb-chart text{fill:var(--kbdb-t2);font-size:11px;font-family:var(--dsw-font-family,inherit)}
.kbdb-chart .gl{stroke:var(--kbdb-b2);stroke-width:1}
.kbdb-chart .halo{paint-order:stroke;stroke:var(--kbdb-l1);stroke-width:3px;stroke-linejoin:round}
.kbdb-chart .hit{fill:transparent}
.kbdb-chart .hit:hover{fill:var(--kbdb-hover)}
.kbdb-legend{display:flex;flex-wrap:wrap;gap:4px 14px;color:var(--kbdb-t2);font-size:12px;margin-bottom:2px}
.kbdb-legend span{display:inline-flex;align-items:center;gap:6px;animation:kbdb-fade .4s ease both;animation-delay:calc(var(--i,0) * 60ms + 200ms)}
.kbdb-legend i{width:10px;height:10px;border-radius:3px;display:inline-block}
.kbdb-s1{fill:var(--kbdb-s1);background:var(--kbdb-s1)}.kbdb-s2{fill:var(--kbdb-s2);background:var(--kbdb-s2)}.kbdb-s3{fill:var(--kbdb-s3);background:var(--kbdb-s3)}
.kbdb-s4{fill:var(--kbdb-s4);background:var(--kbdb-s4)}.kbdb-s5{fill:var(--kbdb-s5);background:var(--kbdb-s5)}.kbdb-s6{fill:var(--kbdb-s6);background:var(--kbdb-s6)}
.kbdb-tone-ok{fill:var(--kbdb-ok);background:var(--kbdb-ok)}.kbdb-tone-err{fill:var(--kbdb-err);background:var(--kbdb-err)}.kbdb-tone-warn{fill:var(--kbdb-warn);background:var(--kbdb-warn)}.kbdb-tone-idle{fill:var(--kbdb-t3);background:var(--kbdb-t3)}.kbdb-tone-mute{fill:var(--kbdb-t4);background:var(--kbdb-t4)}
.kbdb-tonek-ok{stroke:var(--kbdb-ok)}.kbdb-tonek-err{stroke:var(--kbdb-err)}.kbdb-tonek-warn{stroke:var(--kbdb-warn)}.kbdb-tonek-idle{stroke:var(--kbdb-t3)}.kbdb-tonek-mute{stroke:var(--kbdb-t4)}
.kbdb-k1{stroke:var(--kbdb-s1)}.kbdb-k2{stroke:var(--kbdb-s2)}.kbdb-k3{stroke:var(--kbdb-s3)}.kbdb-k4{stroke:var(--kbdb-s4)}.kbdb-k5{stroke:var(--kbdb-s5)}.kbdb-k6{stroke:var(--kbdb-s6)}
.kbdb-tbl{overflow:auto;flex:1;min-height:0}
.kbdb-tbl table{width:100%;border-collapse:collapse}
.kbdb-tbl th{position:sticky;top:0;background:var(--kbdb-l1);text-align:left;font-weight:500;color:var(--kbdb-t3);font-size:12px;padding:5px 8px;border-bottom:1px solid var(--kbdb-b2)}
.kbdb-tbl td{padding:5px 8px;border-bottom:1px solid var(--kbdb-b1);font-variant-numeric:tabular-nums}
.kbdb-w[data-type="flow"] .kbdb-wb{overflow-x:auto}
.kbdb-w[data-type="flow"] .kbdb-chart{min-width:680px}
.kbdb-note-small{color:var(--kbdb-t3);font-size:11.5px;margin-top:4px}

/* heatmap, table, text card */
.kbdb-hm{transform-box:fill-box;transform-origin:50% 50%;animation:kbdb-pop .45s var(--kbdb-spring) both;animation-delay:calc(var(--c,0) * 14ms);animation-play-state:paused;transition:filter .15s}
[data-inview] .kbdb-hm{animation-play-state:running}
.kbdb-hm:hover{filter:brightness(1.3)}
.kbdb-hm0{fill:color-mix(in srgb,var(--kbdb-t3) 16%,var(--kbdb-l1))}
.kbdb-hm1{fill:color-mix(in srgb,var(--kbdb-s1) 32%,var(--kbdb-l1))}
.kbdb-hm2{fill:color-mix(in srgb,var(--kbdb-s1) 56%,var(--kbdb-l1))}
.kbdb-hm3{fill:color-mix(in srgb,var(--kbdb-s1) 80%,var(--kbdb-l1))}
.kbdb-hm4{fill:var(--kbdb-s1)}
.kbdb-hmkey{display:flex;align-items:center;justify-content:flex-end;gap:4px;margin-top:6px;color:var(--kbdb-t3);font-size:11px}
.kbdb-hmkey i{width:11px;height:11px;border-radius:3px;display:inline-block}
.kbdb-hmkey i.kbdb-hm0{background:color-mix(in srgb,var(--kbdb-t3) 16%,var(--kbdb-l1))}
.kbdb-hmkey i.kbdb-hm1{background:color-mix(in srgb,var(--kbdb-s1) 32%,var(--kbdb-l1))}
.kbdb-hmkey i.kbdb-hm2{background:color-mix(in srgb,var(--kbdb-s1) 56%,var(--kbdb-l1))}
.kbdb-hmkey i.kbdb-hm3{background:color-mix(in srgb,var(--kbdb-s1) 80%,var(--kbdb-l1))}
.kbdb-hmkey i.kbdb-hm4{background:var(--kbdb-s1)}
.kbdb-dt{overflow:auto;flex:1;min-height:0}
.kbdb-dt table{width:100%;border-collapse:collapse;font-size:13px}
.kbdb-dt th{position:sticky;top:0;z-index:1;background:var(--kbdb-l1);text-align:left;font-weight:500;color:var(--kbdb-t3);font-size:12px;padding:6px 8px;border-bottom:1px solid var(--kbdb-b2);white-space:nowrap}
.kbdb-dt th.n,.kbdb-dt td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.kbdb-dt td{padding:7px 8px;border-bottom:1px solid var(--kbdb-b1);animation:kbdb-fade .35s ease both;animation-delay:calc(var(--i,0) * 45ms)}
.kbdb-dt td .lb{display:inline-flex;align-items:center;gap:8px;min-width:0}
.kbdb-dt td .sw{width:10px;height:10px;border-radius:3px;display:inline-block;flex:none}
.kbdb-dt td.bar{background:linear-gradient(90deg,color-mix(in srgb,var(--kbdb-s1) 24%,transparent) var(--p,0%),transparent var(--p,0%))}
.kbdb-kpi-v.t{font-size:20px;line-height:1.3;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* chart motion */
.kbdb-bar{transform-box:fill-box;transform-origin:50% 100%;animation:kbdb-rise .6s var(--kbdb-spring) both;animation-delay:calc(var(--i,0) * 26ms + var(--s,0) * 45ms);animation-play-state:paused;transition:filter .15s,transform .15s}
[data-inview] .kbdb-bar{animation-play-state:running}
.kbdb-col:hover .kbdb-bar{filter:brightness(1.14)}
.kbdb-hbar{transform-box:fill-box;transform-origin:0 50%;animation:kbdb-grow .7s var(--kbdb-spring) both;animation-delay:calc(var(--i,0) * 55ms);animation-play-state:paused}
[data-inview] .kbdb-hbar{animation-play-state:running}
.kbdb-row:hover .kbdb-hbar{filter:brightness(1.14)}
.kbdb-val{animation:kbdb-fade .35s ease both;animation-delay:calc(var(--i,0) * 55ms + 380ms);animation-play-state:paused}
[data-inview] .kbdb-val{animation-play-state:running}
.kbdb-line{stroke-dasharray:var(--len);stroke-dashoffset:0;animation:kbdb-draw 1s var(--kbdb-ease) both;animation-play-state:paused}
[data-inview] .kbdb-line{animation-play-state:running}
.kbdb-area{animation:kbdb-fade .8s ease both;animation-delay:.45s;animation-play-state:paused}
[data-inview] .kbdb-area{animation-play-state:running}
.kbdb-end{transform-box:fill-box;transform-origin:50% 50%;animation:kbdb-pop .5s var(--kbdb-spring) both;animation-delay:.95s;animation-play-state:paused}
[data-inview] .kbdb-end{animation-play-state:running}
.kbdb-ping{transform-box:fill-box;transform-origin:50% 50%;animation:kbdb-ping 2.6s ease-out 1.5s infinite;animation-play-state:paused;opacity:0}
[data-inview] .kbdb-ping{animation-play-state:running}
.kbdb-cross{stroke:var(--kbdb-t3);stroke-width:1;stroke-dasharray:3 3;opacity:0;transition:opacity .12s}
.kbdb-cursor{opacity:0;transition:opacity .12s}
.kbdb-chart:hover .kbdb-cross,.kbdb-chart:hover .kbdb-cursor{opacity:1}
.kbdb-seg{animation:kbdb-sweep .9s var(--kbdb-ease) both;animation-delay:calc(var(--i,0) * 90ms);animation-play-state:paused;transition:stroke-width .2s var(--kbdb-spring),filter .15s;fill:none}
[data-inview] .kbdb-seg{animation-play-state:running}
.kbdb-seg:hover{stroke-width:var(--tw-hover);filter:brightness(1.12)}
.kbdb-donut-c{animation:kbdb-fade .5s ease .5s both;animation-play-state:paused}
[data-inview] .kbdb-donut-c{animation-play-state:running}
.kbdb-rib{stroke-dasharray:var(--len);animation:kbdb-draw .9s var(--kbdb-ease) both;animation-delay:calc(var(--i,0) * 35ms);animation-play-state:paused;fill:none;opacity:.42;transition:opacity .15s}
[data-inview] .kbdb-rib{animation-play-state:running}
.kbdb-rib:hover{opacity:.8}
.kbdb-node{transform-box:fill-box;transform-origin:50% 100%;animation:kbdb-grow-y .6s var(--kbdb-spring) both;animation-delay:calc(var(--i,0) * 40ms);animation-play-state:paused}
[data-inview] .kbdb-node{animation-play-state:running}
.kbdb-fnode{cursor:grab;transform-box:fill-box;transform-origin:50% 50%;animation:kbdb-pop .55s var(--kbdb-spring) both;animation-delay:calc(var(--i,0) * 90ms);animation-play-state:paused}
[data-inview] .kbdb-fnode{animation-play-state:running}
.kbdb-fnode:hover rect.nb{stroke:var(--kbdb-t3)}
.kbdb-fnode rect.nb{fill:var(--kbdb-l2);stroke:var(--kbdb-b3);stroke-width:1;transition:stroke .15s}
.kbdb-fnode .nt{fill:var(--kbdb-t1);font-size:13px;font-weight:600}
.kbdb-fnode .ns{fill:var(--kbdb-t3);font-size:11.5px}
.kbdb-fnode .nk{fill:var(--kbdb-t3);font-size:10.5px;letter-spacing:.05em;text-transform:uppercase}
.kbdb-fnode .st-run{animation:kbdb-breathe 1.6s ease-in-out infinite}
.kbdb-fedge{fill:none;stroke:var(--kbdb-t3);stroke-width:1.6;stroke-dasharray:var(--len);animation:kbdb-draw .8s var(--kbdb-ease) both;animation-delay:calc(var(--i,0) * 90ms + 200ms);animation-play-state:paused}
[data-inview] .kbdb-fedge{animation-play-state:running}
.kbdb-fedge.f{stroke:var(--kbdb-err);stroke-dasharray:5 4;animation:kbdb-fade .6s ease both;animation-delay:calc(var(--i,0) * 90ms + 300ms)}
.kbdb-fedge.run{stroke-dasharray:6 6;animation:kbdb-march 1s linear infinite}
.kbdb-fport{fill:var(--kbdb-l1);stroke:var(--kbdb-t3);stroke-width:1.5}

/* card */
.kbdb-kpi{display:flex;align-items:flex-end;justify-content:space-between;gap:10px;flex:1;min-height:0}
.kbdb-kpi-v{font-size:28px;line-height:1.1;font-weight:650;letter-spacing:-.01em;font-variant-numeric:tabular-nums}
.kbdb-kpi-s{display:flex;align-items:center;gap:6px;margin-top:4px;color:var(--kbdb-t2);font-size:12px;animation:kbdb-rise-text .5s var(--kbdb-ease) .35s both;animation-play-state:paused}
[data-inview] .kbdb-kpi-s{animation-play-state:running}
.kbdb-kpi.warn .kbdb-kpi-v{color:var(--dsw-alias-state-warn-label,var(--kbdb-warn))}
.kbdb-spark{flex:none;overflow:visible}
.kbdb-spark polyline{fill:none;stroke:var(--kbdb-s1);stroke-width:2;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:var(--len);animation:kbdb-draw 1s var(--kbdb-ease) .15s both;animation-play-state:paused}
[data-inview] .kbdb-spark polyline{animation-play-state:running}
.kbdb-spark circle{fill:var(--kbdb-s1);stroke:var(--kbdb-l1);stroke-width:2;transform-box:fill-box;transform-origin:50% 50%;animation:kbdb-pop .5s var(--kbdb-spring) 1s both;animation-play-state:paused}
[data-inview] .kbdb-spark circle{animation-play-state:running}
.kbdb-stale{opacity:.55}
.kbdb-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;color:var(--kbdb-t3);text-align:center;padding:8px}
.kbdb-err-note{flex:1;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:8px;color:var(--kbdb-t2)}

/* calendar */
.kbdb-cal{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px;flex:1;min-height:0}
.kbdb-day{display:flex;flex-direction:column;gap:4px;min-width:0;padding:6px;border-radius:10px;border:1px solid var(--kbdb-b1);overflow:hidden;animation:kbdb-rise-text .45s var(--kbdb-ease) both;animation-delay:calc(var(--i,0) * 50ms);animation-play-state:paused}
[data-inview] .kbdb-day{animation-play-state:running}
.kbdb-day.today{border-color:var(--kbdb-b3);background:var(--kbdb-hover);animation:kbdb-rise-text .45s var(--kbdb-ease) both,kbdb-today 3.2s ease-in-out 1s infinite;animation-delay:calc(var(--i,0) * 50ms),1s;animation-play-state:paused,paused}
[data-inview] .kbdb-day.today{animation-play-state:running,running}
.kbdb-day h4{margin:0 0 2px;display:flex;align-items:baseline;gap:5px;font-size:12px;font-weight:500;color:var(--kbdb-t2)}
.kbdb-day.today h4 b{color:var(--kbdb-t1)}
.kbdb-day h4 b{font-weight:600;font-size:13px;font-variant-numeric:tabular-nums}
.kbdb-ev{display:flex;align-items:flex-start;gap:6px;min-width:0;padding:4px 6px;border-radius:6px;font-size:11.5px;line-height:1.25;color:var(--kbdb-t1);background:var(--kbdb-l2);animation:kbdb-pop .4s var(--kbdb-spring) both;animation-delay:calc(var(--i,0) * 50ms + var(--e,0) * 70ms + 150ms);animation-play-state:paused;transition:transform .15s,box-shadow .15s}
[data-inview] .kbdb-ev{animation-play-state:running}
.kbdb-ev:hover{transform:translateY(-1px);box-shadow:0 4px 10px #0002}
.kbdb-ev .kbdb-dot{margin-top:4px}
.kbdb-ev .tx{display:flex;flex-direction:column;min-width:0}
.kbdb-ev .t{font-variant-numeric:tabular-nums;color:var(--kbdb-t3);font-size:11px}
.kbdb-ev .nm{overflow:hidden;min-width:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow-wrap:anywhere}
.kbdb-ev.next{background:transparent;border:1px dashed var(--kbdb-b3)}
.kbdb-ev.fail{background:var(--kbdb-warn-t)}
.kbdb-more{font-size:11.5px;color:var(--kbdb-t3);padding-left:4px}
.kbdb-calkey{display:flex;gap:14px;flex-wrap:wrap;color:var(--kbdb-t3);font-size:12px;margin-bottom:8px}
.kbdb-calkey span{display:inline-flex;align-items:center;gap:6px}

/* list, kanban, carousel, notes */
.kbdb-rows{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column}
.kbdb-lrow{display:flex;align-items:flex-start;gap:10px;padding:8px 4px;border-bottom:1px solid var(--kbdb-b1);animation:kbdb-slide-in .4s var(--kbdb-ease) both;animation-delay:calc(var(--i,0) * 40ms + 120ms);animation-play-state:paused;transition:background-color .15s}
[data-inview] .kbdb-lrow{animation-play-state:running}
.kbdb-lrow:hover{background:var(--kbdb-hover)}
.kbdb-lrow:last-child{border-bottom:0}
.kbdb-lrow .kbdb-dot{margin-top:5px}
.kbdb-lrow .tx{min-width:0;flex:1}
.kbdb-lrow .tx b{display:block;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kbdb-lrow .tx i{display:block;font-style:normal;color:var(--kbdb-t3);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kbdb-lrow .when{color:var(--kbdb-t3);font-size:12px;white-space:nowrap}
.kbdb-fchips{display:flex;gap:6px;margin-bottom:4px}
.kbdb-fchips .kbdb-chip{height:24px;padding-inline:10px}
.kbdb-kan{display:grid;grid-template-columns:repeat(var(--cols),minmax(0,1fr));gap:8px;flex:1;min-height:0}
.kbdb-kcol{display:flex;flex-direction:column;gap:6px;min-width:0;min-height:0;padding:8px;border-radius:10px;background:var(--kbdb-l2);border:1px solid var(--kbdb-b1);transition:outline-color .15s}
.kbdb-kcol.over{outline:2px dashed var(--kbdb-accent);outline-offset:-2px}
.kbdb-kcol h4{margin:0;display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:var(--kbdb-t2)}
.kbdb-kcol h4 .n{font-weight:500;color:var(--kbdb-t3);font-variant-numeric:tabular-nums}
.kbdb-kcards{display:flex;flex-direction:column;gap:6px;overflow:auto;min-height:0;flex:1}
.kbdb-kcard{padding:7px 9px;border-radius:8px;background:var(--kbdb-l1);border:1px solid var(--kbdb-b2);font-size:12.5px;animation:kbdb-rise-text .4s var(--kbdb-ease) both;animation-delay:calc(var(--i,0) * 55ms + 150ms);animation-play-state:paused;transition:transform .15s,box-shadow .15s}
[data-inview] .kbdb-kcard{animation-play-state:running}
.kbdb-kcard:hover{transform:translateY(-1px);box-shadow:0 4px 10px #0002}
.kbdb-kcard[draggable="true"]{cursor:grab}
.kbdb-kcard i{display:block;font-style:normal;color:var(--kbdb-t3);font-size:11.5px}
.kbdb-kcard.dragging{opacity:.4}
.kbdb-rail-wrap{position:relative;flex:1;min-height:0;display:flex;min-width:0}
.kbdb-rail{display:flex;gap:10px;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;flex:1;min-width:0;padding:2px 2px 4px}
.kbdb-rail::-webkit-scrollbar{display:none}
.kbdb-dcard{flex:none;width:200px;scroll-snap-align:start;display:flex;flex-direction:column;gap:8px;padding:8px;border-radius:12px;border:1px solid var(--kbdb-b2);background:var(--kbdb-l2);text-align:left;animation:kbdb-slide-r .5s var(--kbdb-ease) both;animation-delay:calc(var(--i,0) * 60ms + 150ms);animation-play-state:paused;transition:transform .2s var(--kbdb-spring),border-color .15s,box-shadow .2s}
[data-inview] .kbdb-dcard{animation-play-state:running}
.kbdb-dcard:hover{transform:translateY(-3px) scale(1.02);border-color:var(--kbdb-b3);box-shadow:0 8px 18px #0002}
.kbdb-thumb{height:56px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:700;color:var(--kbdb-t2);letter-spacing:.02em;text-transform:uppercase}
.kbdb-dcard b{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kbdb-dcard i{font-style:normal;color:var(--kbdb-t3);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kbdb-w.note{padding-top:10px}
.kbdb-w.note[data-tint="amber"]{background:var(--kbdb-warn-t)}
.kbdb-w.note[data-tint="green"]{background:var(--kbdb-ok-t)}
.kbdb-w.note[data-tint="blue"]{background:var(--kbdb-biz-t)}
.kbdb-w.note[data-tint="pink"]{background:color-mix(in srgb,var(--kbdb-s5) 16%,var(--kbdb-l1))}
.kbdb-ntitle{outline:none;font-weight:600;font-size:14px;min-height:20px}
.kbdb-nbody{outline:none;flex:1;min-height:0;overflow:auto;margin-top:6px;line-height:1.55;white-space:pre-wrap}
.kbdb-ntitle:empty::before,.kbdb-nbody:empty::before{content:attr(data-ph);color:var(--kbdb-t3)}
.kbdb-tint{display:inline-flex;gap:4px;align-items:center;margin-left:auto}
.kbdb-tint button{width:16px;height:16px;border-radius:50%;border:1px solid var(--kbdb-b3);padding:0;transition:transform .15s}
.kbdb-tint button:hover{transform:scale(1.25)}
.kbdb-tint .t0{background:var(--kbdb-l1)}.kbdb-tint .t1{background:var(--kbdb-warn)}.kbdb-tint .t2{background:var(--kbdb-ok)}.kbdb-tint .t3{background:var(--kbdb-accent)}.kbdb-tint .t4{background:var(--kbdb-s5)}
.kbdb-check{display:flex;align-items:flex-start;gap:8px;padding:3px 0}
.kbdb-check button{flex:none;width:18px;height:18px;margin-top:1px;border-radius:5px;border:1.5px solid var(--kbdb-t3);background:transparent;display:flex;align-items:center;justify-content:center;padding:0;color:var(--kbdb-fg);transition:background-color .15s,transform .15s}
.kbdb-check button:active{transform:scale(.85)}
.kbdb-check.done button{background:var(--kbdb-brand);border-color:var(--kbdb-brand)}
.kbdb-check span{outline:none;flex:1;min-width:0;transition:color .2s}
.kbdb-check.done span{color:var(--kbdb-t3);text-decoration:line-through}
.kbdb-addi{align-self:flex-start;border:0;background:none;padding:4px 0;color:var(--kbdb-t2);font-size:12px}
.kbdb-addtile{grid-column:span 3;grid-row:span 2;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;border:1px dashed var(--kbdb-b3);border-radius:14px;background:transparent;color:var(--kbdb-t2);text-align:center;padding:8px}
.kbdb-addtile:hover{background:var(--kbdb-hover);color:var(--kbdb-t1)}

/* gallery and states */
.kbdb-sec-h{display:flex;align-items:baseline;gap:10px;margin:14px 0 8px}
.kbdb-sec-h h2{margin:0;font-size:15px;font-weight:650}
.kbdb-sec-h span{color:var(--kbdb-t3);font-size:12px}
.kbdb-sec-h .sp{flex:1}
.kbdb-gal{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px}
.kbdb-gcard{position:relative;display:flex;flex-direction:column;gap:10px;padding:12px;border-radius:14px;border:1px solid var(--kbdb-b2);background:var(--kbdb-l1);text-align:left;min-width:0;animation:kbdb-w-in .45s var(--kbdb-ease) both;animation-delay:calc(var(--i,0) * 50ms);transition:transform .2s var(--kbdb-spring),border-color .15s,box-shadow .2s}
.kbdb-gcard.link{cursor:pointer}
.kbdb-gcard.link:hover{transform:translateY(-2px);border-color:var(--kbdb-b3);box-shadow:0 8px 18px #0002}
.kbdb-gcard.dim{opacity:.65}
.kbdb-gcard .gh{display:flex;align-items:center;gap:8px}
.kbdb-gcard h3{margin:0;font-size:15px;font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kbdb-gcard p{margin:0;color:var(--kbdb-t2);font-size:12.5px}
.kbdb-gmini{display:grid;grid-template-columns:repeat(12,1fr);grid-auto-rows:var(--rh,7px);gap:3px;padding:8px;border-radius:10px;background:var(--kbdb-l2);height:112px;overflow:hidden;align-content:start}
.kbdb-gmini i{grid-column:span var(--w);grid-row:span var(--h);border-radius:4px;background:var(--kbdb-l1);border:1px solid var(--kbdb-b2);overflow:hidden;transition:border-color .2s,transform .25s var(--kbdb-spring)}
.kbdb-gmini i[data-type="note"]{background:var(--kbdb-warn-t);border-color:transparent}
.kbdb-gmini svg{display:block;width:100%;height:100%}
.kbdb-gmini .mi-ink{fill:var(--kbdb-t2)}
.kbdb-gmini .mi-dim{fill:var(--kbdb-t4)}
.kbdb-gmini .mi-line{stroke:var(--kbdb-t4);stroke-width:1;fill:none}
.kbdb-gcard:hover .kbdb-gmini i{border-color:var(--kbdb-t4)}
.kbdb-gcard:hover .kbdb-gmini i:nth-child(odd){transform:translateY(-1px)}
.kbdb-gmeta{display:flex;gap:6px;flex-wrap:wrap}
.kbdb-gcard .acts{display:flex;gap:8px;align-items:center;margin-top:auto}
.kbdb-gempty{padding:28px 16px;border:1px dashed var(--kbdb-b3);border-radius:14px;text-align:center;color:var(--kbdb-t2);display:flex;flex-direction:column;align-items:center;gap:10px}
.kbdb-gempty b{color:var(--kbdb-t1);font-size:15px}
.kbdb-fpop{position:fixed;z-index:9999;width:220px;padding:6px;border-radius:12px;border:1px solid var(--kbdb-b2);background:var(--kbdb-l3);box-shadow:0 12px 32px #0003;animation:kbdb-pop-in .16s var(--kbdb-ease)}
.kbdb-fpop .o{display:flex;align-items:center;gap:8px;width:100%;padding:7px 8px;border:0;border-radius:8px;background:transparent;text-align:left;font-size:13px}
.kbdb-fpop .o:hover{background:var(--kbdb-hover)}
.kbdb-bone{background:var(--kbdb-bone);border-radius:6px;animation:kbdb-shimmer 1.4s ease-in-out infinite}
.kbdb-sk{display:flex;flex-direction:column;gap:10px;flex:1;min-height:0;padding-top:4px}
.kbdb-tip{position:fixed;z-index:10000;pointer-events:none;max-width:240px;padding:6px 10px;border-radius:8px;background:var(--kbdb-l3);border:1px solid var(--kbdb-b3);box-shadow:0 6px 18px #0003;font-size:12px;color:var(--kbdb-t1)}
.kbdb-tip b{display:block;font-weight:600}
.kbdb-tip span{display:flex;align-items:center;gap:6px;color:var(--kbdb-t2)}
.kbdb-tip span i{width:8px;height:8px;border-radius:2px;display:inline-block}
.kbdb-toast{position:fixed;z-index:10001;left:50%;bottom:24px;transform:translateX(-50%);max-width:calc(100% - 32px);padding:8px 14px;border-radius:16px;background:var(--kbdb-brand);color:var(--kbdb-fg);font-size:12px;box-shadow:0 8px 24px #0004;animation:kbdb-pop-in .2s var(--kbdb-ease)}

/* the right pane */
.kbdb-pane{display:flex;flex-direction:column;height:100%;min-height:0}
.kbdb-pane-h{display:flex;align-items:center;gap:6px;padding:8px 10px;border-bottom:1px solid var(--kbdb-b1);flex:none}
.kbdb-pane-h .nm{font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kbdb-pane-h .sp{flex:1}
.kbdb-pane-b{flex:1;min-height:0;overflow:auto;padding:12px}
.kbdb-pane .kbdb-grid .kbdb-w{grid-column:span 12}
.kbdb-pane .kbdb-grid .kbdb-w[data-type="card"]{grid-column:span 6}
.kbdb-pane .kbdb-cal{grid-template-columns:repeat(7,minmax(92px,1fr));overflow-x:auto}

@container kbdb (max-width:760px){
  .kbdb-grid .kbdb-w{grid-column:span 6}
  .kbdb-grid .kbdb-w[data-w="12"],.kbdb-grid .kbdb-w[data-wide]{grid-column:span 12}
}
@container kbdb (max-width:480px){
  .kbdb-grid .kbdb-w,.kbdb-grid .kbdb-w[data-w="12"]{grid-column:span 12}
  .kbdb-grid .kbdb-w[data-type="card"]{grid-column:span 6}
  .kbdb-cal{grid-template-columns:repeat(7,minmax(96px,1fr));overflow-x:auto}
  .kbdb-kan{grid-template-columns:repeat(var(--cols),minmax(150px,1fr));overflow-x:auto}
}

@keyframes kbdb-w-in{from{opacity:0;transform:translateY(10px) scale(.985)}to{opacity:1;transform:none}}
@keyframes kbdb-rise{from{transform:scaleY(0);opacity:.2}to{transform:scaleY(1);opacity:1}}
@keyframes kbdb-grow{from{transform:scaleX(0);opacity:.2}to{transform:scaleX(1);opacity:1}}
@keyframes kbdb-grow-y{from{transform:scaleY(0)}to{transform:scaleY(1)}}
@keyframes kbdb-draw{from{stroke-dashoffset:var(--len)}to{stroke-dashoffset:0}}
@keyframes kbdb-sweep{from{stroke-dasharray:0 var(--circ)}to{stroke-dasharray:var(--seg) var(--circ)}}
@keyframes kbdb-fade{from{opacity:0}to{opacity:1}}
@keyframes kbdb-pop{from{opacity:0;transform:scale(.6)}to{opacity:1;transform:scale(1)}}
@keyframes kbdb-pop-in{from{opacity:0;transform:translateY(-4px) scale(.97)}to{opacity:1;transform:none}}
@keyframes kbdb-ping{0%{opacity:.55;transform:scale(1)}70%,100%{opacity:0;transform:scale(3.2)}}
@keyframes kbdb-rise-text{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@keyframes kbdb-slide-in{from{opacity:0;transform:translateX(-10px)}to{opacity:1;transform:none}}
@keyframes kbdb-slide-r{from{opacity:0;transform:translateX(18px)}to{opacity:1;transform:none}}
@keyframes kbdb-march{to{stroke-dashoffset:-24}}
@keyframes kbdb-breathe{0%,100%{opacity:1}50%{opacity:.45}}
@keyframes kbdb-today{0%,100%{box-shadow:0 0 0 0 transparent}50%{box-shadow:0 0 0 3px var(--kbdb-hover2)}}
@keyframes kbdb-ring{0%{box-shadow:0 0 0 0 var(--kbdb-accent)}35%{box-shadow:0 0 0 4px var(--kbdb-accent)}100%{box-shadow:0 0 0 0 transparent}}
@keyframes kbdb-spin{to{transform:rotate(360deg)}}
@keyframes kbdb-shimmer{0%,100%{opacity:1}50%{opacity:.55}}
@keyframes kbdb-wiggle{0%,100%{transform:none}30%{transform:rotate(-.35deg)}70%{transform:rotate(.35deg)}}

@media (prefers-reduced-motion:reduce){
  .kbdb *,.kbdb *::before,.kbdb *::after{animation:none!important;transition:none!important}
  .kbdb-ping{display:none}
}
`

// ════════════════════════════════════════════════════════════════════════════
// data
// ════════════════════════════════════════════════════════════════════════════
// src/data.js: language, host access and the source reader (assembled by scripts/build.mjs, in scope: `model`, `chart`).
// Every function here is total: a route that fails gives null, a source that cannot be read gives an error state,
// and nothing throws into React.
const R = '/kybernos-dashboards/'

const lang = () => { try { return String(window.__KB_LANG_RESOLVE__?.() || '').split(/[-_]/)[0] } catch (e) { return 'fr' } }
const kt = (fr, en) => (lang() === 'en' ? en : fr)
const reduceMotion = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches === true } catch (e) { return false } }

let SESSION_ID = ''
const setSession = (id) => { if (typeof id === 'string' && id.length > 0) SESSION_ID = id }
const sessionId = () => SESSION_ID

/** The host routes of this bundle. Never throws: { status, ok, json }. */
async function api (method, path, body) {
  const url = R + path + (SESSION_ID && method === 'GET' ? (path.includes('?') ? '&' : '?') + 'session=' + encodeURIComponent(SESSION_ID) : '')
  const init = { method, credentials: 'same-origin', headers: {} }
  if (body !== undefined && body !== null) {
    init.headers['content-type'] = 'application/json'
    init.body = JSON.stringify(SESSION_ID && method === 'POST' ? Object.assign({ session: SESSION_ID }, body) : body)
  }
  try {
    const r = await fetch(url, init)
    let json = null
    try { json = await r.json() } catch (e) { json = null }
    return { status: r.status, ok: r.ok && (json === null || json.ok !== false), json: json || {} }
  } catch (e) { return { status: 0, ok: false, json: {} } }
}

// ── sources: the same-origin routes the providers ask for, read once per refresh and shared between widgets ────────────
const ROUTE_TTL = 20000
const routeCache = new Map()
function fetchRoute (req, fresh) {
  const key = req.method + ' ' + req.path + (req.body !== undefined ? JSON.stringify(req.body) : '')
  const hit = routeCache.get(key)
  if (fresh !== true && hit !== undefined && Date.now() - hit.at < ROUTE_TTL) return hit.promise
  const ctl = typeof AbortController === 'function' ? new AbortController() : null
  const timer = setTimeout(() => { try { if (ctl) ctl.abort() } catch (e) { /* settled */ } }, 9000)
  const init = { method: req.method, credentials: 'same-origin', headers: {}, signal: ctl ? ctl.signal : undefined }
  if (req.body !== undefined) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(req.body) }
  const promise = fetch(req.path, init)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .then((j) => { clearTimeout(timer); if (j === null) routeCache.delete(key); return j })
  routeCache.set(key, { at: Date.now(), promise })
  return promise
}
const clearRoutes = () => routeCache.clear()

/** Read a widget's source: { state: 'ok' | 'error', table, at, partial }. */
async function readSource (source, fresh) {
  const now = Date.now()
  const plan = model.planFor(source, now)
  const parts = {}
  let required = 0
  let failed = 0
  await Promise.all(plan.map(async (req) => {
    if (req.optional !== true) required++
    const j = await fetchRoute(req, fresh)
    if (j === null) { if (req.optional !== true) failed++ } else parts[req.key] = j
  }))
  if (required > 0 && failed >= required) return { state: 'error', table: model.buildTable(source, {}, now), at: now, partial: false }
  return { state: 'ok', table: model.buildTable(source, parts, now), at: now, partial: failed > 0 }
}

/** "just now", "5 min ago", "2 h ago", "3 d ago". */
function ago (ms, now) {
  const d = Math.max(0, (now === undefined ? Date.now() : now) - ms)
  const m = Math.floor(d / 60000)
  if (d < 45000) return kt('à l’instant', 'just now')
  if (m < 60) return kt('il y a ' + Math.max(1, m) + ' min', Math.max(1, m) + ' min ago')
  if (m < 1440) return kt('il y a ' + Math.floor(m / 60) + ' h', Math.floor(m / 60) + ' h ago')
  return kt('il y a ' + Math.floor(m / 1440) + ' j', Math.floor(m / 1440) + ' d ago')
}

/** Open a new chat with a ready message (the core listens for this event; nothing is sent until the person sends it). */
function askAI (text) {
  try { window.dispatchEvent(new CustomEvent('kb-open-chat-text', { detail: { text } })); return true } catch (e) { return false }
}
const createMessage = () => "Using the skill 'dashboard-builder', create a dashboard."
const improveMessage = (name, id) => "Using the skill 'dashboard-builder', improve the dashboard '" + name + "' (id: " + id + ')'
const addMessage = (name, id) => "Using the skill 'dashboard-builder', add a widget to the dashboard '" + name + "' (id: " + id + '): '

/** A "when" cell, in the person's language: "Today 07:30", "Yesterday 02:00", "Mon 12 Oct". */
function fmtWhen (value, type, now) {
  if (value === '' || value === undefined || value === null) return ''
  if (type !== 'time' && type !== 'date') return String(value)
  const ms = Date.parse(type === 'date' ? value + 'T00:00:00' : value)
  if (!Number.isFinite(ms)) return String(value)
  const d = new Date(ms); const n = new Date(now === undefined ? Date.now() : now)
  const p = (x) => String(x).padStart(2, '0')
  const days = Math.round((new Date(n.getFullYear(), n.getMonth(), n.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000)
  const hm = type === 'time' ? ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) : ''
  if (days === 0) return kt('Aujourd’hui', 'Today') + hm
  if (days === 1) return kt('Hier', 'Yesterday') + hm
  try { return d.toLocaleDateString(lang() === 'en' ? 'en-GB' : 'fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }) + hm } catch (e) { return model.dayKey(ms) + hm }
}

// ════════════════════════════════════════════════════════════════════════════
// paint
// ════════════════════════════════════════════════════════════════════════════
// src/paint.js: charts as SVG strings (assembled by scripts/build.mjs, in scope: `model` and `chart`).
// Pure: data and a size in, markup out, so the visual check and the tests can run them without a browser.
// The motion is in the CSS (css.js): a painter only sets the custom properties the keyframes read (--i, --s, --len, ...).
const esc = (s) => String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const hue = (k) => (k % 6) + 1
/** The fill class of series/label k: a state keeps its meaning (green done, red failed), anything else cycles the six hues. */
const fillClass = (k, tone) => (tone !== undefined ? 'kbdb-tone-' + tone : 'kbdb-s' + hue(k))
const strokeClass = (k, tone) => (tone !== undefined ? 'kbdb-tonek-' + tone : 'kbdb-k' + hue(k))
const num = (v, f) => model.formatNumber(v, f || 'number')
/** The i-th of n marks, as the multiple of 26 ms the CSS delay reads: even steps, the whole cascade capped (a 60-bar chart is not 1.5 s). */
const stagger = (i, n) => chart.staggerDelay(i, n, 26, 620) / 26

/** An x label: a day key becomes "13 Oct" in the page language, anything else is shown as it is. */
function fmtLabel (key, lang) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key))
  if (m === null) return String(key)
  try { return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short' }) } catch (e) { return String(key) }
}
const svgOpen = (W, H, label) => '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(label) + '">'

function legendHtml (series) {
  if (series.length < 2) return ''
  return '<div class="kbdb-legend">' + series.map((s, k) => '<span style="--i:' + k + '"><i class="' + fillClass(k, s.tone) + '"></i>' + esc(s.name) + '</span>').join('') + '</div>'
}

/** Stacked or grouped columns. `data` is model.chartData's answer. */
function paintColumns (data, W, H, o) {
  const opts = o || {}
  const n = data.labels.length
  const L = chart.columnsLayout({ series: data.series.map((s) => s.values), labelCount: n, W, H, mode: data.kind === 'stacked' ? 'stack' : 'group' })
  let g = ''
  for (const t of L.ticks) g += '<line class="gl" x1="' + L.plot.l + '" x2="' + (L.plot.l + L.plot.w) + '" y1="' + t.y + '" y2="' + t.y + '"/><text x="' + (L.plot.l - 6) + '" y="' + (t.y + 4) + '" text-anchor="end">' + esc(num(t.v, 'compact')) + '</text>'
  for (const lb of L.labels) g += '<text x="' + lb.x + '" y="' + (H - 5) + '" text-anchor="middle">' + esc(fmtLabel(data.labels[lb.i].label, opts.lang)) + '</text>'
  // one <g> per column, so hovering anywhere in the band lifts its bars
  for (const hit of L.hits) {
    const bars = L.bars.filter((b) => b.i === hit.i)
    const tip = '<b>' + esc(fmtLabel(data.labels[hit.i].label, opts.lang)) + '</b>' + data.series.map((s, k) => '<span><i class="' + fillClass(k, s.tone) + '"></i>' + esc(s.name) + ' ' + esc(num(s.values[hit.i])) + '</span>').join('') + (data.series.length > 1 ? '<span>Total ' + esc(num(data.totals[hit.i])) + '</span>' : '')
    g += '<g class="kbdb-col" data-tip="' + esc(tip) + '"><rect class="hit" x="' + hit.x + '" y="' + L.plot.t + '" width="' + hit.w + '" height="' + L.plot.h + '"/>'
    for (const b of bars) {
      const cls = 'kbdb-bar ' + fillClass(b.s, data.series[b.s].tone)
      const style = ' style="--i:' + stagger(hit.i, n) + ';--s:' + b.s + '"'
      // a stack is square everywhere but at its top; grouped columns are all rounded at their data end
      const rounded = data.kind === 'stacked' ? b.top : true
      g += rounded
        ? '<path class="' + cls + '"' + style + ' d="' + chart.roundedTopPath(b.x, b.y, b.w, b.h, 4) + '"/>'
        : '<rect class="' + cls + '"' + style + ' x="' + b.x + '" y="' + b.y + '" width="' + b.w + '" height="' + b.h + '"/>'
    }
    g += '</g>'
  }
  return svgOpen(W, H, opts.label || 'Columns') + g + '</svg>'
}

/** Ranked horizontal bars with the value at the tip. */
function paintBars (data, W, H, o) {
  const opts = o || {}
  const values = data.series[0].values
  const L = chart.hbarsLayout({ values, W, H })
  let g = ''
  for (const t of L.ticks) g += '<line class="gl" x1="' + t.x + '" x2="' + t.x + '" y1="' + L.plot.t + '" y2="' + (L.plot.t + L.plot.h) + '"/><text x="' + t.x + '" y="' + (H - 3) + '" text-anchor="middle">' + esc(num(t.v, 'compact')) + '</text>'
  L.bars.forEach((b, i) => {
    const lab = data.labels[i]
    const tip = '<b>' + esc(lab.label) + '</b><span>' + esc(num(b.v)) + (data.unit ? ' ' + esc(data.unit) : '') + '</span>'
    g += '<g class="kbdb-row" data-tip="' + esc(tip) + '"><rect class="hit" x="0" y="' + r(b.y - (L.rowH - b.h) / 2) + '" width="' + W + '" height="' + L.rowH + '"/>'
      + '<text x="' + (L.plot.l - 8) + '" y="' + (b.y + b.h - 3) + '" text-anchor="end" style="fill:var(--kbdb-t1)">' + esc(cutText(lab.label, 14)) + '</text>'
      + (b.w > 0 ? '<path class="kbdb-hbar ' + (lab.tone !== undefined ? fillClass(i, lab.tone) : 'kbdb-s' + (lab.other ? 6 : 1)) + '" style="--i:' + stagger(i, L.bars.length) + '" d="' + chart.roundedRightPath(b.x, b.y, b.w, b.h, 4) + '"/>' : '')
      + '<text class="kbdb-val" style="--i:' + stagger(i, L.bars.length) + ';fill:var(--kbdb-t1)" x="' + r(b.x + b.w + 6) + '" y="' + (b.y + b.h - 3) + '">' + esc(num(b.v, 'compact')) + '</text></g>'
  })
  return svgOpen(W, H, opts.label || 'Bars') + g + '</svg>'
}
const r = (v) => Math.round(v * 10) / 10
const cutText = (s, n) => { const t = String(s); return t.length > n ? t.slice(0, n - 1) + '…' : t }

/** Lines or areas, with an end marker and a crosshair the page moves on hover (data-cx / data-cy). */
function paintLine (data, W, H, area, o) {
  const opts = o || {}
  const n = data.labels.length
  const L = chart.lineLayout({ series: data.series.map((s) => s.values), labelCount: n, W, H })
  let g = ''
  for (const t of L.ticks) g += '<line class="gl" x1="' + L.plot.l + '" x2="' + (L.plot.l + L.plot.w) + '" y1="' + t.y + '" y2="' + t.y + '"/><text x="' + (L.plot.l - 6) + '" y="' + (t.y + 4) + '" text-anchor="end">' + esc(num(t.v, 'compact')) + '</text>'
  for (const lb of L.labels) g += '<text x="' + lb.x + '" y="' + (H - 5) + '" text-anchor="middle">' + esc(fmtLabel(data.labels[lb.i].label, opts.lang)) + '</text>'
  g += '<line class="kbdb-cross" x1="0" x2="0" y1="' + L.plot.t + '" y2="' + L.baseline + '"/>'
  L.lines.forEach((l) => {
    const k = hue(l.s)
    if (area && l.areaD !== '') g += '<path class="kbdb-area kbdb-s' + k + '" fill-opacity=".12" d="' + l.areaD + '"/>'
    if (l.d !== '') g += '<path class="kbdb-line kbdb-k' + k + '" style="--len:' + l.length + '" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="' + l.d + '"/>'
  })
  for (const e of L.end) {
    const k = hue(e.s)
    g += '<circle class="kbdb-ping kbdb-s' + k + '" cx="' + e.x + '" cy="' + e.y + '" r="4"/>'
      + '<circle class="kbdb-end kbdb-s' + k + '" cx="' + e.x + '" cy="' + e.y + '" r="4" stroke-width="2" style="stroke:var(--kbdb-l1)"/>'
      + '<text class="kbdb-val" x="' + (e.x + 10) + '" y="' + (e.y + 4) + '" style="fill:var(--kbdb-t1);font-weight:600">' + esc(num(e.v, 'compact')) + '</text>'
  }
  g += '<circle class="kbdb-cursor kbdb-s1" cx="0" cy="0" r="4.5" stroke-width="2" style="stroke:var(--kbdb-l1)" data-cursor="1"/>'
  for (const hit of L.hits) {
    const tip = '<b>' + esc(fmtLabel(data.labels[hit.i].label, opts.lang)) + '</b>' + data.series.map((s, k) => '<span><i class="kbdb-s' + hue(k) + '"></i>' + esc(s.name) + ' ' + esc(num(s.values[hit.i])) + '</span>').join('')
    const p = L.lines[0].points[hit.i]
    g += '<rect class="hit" x="' + hit.x + '" y="' + L.plot.t + '" width="' + hit.w + '" height="' + L.plot.h + '" data-tip="' + esc(tip) + '" data-cx="' + (p ? p.x : 0) + '" data-cy="' + (p ? p.y : 0) + '"/>'
  }
  return svgOpen(W, H, opts.label || 'Line') + g + '</svg>'
}

/** A donut with the total in the middle (the page counts it up) and slices that move out on hover. */
function paintDonut (data, size, o) {
  const opts = o || {}
  const L = chart.donutLayout({ values: data.series[0].values, size, thickness: Math.max(12, Math.round(size / 9)) })
  let g = ''
  L.segs.forEach((s, k) => {
    const lab = data.labels[s.i]
    const tip = '<b>' + esc(lab.label) + '</b><span>' + esc(num(s.v)) + (data.unit ? ' ' + esc(data.unit) : '') + ' · ' + s.pct + '%</span>'
    g += '<circle class="kbdb-seg ' + (lab.tone !== undefined ? strokeClass(k, lab.tone) : 'kbdb-k' + (lab.other ? 6 : hue(k))) + '" cx="' + L.cx + '" cy="' + L.cy + '" r="' + L.r + '" stroke-width="' + L.thickness + '" '
      + 'stroke-dashoffset="' + (-s.offset) + '" '
      + 'style="--i:' + k + ';--seg:' + s.len + ';--circ:' + L.circ + ';--tw-hover:' + (L.thickness + 4) + 'px" stroke-dasharray="' + s.len + ' ' + L.circ + '" data-tip="' + esc(tip) + '"/>'
  })
  // the first slice starts at 12 o'clock: the circles stroke from 3 o'clock, so the group is turned, not each circle
  g = '<g transform="rotate(-90 ' + L.cx + ' ' + L.cy + ')">' + g + '</g>'
  g += '<text class="kbdb-donut-c" x="' + L.cx + '" y="' + (L.cy + 2) + '" text-anchor="middle" style="fill:var(--kbdb-t1);font-size:' + Math.round(size / 8) + 'px;font-weight:650" data-total="' + L.total + '">' + esc(num(L.total, 'compact')) + '</text>'
    + '<text class="kbdb-donut-c" x="' + L.cx + '" y="' + (L.cy + Math.round(size / 8) + 4) + '" text-anchor="middle" style="font-size:11px">' + esc(opts.caption || '') + '</text>'
  return svgOpen(size, size, opts.label || 'Donut') + g + '</svg>'
}

/** A calendar heatmap: a square per day, a week per column, each pops in from the left. `data` is model.chartData's answer. */
function paintHeatmap (data, W, H, o) {
  const opts = o || {}
  const L = chart.heatmapLayout({ keys: data.labels.map((l) => l.key), values: data.totals, W, H })
  let g = ''
  for (const c of L.cells) {
    const tip = '<b>' + esc(fmtLabel(c.key, opts.lang)) + '</b><span>' + esc(num(c.v)) + (data.unit ? ' ' + esc(data.unit) : '') + '</span>'
    g += '<rect class="kbdb-hm kbdb-hm' + c.level + '" style="--c:' + Math.min(c.col, 60) + '" x="' + c.x + '" y="' + c.y + '" width="' + c.s + '" height="' + c.s + '" rx="' + Math.max(2, Math.round(c.s * 0.2)) + '" data-tip="' + esc(tip) + '"/>'
  }
  return svgOpen(W, Math.max(1, Math.ceil(L.height)), opts.label || 'Heatmap') + g + '</svg>'
}

/** A sankey: ribbons drawn from the left, nodes growing, labels fading in. `sk` is model.sankeyData's answer. */
function paintSankey (sk, W, H, o) {
  const opts = o || {}
  const L = chart.sankeyLayout({ cols: sk.cols, links: sk.links, W, H })
  let g = ''
  L.links.forEach((l, i) => {
    const a = sk.cols[l.a[0]][l.a[1]]; const b = sk.cols[l.b[0]][l.b[1]]
    const tip = '<b>' + esc(a.name) + ' → ' + esc(b.name) + '</b><span>' + esc(num(l.v)) + (opts.unit ? ' ' + esc(opts.unit) : '') + '</span>'
    g += '<path class="kbdb-rib kbdb-k' + hue(l.a[1]) + '" style="--i:' + i + ';--len:' + l.length + '" stroke-width="' + l.w + '" d="' + l.d + '" data-tip="' + esc(tip) + '"/>'
  })
  L.nodes.forEach((n, i) => {
    const left = n.c === 0
    g += '<rect class="kbdb-node kbdb-s' + hue(n.i) + '" style="--i:' + i + '" x="' + n.x + '" y="' + n.y + '" width="' + n.w + '" height="' + n.h + '" rx="2"/>'
      + '<text class="halo kbdb-val" style="--i:' + i + ';fill:var(--kbdb-t1)" x="' + (left ? n.x - 8 : n.x + n.w + 8) + '" y="' + r(n.y + n.h / 2 + 4) + '" text-anchor="' + (left ? 'end' : 'start') + '">' + esc(cutText(n.name, 16)) + ' <tspan style="fill:var(--kbdb-t3)">' + esc(num(n.v, 'compact')) + '</tspan></text>'
  })
  return svgOpen(W, H, opts.label || 'Sankey') + g + '</svg>'
}

/** A flow: nodes pop in one after the other, edges draw themselves, a running step breathes and its edge marches. */
function paintFlow (wd, o) {
  const opts = o || {}
  const byId = {}
  wd.nodes.forEach((n) => { byId[n.id] = n })
  const NW = chart.FLOW_NODE.w; const NH = chart.FLOW_NODE.h
  let g = ''
  wd.edges.forEach((e, i) => {
    const a = byId[e[0]]; const b = byId[e[1]]
    if (a === undefined || b === undefined) return
    const p = chart.flowEdgePath(a, b)
    const running = a.s === 'run' || b.s === 'run'
    g += '<path class="kbdb-fedge' + (e[2] === 'f' ? ' f' : '') + (running && e[2] !== 'f' ? ' run' : '') + '" style="--i:' + i + ';--len:' + p.length + '" d="' + p.d + '"/>'
    if (e[2] === 'f') g += '<text x="' + p.mx + '" y="' + (p.my - 6) + '" text-anchor="middle" style="font-size:11px">' + esc(opts.failLabel || 'on failure') + '</text>'
  })
  wd.nodes.forEach((n, i) => {
    const col = n.s === 'ok' ? 'var(--kbdb-ok)' : n.s === 'warn' ? 'var(--kbdb-warn)' : n.s === 'fail' ? 'var(--kbdb-err)' : n.s === 'run' ? 'var(--kbdb-accent)' : 'var(--kbdb-t3)'
    // the position is an outer group: the entrance animation sets a CSS transform on the node, which would replace a translate()
    g += '<g transform="translate(' + n.x + ',' + n.y + ')"><g class="kbdb-fnode" data-nid="' + esc(n.id) + '" style="--i:' + i + '">'
      + '<rect class="nb" width="' + NW + '" height="' + NH + '" rx="12"/>'
      + '<circle class="kbdb-fport" cx="0" cy="' + NH / 2 + '" r="4.5"/><circle class="kbdb-fport" cx="' + NW + '" cy="' + NH / 2 + '" r="4.5"/>'
      + '<text class="nk" x="14" y="17">' + esc(n.k) + '</text>'
      + '<circle class="' + (n.s === 'run' ? 'st-run' : '') + '" cx="' + (NW - 16) + '" cy="13" r="4" style="fill:' + (n.s === 'idle' ? 'transparent' : col) + ';stroke:' + col + ';stroke-width:1.5"/>'
      + '<text class="nt" x="14" y="35">' + esc(cutText(n.t, 22)) + '</text><text class="ns" x="14" y="50">' + esc(cutText(n.sub, 28)) + '</text></g></g>'
  })
  return '<svg class="kbdb-flowsvg" viewBox="0 0 960 220" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="' + esc(opts.label || 'Flow') + '">' + g + '</svg>'
}

/** The sparkline of a card: a polyline that draws itself and an end dot that pops. */
function paintSpark (values, w, h) {
  const pts = chart.sparkPoints(values, w, h)
  if (pts.length < 2) return ''
  let len = 0
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  const last = pts[pts.length - 1]
  return '<svg class="kbdb-spark" width="' + w + '" height="' + h + '" aria-hidden="true"><polyline style="--len:' + Math.ceil(len) + '" points="' + pts.map((p) => p.x + ',' + p.y).join(' ') + '"/><circle cx="' + last.x + '" cy="' + last.y + '" r="4"/></svg>'
}

// ════════════════════════════════════════════════════════════════════════════
// widgets
// ════════════════════════════════════════════════════════════════════════════
// src/widgets.js: the widgets as React components (assembled by scripts/build.mjs, in scope: React, `model`, `chart`, the
// painters of paint.js and the helpers of data.js).
const React = require('react')
const h = React.createElement
const { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } = React

/* ── icons ── */
const ICONS = {
  plus: '<path d="M8 3v10M3 8h10"/>', chev: '<path d="M4 6l4 4 4-4"/>', refresh: '<path d="M13 8a5 5 0 1 1-1.5-3.5M13 2.5v3h-3"/>',
  table: '<rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M2 6.5h12M6.5 6.5V13"/>', grip: '<path d="M6 4h.01M10 4h.01M6 8h.01M10 8h.01M6 12h.01M10 12h.01" stroke-width="2.4"/>',
  x: '<path d="M4 4l8 8M12 4l-8 8"/>', check: '<path d="M3.5 8.5l3 3 6-7"/>', left: '<path d="M10 3l-5 5 5 5"/>', right: '<path d="M6 3l5 5-5 5"/>',
  minus: '<path d="M3.5 8h9"/>', pencil: '<path d="M3 13l.6-2.8 7.2-7.2a1.4 1.4 0 0 1 2 2L5.6 12.2 3 13Z"/>',
  db: '<ellipse cx="8" cy="4" rx="5" ry="2"/><path d="M3 4v4c0 1.1 2.2 2 5 2s5-.9 5-2V4M3 8v4c0 1.1 2.2 2 5 2s5-.9 5-2V8"/>',
  more: '<path d="M3.5 8h.01M8 8h.01M12.5 8h.01" stroke-width="2.4"/>', star: '<path d="M8 2l1.8 3.7 4 .6-2.9 2.8.7 4L8 11.2 4.4 13l.7-4L2.2 6.3l4-.6L8 2Z"/>',
  copy: '<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5V4A1.5 1.5 0 0 0 9 2.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5"/>',
  archive: '<rect x="2" y="3" width="12" height="3.5" rx="1"/><path d="M3.5 6.5V12a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V6.5M6.5 9h3"/>',
  eyeoff: '<path d="M2 8s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4Z"/><circle cx="8" cy="8" r="1.8"/><path d="M3 13L13 3"/>',
  spark: '<path d="M8 2l1.3 3.2L12.5 6.5 9.3 7.8 8 11 6.7 7.8 3.5 6.5l3.2-1.3L8 2ZM12.5 10.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6.6-1.4Z"/>',
  clock: '<circle cx="8" cy="8" r="6"/><path d="M8 4.5V8l2.5 1.5"/>', undo: '<path d="M3.5 6.5h6a3.2 3.2 0 0 1 0 6.4H6M3.5 6.5 6 4M3.5 6.5 6 9"/>',
  ext: '<path d="M9 3h4v4M13 3 7.5 8.5M6 4H4a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-2"/>', menu: '<path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"/>',
}
const Ic = (name, size) => h('svg', { width: size || 16, height: size || 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', dangerouslySetInnerHTML: { __html: ICONS[name] || '' } })

/* ── hooks ── */

/** True once the element has been on screen; also sets [data-inview], which starts its CSS animations. */
function useInView (ref) {
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (el === null || el === undefined) return undefined
    const go = () => { try { el.setAttribute('data-inview', '1') } catch (e) { /* detached */ } setSeen(true) }
    if (reduceMotion() || typeof IntersectionObserver !== 'function') { go(); return undefined }
    const io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { go(); io.disconnect(); break } }, { threshold: 0.12 })
    io.observe(el)
    // a widget nobody scrolls to (a thumbnail, a screenshot, a print) must not stay at its start frame
    const late = setTimeout(() => { go(); io.disconnect() }, 3500)
    return () => { clearTimeout(late); io.disconnect() }
  }, [])
  return seen
}

/** The size of an element, kept up to date. */
function useSize (ref) {
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = ref.current
    if (el === null || el === undefined) return undefined
    const read = () => { const w = el.clientWidth; const hh = el.clientHeight; setSize((s) => (s.w === w && s.h === hh ? s : { w, h: hh })) }
    read()
    if (typeof ResizeObserver !== 'function') return undefined
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return size
}

/** A number that counts up from 0 to `target` once `run` is true (immediately the target under reduced motion). */
function useCountUp (target, run, ms) {
  const [v, setV] = useState(reduceMotion() ? target : 0)
  useEffect(() => {
    if (reduceMotion() || run !== true) { setV(target); return undefined }
    let raf = 0
    let t0 = null
    const dur = ms || 900
    const step = (t) => {
      if (t0 === null) t0 = t
      const p = Math.min(1, (t - t0) / dur)
      setV(chart.countUpAt(0, target, p))
      if (p < 1) raf = requestAnimationFrame(step)
    }
    setV(0)
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, run])
  return v
}

/** What a source gives a widget: { state: 'none' | 'loading' | 'refreshing' | 'ok' | 'error', table, at, partial }. */
function useSourceData (source, tick) {
  const key = source ? JSON.stringify(source) : ''
  const [st, setSt] = useState({ state: source ? 'loading' : 'none', table: null, at: 0, partial: false })
  useEffect(() => {
    if (!source) { setSt({ state: 'none', table: null, at: 0, partial: false }); return undefined }
    let dead = false
    setSt((s) => ({ state: s.table !== null ? 'refreshing' : 'loading', table: s.table, at: s.at, partial: false }))
    readSource(source, false).then((r) => { if (!dead) setSt({ state: r.state, table: r.table, at: r.at, partial: r.partial }) })
    return () => { dead = true }
  }, [key, tick])
  return st
}

// the numbers on the nodes of a flow: one read per distinct source, the tables indexed by model.flowSources keys
function useFlowData (wd, tick) {
  const list = useMemo(() => (wd.type === 'flow' ? model.flowSources(wd) : []), [wd])
  const key = list.map((x) => x.key).join(';')
  const [st, setSt] = useState({ state: list.length > 0 ? 'loading' : 'none', tables: {}, at: 0, partial: false })
  useEffect(() => {
    if (list.length === 0) { setSt({ state: 'none', tables: {}, at: 0, partial: false }); return undefined }
    let dead = false
    setSt((s) => ({ state: Object.keys(s.tables).length > 0 ? 'refreshing' : 'loading', tables: s.tables, at: s.at, partial: false }))
    Promise.all(list.map((x) => readSource(x.source, false))).then((rs) => {
      if (dead) return
      const tables = {}
      let bad = 0
      rs.forEach((r, i) => { if (r.state === 'ok') tables[list[i].key] = r.table; else bad += 1 })
      setSt({ state: bad === rs.length ? 'error' : 'ok', tables, at: Date.now(), partial: bad > 0 || rs.some((r) => r.partial) })
    })
    return () => { dead = true }
  }, [key, tick])
  return st
}

const bone = (w, hh) => h('div', { className: 'kbdb-bone', style: { width: w, height: hh } })
const Skeleton = ({ type }) => h('div', { className: 'kbdb-sk' }, type === 'card' ? [bone('46%', 28), bone('64%', 12)] : [bone('100%', 12), bone('100%', 12), h('div', { className: 'kbdb-bone', style: { flex: 1, borderRadius: 10 } })])
const Empty = ({ children }) => h('div', { className: 'kbdb-empty' }, children)

const STATE_DOT = { done: '', failed: 'err', queued: 'idle', upcoming: 'idle', paused: 'pause', none: 'idle' }
const dotClass = (state) => 'kbdb-dot' + (STATE_DOT[state] ? ' ' + STATE_DOT[state] : '')

/* ── card ── */
function CardBody ({ wd, table, stale, inView, now }) {
  const c = useMemo(() => model.cardData(table, wd), [table, wd])
  const shown = useCountUp(c.value, inView, 900)
  const v = Number.isInteger(c.value) ? Math.round(shown) : shown
  const text = model.formatNumber(v, wd.format) + (wd.unit ? ' ' + wd.unit : '')
  const sparkHtml = useMemo(() => (c.spark ? paintSpark(c.spark, 96, 34) : ''), [c.spark])
  return h('div', { className: 'kbdb-kpi' + (c.st === 'warn' ? ' warn' : '') + (stale ? ' kbdb-stale' : '') },
    h('div', { style: { minWidth: 0 } },
      h('div', { className: 'kbdb-kpi-v' + (c.label !== undefined ? ' t' : ''), 'data-kb': 'dashboards-value', title: c.label !== undefined ? c.label : undefined }, c.label !== undefined ? (c.label === '' ? '—' : c.label) : text),
      c.sub !== '' ? h('div', { className: 'kbdb-kpi-s' }, h('span', { className: 'kbdb-dot' + (c.st === 'warn' ? ' warn' : (c.st === 'fail' ? ' err' : '')) }), c.sub) : null),
    sparkHtml !== '' ? h('span', { dangerouslySetInnerHTML: { __html: sparkHtml } }) : null)
}

/* ── charts ── */
function chartTableHtml (data) {
  const head = '<tr><th></th>' + data.series.map((s) => '<th>' + esc(s.name) + '</th>').join('') + (data.series.length > 1 ? '<th>Σ</th>' : '') + '</tr>'
  const rows = data.labels.map((l, i) => '<tr><td>' + esc(fmtLabel(l.label, lang())) + '</td>' + data.series.map((s) => '<td>' + esc(model.formatNumber(s.values[i])) + '</td>').join('') + (data.series.length > 1 ? '<td>' + esc(model.formatNumber(data.totals[i])) + '</td>' : '') + '</tr>').join('')
  return '<table><thead>' + head + '</thead><tbody>' + rows + '</tbody></table>'
}
function ChartBody ({ wd, table, stale, asTable }) {
  const ref = useRef(null)
  const { w, h: ht } = useSize(ref)
  const data = useMemo(() => model.chartData(table, wd), [table, wd])
  const donutInfo = wd.kind === 'donut'
  if (data.empty) return h(Empty, null, kt('Rien à afficher pour cette période.', 'Nothing to show for this period.'))
  if (asTable) return h('div', { className: 'kbdb-tbl', dangerouslySetInnerHTML: { __html: chartTableHtml(data) } })
  const multi = (wd.kind === 'stacked' || wd.kind === 'columns' || wd.kind === 'line' || wd.kind === 'area') && data.series.length > 1
  let svg = ''
  if (w > 40 && ht > 40) {
    const o = { lang: lang(), label: wd.title }
    if (wd.kind === 'stacked' || wd.kind === 'columns') svg = paintColumns(data, w, ht, o)
    else if (wd.kind === 'bars') svg = paintBars(data, w, ht, o)
    else if (wd.kind === 'line' || wd.kind === 'area') svg = paintLine(data, w, ht, wd.kind === 'area', o)
    else if (donutInfo) svg = paintDonut(data, Math.max(80, Math.min(w * 0.5, ht)), { label: wd.title, caption: wd.unit || '' })
    else if (wd.kind === 'heatmap') svg = paintHeatmap(data, w, ht, o)
  }
  const onMove = (e) => {
    const t = e.target
    if (!t || !t.getAttribute || !t.getAttribute('data-cx')) return
    const root = ref.current
    const cross = root.querySelector('.kbdb-cross')
    const cur = root.querySelector('[data-cursor]')
    if (cross) { cross.setAttribute('x1', t.getAttribute('data-cx')); cross.setAttribute('x2', t.getAttribute('data-cx')) }
    if (cur) { cur.setAttribute('cx', t.getAttribute('data-cx')); cur.setAttribute('cy', t.getAttribute('data-cy')) }
  }
  if (donutInfo) {
    const total = data.totals.reduce((a, b) => a + b, 0)
    return h('div', { className: 'kbdb-chart' + (stale ? ' kbdb-stale' : ''), ref, style: { display: 'flex', alignItems: 'center', gap: 16 } },
      h('div', { style: { flex: 'none', width: Math.max(80, Math.min(w * 0.5, ht)), height: Math.max(80, Math.min(w * 0.5, ht)) }, dangerouslySetInnerHTML: { __html: w > 40 ? svg : '' } }),
      h('ul', { style: { listStyle: 'none', margin: 0, padding: 0, flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 } },
        data.labels.map((l, i) => h('li', { key: l.key, className: 'kbdb-legend', style: { margin: 0, flexWrap: 'nowrap', gap: 8 } },
          h('span', { style: { '--i': i, minWidth: 0, flex: 1 } }, h('i', { className: l.tone !== undefined ? 'kbdb-tone-' + l.tone : 'kbdb-s' + (l.other ? 6 : ((i % 6) + 1)) }), h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, l.label)),
          h('span', { style: { color: 'var(--kbdb-t3)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' } }, total > 0 ? Math.round((data.totals[i] / total) * 100) + '%' : '')))))
  }
  return h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } },
    multi ? h('div', { dangerouslySetInnerHTML: { __html: legendHtml(data.series) } }) : null,
    h('div', { className: 'kbdb-chart' + (stale ? ' kbdb-stale' : ''), ref, onMouseMove: onMove, dangerouslySetInnerHTML: { __html: svg } }),
    wd.kind === 'heatmap' ? h('div', { className: 'kbdb-hmkey', 'aria-hidden': 'true' }, kt('Moins', 'Less'), [0, 1, 2, 3, 4].map((l) => h('i', { key: l, className: 'kbdb-hm' + l })), kt('Plus', 'More')) : null)
}

/* ── table ── */
function TableBody ({ wd, table, stale }) {
  const d = useMemo(() => model.tableData(table, wd), [table, wd])
  if (d.rows.length === 0) return h(Empty, null, kt('Aucune ligne.', 'No rows.'))
  const now = Date.now()
  const show = (c, v) => (c.type === 'number' ? model.formatNumber(Number(v), c.format) : ((c.type === 'time' || c.type === 'date') ? fmtWhen(v, c.type, now) : String(v)))
  return h('div', { className: 'kbdb-dt' + (stale ? ' kbdb-stale' : '') },
    h('table', null,
      h('thead', null, h('tr', null, d.columns.map((c) => h('th', { key: c.field, className: c.type === 'number' ? 'n' : '' }, c.label)))),
      h('tbody', null, d.rows.map((row, i) => h('tr', { key: i, style: { '--i': Math.min(i, 14) } }, row.map((cl, k) => {
        const c = d.columns[k]
        const text = show(c, cl.v)
        const inner = k === 0 && wd.swatch ? h('span', { className: 'lb' }, h('i', { className: 'sw kbdb-s' + ((i % 6) + 1) }), text) : text
        const style = c.bar && c.max > 0 ? { '--p': Math.max(2, Math.round((Number(cl.v) / c.max) * 100)) + '%' } : undefined
        return h('td', { key: k, className: (c.type === 'number' ? 'n' : '') + (c.bar ? ' bar' : ''), style }, inner)
      }))))))
}

/* ── calendar ── */
function CalendarBody ({ wd, table, stale }) {
  const days = useMemo(() => model.calendarData(table, wd, Date.now()), [table, wd])
  const dn = lang() === 'en' ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] : ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.']
  const key = h('div', { className: 'kbdb-calkey' },
    h('span', null, h('span', { className: 'kbdb-dot' }), kt('Fait', 'Done')), h('span', null, h('span', { className: 'kbdb-dot err' }), kt('Échec', 'Failed')),
    h('span', null, h('span', { className: 'kbdb-dot idle' }), kt('À venir', 'Upcoming')), h('span', null, h('span', { className: 'kbdb-dot pause' }), kt('En pause', 'Paused')))
  return h(React.Fragment, null, key, h('div', { className: 'kbdb-cal' + (stale ? ' kbdb-stale' : '') }, days.map((d, i) => {
    const shown = d.events.slice(0, 4); const more = d.events.length - shown.length
    return h('div', { key: d.key, className: 'kbdb-day' + (d.today ? ' today' : ''), style: { '--i': i } },
      h('h4', null, dn[d.dow] + ' ', h('b', null, d.n)),
      shown.map((e, k) => h('div', { key: k, className: 'kbdb-ev' + (e.state === 'failed' ? ' fail' : (e.state === 'upcoming' || e.state === 'paused' ? ' next' : '')), style: { '--i': i, '--e': k }, 'data-tip': '<b>' + esc(e.title) + '</b><span>' + esc(d.key + ' ' + e.time) + '</span>' + (e.detail ? '<span>' + esc(e.detail) + '</span>' : '') },
        h('span', { className: dotClass(e.state) }), h('span', { className: 'tx' }, h('span', { className: 't' }, e.time), h('span', { className: 'nm' }, e.title)))),
      more > 0 ? h('div', { className: 'kbdb-more' }, '+' + more + ' ' + kt('autres', 'more')) : null)
  })))
}

/* ── list ── */
function ListBody ({ wd, table, stale }) {
  const [chip, setChip] = useState('all')
  const rows = useMemo(() => model.listData(table, wd, chip), [table, wd, chip])
  const now = Date.now()
  return h(React.Fragment, null,
    wd.failedChip ? h('div', { className: 'kbdb-fchips' },
      h('button', { type: 'button', className: 'kbdb-chip', 'aria-pressed': chip === 'all', onClick: () => setChip('all') }, kt('Tout', 'All')),
      h('button', { type: 'button', className: 'kbdb-chip', 'aria-pressed': chip === 'failed', onClick: () => setChip('failed') }, kt('Échecs', 'Failed'))) : null,
    rows.length === 0 ? h(Empty, null, kt('Aucune ligne.', 'No rows.')) : h('div', { className: 'kbdb-rows' + (stale ? ' kbdb-stale' : '') }, rows.map((r, i) =>
      h('div', { key: i, className: 'kbdb-lrow', style: { '--i': Math.min(i, 12) } },
        wd.state ? h('span', { className: dotClass(r.state) }) : null,
        h('div', { className: 'tx' }, h('b', null, r.title), r.sub !== '' ? h('i', null, fmtWhen(r.sub, r.subType, now)) : null),
        r.when !== '' ? h('span', { className: 'when' }, fmtWhen(r.when, r.whenType, now)) : null))))
}

/* ── kanban ── */
function KanbanBody ({ wd, table, stale, onPatch }) {
  const [over, setOver] = useState(-1)
  const [adding, setAdding] = useState(-1)
  const drag = useRef(null)
  const cols = useMemo(() => model.kanbanData(table || { rows: [] }, wd), [table, wd])
  const move = (to) => {
    const d = drag.current
    drag.current = null; setOver(-1)
    if (d === null || to === d.ci || typeof onPatch !== 'function') return
    const next = wd.cols.map((c) => ({ t: c.t, c: c.c.slice() }))
    const [card] = next[d.ci].c.splice(d.ki, 1)
    next[to].c.push(card)
    onPatch({ cols: next })
  }
  const add = (ci, text) => {
    setAdding(-1)
    const t = String(text || '').trim()
    if (t === '' || typeof onPatch !== 'function') return
    const next = wd.cols.map((c) => ({ t: c.t, c: c.c.slice() }))
    next[ci].c.push([t.slice(0, 80), ''])
    onPatch({ cols: next })
  }
  const drop = (ci, ki) => {
    const next = wd.cols.map((c) => ({ t: c.t, c: c.c.slice() }))
    next[ci].c.splice(ki, 1)
    onPatch({ cols: next })
  }
  return h('div', { className: 'kbdb-kan' + (stale ? ' kbdb-stale' : ''), style: { '--cols': cols.length } }, cols.map((c, ci) =>
    h('div', { key: ci, className: 'kbdb-kcol' + (over === ci ? ' over' : ''), onDragOver: wd.manual ? (e) => { e.preventDefault(); if (over !== ci) setOver(ci) } : undefined, onDrop: wd.manual ? (e) => { e.preventDefault(); move(ci) } : undefined, onDragLeave: wd.manual ? () => setOver(-1) : undefined },
      h('h4', null, c.title, h('span', { className: 'n' }, c.total)),
      h('div', { className: 'kbdb-kcards' },
        c.cards.map((k, ki) => h('div', { key: ki, className: 'kbdb-kcard', style: { '--i': Math.min(ki, 8) }, draggable: wd.manual === true, onDragStart: wd.manual ? () => { drag.current = { ci, ki } } : undefined, onDragEnd: () => { drag.current = null; setOver(-1) } },
          k.title, k.sub !== '' ? h('i', null, fmtWhen(k.sub, k.subType, Date.now())) : null,
          wd.manual ? h('button', { type: 'button', className: 'kbdb-ib', style: { width: 18, height: 18, float: 'right', marginTop: -2 }, 'aria-label': kt('Retirer la carte', 'Remove the card'), onClick: () => drop(ci, ki) }, Ic('x', 11)) : null)),
        wd.manual ? (adding === ci
          ? h('input', { autoFocus: true, className: 'kbdb-kcard', style: { width: '100%', font: 'inherit', color: 'inherit' }, placeholder: kt('Nouvelle carte', 'New card'), onKeyDown: (e) => { if (e.key === 'Enter') add(ci, e.target.value); else if (e.key === 'Escape') setAdding(-1) }, onBlur: (e) => add(ci, e.target.value) })
          : h('button', { type: 'button', className: 'kbdb-addi', onClick: () => setAdding(ci) }, '+ ' + kt('Ajouter', 'Add'))) : null))))
}

/* ── note ── */
// The text of an editable box, line by line. Enter in a contenteditable leaves <div> and <br> children, and textContent
// glues the lines ("good" + "hello" -> "goodhello"), so the box is read as lines the way the page lays them out: a block
// starts a line, and a <br> ends one unless it is the last child of its parent (that one only marks the end, or the empty
// line of a block) or sits right before a block (the block starts the next line by itself).
const isBlockEl = (n) => n !== undefined && n.nodeType === 1 && /^(DIV|P|LI|H[1-6])$/.test(n.nodeName)
function editableText (root) {
  const lines = ['']
  let started = false
  const walk = (n) => {
    const kids = Array.from(n.childNodes)
    kids.forEach((c, i) => {
      if (c.nodeType === 3) {
        if (c.data !== '') { lines[lines.length - 1] += c.data; started = true }
      } else if (c.nodeName === 'BR') {
        if (i < kids.length - 1 && !isBlockEl(kids[i + 1])) lines.push('')
        started = true
      } else if (c.nodeType === 1) {
        if (isBlockEl(c)) { if (started) lines.push(''); started = true }
        walk(c)
      }
    })
  }
  walk(root)
  return lines.join('\n')
}
// what a box keeps once you leave it: the text, and the box itself rewritten as that text (what you see is what is saved)
function leaveBox (el, oneLine) {
  let t = editableText(el)
  if (oneLine) t = t.replace(/\s*\n\s*/g, ' ').trim()
  if (el.textContent !== t) el.textContent = t
  return t
}
// a paste is plain text: no fonts, colours or blocks from wherever it was copied
const pastePlain = (oneLine) => (e) => {
  const cd = e.clipboardData
  if (!cd) return
  e.preventDefault()
  let t = cd.getData('text/plain')
  if (oneLine) t = t.replace(/\s*\n\s*/g, ' ')
  try { document.execCommand('insertText', false, t) } catch (_) {}
}
// one-line boxes (title, checklist item): Enter validates, it does not start a second line
const enterLeaves = (e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }

function NoteBody ({ wd, onPatch }) {
  const has = Array.isArray(wd.check)
  const save = (patch) => { if (typeof onPatch === 'function') onPatch(patch) }
  const setCheck = (i, fn) => { const next = wd.check.map((c) => c.slice()); fn(next[i]); save({ check: next }) }
  return h(React.Fragment, null,
    h('div', { className: 'kbdb-ntitle', contentEditable: true, suppressContentEditableWarning: true, 'data-ph': kt('Titre', 'Title'), onKeyDown: enterLeaves, onPaste: pastePlain(true), onBlur: (e) => save({ title: leaveBox(e.currentTarget, true) }) }, wd.title),
    has
      ? h('div', { className: 'kbdb-nbody', style: { whiteSpace: 'normal' } },
        wd.check.map((c, i) => h('div', { key: i, className: 'kbdb-check' + (c[1] ? ' done' : '') },
          h('button', { type: 'button', 'aria-label': kt('Cocher', 'Toggle'), 'aria-pressed': c[1] === 1, onClick: () => setCheck(i, (row) => { row[1] = row[1] ? 0 : 1 }) }, c[1] ? Ic('check', 12) : null),
          h('span', { contentEditable: true, suppressContentEditableWarning: true, onKeyDown: enterLeaves, onPaste: pastePlain(true), onBlur: (e) => { const t = leaveBox(e.currentTarget, true); setCheck(i, (row) => { row[0] = t }) } }, c[0]))),
        h('button', { type: 'button', className: 'kbdb-addi', onClick: () => save({ check: wd.check.concat([[kt('Nouvel élément', 'New item'), 0]]) }) }, '+ ' + kt('Ajouter un élément', 'Add an item')))
      : h('div', { className: 'kbdb-nbody', contentEditable: true, suppressContentEditableWarning: true, 'data-ph': kt('Écrivez ici', 'Write something'), onPaste: pastePlain(false), onBlur: (e) => save({ text: leaveBox(e.currentTarget, false) }) }, wd.text || ''))
}

/* ── carousel ── */
const KIND_HUE = { slides: 1, pptx: 1, doc: 3, docx: 3, document: 3, md: 3, pdf: 6, 'mini app': 2, json: 2, png: 4, jpg: 4, mp4: 5 }
function CarouselBody ({ wd, table, stale, railRef }) {
  const cards = useMemo(() => model.carouselData(table, wd), [table, wd])
  if (cards.length === 0) return h(Empty, null, kt('Rien à parcourir.', 'Nothing to browse.'))
  return h('div', { className: 'kbdb-rail-wrap' }, h('div', { className: 'kbdb-rail' + (stale ? ' kbdb-stale' : ''), ref: railRef }, cards.map((c, i) => {
    const k = KIND_HUE[String(c.kind).toLowerCase()] || ((i % 6) + 1)
    return h('div', { key: i, className: 'kbdb-dcard', style: { '--i': Math.min(i, 10) } },
      h('span', { className: 'kbdb-thumb', style: { background: 'color-mix(in srgb, var(--kbdb-s' + k + ') 16%, var(--kbdb-l1))' } }, (c.kind || c.title || '?').slice(0, 4)),
      h('b', null, c.title), h('i', null, [c.kind, c.sub].filter((x) => x !== '').join(' · ')))
  })))
}

/* ── flow and sankey ── */
function FlowBody ({ wd, onPatch, edit, flowTables }) {
  const ref = useRef(null)
  const [nodes, setNodes] = useState(wd.nodes)
  useEffect(() => { setNodes(wd.nodes) }, [wd.nodes])
  // drawn with the live numbers; dragging and saving keep to the nodes as written
  const html = useMemo(() => {
    const tables = flowTables || {}
    const shown = nodes.map((n) => (n.bind ? model.liveNode(n, tables[n.bind.source.provider + '|' + JSON.stringify(n.bind.source.params)]) : n))
    return paintFlow(Object.assign({}, wd, { nodes: shown }), { label: wd.title, failLabel: kt('en cas d’échec', 'on failure') })
  }, [wd, nodes, flowTables])
  const onDown = (e) => {
    const g = e.target.closest ? e.target.closest('.kbdb-fnode') : null
    const svg = ref.current ? ref.current.querySelector('svg') : null
    if (g === null || svg === null) return
    const id = g.getAttribute('data-nid')
    const n = nodes.find((x) => x.id === id)
    if (n === undefined) return
    const pt = (ev) => { const p = svg.createSVGPoint(); p.x = ev.clientX; p.y = ev.clientY; return p.matrixTransform(svg.getScreenCTM().inverse()) }
    const p0 = pt(e); const ox = p0.x - n.x; const oy = p0.y - n.y
    let latest = nodes
    const mv = (ev) => {
      const p = pt(ev)
      latest = nodes.map((x) => (x.id === id ? Object.assign({}, x, { x: Math.round(Math.max(0, Math.min(780, p.x - ox))), y: Math.round(Math.max(0, Math.min(160, p.y - oy))) }) : x))
      setNodes(latest)
    }
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); if (typeof onPatch === 'function') onPatch({ nodes: latest }) }
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up)
    e.preventDefault()
  }
  return h('div', { className: 'kbdb-chart', ref, onPointerDown: onDown, dangerouslySetInnerHTML: { __html: html } })
}
function SankeyBody ({ wd, table, stale }) {
  const ref = useRef(null)
  const { w, h: ht } = useSize(ref)
  const sk = useMemo(() => model.sankeyData(table, wd), [table, wd])
  if (sk.empty) return h(Empty, null, kt('Rien à afficher.', 'Nothing to show.'))
  const svg = w > 60 && ht > 60 ? paintSankey(sk, w, ht, { unit: wd.unit || '', label: wd.title }) : ''
  return h('div', { className: 'kbdb-chart' + (stale ? ' kbdb-stale' : ''), ref, dangerouslySetInnerHTML: { __html: svg } })
}

/* ── the shell around every widget ── */
const WIDTHS = [3, 4, 5, 6, 7, 8, 12]
function Widget ({ wd, index, tick, edit, flash, onPatch, onRemove, onMove, onWiden, onRetry }) {
  const root = useRef(null)
  const railRef = useRef(null)
  const inView = useInView(root)
  const src = useSourceData(wd.source, tick)
  const flow = useFlowData(wd, tick)
  const [asTable, setAsTable] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [over, setOver] = useState(false)
  const bound = wd.source !== undefined
  const hasTable = wd.type === 'chart'
  const stale = src.state === 'refreshing'
  const label = bound && model.PROVIDERS[wd.source.provider] ? model.PROVIDERS[wd.source.provider].label : ''

  let body
  if (bound && (src.state === 'loading' || src.state === 'none')) body = h(Skeleton, { type: wd.type })
  else if (wd.type === 'flow' && flow.state === 'loading') body = h(Skeleton, { type: 'flow' })
  else if (bound && src.state === 'error') {
    body = h('div', { className: 'kbdb-err-note' }, h('span', null, kt('Cette source n’a pas répondu.', 'This source did not answer.')),
      h('button', { type: 'button', className: 'kbdb-btn sm', onClick: () => { if (typeof onRetry === 'function') onRetry() } }, kt('Réessayer', 'Try again')))
  } else {
    const common = { wd, table: src.table, stale, inView, onPatch, edit, flowTables: flow.tables }
    switch (wd.type) {
      case 'card': body = h(CardBody, common); break
      case 'chart': body = h(ChartBody, Object.assign({ asTable }, common)); break
      case 'calendar': body = h(CalendarBody, common); break
      case 'table': body = h(TableBody, common); break
      case 'list': body = h(ListBody, common); break
      case 'kanban': body = h(KanbanBody, common); break
      case 'carousel': body = h(CarouselBody, Object.assign({ railRef }, common)); break
      case 'note': body = h(NoteBody, common); break
      case 'flow': body = h(FlowBody, common); break
      case 'sankey': body = h(SankeyBody, common); break
      default: body = null
    }
  }
  const isNote = wd.type === 'note'
  const head = h('div', { className: 'kbdb-wh' },
    isNote ? null : h('h3', { title: wd.title }, wd.title),
    isNote
      ? h('span', { className: 'kbdb-tint kbdb-tools' }, ['', 'amber', 'green', 'blue', 'pink'].map((t, i) => h('button', { key: t, type: 'button', className: 't' + i, 'aria-label': t || kt('Sans couleur', 'No colour'), onClick: () => onPatch && onPatch({ tint: t }) })))
      : h('span', { className: 'kbdb-tools', style: { display: 'inline-flex', gap: 2 } },
        wd.type === 'carousel' ? [
          h('button', { key: 'l', type: 'button', className: 'kbdb-ib', 'aria-label': kt('Défiler à gauche', 'Scroll left'), onClick: () => railRef.current && railRef.current.scrollBy({ left: -212, behavior: 'smooth' }) }, Ic('left', 14)),
          h('button', { key: 'r', type: 'button', className: 'kbdb-ib', 'aria-label': kt('Défiler à droite', 'Scroll right'), onClick: () => railRef.current && railRef.current.scrollBy({ left: 212, behavior: 'smooth' }) }, Ic('right', 14))] : null,
        hasTable ? h('button', { type: 'button', className: 'kbdb-ib', 'aria-pressed': asTable, 'aria-label': kt('Voir en tableau', 'Show as a table'), title: kt('Voir en tableau', 'Show as a table'), onClick: () => setAsTable((v) => !v) }, Ic('table', 14)) : null))
  // what the footer reports: the widget's own source, or for a flow the sources of its nodes
  const liveFlow = wd.type === 'flow' && flow.state !== 'none'
  const status = liveFlow ? { state: flow.state, at: flow.at, partial: flow.partial, table: null } : src
  const footLabel = liveFlow
    ? (() => { const ls = Array.from(new Set(model.flowSources(wd).map((x) => (model.PROVIDERS[x.source.provider] ? model.PROVIDERS[x.source.provider].label : x.source.provider)))); return ls.length > 2 ? ls.length + ' ' + kt('sources', 'sources') : ls.join(' + ') })()
    : label
  const noteFoot = ((isNote || !bound) && !liveFlow) ? h('div', { className: 'kbdb-wf' }, h('span', { className: 'sp' }, Ic('pencil', 12), ' ', isNote ? kt('Écrit ici, enregistré dans ce dashboard', 'Written here, saved in this dashboard') : (wd.type === 'flow' ? kt('Dessiné ici, enregistré dans ce dashboard', 'Drawn here, saved in this dashboard') : kt('Cartes à vous, enregistrées dans ce dashboard', 'Cards are yours, saved in this dashboard')))) : null
  const foot = noteFoot !== null ? noteFoot : h('div', { className: 'kbdb-wf' },
    h('span', { className: 'kbdb-dot' + (status.state === 'error' ? ' err' : (status.partial || status.state === 'refreshing' ? ' warn' : '')) }),
    h('span', { className: 'sp', title: status.table && status.table.meta.note ? status.table.meta.note : '' }, footLabel + ' · ' + (status.state === 'error' ? kt('illisible', 'unreadable') : (status.at ? kt('lu ', 'read ') + ago(status.at) : kt('lecture…', 'reading…'))) + (status.table && status.table.meta.note ? ' · ⓘ' : '')))
  const edit_ = h('div', { className: 'kbdb-we' },
    h('button', { type: 'button', className: 'kbdb-ib', 'aria-label': kt('Glisser pour déplacer', 'Drag to move'), title: kt('Glisser pour déplacer', 'Drag to move'), onMouseDown: () => { if (root.current) root.current.setAttribute('draggable', 'true') } }, Ic('grip', 14)),
    h('button', { type: 'button', className: 'kbdb-ib', 'aria-label': kt('Plus étroit', 'Narrower'), onClick: () => onWiden(-1) }, Ic('minus', 14)),
    h('button', { type: 'button', className: 'kbdb-ib', 'aria-label': kt('Plus large', 'Wider'), onClick: () => onWiden(1) }, Ic('plus', 14)),
    h('button', { type: 'button', className: 'kbdb-ib', 'aria-label': kt('Retirer', 'Remove'), onClick: onRemove }, Ic('x', 14)))
  return h('article', {
    ref: root, className: 'kbdb-w' + (isNote ? ' note' : '') + (flash ? ' flash' : '') + (dragging ? ' dragging' : '') + (over ? ' over' : ''), 'data-id': wd.id, 'data-type': wd.type, 'data-w': wd.w, 'data-tint': wd.tint || undefined,
    style: { '--w': wd.w, '--h': wd.h, '--wi': Math.min(index, 14) },
    onDragStart: (e) => { setDragging(true); try { e.dataTransfer.setData('text/plain', wd.id); e.dataTransfer.effectAllowed = 'move' } catch (x) { /* no dataTransfer */ } },
    onDragEnd: () => { setDragging(false); if (root.current) root.current.removeAttribute('draggable') },
    onDragOver: (e) => { if (edit) { e.preventDefault(); if (!over) setOver(true) } },
    onDragLeave: () => setOver(false),
    onDrop: (e) => { setOver(false); if (!edit) return; e.preventDefault(); let from = ''; try { from = e.dataTransfer.getData('text/plain') } catch (x) { from = '' } if (from !== '' && from !== wd.id) onMove(from, wd.id) },
  }, edit_, head, h('div', { className: 'kbdb-wb' }, body), foot)
}

/* ── the grid: widgets, edit mode, the tooltip ── */
function DashboardView ({ dash, tick, edit, flashIds, onChange, onAsk, onRetry }) {
  const [tip, setTip] = useState(null)
  const widgets = dash.widgets
  const setW = (id, patch) => onChange(Object.assign({}, dash, { widgets: widgets.map((w) => (w.id === id ? Object.assign({}, w, patch) : w)) }), 'Edited a widget')
  const remove = (id) => onChange(Object.assign({}, dash, { widgets: widgets.filter((w) => w.id !== id) }), 'Removed a widget')
  const widen = (id, dir) => {
    const w = widgets.find((x) => x.id === id)
    if (w === undefined) return
    let k = WIDTHS.indexOf(w.w); if (k < 0) k = 3
    k = Math.max(0, Math.min(WIDTHS.length - 1, k + dir))
    setW(id, { w: WIDTHS[k] })
  }
  const move = (from, to) => {
    const a = widgets.findIndex((w) => w.id === from); const b = widgets.findIndex((w) => w.id === to)
    if (a < 0 || b < 0) return
    const next = widgets.slice(); const [it] = next.splice(a, 1); next.splice(b, 0, it)
    onChange(Object.assign({}, dash, { widgets: next }), 'Moved a widget')
  }
  const onMouseMove = (e) => {
    const t = e.target && e.target.closest ? e.target.closest('[data-tip]') : null
    if (t === null) { if (tip !== null) setTip(null); return }
    setTip({ x: e.clientX, y: e.clientY, html: t.getAttribute('data-tip') })
  }
  const place = tip === null ? null : { left: Math.min(tip.x + 14, window.innerWidth - 250), top: Math.min(tip.y + 14, window.innerHeight - 90) }
  return h('div', { className: 'kbdb-viewwrap', onMouseMove, onMouseLeave: () => setTip(null) },
    h('div', { className: 'kbdb-grid' + (edit ? ' kbdb-edit' : ''), 'data-kb': 'dashboards-grid' },
      widgets.map((w, i) => h(Widget, {
        key: w.id + ':' + tick, wd: w, index: i, tick, edit, flash: flashIds && flashIds.has(w.id), onRetry,
        onPatch: (patch) => setW(w.id, patch), onRemove: () => remove(w.id), onMove: move, onWiden: (d) => widen(w.id, d),
      })),
      edit && onAsk ? h('button', { type: 'button', className: 'kbdb-addtile', onClick: () => onAsk('add') }, Ic('spark', 20), h('span', null, kt('Demander à l’IA d’ajouter un widget', 'Ask the AI to add a widget'))) : null),
    tip !== null ? h('div', { className: 'kbdb-tip', style: place, dangerouslySetInnerHTML: { __html: tip.html } }) : null)
}

// ════════════════════════════════════════════════════════════════════════════
// page
// ════════════════════════════════════════════════════════════════════════════
// src/page.js: the Dashboards page, the right-pane tab and the player of the MiniApp door (assembled by scripts/build.mjs).
// In scope: React, `model`, `chart`, the painters, data.js helpers and widgets.js components.

let WANT_OPEN_ID = null // set by the pane ("Open full page") for the page to pick up

/** The last dashboard looked at, per browser (a convenience: the host stays the truth). */
const lastOpened = {
  get () { try { return window.localStorage.getItem('kybernos.dashboards.last') } catch (e) { return null } },
  set (id) { try { window.localStorage.setItem('kybernos.dashboards.last', id) } catch (e) { /* private mode */ } },
}

/** Close a popover when the click is outside its wrapper. */
function useOutside (open, onClose) {
  useEffect(() => {
    if (!open) return undefined
    const down = (e) => { if (!(e.target.closest && e.target.closest('.kbdb-rel, .kbdb-fpop'))) onClose() }
    const key = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', down, true)
    document.addEventListener('keydown', key, true)
    return () => { document.removeEventListener('mousedown', down, true); document.removeEventListener('keydown', key, true) }
  }, [open])
}

/** The widget ids that are new or changed from one revision to the next: what flashes when the agent writes. */
function changedIds (before, after) {
  const old = new Map(before.map((w) => [w.id, JSON.stringify(w)]))
  return new Set(after.filter((w) => old.get(w.id) !== JSON.stringify(w)).map((w) => w.id))
}

/** A tiny coloured sketch of one widget for the gallery cards: its kind of chart, a sparkline on a card, the colours the real one uses. */
function miniGlyph (s) {
  const bar = (i, v, c) => '<rect class="kbdb-s' + c + '" x="' + (4 + i * 7) + '" y="' + (27 - v) + '" width="5" height="' + v + '" rx="1"/>'
  switch (s.type) {
    case 'card':
      return '<rect class="mi-ink" x="5" y="6" width="17" height="7" rx="2"/><rect class="mi-dim" x="5" y="17" width="27" height="3" rx="1.5"/>'
        + (s.spark ? '<polyline class="kbdb-k1" points="29,26 33,21 37,23 42,12" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>' : '<rect class="kbdb-s2" x="5" y="23" width="10" height="3" rx="1.5"/>')
    case 'chart': {
      const k = s.kind
      if (k === 'stacked') return [10, 16, 12, 19, 14, 21].map((v, i) => bar(i, v, 1) + bar(i, Math.round(v * 0.45), 2)).join('')
      if (k === 'bars') return [[34, 1], [26, 2], [20, 3], [12, 4]].map((r, i) => '<rect class="kbdb-s' + r[1] + '" x="4" y="' + (4 + i * 6) + '" width="' + r[0] + '" height="4" rx="2"/>').join('')
      if (k === 'line') return '<polyline class="kbdb-k1" points="3,22 11,15 18,18 27,8 36,12 45,5" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/><polyline class="kbdb-k2" points="3,25 14,21 24,23 34,18 45,19" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" opacity=".8"/>'
      if (k === 'area') return '<path class="kbdb-s1" fill-opacity=".25" d="M3 27 L3 21 L11 15 L18 18 L27 8 L36 12 L45 6 L45 27 Z"/><polyline class="kbdb-k1" points="3,21 11,15 18,18 27,8 36,12 45,6" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>'
      if (k === 'donut') return '<g transform="rotate(-90 24 15)"><circle cx="24" cy="15" r="9" fill="none" stroke-width="5" class="kbdb-k1" stroke-dasharray="30 57"/><circle cx="24" cy="15" r="9" fill="none" stroke-width="5" class="kbdb-k2" stroke-dasharray="15 57" stroke-dashoffset="-30"/><circle cx="24" cy="15" r="9" fill="none" stroke-width="5" class="kbdb-k3" stroke-dasharray="9 57" stroke-dashoffset="-45"/></g>'
      if (k === 'heatmap') {
        const lv = [0, 1, 0, 2, 0, 3, 1, 0, 2, 4, 1, 0, 3, 2, 0, 1, 4, 3, 0, 2, 1, 0, 3, 4]
        return lv.map((l, i) => '<rect class="kbdb-hm' + l + '" x="' + (3 + Math.floor(i / 4) * 7.4) + '" y="' + (3 + (i % 4) * 6.2) + '" width="5.6" height="5" rx="1.2"/>').join('')
      }
      return [8, 14, 10, 18, 12, 21, 15].map((v, i) => bar(i, v, 1)).join('')
    }
    case 'table':
      return '<rect class="mi-dim" x="4" y="4" width="40" height="2.5" rx="1"/>' + [0, 1, 2].map((i) => '<rect class="kbdb-s' + (i + 1) + '" x="4" y="' + (10 + i * 6) + '" width="4" height="4" rx="1"/><rect class="mi-ink" x="11" y="' + (10.5 + i * 6) + '" width="' + (14 - i * 2) + '" height="3" rx="1.5"/><rect class="kbdb-s1" fill-opacity=".45" x="29" y="' + (10.5 + i * 6) + '" width="' + (15 - i * 4) + '" height="3" rx="1.5"/>').join('')
    case 'calendar':
      return [0, 1, 2, 3, 4, 5, 6].map((i) => '<rect class="mi-line" x="' + (3 + i * 6.2) + '" y="3" width="5.2" height="24" rx="1.4" style="fill:var(--kbdb-l2)"/>').join('')
        + '<rect class="kbdb-tone-ok" x="4" y="7" width="3.2" height="3.2" rx="1"/><rect class="kbdb-tone-ok" x="16.4" y="11" width="3.2" height="3.2" rx="1"/><rect class="kbdb-tone-err" x="22.6" y="7" width="3.2" height="3.2" rx="1"/><rect class="kbdb-tone-ok" x="28.8" y="15" width="3.2" height="3.2" rx="1"/><rect class="kbdb-tone-idle" x="35" y="9" width="3.2" height="3.2" rx="1"/>'
    case 'list':
      return [0, 1, 2, 3].map((i) => '<circle class="' + (i === 2 ? 'kbdb-tone-err' : 'kbdb-tone-ok') + '" cx="6" cy="' + (6 + i * 6.2) + '" r="1.7"/><rect class="mi-ink" x="11" y="' + (4.7 + i * 6.2) + '" width="' + (22 - (i % 2) * 6) + '" height="2.6" rx="1.3"/><rect class="mi-dim" x="37" y="' + (4.9 + i * 6.2) + '" width="7" height="2.2" rx="1.1"/>').join('')
    case 'kanban':
      return [0, 1, 2].map((c) => '<rect x="' + (3 + c * 15) + '" y="3" width="13.5" height="24" rx="2" style="fill:var(--kbdb-l2)"/>' + [0, 1, 2].slice(0, 3 - c).map((r) => '<rect class="kbdb-s' + (c + 1) + '" fill-opacity=".85" x="' + (4.5 + c * 15) + '" y="' + (5.5 + r * 7) + '" width="10.5" height="5" rx="1.4"/>').join('')).join('')
    case 'carousel':
      return [0, 1, 2, 3].map((i) => '<rect x="' + (2 + i * 12) + '" y="5" width="10.5" height="20" rx="2" style="fill:var(--kbdb-l2)"/><rect class="kbdb-s' + ((i % 5) + 1) + '" fill-opacity=".8" x="' + (3 + i * 12) + '" y="6" width="8.5" height="9" rx="1.4"/><rect class="mi-ink" x="' + (3.5 + i * 12) + '" y="18" width="7.5" height="2" rx="1"/>').join('')
    case 'note':
      return '<rect class="mi-ink" x="5" y="6" width="26" height="2.6" rx="1.3"/><rect class="mi-dim" x="5" y="12" width="36" height="2.2" rx="1.1"/><rect class="mi-dim" x="5" y="17" width="31" height="2.2" rx="1.1"/><rect class="mi-dim" x="5" y="22" width="20" height="2.2" rx="1.1"/>'
    case 'flow':
      return '<path class="mi-line" d="M15 10 H21 M33 10 H36 M15 10 C19 10 19 21 23 21 M31 21 H36" style="stroke:var(--kbdb-t4)"/>'
        + '<rect class="kbdb-s1" x="3" y="6" width="12" height="8" rx="2.4"/><rect class="kbdb-s2" x="21" y="6" width="12" height="8" rx="2.4"/><rect class="kbdb-tone-ok" x="36" y="6" width="9" height="8" rx="2.4"/><rect class="kbdb-tone-err" x="23" y="17" width="9" height="8" rx="2.4"/>'
    case 'sankey':
      return '<path class="kbdb-s1" fill-opacity=".45" d="M7 4 C22 4 26 6 41 6 L41 14 C26 14 22 13 7 13 Z"/><path class="kbdb-s2" fill-opacity=".45" d="M7 15 C22 15 26 17 41 17 L41 22 C26 22 22 23 7 23 Z"/>'
        + '<rect class="kbdb-s1" x="4" y="4" width="3" height="9" rx="1"/><rect class="kbdb-s2" x="4" y="15" width="3" height="8" rx="1"/><rect class="kbdb-s1" x="41" y="6" width="3" height="8" rx="1"/><rect class="kbdb-s2" x="41" y="17" width="3" height="5" rx="1"/>'
    default:
      return '<rect class="mi-dim" x="4" y="4" width="40" height="22" rx="3"/>'
  }
}
function Mini ({ shape }) {
  const ref = useRef(null)
  const [rh, setRh] = useState(7)
  const key = JSON.stringify(shape || [])
  // the whole dashboard has to fit the box: once the browser has placed the widgets, the row height is what makes the rows fill it
  useLayoutEffect(() => {
    const el = ref.current
    if (el === null || typeof getComputedStyle !== 'function') return
    const rows = getComputedStyle(el).gridTemplateRows.split(' ').filter((x) => x !== '').length
    if (rows === 0) return
    const free = el.clientHeight - 16 - (rows - 1) * 3
    setRh(Math.max(2, Math.min(9, Math.floor((free / rows) * 10) / 10)))
  }, [key])
  return h('span', { className: 'kbdb-gmini', ref, 'aria-hidden': 'true', style: { '--rh': rh + 'px' } }, (shape || []).map((s, i) => h('i', {
    key: i, 'data-type': s.type, 'data-kind': s.kind || undefined, style: { '--w': s.w, '--h': Math.max(1, s.h) },
    dangerouslySetInnerHTML: { __html: '<svg viewBox="0 0 48 30" preserveAspectRatio="' + (s.kind === 'donut' || s.type === 'flow' ? 'xMidYMid meet' : 'none') + '">' + miniGlyph(s) + '</svg>' },
  })))
}

function DashboardsPage () {
  const rootRef = useRef(null)
  const [list, setList] = useState(null)
  const [presets, setPresets] = useState([])
  const [failed, setFailed] = useState(false)
  const [screen, setScreen] = useState('boot')
  const [dash, setDash] = useState(null) // { id, dashboard, rev, history, isDefault }
  const [edit, setEdit] = useState(false)
  const [tick, setTick] = useState(0)
  const [busy, setBusy] = useState(false)
  const [showHidden, setShowHidden] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [pop, setPop] = useState('')
  const [menu, setMenu] = useState(null)
  const [toast, setToast] = useState('')
  const [conflict, setConflict] = useState(false)
  const [flash, setFlash] = useState(null)
  const [revs, setRevs] = useState([])
  const dashRef = useRef(null)
  const pending = useRef(null)
  const saveTimer = useRef(0)
  dashRef.current = dash
  useInView(rootRef)
  useOutside(pop !== '' || menu !== null, () => { setPop(''); setMenu(null) })

  const say = (t) => { setToast(t); setTimeout(() => setToast((x) => (x === t ? '' : x)), 2600) }

  const refreshList = useCallback(async () => {
    const [l, p] = await Promise.all([api('GET', 'list'), api('GET', 'presets')])
    if (!l.ok) { setFailed(true); return null }
    setFailed(false)
    setList({ dashboards: l.json.dashboards || [], default: l.json.default || null })
    if (p.ok) setPresets(p.json.presets || [])
    return l.json
  }, [])

  const load = useCallback(async (id, opts) => {
    const r = await api('GET', 'dashboard?id=' + encodeURIComponent(id))
    if (!r.ok) { say(kt('Ce dashboard est introuvable.', 'This dashboard cannot be found.')); return false }
    const prev = dashRef.current
    const next = { id, dashboard: r.json.dashboard, rev: r.json.rev, history: r.json.history || [], isDefault: r.json.isDefault === true }
    if (opts && opts.flash && prev !== null && prev.id === id) setFlash(changedIds(prev.dashboard.widgets, next.dashboard.widgets))
    else setFlash(null)
    setDash(next)
    return true
  }, [])

  const open = useCallback(async (id) => {
    if (await load(id)) { setScreen('dash'); setEdit(false); setConflict(false); setPop(''); lastOpened.set(id); api('POST', 'open', { id }) }
  }, [load])

  // first load: the default dashboard, else the one looked at last, else the gallery
  useEffect(() => {
    let dead = false
    ;(async () => {
      const l = await refreshList()
      if (dead || l === null) { if (!dead) setScreen('gallery'); return }
      const live = (l.dashboards || []).filter((d) => !d.archived)
      const want = WANT_OPEN_ID; WANT_OPEN_ID = null
      // the one asked for, the default, the one looked at last, else the only one there is; with several and no choice, the gallery
      const pick = (want !== null && live.find((d) => d.id === want)) || live.find((d) => d.id === l.default) || live.find((d) => d.id === lastOpened.get()) || (live.length === 1 ? live[0] : null)
      if (pick) await open(pick.id); else setScreen('gallery')
    })()
    const onWant = () => { const id = WANT_OPEN_ID; WANT_OPEN_ID = null; if (id) { refreshList().then(() => open(id)) } }
    window.addEventListener('kb-dashboards-open', onWant)
    return () => { dead = true; window.removeEventListener('kb-dashboards-open', onWant) }
  }, [])

  // the agent writes through the tool: pick the change up (a new revision) without losing the person's pending edit
  useEffect(() => {
    const t = setInterval(async () => {
      const s = await api('GET', 'state')
      if (!s.ok || !s.json.current) return
      const cur = dashRef.current
      if (cur !== null && s.json.current.id === cur.id && pending.current === null) {
        const r = await api('GET', 'dashboard?id=' + encodeURIComponent(cur.id))
        if (r.ok && r.json.rev > cur.rev && pending.current === null) {
          setFlash(changedIds(cur.dashboard.widgets, r.json.dashboard.widgets))
          setDash({ id: cur.id, dashboard: r.json.dashboard, rev: r.json.rev, history: r.json.history || [], isDefault: r.json.isDefault === true })
          setTick((x) => x + 1)
          refreshList()
        }
      }
    }, 1500)
    return () => clearInterval(t)
  }, [])

  // ── saving: the person's edits go to the host, debounced, with the revision they started from ──
  const flush = useCallback(async () => {
    const job = pending.current
    if (job === null) return
    pending.current = null
    const r = await api('POST', 'save', { id: job.id, dashboard: job.dashboard, what: job.what, expectRev: job.rev })
    if (r.ok) { setDash((d) => (d !== null && d.id === job.id ? Object.assign({}, d, { rev: r.json.rev }) : d)); setConflict(false) }
    else if (r.status === 409) setConflict(true)
    else say(kt('L’enregistrement a échoué.', 'Saving failed.'))
  }, [])
  const change = (next, what) => {
    const cur = dashRef.current
    if (cur === null) return
    setDash(Object.assign({}, cur, { dashboard: next }))
    pending.current = { id: cur.id, dashboard: next, what, rev: cur.rev }
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(flush, 600)
  }
  useEffect(() => () => { clearTimeout(saveTimer.current); flush() }, [])

  const refresh = async () => {
    setBusy(true)
    await flush()
    clearRoutes()
    setTick((x) => x + 1)
    await refreshList()
    setTimeout(() => setBusy(false), 500)
  }
  const toGallery = async () => { await flush(); setScreen('gallery'); setPop(''); refreshList() }
  const act = async (path, body, okText) => {
    const r = await api('POST', path, body)
    if (!r.ok) { say(r.json.message || kt('Action impossible.', 'Could not do that.')); return null }
    await refreshList()
    if (okText) say(okText)
    return r.json
  }
  const usePreset = async (p) => {
    const r = await act('preset', { preset: p.id }, null)
    if (r !== null) { say(kt('Créé depuis le preset « ', 'Created from the preset “') + p.name + kt(' ».', '”.')); await open(r.id) }
  }

  const items = list === null ? [] : list.dashboards
  const mine = items.filter((d) => !d.archived && (!d.hidden || showHidden))
  const archived = items.filter((d) => d.archived)
  const hiddenCount = items.filter((d) => d.hidden && !d.archived).length
  const D = dash !== null ? dash.dashboard : null

  // ── header ──
  const askCreate = () => { if (!askAI(createMessage())) say(kt('Impossible d’ouvrir le chat.', 'Could not open the chat.')) }
  const askImprove = () => { if (D && !askAI(improveMessage(D.name, dash.id))) say(kt('Impossible d’ouvrir le chat.', 'Could not open the chat.')) }
  const askAdd = () => { if (D) askAI(addMessage(D.name, dash.id)) }
  const sources = D ? model.sourcesOf(D) : []

  const header = screen === 'dash' && D !== null
    ? h('header', { className: 'kbdb-ph' },
      h('div', { className: 'kbdb-ph-l' },
        h('div', { className: 'kbdb-crumb' }, h('button', { type: 'button', onClick: toGallery }, kt('Dashboards', 'Dashboards')), h('span', null, '/'), h('span', null, D.name), dash.isDefault ? h('span', { className: 'kbdb-pill def' }, kt('Par défaut', 'Default')) : null),
        h('h1', { className: 'kbdb-title' }, h('span', { className: 'kbdb-rel' },
          h('button', { type: 'button', 'aria-haspopup': 'listbox', 'aria-expanded': pop === 'switch', onClick: () => setPop(pop === 'switch' ? '' : 'switch') }, D.name, Ic('chev', 16)),
          pop === 'switch' ? h('div', { className: 'kbdb-pop', role: 'listbox' },
            h('span', { className: 'hd' }, kt('Vos dashboards', 'Your dashboards')),
            items.filter((d) => !d.archived && !d.hidden).map((d) => h('button', { key: d.id, type: 'button', className: 'o', role: 'option', 'aria-current': d.id === dash.id, onClick: async () => { await flush(); open(d.id) } }, d.name, h('span', { className: 'sub' }, d.widgets + ' ' + kt('widgets', 'widgets')))),
            h('button', { type: 'button', className: 'o', onClick: toGallery }, kt('Tout voir et presets', 'See all and presets'))) : null)),
        D.desc !== '' ? h('p', { className: 'kbdb-sub' }, D.desc) : null),
      h('div', { className: 'kbdb-ph-r' },
        h('span', { className: 'kbdb-built' }, h('span', { className: 'kbdb-dot live' }), kt('Rév. ', 'Rev. ') + dash.rev),
        h('span', { className: 'kbdb-rel' },
          h('button', { type: 'button', className: 'kbdb-btn', 'aria-haspopup': 'dialog', 'aria-expanded': pop === 'sources', onClick: () => setPop(pop === 'sources' ? '' : 'sources') }, Ic('db', 14), kt('Sources', 'Sources'), h('span', { style: { color: 'var(--kbdb-t3)' } }, sources.length)),
          pop === 'sources' ? h('div', { className: 'kbdb-pop r' },
            h('span', { className: 'hd' }, kt('Sources lues par ce dashboard', 'Sources this dashboard reads')),
            sources.length === 0 ? h('span', { className: 'foot' }, kt('Aucune : ce dashboard ne contient que vos notes.', 'None: this dashboard only holds your notes.')) : sources.map((s) => h('div', { key: s.provider, className: 'src' }, h('span', { className: 'kbdb-dot', style: { marginTop: 6 } }), h('span', { className: 'tx' }, h('b', { style: { fontWeight: 500 } }, s.label), h('i', null, s.provider + ' · ' + s.widgets.length + ' widget' + (s.widgets.length > 1 ? 's' : ''))))),
            h('span', { className: 'foot' }, kt('Les sources sont lues sur cet ordinateur. Un fichier dashboard ne peut lire que ces sources.', 'Sources are read on this computer. A dashboard file can only read these sources.'))) : null),
        h('button', { type: 'button', className: 'kbdb-btn' + (busy ? ' busy' : ''), 'data-act': 'refresh', onClick: refresh }, h('span', { className: 'kbdb-spin' }, Ic('refresh', 14)), kt('Actualiser', 'Refresh')),
        h('span', { className: 'kbdb-rel' },
          h('button', { type: 'button', className: 'kbdb-btn', 'aria-haspopup': 'dialog', 'aria-expanded': pop === 'history', onClick: async () => { if (pop === 'history') { setPop(''); return } await flush(); const r = await api('GET', 'revisions?id=' + encodeURIComponent(dash.id)); setRevs(r.ok ? r.json.revisions : []); setPop('history') } }, Ic('clock', 14), kt('Historique', 'History')),
          pop === 'history' ? h('div', { className: 'kbdb-pop r' },
            h('span', { className: 'hd' }, kt('Révisions', 'Revisions')),
            revs.length === 0 ? h('span', { className: 'foot' }, kt('Aucune révision.', 'No revisions.')) : revs.map((rv) => h('button', { key: rv.r, type: 'button', className: 'o', disabled: rv.r === dash.rev, onClick: async () => { setPop(''); const r = await api('POST', 'restore', { id: dash.id, rev: rv.r }); if (r.ok) { await load(dash.id); setTick((x) => x + 1); say(kt('Révision ', 'Revision ') + rv.r + kt(' restaurée.', ' restored.')) } } },
              'r' + rv.r + ' · ' + (rv.by === 'agent' ? kt('IA', 'AI') : (rv.by === 'preset' ? 'preset' : kt('vous', 'you'))), h('span', { className: 'sub' }, rv.what || '')))) : null),
        h('button', { type: 'button', className: 'kbdb-btn', 'aria-pressed': edit, 'data-act': 'edit', onClick: () => setEdit((v) => !v) }, Ic('pencil', 14), edit ? kt('Terminé', 'Done') : kt('Modifier la mise en page', 'Edit layout')),
        h('button', { type: 'button', className: 'kbdb-btn primary', 'data-act': 'improve', onClick: askImprove }, Ic('spark', 14), kt('Améliorer avec l’IA', 'Improve with AI'))))
    : h('header', { className: 'kbdb-ph' },
      h('div', { className: 'kbdb-ph-l' }, h('h1', { className: 'kbdb-title' }, kt('Dashboards', 'Dashboards')),
        h('p', { className: 'kbdb-sub' }, kt('Vos dashboards sont des fichiers. Partez d’un preset, ou demandez à l’IA d’en construire un.', 'Your dashboards are files. Start from a preset, or ask the AI to build one.'))),
      h('div', { className: 'kbdb-ph-r' },
        hiddenCount > 0 ? h('button', { type: 'button', className: 'kbdb-btn', 'aria-pressed': showHidden, onClick: () => setShowHidden((v) => !v) }, Ic('eyeoff', 14), kt('Masqués', 'Hidden'), h('span', { style: { color: 'var(--kbdb-t3)' } }, hiddenCount)) : null,
        h('button', { type: 'button', className: 'kbdb-btn primary', 'data-act': 'create', onClick: askCreate }, Ic('spark', 14), kt('Créer un dashboard avec l’IA', 'Create a dashboard with AI'))))

  // ── gallery ──
  const card = (d, i) => h('article', { key: d.id, className: 'kbdb-gcard link' + (d.hidden ? ' dim' : ''), style: { '--i': Math.min(i, 8) }, tabIndex: 0, 'data-kb': 'dashboards-card', 'data-id': d.id,
    onClick: (e) => { if (e.target.closest('[data-more]')) return; open(d.id) }, onKeyDown: (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); open(d.id) } } },
    h(Mini, { shape: d.shape }),
    h('div', { className: 'gh' }, h('h3', null, d.name), d.isDefault ? h('span', { className: 'kbdb-pill def' }, kt('Par défaut', 'Default')) : null,
      h('button', { type: 'button', className: 'kbdb-ib', 'data-more': '1', 'aria-label': kt('Actions', 'Actions'), 'aria-haspopup': 'menu', onClick: (e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setMenu(menu !== null && menu.id === d.id ? null : { id: d.id, x: Math.max(8, Math.min(window.innerWidth - 228, r.right - 220)), y: r.bottom + 6 }) } }, Ic('more', 16))),
    d.desc !== '' ? h('p', null, d.desc) : null,
    h('span', { className: 'kbdb-gmeta' }, h('span', { className: 'kbdb-pill' }, d.widgets + ' widgets'), h('span', { className: 'kbdb-pill' }, d.sources.length + ' ' + kt('sources', 'sources')), h('span', { className: 'kbdb-pill' }, d.by === 'agent' ? kt('par l’IA', 'by AI') : (d.by === 'preset' ? kt('depuis un preset', 'from a preset') : kt('par vous', 'by you'))), d.hidden ? h('span', { className: 'kbdb-pill' }, kt('masqué', 'hidden')) : null))
  const presetCard = (p, i) => h('article', { key: p.id, className: 'kbdb-gcard', style: { '--i': Math.min(i, 8) }, 'data-kb': 'dashboards-preset', 'data-id': p.id },
    h(Mini, { shape: p.shape }), h('div', { className: 'gh' }, h('h3', null, p.name)), h('p', null, p.desc),
    h('span', { className: 'kbdb-gmeta' }, h('span', { className: 'kbdb-pill' }, p.widgets + ' widgets'), h('span', { className: 'kbdb-pill' }, p.sources.length + ' ' + kt('sources', 'sources'))),
    h('div', { className: 'acts' }, h('button', { type: 'button', className: 'kbdb-btn sm', 'data-act': 'use-preset', onClick: () => usePreset(p) }, kt('Utiliser ce preset', 'Use this preset'))))

  let body
  if (screen === 'boot' || (failed === false && list === null)) body = h('div', { className: 'kbdb-gal' }, [0, 1, 2].map((i) => h('div', { key: i, className: 'kbdb-gcard' }, bone('100%', 96), bone('50%', 16), bone('80%', 12))))
  else if (failed) body = h('div', { className: 'kbdb-banner' }, h('span', { className: 'kbdb-dot warn' }), h('span', { className: 'sp' }, kt('Le serveur local ne répond pas aux dashboards. Réessayez dans un instant.', 'The local server is not answering for dashboards. Try again in a moment.')), h('button', { type: 'button', className: 'kbdb-btn sm', onClick: () => { setScreen('boot'); refreshList().then(() => setScreen('gallery')) } }, kt('Réessayer', 'Try again')))
  else if (screen === 'gallery') {
    body = h(React.Fragment, null,
      h('div', { className: 'kbdb-sec-h' }, h('h2', null, kt('Mes dashboards', 'My dashboards')), h('span', null, mine.length)),
      mine.length === 0
        ? h('div', { className: 'kbdb-gempty' }, h('b', null, kt('Aucun dashboard pour l’instant', 'No dashboard yet')), h('span', null, kt('Demandez à l’IA ce que vous voulez suivre, ou partez d’un preset ci-dessous.', 'Ask the AI what you want to follow, or start from a preset below.')), h('button', { type: 'button', className: 'kbdb-btn primary', onClick: askCreate }, Ic('spark', 14), kt('Créer un dashboard avec l’IA', 'Create a dashboard with AI')))
        : h('div', { className: 'kbdb-gal' }, mine.map(card)),
      h('div', { className: 'kbdb-sec-h' }, h('h2', null, 'Presets'), h('span', null, kt('Des modèles : en utiliser un vous donne votre propre copie.', 'Templates: using one gives you your own copy.'))),
      h('div', { className: 'kbdb-gal' }, presets.map(presetCard)),
      archived.length > 0 ? h(React.Fragment, null,
        h('div', { className: 'kbdb-sec-h' }, h('h2', null, kt('Archivés', 'Archived')), h('span', null, archived.length), h('span', { className: 'sp' }), h('button', { type: 'button', className: 'kbdb-chip', 'aria-pressed': showArchived, onClick: () => setShowArchived((v) => !v) }, showArchived ? kt('Masquer', 'Hide') : kt('Afficher', 'Show'))),
        showArchived ? h('div', { className: 'kbdb-gal' }, archived.map((d, i) => h('article', { key: d.id, className: 'kbdb-gcard dim', style: { '--i': Math.min(i, 8) } }, h(Mini, { shape: d.shape }), h('div', { className: 'gh' }, h('h3', null, d.name)), d.desc !== '' ? h('p', null, d.desc) : null, h('div', { className: 'acts' }, h('button', { type: 'button', className: 'kbdb-btn sm', onClick: () => act('flags', { id: d.id, archived: false }, kt('Restauré.', 'Restored.')) }, kt('Restaurer', 'Restore')))))) : null) : null)
  } else if (D !== null) {
    body = h(React.Fragment, null,
      conflict ? h('div', { className: 'kbdb-banner' }, h('span', { className: 'kbdb-dot warn' }), h('span', { className: 'sp' }, kt('Ce dashboard a changé ailleurs (l’IA, un autre onglet). Vos dernières retouches ne sont pas enregistrées.', 'This dashboard changed elsewhere (the AI, another tab). Your last edits were not saved.')), h('button', { type: 'button', className: 'kbdb-btn sm', onClick: async () => { await load(dash.id); setTick((x) => x + 1) } }, kt('Recharger', 'Reload'))) : null,
      D.widgets.length === 0 ? h('div', { className: 'kbdb-gempty' }, h('b', null, kt('Ce dashboard est vide', 'This dashboard is empty')), h('span', null, kt('Dites à l’IA ce que vous voulez y voir.', 'Tell the AI what you want to see here.')), h('button', { type: 'button', className: 'kbdb-btn primary', onClick: askImprove }, Ic('spark', 14), kt('Améliorer avec l’IA', 'Improve with AI')))
        : h(DashboardView, { dash: D, tick, edit, flashIds: flash, onChange: change, onAsk: (kind) => { if (kind === 'add') askAdd() }, onRetry: refresh }))
  } else body = null

  const menuItem = (key, icon, label, fn) => h('button', { key, type: 'button', className: 'o', onClick: async () => { setMenu(null); await fn() } }, Ic(icon, 14), label)
  const menuFor = menu === null ? null : items.find((d) => d.id === menu.id)
  const fpop = menuFor === null || menuFor === undefined ? null : h('div', { className: 'kbdb-fpop', style: { left: menu.x, top: menu.y }, role: 'menu' },
    menuItem('def', 'star', menuFor.isDefault ? kt('Dashboard par défaut', 'Default dashboard') : kt('Définir par défaut', 'Set as default'), () => act('flags', { id: menuFor.id, default: !menuFor.isDefault }, menuFor.isDefault ? kt('Plus de dashboard par défaut.', 'No default dashboard any more.') : kt('Ouvert en premier depuis le menu.', 'Opens first from the menu.'))),
    menuItem('clone', 'copy', kt('Cloner', 'Clone'), async () => { const r = await act('clone', { id: menuFor.id }, null); if (r !== null) say(kt('Cloné : ', 'Cloned: ') + r.id) }),
    menuItem('arch', 'archive', kt('Archiver', 'Archive'), () => act('flags', { id: menuFor.id, archived: true }, kt('Archivé.', 'Archived.'))),
    menuItem('hide', 'eyeoff', menuFor.hidden ? kt('Afficher à nouveau', 'Show again') : kt('Masquer', 'Hide'), () => act('flags', { id: menuFor.id, hidden: !menuFor.hidden }, menuFor.hidden ? kt('Visible à nouveau.', 'Visible again.') : kt('Masqué. Utilisez « Masqués » pour le retrouver.', 'Hidden. Use “Hidden” to bring it back.'))))

  return h('div', { ref: rootRef, className: 'kbdb kbdb-page' + (edit && screen === 'dash' ? ' kbdb-editing' : ''), 'data-kb': 'dashboards-page', 'data-screen': screen },
    header, body, fpop, toast !== '' ? h('div', { className: 'kbdb-toast', role: 'status' }, toast) : null)
}

/* ── the right-pane tab ── */
function DashboardsPane () {
  const rootRef = useRef(null)
  const [cur, setCur] = useState(null) // { id, name }
  const [dash, setDash] = useState(null)
  const [tick, setTick] = useState(0)
  const [flash, setFlash] = useState(null)
  const dashRef = useRef(null)
  dashRef.current = dash
  const curId = cur ? cur.id : null
  const loadDash = useCallback(async (id, withFlash) => {
    const r = await api('GET', 'dashboard?id=' + encodeURIComponent(id))
    if (!r.ok) { setDash(null); return }
    const prev = dashRef.current
    if (withFlash && prev !== null && prev.id === id) setFlash(changedIds(prev.dashboard.widgets, r.json.dashboard.widgets)); else setFlash(null)
    setDash({ id, dashboard: r.json.dashboard, rev: r.json.rev })
  }, [])
  useEffect(() => {
    let dead = false
    const probe = async () => {
      const s = await api('GET', 'state')
      if (dead || !s.ok || !s.json.current) return
      const c = s.json.current
      setCur((old) => (old !== null && old.id === c.id && old.name === c.name ? old : { id: c.id, name: c.name }))
      const d = dashRef.current
      if (d === null || d.id !== c.id) { loadDash(c.id, false); return }
      const r = await api('GET', 'dashboard?id=' + encodeURIComponent(c.id))
      if (!dead && r.ok && r.json.rev > d.rev) { setFlash(changedIds(d.dashboard.widgets, r.json.dashboard.widgets)); setDash({ id: c.id, dashboard: r.json.dashboard, rev: r.json.rev }); setTick((x) => x + 1) }
    }
    probe()
    const t = setInterval(probe, 1500)
    return () => { dead = true; clearInterval(t) }
  }, [])
  const full = () => { try { window.__KB_DASHBOARDS__.open(curId) } catch (e) { /* the page is not available */ } }
  useInView(rootRef)
  if (dash === null) return h('div', { ref: rootRef, className: 'kbdb kbdb-pane', 'data-kb': 'dashboards-pane' }, h('div', { className: 'kbdb-empty', style: { padding: 24 } }, h('b', null, kt('Pas encore de dashboard', 'No dashboard yet')), kt('Demandez-en un au chat : il apparaîtra ici.', 'Ask the chat for one: it will show up here.')))
  return h('div', { ref: rootRef, className: 'kbdb kbdb-pane', 'data-kb': 'dashboards-pane' },
    h('div', { className: 'kbdb-pane-h' }, h('span', { className: 'kbdb-dot live' }), h('span', { className: 'nm' }, dash.dashboard.name), h('span', { className: 'sp' }),
      h('button', { type: 'button', className: 'kbdb-ib', 'aria-label': kt('Actualiser', 'Refresh'), onClick: () => { clearRoutes(); setTick((x) => x + 1) } }, Ic('refresh', 14)),
      h('button', { type: 'button', className: 'kbdb-ib', 'aria-label': kt('Ouvrir en pleine page', 'Open full page'), title: kt('Ouvrir en pleine page', 'Open full page'), onClick: full }, Ic('ext', 14))),
    h('div', { className: 'kbdb-pane-b' }, h(DashboardView, { dash: dash.dashboard, tick, edit: false, flashIds: flash, onChange: () => {}, onRetry: () => { clearRoutes(); setTick((x) => x + 1) } })))
}

/* ── the player of the MiniApp door (Livrables page, chat card, popup) ── */
function DashboardPlayer (props) {
  const rootRef = useRef(null)
  useInView(rootRef)
  const parsed = useMemo(() => {
    try {
      const doc = JSON.parse(String(props.text || ''))
      const first = Array.isArray(doc.data) ? doc.data[0] : null
      if (first === null || typeof first !== 'object') return null
      return model.validateDashboard(first.payload && typeof first.payload === 'object' ? first.payload : first).dashboard
    } catch (e) { return null }
  }, [props.text])
  if (parsed === null) return h('div', { className: 'kbdb' }, h('div', { className: 'kbdb-empty' }, kt('Dashboard illisible.', 'Unreadable dashboard.')))
  return h('div', { ref: rootRef, className: 'kbdb kbdb-page', 'data-kb': 'dashboards-player', 'data-kb-path': props.path || '' },
    h('h2', { style: { margin: '0 0 8px', fontSize: 16 } }, parsed.name),
    h(DashboardView, { dash: parsed, tick: 0, edit: false, flashIds: null, onChange: () => {} }))
}

// ════════════════════════════════════════════════════════════════════════════
// main
// ════════════════════════════════════════════════════════════════════════════
// src/main.js: registration with DSH (assembled by scripts/build.mjs). The last file of the bundle: it returns the plugin.
const TYPE_ID = 'kybernos-dashboards'
const KIND = 'kybernos-dashboards'
const SLOT_PANE = 'sidebar.right.pane.tab'
const SLOT_PAGE = 'main.kybernos-dashboards'
const STYLE_ID = 'kybernos-dashboards-styles'

let CTX = null
function openTab () {
  try {
    const sb = CTX && CTX.get('sidebarRight')
    if (sb && typeof sb.openTab === 'function') sb.openTab(KIND, {})
  } catch (e) { /* no chat on screen */ }
}
// The tab can only show inside a chat: keep trying for a minute after a dashboard arrives, so it appears as soon as one is on screen.
let WANT_OPEN_UNTIL = 0
const panelShown = () => { const p = document.querySelector('[data-kb="dashboards-pane"]'); return !!p && p.getClientRects().length > 0 }

/** The door of the Livrables page, the chat card and the popup: the "dashboard" player. */
function registerPlayer () {
  try {
    if (window.__KB_MINIAPP__ && typeof window.__KB_MINIAPP__.register === 'function') window.__KB_MINIAPP__.register('dashboard', DashboardPlayer)
    else { window.__KB_MINIAPP_PENDING__ = window.__KB_MINIAPP_PENDING__ || []; window.__KB_MINIAPP_PENDING__.push(['dashboard', DashboardPlayer]) }
  } catch (e) { /* the player is optional */ }
}

function apply (ctx) {
  CTX = ctx
  ctx.effect(() => {
    if (document.getElementById(STYLE_ID)) return undefined
    const el = document.createElement('style')
    el.id = STYLE_ID
    el.setAttribute('data-plugin', '@local/kybernos-dashboards')
    el.textContent = CSS
    document.head.appendChild(el)
    return () => { el.remove() }
  }, 'kybernos-dashboards: styles')

  // the page: the child slot the core's menu row opens
  ctx.effect(() => ctx.slots.inject(SLOT_PAGE, () => ctx.slots.register({ name: SLOT_PAGE }, DashboardsPage)), 'kybernos-dashboards: page')

  // the right-pane tab
  let registre = null
  try { registre = ctx.get('sidebarRightTabs') } catch (e) { registre = null }
  if (registre && typeof registre.register === 'function') {
    ctx.effect(() => registre.register({
      id: TYPE_ID,
      kind: KIND,
      title: () => 'Dashboard',
      guide: [{ title: () => 'Dashboard', description: () => kt('Le dashboard sur lequel le chat travaille, mis à jour en direct.', 'The dashboard the chat is working on, updated live.') }],
    }), 'kybernos-dashboards: sidebar tab type')
  }
  ctx.effect(() => ctx.slots.inject(SLOT_PANE, () => ctx.slots.register({ name: SLOT_PANE, key: TYPE_ID }, DashboardsPane)), 'kybernos-dashboards: pane body')

  // which chat is on screen
  ctx.effect(() => {
    const t = setInterval(() => {
      try {
        const ui = ctx.get('uiSession')
        const key = ui && ui.adapter && ui.adapter.current ? ui.adapter.current.getSnapshot().key : ''
        setSession(key)
      } catch (e) { /* keep the last known key */ }
    }, 4000)
    return () => clearInterval(t)
  }, 'kybernos-dashboards: session key')

  // open the tab when the agent writes a dashboard (strict: only this chat's own dashboard, never a page edit)
  let seen = null
  ctx.effect(() => {
    const probe = async () => {
      const s = await api('GET', 'state?strict=1')
      if (s.ok && s.json.current) {
        const at = s.json.current.at
        if (seen !== at) {
          const first = seen === null
          seen = at
          if (!first || Date.now() - at < 15000) { WANT_OPEN_UNTIL = Date.now() + 60000; openTab() }
        }
      }
      if (WANT_OPEN_UNTIL > Date.now()) { if (panelShown()) WANT_OPEN_UNTIL = 0; else openTab() }
    }
    probe()
    const t = setInterval(probe, 1500)
    return () => clearInterval(t)
  }, 'kybernos-dashboards: open-on-arrival probe')

  registerPlayer()
  try {
    window.__KB_DASHBOARDS__ = {
      /** The key of the chat on screen (what the host files a dashboard under), for diagnostics and the live check. */
      session: () => sessionId(),
      /** Open the Dashboards page on one dashboard. Returns false when the page cannot be reached. */
      open (id) {
        WANT_OPEN_ID = typeof id === 'string' ? id : null
        let ok = false
        try { ok = typeof window.__KB_OPEN__ === 'function' && window.__KB_OPEN__({ view: 'dashboards' }) === true } catch (e) { ok = false }
        try { window.dispatchEvent(new CustomEvent('kb-dashboards-open')) } catch (e) { /* no window */ }
        return ok
      },
    }
  } catch (e) { /* no window */ }
}

return {
  // `sidebarRightTabs` must be declared: ui-sidebar-right provides it, and without this `apply` could run before.
  inject: ['slots', 'sidebarRightTabs'],
  apply,
  __test: { model, chart, fmtLabel, paintColumns, paintBars, paintLine, paintDonut, paintHeatmap, miniGlyph, paintSankey, paintFlow, paintSpark, legendHtml, fmtWhen, ago, changedIds, createMessage, improveMessage, addMessage, CSS },
}
