// The gate's pages: the sign-in form and the "Kybernos is starting" page.
//
// The text is written into the HTML on the server, so the page reads correctly with scripts off;
// the script only adds the interaction (submit, wrong password, lock countdown, success).
// Colours are the DSH values (dsh-client-ui-theme 0.2.0-rc.2) and the Kybernos K, as in the validated mockup.

const STRINGS = {
  fr: {
    title: 'Accès protégé', sub: 'Saisissez vos identifiants pour ouvrir Kybernos.',
    userLabel: 'Identifiant', label: 'Mot de passe', signin: 'Se connecter', signing: 'Connexion…', wait: 'Patientez',
    note: 'Cet appareil restera connecté {days} jours.', foot: 'Une seule connexion : la porte ouvre aussi DSH pour vous.',
    empty: 'Saisissez l’identifiant et le mot de passe.',
    wrongOne: 'Identifiant ou mot de passe incorrect. {n} essai restant.', wrongMany: 'Identifiant ou mot de passe incorrect. {n} essais restants.',
    locked: 'Trop d’essais. Nouvelle tentative possible dans {t}.', failed: 'La connexion a échoué. Réessayez dans un instant.',
    doneTitle: 'Connecté', doneSub: 'Ouverture de Kybernos…', show: 'Afficher le mot de passe', hide: 'Masquer le mot de passe',
    startTitle: 'Kybernos démarre', startSub: 'La page se rouvrira toute seule dans quelques secondes.'
  },
  en: {
    title: 'Protected access', sub: 'Enter your credentials to open Kybernos.',
    userLabel: 'Username', label: 'Password', signin: 'Sign in', signing: 'Signing in…', wait: 'Please wait',
    note: 'This device will stay signed in for {days} days.', foot: 'One sign-in: the gate also signs you in to DSH.',
    empty: 'Enter the username and the password.',
    wrongOne: 'Wrong username or password. {n} attempt left.', wrongMany: 'Wrong username or password. {n} attempts left.',
    locked: 'Too many attempts. You can try again in {t}.', failed: 'Sign-in failed. Try again in a moment.',
    doneTitle: 'Signed in', doneSub: 'Opening Kybernos…', show: 'Show password', hide: 'Hide password',
    startTitle: 'Kybernos is starting', startSub: 'This page will reopen by itself in a few seconds.'
  }
}

/** `fr` or `en` from an Accept-Language header (French when it asks for French first, English otherwise). */
export function pickLanguage (acceptLanguage) {
  const first = String(acceptLanguage ?? '').split(',')[0].trim().toLowerCase()
  return first.startsWith('fr') ? 'fr' : 'en'
}

/** Only a same-site relative path survives; anything else (absolute URL, `//host`, `/\host`) becomes `/`. */
export function safeNext (value) {
  if (typeof value !== 'string' || value.length > 2048) return '/'
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\') || /[\u0000-\u001f\u007f]/u.test(value)) return '/'
  return value
}

const escapeHtml = (text) => String(text).replace(/[&<>"']/gu, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[c])
// JSON inside a <script>: `<`, `>` and `&` are written as unicode escapes so the data can never close the tag.
const jsonForScript = (value) => JSON.stringify(value).replace(/[<>&]/gu, (c) => '\\u00' + c.charCodeAt(0).toString(16).padStart(2, '0'))

const K_PATH = 'M0 0H15V13.5L23 0H34L24 19.5L36 40H24L15.5 28V40H0Z M4 8a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0Z M4 20a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0Z M4 32a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0Z'

const CSS = `
:root{--kb-red:#f03025;--kb-accent:#ff7a1a;--font:-apple-system,BlinkMacSystemFont,"Segoe UI","Helvetica Neue",Arial,sans-serif;
--bg-page:#f9fafb;--bg-card:#fff;--text-1:#0f1115;--text-2:#61666b;--border-2:#0000001a;--primary:#0f1115;--primary-text:#fff;
--danger:#ec1313;--warn:#dd8629;--warn-bg:#fef5e7;--ok:#22c55e;--ok-bg:#e6faed;--track:#ebeef2}
@media (prefers-color-scheme:dark){:root{--bg-page:#151517;--bg-card:#1b1b1c;--text-1:#f9fafb;--text-2:#adb2b8;--border-2:#ffffff1f;
--primary:#f9fafb;--primary-text:#0f1115;--danger:#f25a5a;--warn:#f7ad31;--warn-bg:#27241f;--ok:#4ed17e;--ok-bg:#233c2c;--track:#353638}}
*{box-sizing:border-box}html{color-scheme:light dark}
body{margin:0;min-height:100vh;display:flex;flex-direction:column;background:var(--bg-page);color:var(--text-1);font:15px/1.5 var(--font);-webkit-font-smoothing:antialiased}
main{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px 16px;gap:20px}
.card{width:100%;max-width:400px;background:var(--bg-card);border:1px solid var(--border-2);border-radius:12px;padding:32px 28px 28px}
.wm{display:inline-flex;align-items:baseline;font-size:34px;font-weight:700;letter-spacing:-.03em;line-height:1;margin-bottom:22px}
.wm svg{height:.95em;width:.855em;margin-right:-.11em;transform:translateY(.04em);flex:none}.wm .k{fill:var(--kb-red)}
h1{margin:0 0 6px;font-size:20px;line-height:1.3;font-weight:600}.sub{margin:0 0 22px;color:var(--text-2);font-size:14px}
label.f{display:block;font-size:13px;font-weight:600;margin-bottom:6px}.field{position:relative}.field.u{margin-bottom:16px}
input{width:100%;height:44px;padding:0 44px 0 14px;font:inherit;color:var(--text-1);background:var(--bg-card);border:1px solid var(--border-2);border-radius:10px;outline:none}
input::placeholder{color:var(--text-2);opacity:.7}
input:focus-visible{border-color:var(--kb-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--kb-accent) 30%,transparent)}
.field.bad input{border-color:var(--danger)}input:disabled{opacity:.55;cursor:not-allowed}
.eye{position:absolute;inset:0 0 0 auto;width:44px;display:grid;place-items:center;background:none;border:0;color:var(--text-2);cursor:pointer;border-radius:0 10px 10px 0}
.eye:hover{color:var(--text-1)}.eye:focus-visible{outline:2px solid var(--kb-accent);outline-offset:-2px}.eye:disabled{cursor:not-allowed;opacity:.5}
.msg{display:flex;gap:8px;align-items:flex-start;margin-top:10px;font-size:13px;min-height:20px}.msg.err{color:var(--danger)}.msg svg{flex:none;margin-top:2px}
.box{margin-top:14px;padding:12px 14px;border-radius:10px;font-size:13px;background:var(--warn-bg);border:1px solid color-mix(in srgb,var(--warn) 40%,transparent)}
.box b{color:var(--warn)}.bar{height:4px;border-radius:2px;background:var(--track);margin-top:10px;overflow:hidden}.bar i{display:block;height:100%;width:100%;background:var(--warn);transform-origin:left}
.btn{width:100%;height:44px;margin-top:16px;display:inline-flex;gap:8px;align-items:center;justify-content:center;font:inherit;font-weight:600;color:var(--primary-text);background:var(--primary);border:0;border-radius:10px;cursor:pointer}
.btn:hover:not(:disabled){filter:brightness(1.12)}.btn:focus-visible{outline:3px solid var(--kb-accent);outline-offset:2px}.btn:disabled{opacity:.55;cursor:not-allowed}
.spin{width:16px;height:16px;border-radius:50%;border:2px solid color-mix(in srgb,var(--primary-text) 35%,transparent);border-top-color:var(--primary-text);animation:r .8s linear infinite}
.spin.big{width:28px;height:28px;border-width:3px;border-color:var(--track);border-top-color:var(--text-2)}
@keyframes r{to{transform:rotate(360deg)}}@media (prefers-reduced-motion:reduce){.spin{animation:none}.bar i,.ok .bar i{transition:none!important}}
.note{margin:14px 0 0;text-align:center;color:var(--text-2);font-size:12.5px}
.ok{display:grid;place-items:center;text-align:center;gap:10px;padding:8px 0 4px}.ok .tick{width:52px;height:52px;border-radius:50%;background:var(--ok-bg);color:var(--ok);display:grid;place-items:center}
.ok h1{margin:4px 0 0}.ok p{margin:0;color:var(--text-2);font-size:14px}.ok .bar{width:100%;margin-top:14px}.ok .bar i{background:var(--ok);transform:scaleX(0);transition:transform .7s linear}.ok .bar i.go{transform:scaleX(1)}
.foot{color:var(--text-2);font-size:12.5px;text-align:center;max-width:400px}.hide{display:none!important}
`

const wordmark = `<div class="wm" role="img" aria-label="Kybernos"><svg viewBox="0 0 36 40" aria-hidden="true"><path class="k" fill-rule="evenodd" d="${K_PATH}"/></svg><span>ybernos</span></div>`
const EYE_ON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>'
const EYE_OFF = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.9 17.9A10.9 10.9 0 0 1 12 19c-6.4 0-10-7-10-7a18.7 18.7 0 0 1 4.1-5M9.9 5.2A9.9 9.9 0 0 1 12 5c6.4 0 10 7 10 7a18.6 18.6 0 0 1-2.2 3.2M1 1l22 22"/></svg>'
const ICON_ERR = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M12 7.5v5.5M12 16.5h.01"/></svg>'
const TICK = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'

const shell = ({ lang, nonce, title, body, script }) => `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title><style nonce="${nonce}">${CSS}</style></head>
<body><main>${body}</main><script nonce="${nonce}">${script}</script></body></html>`

/** The Content-Security-Policy that goes with these pages (they carry one inline style and one inline script). */
export const pageCsp = (nonce) => `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'self'; img-src data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`

/** The sign-in page. `next` is where to go afterwards (sanitised here as well). */
export function renderLogin ({ lang, nonce, next, sessionDays }) {
  const s = STRINGS[lang] ?? STRINGS.en
  const note = s.note.replace('{days}', String(sessionDays))
  const cfg = { next: safeNext(next), dict: { ...s, note } }
  const body = `<section class="card" aria-labelledby="ttl">${wordmark}
<form id="form" novalidate autocomplete="on" method="post" action="/__gate/login">
<h1 id="ttl">${escapeHtml(s.title)}</h1><p class="sub">${escapeHtml(s.sub)}</p>
<label class="f" for="user">${escapeHtml(s.userLabel)}</label>
<div class="field u" id="ufield"><input id="user" name="username" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" autofocus placeholder="${escapeHtml(s.userLabel)}"></div>
<label class="f" for="pw">${escapeHtml(s.label)}</label>
<div class="field" id="field"><input id="pw" name="password" type="password" autocomplete="current-password" aria-describedby="msg" placeholder="${escapeHtml(s.label)}">
<button type="button" class="eye" id="eye" aria-pressed="false" aria-label="${escapeHtml(s.show)}"><span id="eye-on">${EYE_ON}</span><span id="eye-off" class="hide">${EYE_OFF}</span></button></div>
<div id="msg" role="status" aria-live="polite"></div>
<button class="btn" id="submit" type="submit">${escapeHtml(s.signin)}</button>
<p class="note">${escapeHtml(note)}</p></form>
<div id="done" class="ok hide" role="status"><div class="tick">${TICK}</div><h1>${escapeHtml(s.doneTitle)}</h1><p>${escapeHtml(s.doneSub)}</p><div class="bar" aria-hidden="true"><i id="doneBar"></i></div></div>
</section><p class="foot">${escapeHtml(s.foot)}</p>`
  const script = `(()=>{const C=${jsonForScript(cfg)},D=C.dict,$=(i)=>document.getElementById(i);let timer=null,busy=false
const ERR='${ICON_ERR.replaceAll('\'', '\\\'')}'
const mmss=(s)=>Math.floor(s/60)+':'+String(s%60).padStart(2,'0')
const fmt=(t,v)=>t.replace('{n}',v.n).replace('{t}',v.t)
function setBad(u,p){$('ufield').classList.toggle('bad',u);$('field').classList.toggle('bad',p)}
function lock(on){$('user').disabled=on;$('pw').disabled=on;$('eye').disabled=on;$('submit').disabled=on}
function err(text){const m=$('msg');m.className='msg err';m.innerHTML=ERR;const s=document.createElement('span');s.textContent=text;m.appendChild(s)}
function clearMsg(){const m=$('msg');m.className='';m.textContent='';setBad(false,false)}
function locked(total){clearInterval(timer);let left=total;lock(true);$('submit').textContent=D.wait
const m=$('msg');m.className='box'
const draw=()=>{m.textContent='';const d=document.createElement('div');const parts=fmt(D.locked,{t:'\\u0000'}).split('\\u0000');d.append(parts[0]);const b=document.createElement('b');b.textContent=mmss(left);d.append(b);d.append(parts[1]||'');m.appendChild(d)
const bar=document.createElement('div');bar.className='bar';const i=document.createElement('i');i.style.transform='scaleX('+(left/total).toFixed(3)+')';bar.appendChild(i);m.appendChild(bar)}
draw();timer=setInterval(()=>{left-=1;if(left<=0){clearInterval(timer);clearMsg();lock(false);$('submit').textContent=D.signin;$('user').focus()}else draw()},1000)}
$('eye').addEventListener('click',()=>{const show=$('pw').type==='password';$('pw').type=show?'text':'password';$('eye').setAttribute('aria-pressed',String(show));$('eye').setAttribute('aria-label',show?D.hide:D.show);$('eye-on').classList.toggle('hide',show);$('eye-off').classList.toggle('hide',!show);$('pw').focus()})
$('form').addEventListener('submit',async(e)=>{e.preventDefault();if(busy)return
const u=$('user').value.trim(),p=$('pw').value
if(u===''||p===''){setBad(u==='',p==='');err(D.empty);(u===''?$('user'):$('pw')).focus();return}
busy=true;clearMsg();lock(true);$('submit').textContent=D.signing
try{const r=await fetch('/__gate/login',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({user:u,password:p,next:C.next})})
let j={};try{j=await r.json()}catch(x){}
if(r.ok&&j.ok){$('form').classList.add('hide');$('done').classList.remove('hide');requestAnimationFrame(()=>$('doneBar').classList.add('go'));setTimeout(()=>location.replace(typeof j.next==='string'?j.next:'/'),700);return}
busy=false;$('pw').value=''
if(r.status===429&&Number.isFinite(j.retryAfter)){locked(j.retryAfter);return}
lock(false);$('submit').textContent=D.signin;setBad(true,true)
if(r.status===401&&Number.isFinite(j.triesLeft)){err(fmt(j.triesLeft===1?D.wrongOne:D.wrongMany,{n:j.triesLeft}))}else{err(D.failed)}
$('user').focus()}catch(x){busy=false;lock(false);$('submit').textContent=D.signin;err(D.failed)}})
})()`
  return shell({ lang, nonce, title: 'Kybernos', body, script })
}

/** Shown to a signed-in user while DSH is not answering yet. */
export function renderStarting ({ lang, nonce }) {
  const s = STRINGS[lang] ?? STRINGS.en
  const body = `<section class="card">${wordmark}<div class="ok" role="status"><span class="spin big" aria-hidden="true"></span><h1>${escapeHtml(s.startTitle)}</h1><p>${escapeHtml(s.startSub)}</p></div></section>`
  return shell({ lang, nonce, title: 'Kybernos', body, script: 'setTimeout(()=>location.reload(),3000)' })
}
