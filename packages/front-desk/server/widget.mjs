// The script a shop pastes into its own site: one round button in the shop's colour that opens the chat page in an iframe.
//
//   <script src="https://HOST/widget.js" data-shop="my-shop" async></script>       (optional: data-side="left")
//
// It runs on somebody else's page, so it is built to be a bad neighbour's best neighbour: everything lives in one shadow root (the
// host page's CSS cannot reach it and ours cannot leak), nothing is written as markup (no innerHTML, no eval), the styles are a
// constructed stylesheet (a strict host CSP on `style-src` does not block it), the iframe gets no permission, and the chat itself
// stays on our origin, so the host page can never read what a visitor types. The visitor's id lives in that iframe, not here.

const WIDGET_JS = `(function () {
  if (window.__frontDeskWidget) return;
  var script = document.currentScript;
  if (!script || !script.src) return;
  var shop = script.getAttribute('data-shop') || '';
  if (!/^[a-z0-9][a-z0-9-]{2,39}$/.test(shop)) return;
  window.__frontDeskWidget = true;
  var base = new URL(script.src).origin;
  var left = script.getAttribute('data-side') === 'left';

  function start(cfg) {
    var color = /^#[0-9a-fA-F]{6}$/.test(cfg.color) ? cfg.color : '#2F6B54';
    var labels = cfg.labels || {};
    var host = document.createElement('div');
    host.setAttribute('data-front-desk', shop);
    var root = host.attachShadow({ mode: 'open' });
    var css = ':host{all:initial}'
      + '.btn{position:fixed;bottom:20px;' + (left ? 'left' : 'right') + ':20px;width:56px;height:56px;border-radius:50%;border:0;background:' + color + ';color:#fff;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.28);display:grid;place-items:center;font:600 22px/1 system-ui,sans-serif;z-index:2147483000;padding:0}'
      + '.btn:focus-visible{outline:3px solid #fff;outline-offset:-6px;box-shadow:0 0 0 3px ' + color + '}'
      + '.panel{position:fixed;bottom:88px;' + (left ? 'left' : 'right') + ':20px;width:min(380px,calc(100vw - 24px));height:min(600px,calc(100vh - 110px));border:0;border-radius:16px;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,.3);background:#fff;z-index:2147483000;display:none}'
      + '.panel.on{display:block}.panel iframe{width:100%;height:100%;border:0;display:block}'
      + '@media (max-width:480px){.panel{inset:0;width:100%;height:100%;border-radius:0}.btn.open{display:none}}'
      + '.x{display:none;position:absolute;top:8px;right:8px;width:32px;height:32px;border-radius:50%;border:0;background:rgba(0,0,0,.35);color:#fff;font:20px/1 system-ui,sans-serif;cursor:pointer;padding:0;z-index:1}'
      + '@media (max-width:480px){.on .x{display:block}}'
      + '@media (prefers-reduced-motion:no-preference){.panel.on{animation:rise .18s ease-out}@keyframes rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}}';
    try { var sheet = new CSSStyleSheet(); sheet.replaceSync(css); root.adoptedStyleSheets = [sheet]; }
    catch (e) { var st = document.createElement('style'); st.textContent = css; root.appendChild(st); }

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn';
    btn.textContent = '\\u{1F4AC}';
    btn.setAttribute('aria-label', labels.open || 'Chat');
    btn.setAttribute('aria-expanded', 'false');
    var panel = document.createElement('div');
    panel.className = 'panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', cfg.name || 'Chat');
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'x';
    close.textContent = '\\u00D7';
    close.setAttribute('aria-label', labels.close || 'Close');
    panel.appendChild(close);
    var frame = null;

    function setOpen(on) {
      if (on && !frame) {
        frame = document.createElement('iframe');
        frame.src = base + '/c/' + shop + '?embed=1';
        frame.title = cfg.name || 'Chat';
        frame.setAttribute('allow', '');
        frame.setAttribute('referrerpolicy', 'no-referrer');
        panel.appendChild(frame);
      }
      panel.classList.toggle('on', on);
      btn.classList.toggle('open', on);
      btn.setAttribute('aria-expanded', on ? 'true' : 'false');
      if (on && frame) frame.focus(); else btn.focus();
    }
    btn.addEventListener('click', function () { setOpen(!panel.classList.contains('on')); });
    close.addEventListener('click', function () { setOpen(false); });
    root.addEventListener('keydown', function (e) { if (e.key === 'Escape' && panel.classList.contains('on')) setOpen(false); });
    root.appendChild(panel);
    root.appendChild(btn);
    document.body.appendChild(host);
  }

  fetch(base + '/c/' + shop + '/config').then(function (r) { return r.ok ? r.json() : null; }).then(function (c) { if (c) start(c); }).catch(function () {});
})();
`;

export const widgetScript = () => WIDGET_JS;

/** What the owner copies into their site. `base` is the public address of this service, without a trailing slash. */
export const embedSnippet = ({ base, slug }) => `<script src="${String(base).replace(/\/+$/, '')}/widget.js" data-shop="${slug}" async></script>`;
