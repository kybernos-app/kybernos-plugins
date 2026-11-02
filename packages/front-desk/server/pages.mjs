// The two pages the service serves: the visitor's chat and the owner's Boîte (text only in this first lot). Both are one HTML
// file with an inline style and script under a CSP nonce, no external request, and every piece of data is put in the page with
// textContent, never as markup. English is the source; French lives in its own dictionary.

const CHAT_EN = {
  placeholder: 'Write your message…', send: 'Send', ai: 'AI assistant', aiNote: 'You are talking to an AI assistant.',
  mydata: 'My data', remembered: 'What is remembered about you', nothing: 'Nothing is remembered about you.',
  erase: 'Erase everything', eraseConfirm: 'Click again to confirm', close: 'Close',
  typing: 'Typing…', neterr: 'Could not reach the assistant. Please try again.',
  first_name: 'First name', email: 'Email', preference: 'Preference', yes: 'Yes, remember', no: 'No thanks',
};
const CHAT_FR = {
  placeholder: 'Écris ton message…', send: 'Envoyer', ai: 'Assistant IA', aiNote: 'Tu parles à un assistant IA.',
  mydata: 'Mes données', remembered: 'Ce qui est retenu sur toi', nothing: 'Rien n’est retenu sur toi.',
  erase: 'Tout effacer', eraseConfirm: 'Clique encore pour confirmer', close: 'Fermer',
  typing: 'Écrit…', neterr: 'Impossible de joindre l’assistant. Réessaie.',
  first_name: 'Prénom', email: 'E-mail', preference: 'Préférence', yes: 'Oui, retenir', no: 'Non merci',
};
const BOITE_EN = {
  title: 'Inbox', token: 'Owner token', open: 'Open', badToken: 'Wrong token.', refresh: 'Refresh',
  today: 'Today', spent: 'spent', of: 'of', running: 'running now',
  stop: 'Stop the assistant', resume: 'Resume the assistant', stopped: 'The assistant is stopped.',
  approvals: 'Waiting for your decision', none: 'Nothing.', approve: 'Approve', reject: 'Reject',
  conversations: 'Conversations', messages: 'Messages left for the shop', callbacks: 'Callback requests',
  contact: 'Contact card', level: 'Identity level', channel: 'Channel', remembered: 'Remembered, with consent',
  noneKnown: 'Nothing is remembered.', erase: 'Erase this visitor', eraseConfirm: 'Click again to confirm',
  visitor: 'Visitor', assistant: 'Assistant', did: 'Assistant did', scenarios: 'Run the five scenarios', pass: 'passed', fail: 'failed',
  l1: '1 · anonymous', l2: '2 · sender checked by the channel', l3: '3 · one-time code',
  pickOne: 'Pick a conversation.',
};
const BOITE_FR = {
  title: 'Boîte', token: 'Jeton du propriétaire', open: 'Ouvrir', badToken: 'Jeton incorrect.', refresh: 'Actualiser',
  today: 'Aujourd’hui', spent: 'dépensé', of: 'sur', running: 'en cours',
  stop: 'Arrêter l’assistant', resume: 'Relancer l’assistant', stopped: 'L’assistant est arrêté.',
  approvals: 'En attente de ta décision', none: 'Rien.', approve: 'Accepter', reject: 'Refuser',
  conversations: 'Conversations', messages: 'Messages laissés pour la boutique', callbacks: 'Demandes de rappel',
  contact: 'Fiche du contact', level: 'Niveau d’identité', channel: 'Canal', remembered: 'Retenu, avec accord',
  noneKnown: 'Rien n’est retenu.', erase: 'Effacer ce visiteur', eraseConfirm: 'Clique encore pour confirmer',
  visitor: 'Visiteur', assistant: 'Assistant', did: 'L’assistant a fait', scenarios: 'Rejouer les cinq scénarios', pass: 'réussis', fail: 'échoués',
  l1: '1 · anonyme', l2: '2 · expéditeur vérifié par le canal', l3: '3 · code à usage unique',
  pickOne: 'Choisis une conversation.',
};
const DICT = { chat: { en: CHAT_EN, fr: CHAT_FR }, boite: { en: BOITE_EN, fr: BOITE_FR } };

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** JSON that is safe inside a <script type="application/json"> block. */
const safeJson = (v) => JSON.stringify(v).replace(/</g, '\\u003c').replace(new RegExp(String.fromCharCode(0x2028), 'g'), '\\u2028').replace(new RegExp(String.fromCharCode(0x2029), 'g'), '\\u2029');

const BASE_CSS = `
:root{--bg:#fbfaf7;--card:#fff;--ink:#1d2421;--ink2:#5b655f;--line:#dcd9d0;--well:#f1efe9;--warn:#fff3cd;--warnink:#6b4e00;--ok:#e3f3e8;--okink:#155d2e;--bad:#fde4e1;--badink:#8a1c12}
@media (prefers-color-scheme:dark){:root{--bg:#141816;--card:#1c211f;--ink:#e8ece9;--ink2:#9aa6a0;--line:#2f3733;--well:#242a27;--warn:#3a3114;--warnink:#f0d589;--ok:#183524;--okink:#8fdcab;--bad:#3d1b17;--badink:#f4b3ab}}
*{box-sizing:border-box}html,body{margin:0;height:100%}
body{background:var(--bg);color:var(--ink);font:16px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
button{font:inherit;color:inherit;border:1px solid var(--line);background:var(--card);border-radius:10px;padding:8px 14px;cursor:pointer}
button:hover{background:var(--well)}button:focus-visible,textarea:focus-visible,input:focus-visible{outline:2px solid var(--brand,#2F6B54);outline-offset:2px}
button.primary{background:var(--brand,#2F6B54);border-color:var(--brand,#2F6B54);color:#fff}button.primary:hover{filter:brightness(1.08)}
button[disabled]{opacity:.55;cursor:default}
`;

export function chatPage({ fiche, nonce }) {
  const lang = fiche.language;
  const T = DICT.chat[lang] || CHAT_EN;
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(fiche.name)}</title><style nonce="${nonce}">${BASE_CSS}
:root{--brand:${fiche.brand.color}}
body{display:flex;justify-content:center}
.app{position:relative;display:flex;flex-direction:column;width:100%;max-width:560px;height:100%;background:var(--card);border-left:1px solid var(--line);border-right:1px solid var(--line)}
header{display:flex;align-items:center;gap:12px;padding:12px 16px;background:var(--brand);color:#fff}
.logo{width:38px;height:38px;border-radius:50%;background:#ffffff38;display:grid;place-items:center;font-weight:700;flex:none}
header .t{font-weight:600;line-height:1.2;min-width:0}header small{display:block;font-weight:400;opacity:.92;overflow-wrap:anywhere}
header button{margin-left:auto;background:#ffffff26;border-color:#ffffff59;color:#fff;padding:6px 10px;font-size:14px;white-space:nowrap}
#log{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px}
.m{max-width:85%;padding:9px 13px;border-radius:16px;overflow-wrap:anywhere;white-space:pre-wrap}
.m.a{align-self:flex-start;background:var(--well);border-bottom-left-radius:4px}
.m.v{align-self:flex-end;background:var(--brand);color:#fff;border-bottom-right-radius:4px}
.m.err{align-self:center;background:var(--bad);color:var(--badink);font-size:14px}
.m.sys{align-self:center;background:transparent;color:var(--ink2);font-size:13px;text-align:center}
.card{align-self:stretch;border:1px solid var(--line);border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:10px;background:var(--bg);font-size:15px;overflow-wrap:anywhere}
.card .row{display:flex;gap:8px;flex-wrap:wrap}
form{display:flex;gap:8px;padding:10px 12px;border-top:1px solid var(--line)}
textarea{flex:1;resize:none;font:inherit;color:inherit;background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:9px 12px;max-height:120px}
.panel{position:absolute;inset:0;background:var(--card);padding:20px;overflow:auto;display:none}.panel.on{display:block}
.panel-in{max-width:520px;margin:0 auto;display:flex;flex-direction:column;gap:14px}
.panel dl{margin:0;display:grid;grid-template-columns:auto 1fr;gap:6px 14px}.panel dt{color:var(--ink2)}.panel dd{margin:0;overflow-wrap:anywhere}
.h0{margin:0}.btns{display:flex;gap:8px;flex-wrap:wrap}.muted{color:var(--ink2)}
.note{padding:6px 16px;text-align:center;font-size:12px;color:var(--ink2);border-top:1px solid var(--line)}
</style></head><body>
<div class="app"><header><div class="logo" id="logo" aria-hidden="true"></div><div class="t"><span id="name"></span><small id="hello"></small></div><button type="button" id="mydata"></button></header>
<div id="log" role="log" aria-live="polite"></div>
<form id="f" autocomplete="off"><textarea id="in" rows="1" maxlength="2000" aria-label="message"></textarea><button class="primary" id="send" type="submit"></button></form>
<div class="note" id="ainote"></div>
<div class="panel" id="panel" role="dialog" aria-modal="true"><div class="panel-in"><h2 id="ph" class="h0"></h2><dl id="fields"></dl><p id="none"></p><div class="btns"><button type="button" id="erase"></button><button type="button" id="close"></button></div><p id="pmsg" class="muted"></p></div></div>
<script type="application/json" id="cfg">${safeJson({ slug: fiche.slug, lang, name: fiche.name, hello: fiche.brand.greeting, t: T })}</script>
<script nonce="${nonce}">
(function(){
var C=JSON.parse(document.getElementById('cfg').textContent),T=C.t,$=function(i){return document.getElementById(i)};
var base='/c/'+C.slug,log=$('log'),input=$('in'),busy=false,mem={};
function store(k,v){try{if(v===undefined)return localStorage.getItem(k);localStorage.setItem(k,v)}catch(e){return v===undefined?mem[k]:(mem[k]=v)}}
function rid(){var a=new Uint8Array(16),s='';(window.crypto||{getRandomValues:function(x){for(var i=0;i<x.length;i++)x[i]=Math.random()*256}}).getRandomValues(a);for(var i=0;i<a.length;i++)s+=('0'+a[i].toString(16)).slice(-2);return s}
var vid=store('fd_vid');if(!/^[a-z0-9]{16,64}$/.test(vid||'')){vid=rid();store('fd_vid',vid)}
$('name').textContent=C.name;$('hello').textContent=C.hello||T.ai;$('logo').textContent=(C.name||'?').charAt(0).toUpperCase();
$('mydata').textContent=T.mydata;$('send').textContent=T.send;input.placeholder=T.placeholder;$('ainote').textContent=T.aiNote;
$('ph').textContent=T.remembered;$('erase').textContent=T.erase;$('close').textContent=T.close;
var hist=[];try{hist=JSON.parse(store('fd_h_'+C.slug)||'[]')}catch(e){hist=[]}
function save(){store('fd_h_'+C.slug,JSON.stringify(hist.slice(-60)))}
function bubble(cls,text,keep){var d=document.createElement('div');d.className='m '+cls;d.textContent=text;log.appendChild(d);log.scrollTop=log.scrollHeight;if(keep){hist.push([cls,text]);save()}return d}
hist.forEach(function(h){bubble(h[0],h[1],false)});
function consentCard(c){var d=document.createElement('div');d.className='card';var p=document.createElement('div');p.textContent=c.text;var row=document.createElement('div');row.className='row';
function mk(label,accept,primary){var b=document.createElement('button');b.type='button';b.textContent=label;if(primary)b.className='primary';b.onclick=function(){row.querySelectorAll('button').forEach(function(x){x.disabled=true});
api('/consent',{visitorId:vid,noteId:c.noteId,accept:accept}).then(function(r){d.remove();if(r.reply)bubble('sys',r.reply,false)})};return b}
row.appendChild(mk(c.yes,true,true));row.appendChild(mk(c.no,false,false));d.appendChild(p);d.appendChild(row);log.appendChild(d);log.scrollTop=log.scrollHeight}
function api(path,body,method,headers){return fetch(base+path,{method:method||'POST',headers:Object.assign({'content-type':'application/json'},headers||{}),body:body?JSON.stringify(body):undefined}).then(function(r){return r.json().catch(function(){return{}})})}
$('f').addEventListener('submit',function(e){e.preventDefault();var text=input.value.trim();if(!text||busy)return;busy=true;$('send').disabled=true;input.value='';input.style.height='';bubble('v',text,true);var wait=bubble('sys',T.typing,false);
api('/messages',{visitorId:vid,text:text,lang:C.lang}).then(function(r){wait.remove();if(r.reply)bubble(r.ok?'a':'err',r.reply,!!r.ok);(r.pendingConsents||[]).forEach(function(c){c.yes=T.yes;c.no=T.no;consentCard(c)})}).catch(function(){wait.remove();bubble('err',T.neterr,false)}).then(function(){busy=false;$('send').disabled=false;input.focus()})});
input.addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();$('f').requestSubmit()}});
input.addEventListener('input',function(){input.style.height='auto';input.style.height=Math.min(120,input.scrollHeight)+'px'});
var armed=false;
$('mydata').onclick=function(){$('panel').classList.add('on');$('pmsg').textContent='';armed=false;$('erase').textContent=T.erase;
fetch(base+'/me',{headers:{'x-visitor-id':vid}}).then(function(r){return r.json()}).then(function(r){var dl=$('fields');dl.textContent='';var k=Object.keys(r.fields||{});$('none').textContent=k.length?'':T.nothing;$('erase').style.display=k.length?'':'none';k.forEach(function(x){var dt=document.createElement('dt');dt.textContent=T[x]||x;var dd=document.createElement('dd');dd.textContent=r.fields[x];dl.appendChild(dt);dl.appendChild(dd)})})};
$('close').onclick=function(){$('panel').classList.remove('on')};
$('erase').onclick=function(){if(!armed){armed=true;$('erase').textContent=T.eraseConfirm;return}armed=false;$('erase').textContent=T.erase;
fetch(base+'/me',{method:'DELETE',headers:{'x-visitor-id':vid}}).then(function(r){return r.json()}).then(function(r){hist=[];save();log.textContent='';$('fields').textContent='';$('none').textContent=T.nothing;$('erase').style.display='none';$('pmsg').textContent=r.reply||''})};
})();
</script></body></html>`;
}

export function boitePage({ fiche, nonce }) {
  const lang = fiche.language;
  const T = DICT.boite[lang] || BOITE_EN;
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(fiche.name)} · ${esc(T.title)}</title><style nonce="${nonce}">${BASE_CSS}
:root{--brand:${fiche.brand.color}}
body{height:auto;min-height:100%}
.wrap{max-width:1100px;margin:0 auto;padding:16px}
h1{font-size:20px;margin:0 0 12px}h2{font-size:15px;margin:0 0 8px}
.bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:14px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;margin-bottom:14px;overflow-wrap:anywhere}
.grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.6fr);gap:14px;align-items:start}
@media (max-width:800px){.grid{grid-template-columns:minmax(0,1fr)}}
.meter{height:10px;border-radius:5px;background:var(--well);overflow:hidden}.meter>i{display:block;height:100%;background:var(--brand)}
.item{display:block;width:100%;text-align:left;border-radius:10px;margin-bottom:6px}.item[aria-current="true"]{border-color:var(--brand)}
.item small{display:block;color:var(--ink2)}
.m{padding:8px 12px;border-radius:14px;margin:6px 0;max-width:90%;overflow-wrap:anywhere;white-space:pre-wrap}
.m.v{background:var(--well)}.m.a{background:var(--brand);color:#fff;margin-left:auto}
.ev{font-size:13px;color:var(--ink2);text-align:center;margin:4px 0}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.pill{display:inline-block;border-radius:999px;padding:2px 10px;font-size:13px;background:var(--well)}.pill.ok{background:var(--ok);color:var(--okink)}.pill.bad{background:var(--bad);color:var(--badink)}.pill.warn{background:var(--warn);color:var(--warnink)}
input{font:inherit;color:inherit;background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:8px 12px;min-width:0;flex:1}
dl{margin:0;display:grid;grid-template-columns:auto 1fr;gap:4px 12px}dt{color:var(--ink2)}dd{margin:0}
.muted{color:var(--ink2)}.tight{margin:8px 0 0}.between{justify-content:space-between}.h0{margin:0}.gap{margin:10px 0}.push{margin-left:auto}.meter>i{width:0}
</style></head><body><div class="wrap">
<h1 id="h"></h1>
<div class="card" id="login"><form id="lf" class="row"><input id="tok" type="password" autocomplete="off" aria-label="token"><button class="primary" type="submit" id="lb"></button></form><p class="muted tight" id="lm"></p></div>
<div id="main" hidden>
<div class="card"><div class="row between"><h2 id="th" class="h0"></h2><span id="state"></span></div><div class="meter gap"><i id="mb"></i></div><div class="row"><span id="mt"></span><button type="button" id="kill" class="push"></button><button type="button" id="refresh"></button></div></div>
<div class="card" id="apc"><h2 id="ah"></h2><div id="al"></div></div>
<div class="grid"><div><div class="card"><h2 id="ch"></h2><div id="cl"></div></div><div class="card"><h2 id="mh"></h2><div id="ml"></div></div><div class="card"><h2 id="bh"></h2><div id="bl"></div></div></div></div>

<div class="card" id="detail"><p class="muted" id="pick"></p></div></div>
<div class="card"><div class="row"><button type="button" id="sc"></button><span id="sr"></span></div></div>
</div></div>
<script type="application/json" id="cfg">${safeJson({ t: T })}</script>
<script nonce="${nonce}">
(function(){
var T=JSON.parse(document.getElementById('cfg').textContent).t,$=function(i){return document.getElementById(i)};
var mem={};function store(k,v){try{if(v===undefined)return sessionStorage.getItem(k);sessionStorage.setItem(k,v)}catch(e){return v===undefined?mem[k]:(mem[k]=v)}}
var tok=store('fd_tok')||'',cur=null,armed=false;
$('h').textContent=T.title;$('lb').textContent=T.open;$('tok').placeholder=T.token;$('th').textContent=T.today;$('ah').textContent=T.approvals;$('ch').textContent=T.conversations;$('mh').textContent=T.messages;$('bh').textContent=T.callbacks;$('pick').textContent=T.pickOne;$('refresh').textContent=T.refresh;$('sc').textContent=T.scenarios;
function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e}
function api(path,method,body){return fetch('/v1/admin/'+path,{method:method||'GET',headers:{authorization:'Bearer '+tok,'content-type':'application/json'},body:body?JSON.stringify(body):undefined}).then(function(r){if(r.status===401){var e=new Error('auth');e.auth=true;throw e}return r.json()})}
function money(m,cur){return (m/1e6).toFixed(m<1e5?4:2)+' '+cur}
function when(ts){return new Date(ts).toLocaleString()}
function fill(box,rows,none){box.textContent='';if(!rows.length){box.appendChild(el('p','muted',none||T.none));return}rows.forEach(function(r){box.appendChild(r)})}
function render(o){
 var b=o.budget;$('mb').style.width=Math.min(100,b.capMicro?100*(b.spentMicro+b.reservedMicro)/b.capMicro:100)+'%';
 $('mt').textContent=money(b.spentMicro,b.currency)+' '+T.of+' '+money(b.capMicro,b.currency)+' · '+b.inflight+' '+T.running;
 var st=$('state');st.textContent='';if(b.killed||!b.enabled){st.appendChild(el('span','pill bad',T.stopped))}
 $('kill').textContent=b.killed?T.resume:T.stop;$('kill').dataset.on=b.killed?'':'1';
 fill($('al'),o.approvals.map(function(a){var d=el('div','row');d.style.marginBottom='8px';d.appendChild(el('span','pill warn',a.name));d.appendChild(el('span',null,JSON.stringify(a.params)));
  var y=el('button','primary',T.approve),n=el('button',null,T.reject);y.style.marginLeft='auto';
  function dec(x){return function(){y.disabled=n.disabled=true;api('approvals/'+a.id,'POST',{decision:x}).then(load)}}y.onclick=dec('approve');n.onclick=dec('reject');d.appendChild(y);d.appendChild(n);return d}));
 fill($('cl'),o.conversations.map(function(c){var bt=el('button','item');bt.appendChild(el('span',null,c.preview||c.id));bt.appendChild(el('small',null,c.channel+' · '+when(c.lastAt)));bt.setAttribute('aria-current',cur===c.id?'true':'false');bt.onclick=function(){open(c.id)};return bt}));
 fill($('ml'),o.messages.map(function(m){var d=el('div');d.style.marginBottom='8px';d.appendChild(el('div',null,m.message));d.appendChild(el('small','muted',m.channel+' · '+when(m.ts)+(m.contact?' · '+m.contact:'')));return d}));
 fill($('bl'),o.callbacks.map(function(m){var d=el('div');d.style.marginBottom='8px';d.appendChild(el('div',null,m.phone+(m.when?' · '+m.when:'')));d.appendChild(el('small','muted',m.channel+' · '+when(m.ts)));return d}));
}
function open(id){cur=id;armed=false;api('conversations/'+id).then(function(r){var box=$('detail');box.textContent='';
 var lv=T['l'+r.card.level]||String(r.card.level);var card=el('div','card');card.style.background='var(--bg)';card.appendChild(el('h2',null,T.contact));var dl=el('dl');
 [[T.channel,r.card.channel],[T.level,lv]].forEach(function(p){dl.appendChild(el('dt',null,p[0]));dl.appendChild(el('dd',null,p[1]))});
 var ks=Object.keys(r.card.fields);dl.appendChild(el('dt',null,T.remembered));var dd=el('dd');if(!ks.length)dd.textContent=T.noneKnown;ks.forEach(function(k){dd.appendChild(el('div',null,k+': '+r.card.fields[k].value))});dl.appendChild(dd);card.appendChild(dl);
 var er=el('button',null,T.erase);er.style.marginTop='10px';er.onclick=function(){if(!armed){armed=true;er.textContent=T.eraseConfirm;return}api('conversations/'+id,'DELETE').then(function(){cur=null;box.textContent='';box.appendChild(el('p','muted',T.pickOne));load()})};card.appendChild(er);box.appendChild(card);
 r.log.forEach(function(e){if(e.type==='event')box.appendChild(el('div','ev',T.did+': '+e.name+(e.pending?' (…)':e.ok?'':' ✗')));else box.appendChild(el('div','m '+(e.role==='user'?'v':'a'),e.text))})
 load(true)})}
function load(quiet){return api('overview').then(function(o){$('login').hidden=true;$('main').hidden=false;render(o)}).catch(function(e){if(e.auth){$('main').hidden=true;$('login').hidden=false;$('lm').textContent=tok?T.badToken:'';store('fd_tok','');tok=''}})}
$('lf').addEventListener('submit',function(e){e.preventDefault();tok=$('tok').value.trim();store('fd_tok',tok);$('tok').value='';load()});
$('refresh').onclick=function(){load()};
$('kill').onclick=function(){api('kill','POST',{on:$('kill').dataset.on==='1'}).then(load)};
$('sc').onclick=function(){$('sr').textContent='…';api('scenarios','POST').then(function(r){var ok=r.results.filter(function(x){return x.ok}).length;var s=$('sr');s.textContent='';s.appendChild(el('span','pill '+(ok===r.results.length?'ok':'bad'),ok+'/'+r.results.length+' '+(ok===r.results.length?T.pass:T.fail)))})};
if(tok)load()
})();
</script></body></html>`;
}
