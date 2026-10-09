// ═══════════════════════════════════════════════════════════════════════════
// kybernos-bricks — moitié CLIENT.
//
// Le panneau « Briques » de la barre latérale DROITE : un canevas isométrique
// qui pose les briques en direct, puis les relit.
//
//   chat (outil `animer_briques`)  →  route /kybernos-bricks/state  →  ce panneau
//
// TROIS PARTIES DANS CE FICHIER :
//   1. le MOTEUR (couleurs, masques, pavage, 9 générateurs, rendu Canvas 2D) —
//      extrait tel quel du POC vérifié `artifacts/maquettes/brick-studio.html` ;
//   2. l'EXÉCUTEUR D'OPS : la géométrie que l'agent envoie devient un modèle ;
//   3. le PANNEAU : onglet de la barre latérale droite + horloge de pose.
//
// La pose est calée sur `t0`/`dureeMs` de l'hôte : le panneau ne « joue » pas
// une animation locale, il rattrape une horloge qui a démarré au clic du chat.
// ═══════════════════════════════════════════════════════════════════════════

window.__ModuleLoader__.load({
  id: '@local/kybernos-bricks/client',
  factory (require) {
    const React = require('react')
    const h = React.createElement

    const TYPE_ID = 'kybernos-bricks'
    const KIND = 'kybernos-bricks'
    const SLOT = 'sidebar.right.pane.tab'
    const STYLE_ID = 'kybernos-bricks-styles'
    const ROUTE_STATE = '/kybernos-bricks/state'
    const CADENCE_MS = 400

    const CSS = `
.kbb-root{display:flex;flex-direction:column;height:100%;min-height:0;font-size:12px;
  color:var(--dsw-alias-label-primary,#1a1a1a);background:var(--dsw-alias-bg-layer-2,#fff)}
.kbb-head{flex:none;display:flex;align-items:center;gap:8px;padding:10px 12px 8px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.07))}
.kbb-title{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kbb-badge{margin-left:auto;flex:none;font-size:10.5px;font-weight:600;padding:2px 8px;border-radius:99px;
  background:var(--dsw-alias-bg-module-platform,rgba(0,0,0,.05));color:var(--dsw-alias-label-secondary,#6b6b68)}
.kbb-badge.run{background:#e1502a;color:#fff}
.kbb-view{position:relative;flex:1;min-height:160px;background:#f7f6f3;overflow:hidden}
.kbb-view canvas{display:block;width:100%;height:100%;cursor:grab}
.kbb-view canvas.kbb-drag{cursor:grabbing}
.kbb-empty{position:absolute;inset:0;display:flex;flex-direction:column;gap:6px;align-items:center;justify-content:center;
  padding:22px;text-align:center;color:var(--dsw-alias-label-tertiary,#8a8a87);font-size:12px;line-height:1.5}
.kbb-empty b{color:var(--dsw-alias-label-secondary,#4a4a47);font-weight:600}
.kbb-empty code{font-size:11px;background:var(--dsw-alias-bg-module-platform,rgba(0,0,0,.05));padding:1px 5px;border-radius:4px}
.kbb-tools{position:absolute;top:8px;left:8px;display:flex;gap:2px;background:rgba(255,255,255,.92);
  border-radius:9px;padding:3px;box-shadow:0 3px 12px rgba(28,42,28,.12)}
.kbb-tool{border:0;background:transparent;font:inherit;font-size:10.5px;color:#6b6b68;padding:3px 7px;border-radius:6px;cursor:pointer}
.kbb-tool:hover{background:rgba(0,0,0,.05)}
.kbb-tool.on{background:#efefec;color:#1a1a1a;font-weight:650}
.kbb-foot{flex:none;padding:8px 12px 10px;border-top:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.07))}
.kbb-line{display:flex;align-items:center;gap:7px}
.kbb-play{flex:none;width:26px;height:26px;border:0;border-radius:50%;background:#e1502a;color:#fff;cursor:pointer;
  display:grid;place-items:center;font-size:10px;line-height:1}
.kbb-play:hover{background:#c94522}
.kbb-step{flex:none;width:22px;height:22px;border:0;background:transparent;color:#6b6b68;cursor:pointer;border-radius:6px;font-size:11px}
.kbb-step:hover{background:rgba(0,0,0,.05)}
.kbb-sp{border:0;background:transparent;font:inherit;font-size:10.5px;color:#8a8a87;padding:3px 5px;border-radius:5px;cursor:pointer}
.kbb-sp.on{background:rgba(0,0,0,.06);color:#1a1a1a;font-weight:650}
.kbb-track{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.kbb-lab{font-size:10.5px;color:#7c7c79;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kbb-lab b{color:#2a2a28;font-weight:600}
.kbb-range{-webkit-appearance:none;appearance:none;width:100%;height:4px;border-radius:2px;background:rgba(0,0,0,.10);outline:0}
.kbb-range::-webkit-slider-thumb{-webkit-appearance:none;width:12px;height:12px;border-radius:50%;background:#e1502a;border:2px solid #fff;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.25)}
.kbb-note{margin-top:7px;font-size:10.5px;line-height:1.45;color:var(--dsw-alias-label-tertiary,#8a8a87);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kbb-note b{color:var(--dsw-alias-label-secondary,#4a4a47);font-weight:600}
.kbb-chip{display:inline-block;font-size:10.5px;padding:1px 7px;border-radius:99px;margin:0 4px 4px 0;
  background:var(--dsw-alias-bg-module-platform,rgba(0,0,0,.05));color:var(--dsw-alias-label-secondary,#6b6b68);cursor:pointer;border:0;font-family:inherit}
.kbb-chip:hover{background:rgba(0,0,0,.09)}
.kbb-chips{display:flex;flex-wrap:wrap;gap:0;margin-top:6px;max-height:52px;overflow:hidden}
`
    /* ══════════════════════ MOTEUR (extrait du POC vérifié) ══════════════════════ */

const RAD = Math.PI / 180;
const $ = s => document.querySelector(s);
const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
function mulberry32(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; } }
function hash(str){ let h=2166136261; for(let i=0;i<str.length;i++){ h^=str.charCodeAt(i); h=Math.imul(h,16777619); } return h>>>0; }

/* ============================ couleurs ============================ */
const C = {
  green:'#4C9A52', green2:'#3F8A47', pine:'#2F6B3A', pine2:'#255833',
  red:'#C4291C', darkRed:'#8E1B14', orange:'#E8772E',
  blue:'#2A6FD6', water:'#3FB6B0', azure:'#4FA3E3',
  white:'#F4F4F2', cream:'#EFE4C8', sand:'#E6D8B8',
  grey:'#9BA3A7', lightGrey:'#C3C8CB', darkGrey:'#5A6165', rock:'#7C848A',
  tan:'#D9C08C', brown:'#7A4E2B', wood:'#8E6239',
  yellow:'#F2C31A', black:'#25282A', purple:'#7B4FA8', pink:'#E39CB0'
};
const _rgbCache = new Map();
function hexRgb(h){
  let c = _rgbCache.get(h);
  if(c) return c;
  const s = h.replace('#','');
  const n = parseInt(s.length===3 ? s.split('').map(x=>x+x).join('') : s, 16);
  c = [n>>16&255, n>>8&255, n&255];
  _rgbCache.set(h,c); return c;
}
const _shadeCache = new Map();
function shade(hex, k){
  const key = hex + '|' + k.toFixed(3);
  let v = _shadeCache.get(key);
  if(v) return v;
  const [r,g,b] = hexRgb(hex);
  v = '#' + [r*k, g*k, b*k].map(x => clamp(Math.round(x),0,255).toString(16).padStart(2,'0')).join('');
  _shadeCache.set(key, v); return v;
}

/* ============================ modèle ============================ */
class BrickModel {
  constructor(){ this.bricks = []; this.occ = new Set(); this.groups = []; }
  has(x,y,z){ return this.occ.has(x+','+y+','+z); }
  place(x,y,z,w,d,hp,color,group,shape,decal){
    const b = { x,y,z,w,d,hp,color, group: group||'', shape: shape||'brick', decal: !!decal };
    if(!decal) for(let j=y;j<y+d;j++) for(let i=x;i<x+w;i++) for(let k=z;k<z+hp;k++) this.occ.add(i+','+j+','+k);
    this.bricks.push(b); return b;
  }
  bounds(){
    if(!this.bricks.length) return {x0:0,y0:0,z0:0,x1:1,y1:1,z1:1};
    let x0=1e9,y0=1e9,z0=1e9,x1=-1e9,y1=-1e9,z1=-1e9;
    for(const b of this.bricks){
      x0=Math.min(x0,b.x); y0=Math.min(y0,b.y); z0=Math.min(z0,b.z);
      x1=Math.max(x1,b.x+b.w); y1=Math.max(y1,b.y+b.d); z1=Math.max(z1,b.z+b.hp);
    }
    return {x0,y0,z0,x1,y1,z1};
  }
  palette(){
    const m = new Map();
    for(const b of this.bricks) m.set(b.color,(m.get(b.color)||0)+1);
    return [...m.entries()].sort((a,b)=>b[1]-a[1]);
  }
}
class Builder {
  constructor(seed){ this.m = new BrickModel(); this.rng = mulberry32(seed); this.cur = ''; }
  g(name){ this.cur = name; if(!this.m.groups.includes(name)) this.m.groups.push(name); return this; }
  put(x,y,z,w,d,hp,color,shape){ return this.m.place(x,y,z,w,d,hp,color,this.cur,shape); }
  dput(x,y,z,w,d,hp,color){ return this.m.place(x,y,z,w,d,hp,color,this.cur,'tile',true); }
  plate(x,y,w,d,color){ return this.put(x,y,0,w,d,1,color,'plate'); }
  fill(mask,z,hp,color){
    const col = (typeof color === 'function') ? color : (()=>color);
    for(const p of tileMask(mask,this.rng)) this.put(p.x,p.y,z,p.w,p.d,hp,col(p.x,p.y));
    return this;
  }
  discFill(mask,z,hp,color){ return this.fill(mask,z,hp,color); }
}

/* ============================ masques + pavage ============================ */
const K = (x,y) => x+','+y;
function rectMask(w,d,x0=0,y0=0){ const s=new Set(); for(let y=0;y<d;y++) for(let x=0;x<w;x++) s.add(K(x+x0,y+y0)); return s; }
function discMask(cx,cy,r){ const s=new Set(); const r2=r*r;
  for(let y=Math.floor(cy-r-1);y<=Math.ceil(cy+r+1);y++) for(let x=Math.floor(cx-r-1);x<=Math.ceil(cx+r+1);x++){
    const dx=x+0.5-cx, dy=y+0.5-cy; if(dx*dx+dy*dy<=r2+0.2) s.add(K(x,y)); } return s; }
function ringDiscMask(cx,cy,r,t){ const a=discMask(cx,cy,r); const b=discMask(cx,cy,Math.max(0.01,r-t));
  for(const k of b) a.delete(k); return a; }
function ringRectMask(w,d,t){ const a=rectMask(w,d); const b=rectMask(w-2*t,d-2*t,t,t); for(const k of b) a.delete(k); return a; }
function minus(mask,x,y,w,d){ const s=new Set(mask); for(let j=y;j<y+d;j++) for(let i=x;i<x+w;i++) s.delete(K(i,j)); return s; }
function offs(mask,dx,dy){ const s=new Set(); for(const k of mask){ const [x,y]=k.split(',').map(Number); s.add(K(x+dx,y+dy)); } return s; }
function union(){ const s=new Set(); for(const m of arguments) for(const k of m) s.add(k); return s; }

const SIZES = [[2,4],[4,2],[2,3],[3,2],[2,2],[1,4],[4,1],[1,3],[3,1],[1,2],[2,1],[1,1]];
function tileMask(mask, rng){
  const free = new Set(mask);
  const cells = [...mask].map(k => k.split(',').map(Number));
  cells.sort((a,b) => a[1]-b[1] || a[0]-b[0]);
  const out = [];
  for(const [x,y] of cells){
    if(!free.has(K(x,y))) continue;
    const fits = [];
    for(const [w,d] of SIZES){
      let ok = true;
      for(let j=0;j<d&&ok;j++) for(let i=0;i<w;i++) if(!free.has(K(x+i,y+j))){ ok=false; break; }
      if(ok) fits.push([w,d]);
    }
    let pick = fits.length ? fits[Math.floor(Math.pow(rng(),1.6)*Math.min(fits.length,3))] || fits[0] : [1,1];
    for(let j=0;j<pick[1];j++) for(let i=0;i<pick[0];i++) free.delete(K(x+i,y+j));
    out.push({x,y,w:pick[0],d:pick[1]});
  }
  return out;
}
function varc(rng, cols){ return () => cols[Math.floor(rng()*cols.length)]; }

/* ============================ structures ============================ */
function stacked(b, mask, z0, courses, hp, color, stagger){
  for(let l=0;l<courses;l++){
    const m = (stagger && l%2) ? (stagger===1 ? mask : mask) : mask;
    b.fill(m, z0 + l*hp, hp, color);
  }
}
function cone(b, cx, cy, z, r, levels, color, hp=3){
  for(let l=0;l<levels;l++){
    const r1 = r*(1 - l/levels);
    if(r1 < 0.6) break;
    const m = discMask(cx,cy,r1);
    if(m.size) b.fill(m, z + l*hp, hp, color);
  }
}
function pyramid(b, x, y, z, w, d, levels, color){
  for(let l=0;l<levels;l++){
    const ww = w-2*l, dd = d-2*l;
    if(ww < 2 || dd < 2) break;
    b.fill(rectMask(ww,dd,x+l,y+l), z+l*3, 3, color);
  }
}
function tree(b, x, y, z, h){
  b.put(x,y,z,1,1,3,C.brown,'brick');
  for(let l=0;l<h;l++){
    const r = 2.1 - l*0.42;
    if(r < 0.7) break;
    b.fill(discMask(x+0.5,y+0.5,r), z+3+l*2, 2, l%2 ? C.pine : C.pine2);
  }
}
function studDotGrid(b,x,y,w,d,z,color,step){
  for(let j=0;j<d;j+=step) for(let i=0;i<w;i+=step) b.put(x+i,y+j,z,1,1,1,color,'tile');
}

/* ============================ archétypes ============================ */
const BUILDERS = {
  castle(seed){
    const b = new Builder(seed); const R = b.rng;
    b.g('Baseplate'); b.plate(0,0,96,96,C.green);
    b.g('Moat'); b.fill(ringDiscMask(48,48,45,4), 1, 1, varc(R,[C.water,C.azure]));
    const stone = varc(R,[C.lightGrey,C.grey,C.tan,'#B7BCC0']);
    const reds  = varc(R,[C.red,C.darkRed]);
    b.g('Curtain wall');
    const wall = offs(ringRectMask(58,58,2), 19, 19);
    const gate = minus(wall, 26, 19, 6, 2);
    for(let l=0;l<5;l++) b.fill(gate, 1+l*3, 3, stone);
    b.g('Battlements');
    for(const k of gate){ const [x,y]=k.split(',').map(Number); if((x+y)%2===0) b.put(x,y,16,1,1,3,stone()); }
    b.g('Corner towers');
    for(const [cx,cy] of [[26,26],[69,26],[26,69],[69,69]]){
      const ring = ringDiscMask(cx,cy,5.2,2);
      for(let l=0;l<11;l++) b.fill(ring, 1+l*3, 3, stone);
      b.fill(discMask(cx,cy,5.2), 31, 3, stone);
      cone(b, cx, cy, 34, 5.2, 5, reds(), 3);
    }
    b.g('Gatehouse');
    for(let l=0;l<8;l++) b.fill(rectMask(8,3,25,18), 1+l*3, 3, stone);
    b.put(26,18,25,2,1,3,stone()); b.put(31,18,25,2,1,3,stone());
    for(let l=0;l<3;l++){ b.fill(rectMask(3,3,25,18), 25+l*3, 3, stone); b.fill(rectMask(3,3,31,18), 25+l*3, 3, stone); }
    b.fill(rectMask(3,3,25,18), 34, 3, stone); b.fill(rectMask(3,3,31,18), 34, 3, stone);
    b.g('Keep');
    const keep = offs(ringRectMask(16,16,3), 40, 40);
    for(let l=0;l<14;l++) b.fill(keep, 1+l*3, 3, stone);
    for(let l=0;l<2;l++) b.fill(offs(ringRectMask(16,16,2),40,40), 43+l*3, 3, stone);
    b.fill(offs(rectMask(16,16),40,40), 46, 3, C.wood);
    pyramid(b, 40, 40, 49, 16, 16, 4, reds());
    b.g('Trees');
    [[30,80],[28,84],[84,30],[80,84],[84,84]].forEach(([x,y]) => tree(b,x,y,1,5));
    return { model:b.m, desc:'A stone castle with battlemented walls, four round corner towers with red-cone roofs, a gatehouse, a tall keep with a stepped red roof, a wide moat and pine trees.' };
  },

  chalet(seed){
    const b = new Builder(seed); const R = b.rng;
    b.g('Snowy ground'); b.plate(0,0,26,22,C.white);
    const stone = varc(R,[C.lightGrey,C.grey,C.tan]);
    const wood  = varc(R,[C.wood,C.brown,C.tan]);
    const roof  = varc(R,[C.darkRed,'#7A1A12',C.brown]);
    const walls = rectMask(18,14,4,4);
    b.g('Stone ground floor');
    for(let l=0;l<4;l++) b.fill(walls, 1+l*3, 3, stone);
    b.g('Log walls');
    for(let l=0;l<6;l++) b.fill(walls, 13+l*3, 3, wood);
    b.g('Roof');
    for(let l=0;l<7;l++){
      const w = 18-2*l, d = 14-2*l;
      if(w<2 || d<2) break;
      b.fill(rectMask(w,d,4+l,4+l), 31+l*3, 3, roof);
    }
    b.g('Details');
    b.dput(11,18,1,2,1,3,C.brown);
    b.dput(5,18,16,3,1,3,C.black); b.dput(14,18,16,3,1,3,C.black);
    b.dput(5,18,22,3,1,3,C.black); b.dput(14,18,22,3,1,3,C.black);
    b.fill(rectMask(20,2,3,16), 13, 1, C.brown);
    [[2,2],[22,2],[2,18],[22,18]].forEach(([x,y]) => tree(b,x,y,1,6));
    return { model:b.m, desc:'A cozy two-story alpine chalet with a stone ground floor, log walls, a wide dark red gable roof, warm dark windows and a ring of pine trees on snow.' };
  },

  lighthouse(seed){
    const b = new Builder(seed); const R = b.rng;
    b.g('Sea'); b.plate(0,0,44,40,C.water);
    b.g('Rocky point');
    b.fill(discMask(22,20,15), 1, 2, varc(R,[C.rock,C.darkGrey,C.grey]));
    b.fill(discMask(22,20,13), 3, 2, C.grey);
    b.g('Tower');
    for(let l=0;l<22;l++) b.fill(discMask(22,20,4.2), 5+l*3, 3, l%4<2 ? C.white : C.red);
    b.g('Lantern room');
    b.fill(discMask(22,20,4.2), 71, 3, C.darkGrey);
    b.fill(ringDiscMask(22,20,4.2,0.7), 74, 3, C.lightGrey);
    b.fill(discMask(22,20,3.6), 74, 3, C.yellow);
    cone(b, 22, 20, 77, 4.2, 4, C.red);
    b.g('Keeper cottage');
    const cot = rectMask(8,6,27,17);
    for(let l=0;l<4;l++) b.fill(cot, 5+l*3, 3, varc(R,[C.white,C.cream]));
    b.fill(discMask(31,20,5), 17, 3, C.brown);
    cone(b, 31, 20, 20, 4.8, 4, C.darkRed);
    b.g('Shore'); [[12,12],[14,30],[32,12]].forEach(([x,y]) => tree(b,x,y,5,4));
    return { model:b.m, desc:"A red-and-white striped lighthouse on a rocky harbor point, with a keeper's cottage, a warm lantern room and a small stand of pines." };
  },

  rocket(seed){
    const b = new Builder(seed); const R = b.rng;
    b.g('Launch pad'); b.plate(0,0,34,34,C.grey);
    b.fill(rectMask(34,34), 1, 1, (x,y) => (Math.floor(y/3)%2) ? C.yellow : C.white);
    b.g('Fins');
    for(const [dx,dy] of [[-1,-1],[1,-1],[-1,1],[1,1]]){
      for(let l=0;l<6;l++){
        const w = 7-l;
        b.fill(rectMask(w,w, dx<0 ? 12-w : 22, dy<0 ? 12-w : 22), 2+l*3, 3, C.red);
      }
    }
    b.g('Body');
    for(let l=0;l<20;l++) b.fill(discMask(17,17,5), 2+l*3, 3, l%5===0 ? C.red : C.white);
    b.g('Nose cone'); cone(b, 17, 17, 62, 5.4, 7, C.white);
    b.fill(discMask(17,17,1.3), 80, 3, C.red);
    b.g('Windows'); b.dput(16,12,38,2,1,3,C.azure);
    return { model:b.m, desc:'A 1950s white-and-red rocket on four swept fins, standing on a striped launch pad, with a porthole and a tapered nose cone.' };
  },

  robot(seed){
    const b = new Builder(seed); const R = b.rng;
    b.g('Base'); b.plate(0,0,18,16,C.lightGrey);
    b.g('Legs');
    [[3,4],[11,4]].forEach(([x,y]) => { for(let l=0;l<3;l++) b.fill(rectMask(4,5,x,y), 1+l*3, 3, C.darkGrey); });
    b.g('Body'); b.fill(rectMask(18,9,0,4), 7, 3, C.darkGrey);
    for(let l=0;l<7;l++) b.fill(rectMask(12,9,3,4), 10+l*3, 3, l<2 ? C.azure : C.grey);
    b.dput(6,13,19,4,1,3,C.yellow); b.dput(8,13,25,2,1,3,C.white);
    b.g('Arms');
    [[0,4],[15,4]].forEach(([x,y]) => {
      for(let l=0;l<6;l++) b.fill(rectMask(3,3,x,y), 10+l*3, 3, C.grey);
      b.put(x,y,28,3,3,2,C.darkGrey,'plate');
      b.put(x,y,30,1,1,3,C.rock); b.put(x+2,y+2,30,1,1,3,C.rock);
    });
    b.g('TV head');
    for(let l=0;l<6;l++) b.fill(rectMask(11,7,4,6), 31+l*3, 3, varc(R,[C.cream,C.white,'#E2D6BC']));
    b.dput(5,13,33,9,1,12,C.black);
    b.dput(6,13.6,38,3,0.5,3,C.yellow); b.dput(11,13.6,38,3,0.5,3,C.yellow);
    b.dput(7,13.6,34,5,0.5,2,C.darkGrey);
    b.g('Antenna'); b.put(9,6,49,1,1,3,C.darkGrey,'brick'); b.put(9,6,52,1,1,3,C.orange,'brick');
    return { model:b.m, desc:'A cheerful robot with a cream TV head, glowing pixel eyes, chunky claw hands and an antenna, standing on a light grey baseplate.' };
  },

  canal(seed){
    const b = new Builder(seed); const R = b.rng;
    b.g('Baseplate'); b.plate(0,0,48,48,C.green);
    b.g('Canal'); b.fill(rectMask(48,12,0,18), 1, 1, varc(R,[C.water,C.azure]));
    b.fill(rectMask(48,1,0,17), 1, 1, C.tan); b.fill(rectMask(48,1,0,30), 1, 1, C.tan);
    const brickCols = [[C.red,C.darkRed],[C.tan,C.brown],[C.white,C.cream],[C.blue,C.azure]];
    b.g('Canal houses');
    [2,11,20,29].forEach((x, i) => {
      const cols = brickCols[i%4];
      for(let l=0;l<10;l++) b.fill(rectMask(8,10,x,4), 1+l*3, 3, l===0 ? cols[1] : varc(R,cols)());
      b.dput(x+2,14,16,2,1,3,C.white); b.dput(x+5,14,16,2,1,3,C.white);
      b.dput(x+2,14,22,2,1,3,C.white); b.dput(x+5,14,22,2,1,3,C.white);
      b.dput(x+3,14,1,2,1,3,C.darkGrey);
      for(let s=0;s<4;s++){
        const w = 8-2*s; if(w<2) break;
        b.fill(rectMask(w,1,x+s,13), 31+s*3, 3, cols[1]);
      }
    });
    b.g('Clock tower');
    for(let l=0;l<28;l++) b.fill(rectMask(7,7,38,3), 1+l*3, 3, varc(R,[C.cream,C.tan]));
    b.dput(39,10,68,4,1,4,C.white); b.dput(40,10,71,2,1,4,C.black);
    b.fill(rectMask(7,7,38,3), 85, 3, C.tan);
    cone(b, 41.5, 6.5, 88, 4.2, 6, C.green);
    b.g('Canal bridge');
    for(let l=0;l<3;l++) b.fill(rectMask(6,13,20,18), 2+l, 1, l===1 ? C.lightGrey : C.tan);
    b.fill(rectMask(2,13,19,18), 5, 1, C.tan); b.fill(rectMask(2,13,26,18), 5, 1, C.tan);
    b.g('Quay');
    for(let x=2;x<46;x+=6) tree(b, x, 33, 1, 4);
    b.put(6,15,1,2,2,3,C.grey,'brick'); b.put(30,15,1,2,2,3,C.grey,'brick');
    b.g('Canal boats');
    b.put(14,22,2,6,3,2,C.brown,'plate');
    b.put(18,23,4,1,1,4,C.white,'brick'); b.put(16,23,4,1,1,4,C.white,'brick');
    b.fill(ringRectMask(48,48,1), 1, 1, C.green2);
    return { model:b.m, desc:'A canal-side town square with a tall cream clock tower and green spire, four step-gabled canal houses in red, tan, white and blue, a brick bridge over a turquoise canal, boats and a row of pines along the quay.' };
  },

  mosaic(seed){
    const b = new Builder(seed);
    b.g('Backing board'); b.plate(0,0,40,30,C.darkGrey);
    b.g('Mosaic');
    const W = 40, D = 30;
    const col = (x,y) => {
      const sun = Math.hypot(x-11, y-9);
      if(sun < 3.4) return C.yellow;
      if(sun < 4.6) return C.orange;
      if(y < 9) return mixHex(C.azure, C.yellow, 0.15 + y*0.09);
      if(y < 12) return C.orange;
      if(y < 16) return y<14 ? '#C4573F' : '#8E3A46';
      if(y < 19) return C.darkRed;
      if(y < 22) return C.blue;
      return y<26 ? '#1E5AA8' : '#123C74';
    };
    for(let y=0;y<D;y+=2) for(let x=0;x<W;x+=2){
      if(x>25 && x<35 && y>6 && y<26) continue;
      b.put(x,y,1,2,2,1,col(x,y));
    }
    for(let y=10;y<26;y+=2) b.put(28,y,1,2,2,1,C.white);
    for(let y=14;y<20;y+=2) b.put(30,y,1,2,2,1,C.red);
    b.put(28,22,1,2,4,1,C.darkGrey);
    b.put(4,16,1,2,2,1,C.cream); b.put(6,14,1,2,4,1,C.white);
    b.put(8,18,1,1,8,2,C.white);
    return { model:b.m, desc:'A standing brick mosaic of a harbor sunset, where a sailboat drifts past a lighthouse under a wide orange sky, tiled in two-by-two plates.' };
  },

  camper(seed){
    const b = new Builder(seed); const R = b.rng;
    b.g('Beach'); b.plate(0,0,38,24,C.sand);
    b.g('Wheels');
    [[5,2],[5,15],[25,2],[25,15]].forEach(([x,y]) => {
      b.put(x,y,1,4,4,4,C.black,'brick'); b.put(x+1,y+1,5,2,2,1,C.lightGrey,'tile'); });
    b.g('Van body');
    for(let l=0;l<6;l++) b.fill(rectMask(30,14,4,4), 5+l*3, 3, l<2 ? C.white : C.red);
    b.g('Windows'); b.dput(7,18,14,8,1,6,C.azure); b.dput(19,18,14,8,1,6,C.azure);
    b.dput(5,18,8,4,1,6,C.cream); b.dput(34,8,14,1,10,6,C.azure);
    b.g('Roof'); b.fill(rectMask(30,14,4,4), 23, 3, C.white);
    b.g('Roof rack'); b.fill(rectMask(16,10,8,6), 26, 2, C.lightGrey);
    b.g('Surfboard'); b.put(10,7,28,2,8,2,C.yellow); b.put(13,10,28,3,1,2,C.orange);
    b.g('Details');
    b.put(4,4,8,1,1,3,C.yellow,'brick'); b.put(33,4,8,1,1,3,C.yellow,'brick');
    b.put(4,17,8,1,1,3,C.yellow,'brick'); b.put(33,17,8,1,1,3,C.yellow,'brick');
    return { model:b.m, desc:'A chunky 1960s camper van parked on the beach, white over red, with a surfboard on the roof rack, blue windows and four black wheels.' };
  },

  hummingbird(seed){
    const b = new Builder(seed); const R = b.rng;
    b.g('Perch'); b.plate(0,0,22,18,C.green);
    b.g('Body');
    for(let l=0;l<4;l++) b.fill(rectMask(7,9,8,5), 1+l*3, 3, varc(R,['#2E8B84','#3FB6B0','#1F6B66']));
    b.g('Head'); for(let l=0;l<3;l++) b.fill(rectMask(5,5,12,4), 13+l*3, 3, '#2E8B84');
    b.g('Throat'); b.dput(15,8,12,3,1,3,C.red); b.dput(15,8,16,3,1,3,C.pink);
    b.g('Beak'); b.dput(17,5,16,3,1,3,C.black);
    b.g('Wings');
    for(let l=0;l<3;l++) b.fill(rectMask(9,1,4,13-l*2), 1+l*3, 3, '#1F6B66');
    b.fill(rectMask(8,1,6,11), 7, 3, '#4FBDB6');
    b.g('Tail'); for(let l=0;l<3;l++) b.fill(rectMask(6,2,2,7+l), 1+l*3, 3, '#1F6B66');
    b.g('Flowers'); [[17,15],[20,2],[2,2]].forEach(([x,y]) => { b.put(x,y,1,1,1,3,C.pine); b.put(x,y,4,2,2,1,C.red); });
    return { model:b.m, desc:'A ruby-throated hummingbird in mid-hover, built in turquoise and deep green bricks with a red throat patch, beside a small stand of flowers.' };
  }
};

function mixHex(a,b,t){
  const A = hexRgb(a), B = hexRgb(b);
  return '#' + [0,1,2].map(i => clamp(Math.round(A[i]+(B[i]-A[i])*t),0,255).toString(16).padStart(2,'0')).join('');
}

/* ============================ planificateur ============================ */
const SHOWCASE = [
  ['chalet','Alpine Chalet','A cozy two-story alpine chalet with a stone ground floor, log walls, a wide dark red roof and a ring of pine trees on snow.'],
  ['canal','Canal Clock Square','A canal-side town square with a tall clock tower, four step-gabled canal houses, a turquoise canal and boats.'],
  ['robot','Friendly Robot','A cheerful robot with a TV head, glowing pixel eyes and claw hands, standing on a light grey base.'],
  ['lighthouse','Harbor Lighthouse','A red-and-white striped lighthouse on a rocky harbor point, with a keeper\u2019s cottage and a warm lantern room.'],
  ['rocket','Retro Rocket','A 1950s white-and-red rocket on four swept fins, waiting on a striped launch pad.'],
  ['mosaic','Sunset Harbor Mosaic','A standing brick mosaic of a harbor sunset, where a sailboat drifts past a lighthouse.'],
  ['camper','Vintage Camper Van','A chunky 1960s camper van parked on the beach, with a surfboard on the roof.'],
  ['castle','Stone Castle','A stone castle with four round towers with red-cone roofs, a gatehouse, a tall keep and a wide moat.']
];
const SHARED = [
  ['castle','Stone Castle','From Claudie \u00b7 15min ago'],
  ['hummingbird','Ruby-Throated Hummingbird','From Damien \u00b7 2h ago']
];
const KEYWORDS = [
  [/ch[aâ]teau|castle|forteresse|donjon|fortress/i, 'castle'],
  [/chalet|alpin|cabine|cabin|montagne|mountain|ski/i, 'chalet'],
  [/phare|lighthouse|port|harbor|harbour|marin/i, 'lighthouse'],
  [/fus[ée]e|rocket|navette|spatial|espace|space/i, 'rocket'],
  [/robot|andro[iï]de|mecha|automate/i, 'robot'],
  [/canal|place|horloge|clock|square|ville|town|maison|house/i, 'canal'],
  [/mosa[iï]que|mosaic|tableau|affiche|poster|coucher|sunset/i, 'mosaic'],
  [/van|camping|car|camper|surf|plage|beach/i, 'camper'],
  [/colibri|hummingbird|oiseau|bird/i, 'hummingbird']
];
function plan(prompt){
  const p = (prompt||'').trim();
  let key = null;
  for(const [re,k] of KEYWORDS) if(re.test(p)) { key = k; break; }
  let name = null;
  if(!key){
    const h = hash(p.toLowerCase() || 'brick');
    const keys = ['chalet','canal','castle','rocket','lighthouse','camper','robot'];
    key = keys[h % keys.length];
    name = titleFromPrompt(p);
  }
  return { key, name, prompt:p, seed: hash(p.toLowerCase() + '|' + key) };
}
function titleFromPrompt(p){
  const stop = new Set(['the','a','an','avec','with','and','et','de','du','des','le','la','les','un','une','sur','on','dans','of','for','my','me','make','build','construis','fais','moi','je','veux','un','une','qui','that']);
  const w = p.toLowerCase().replace(/[^a-zà-ÿ0-9 ]/gi,' ').split(/\s+/).filter(x => x.length>2 && !stop.has(x));
  if(!w.length) return null;
  return w.slice(0,3).map(x => x[0].toUpperCase()+x.slice(1)).join(' ');
}
const DEFAULT_DESC = {
  castle:'A stone castle with battlemented walls, four round corner towers with red-cone roofs, a gatehouse, a tall keep with a red roof and a wide moat.',
  chalet:'A cozy two-story alpine chalet with a stone ground floor, log walls, a wide dark red roof and a ring of pine trees on snow.',
  lighthouse:'A red-and-white striped lighthouse on a rocky harbor point, with a keeper\u2019s cottage and a warm lantern room.',
  rocket:'A 1950s white-and-red rocket on four swept fins, waiting on a striped launch pad.',
  robot:'A cheerful robot with a TV head, glowing pixel eyes and claw hands, standing on a light grey base.',
  canal:'A canal-side town square with a tall clock tower, four step-gabled canal houses, a turquoise canal and boats.',
  mosaic:'A standing brick mosaic of a harbor sunset, where a sailboat drifts past a lighthouse.',
  camper:'A chunky 1960s camper van parked on the beach, with a surfboard on the roof.',
  hummingbird:'A ruby-throated hummingbird in mid-hover, built in turquoise and deep green bricks with a red throat patch.'
};

/* ============================ rendu ============================ */
const ZK = 0.4;   // une plaque = 0,4 stud de haut ; z est exprimé en plaques
function makeCam(){ return { yaw:38*RAD, pitch:27*RAD, zoom:1, cx:0, cy:0, scale:8 }; }
function camBasis(cam){
  return { c:Math.cos(cam.yaw), s:Math.sin(cam.yaw), cp:Math.cos(cam.pitch), sp:Math.sin(cam.pitch) };
}
function project(cam,B,x,y,z){
  const X = cam.cx + (x*B.c - y*B.s)*cam.scale;
  const Y = cam.cy - (z*ZK*B.cp - (x*B.s + y*B.c)*B.sp)*cam.scale;
  return [X,Y];
}
function depthOf(B,x,y,z){ return (x*B.s + y*B.c)*B.cp + z*ZK*B.sp; }
const LIGHT = (()=>{ const v=[-0.40,-0.62,1.0]; const n=Math.hypot(v[0],v[1],v[2]); return v.map(x=>x/n); })();
function faceShade(nx,ny,nz){
  const dot = nx*LIGHT[0] + ny*LIGHT[1] + nz*LIGHT[2];
  return 0.44 + 0.60*Math.max(0,dot);
}
const FACES = [
  { n:[0,0,1],  v:[[0,0,1],[1,0,1],[1,1,1],[0,1,1]] },
  { n:[0,1,0],  v:[[0,1,0],[0,1,1],[1,1,1],[1,1,0]] },
  { n:[1,0,0],  v:[[1,0,0],[1,0,1],[1,1,1],[1,1,0]] },
  { n:[0,-1,0], v:[[0,0,0],[1,0,0],[1,0,1],[0,0,1]] },
  { n:[-1,0,0], v:[[0,0,0],[0,0,1],[0,1,1],[0,1,0]] },
  { n:[0,0,-1], v:[[0,0,0],[0,1,0],[1,1,0],[1,0,0]] }
];

function fitCamera(cam, W, H, bounds, pad){
  const B = camBasis(cam);
  const pts = [];
  for(const x of [bounds.x0,bounds.x1]) for(const y of [bounds.y0,bounds.y1]) for(const z of [bounds.z0,bounds.z1]){
    const X = (x*B.c - y*B.s), Y = -(z*ZK*B.cp - (x*B.s + y*B.c)*B.sp);
    pts.push([X,Y]);
  }
  let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
  for(const [X,Y] of pts){ x0=Math.min(x0,X); y0=Math.min(y0,Y); x1=Math.max(x1,X); y1=Math.max(y1,Y); }
  const w = Math.max(0.001, x1-x0), h = Math.max(0.001, y1-y0);
  const p = pad || 0.80;
  cam.scale = Math.min(W*p/w, H*p/h);
  cam.cx = W/2 - ((x0+x1)/2)*cam.scale;
  cam.cy = H/2 - ((y0+y1)/2)*cam.scale;
}

function renderScene(ctx, W, H, bricks, cam, opts){
  opts = opts || {};
  const B = camBasis(cam);
  ctx.clearRect(0,0,W,H);
  if(opts.bg){ ctx.fillStyle = opts.bg; ctx.fillRect(0,0,W,H); }
  if(!bricks.length) return;

  // ombre portée : empreinte des volumes AU-DESSUS du socle, projetée au sol puis floutée
  if(opts.shadow !== false && opts.shadowCanvas){
    const sc = opts.shadowCanvas;
    const g2 = sc.getContext('2d');
    g2.save(); g2.setTransform(1,0,0,1,0,0); g2.clearRect(0,0,sc.width,sc.height); g2.restore();
    g2.fillStyle = '#1E2A1E';
    const z0 = cam._z0 || 0;
    for(const b of bricks){
      if(b.z < z0 + 0.5) continue;
      const q = [project(cam,B,b.x,b.y,0), project(cam,B,b.x+b.w,b.y,0), project(cam,B,b.x+b.w,b.y+b.d,0), project(cam,B,b.x,b.y+b.d,0)];
      g2.beginPath(); g2.moveTo(q[0][0],q[0][1]+7);
      for(let i=1;i<4;i++) g2.lineTo(q[i][0],q[i][1]+7);
      g2.closePath(); g2.fill();
    }
    ctx.save(); ctx.globalAlpha = 0.22; ctx.filter = 'blur(12px)';
    ctx.drawImage(sc,0,0,W,H); ctx.restore();
  }

  const hl = opts.highlight || null;
  const list = bricks.map(b => ({ b, d: depthOf(B, b.x+b.w/2, b.y+b.d/2, b.z+b.hp/2) + (b.decal ? 0.4 : 0) }));
  list.sort((p,q) => p.d - q.d);

  for(const {b} of list){
    const hx = b.x, hy = b.y, hz = b.z, hw = b.w, hd = b.d, hh = b.hp;
    const base = hl && hl.has(b) ? '#E1502A' : b.color;
    const drawn = [];
    for(const f of FACES){
      const nd = -(B.cp*(f.n[0]*B.s + f.n[1]*B.c) + f.n[2]*B.sp);
      if(nd >= -1e-6) continue;
      let d = 0;
      const pts = f.v.map(([ux,uy,uz]) => {
        d += depthOf(B, hx+ux*hw, hy+uy*hd, hz+uz*hh);
        return project(cam,B, hx+ux*hw, hy+uy*hd, hz+uz*hh);
      });
      drawn.push({ pts, d: d/4, s: faceShade(f.n[0],f.n[1],f.n[2]), top: f.n[2] === 1 });
    }
    drawn.sort((p,q) => p.d - q.d);
    for(const f of drawn){
      ctx.beginPath();
      ctx.moveTo(f.pts[0][0], f.pts[0][1]);
      for(let i=1;i<4;i++) ctx.lineTo(f.pts[i][0], f.pts[i][1]);
      ctx.closePath();
      ctx.fillStyle = shade(base, f.s);
      ctx.fill();
      ctx.strokeStyle = shade(base, f.s*0.90); ctx.lineWidth = 1; ctx.stroke();
    }
    // tenons : cercle unité transformé par l'affine de projection du plan horizontal
    if(opts.studs !== false && !b.decal && drawn.some(f => f.top)){
      const zTop = hz + hh;
      const sc = cam.scale/64;
      const fillS = shade(base, 1.26), strokeS = shade(base, 0.78);
      for(let j=0;j<hd;j++) for(let i=0;i<hw;i++){
        if(opts.occ && opts.occ.has((hx+i)+','+(hy+j)+','+(hz+hh))) continue;
        const [px,py] = project(cam,B, hx+i+0.5, hy+j+0.5, zTop);
        ctx.save();
        ctx.transform(sc*B.c, sc*B.s*B.sp, -sc*B.s, sc*B.c*B.sp, px, py);
        ctx.beginPath(); ctx.arc(0,0,17.5,0,7);
        ctx.fillStyle = fillS; ctx.fill();
        ctx.strokeStyle = strokeS; ctx.lineWidth = 2.0; ctx.stroke();
        ctx.restore();
      }
    }
  }
}

function renderFit(canvas, model, cam, opts){
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio||1);
  const W = canvas.clientWidth||canvas.width, H = canvas.clientHeight||canvas.height;
  canvas.width = Math.round(W*dpr); canvas.height = Math.round(H*dpr);
  ctx.setTransform(1,0,0,1,0,0); ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.setTransform(dpr,0,0,dpr,0,0);
  const sc = opts && opts.shadowCanvas;
  if(sc){
    sc.width = canvas.width; sc.height = canvas.height;
    const sctx = sc.getContext('2d'); sctx.setTransform(dpr,0,0,dpr,0,0);
  }
  const bd = model.bounds();
  cam._z0 = bd.z0;
  fitCamera(cam, W, H, bd, opts && opts.pad);
  const bricks = (opts && opts.count != null) ? model.bricks.slice(0, opts.count) : model.bricks;
  renderScene(ctx, W, H, bricks, cam, Object.assign({
    bg:null, shadowCanvas: sc, occ: model.occ, studs: opts && opts.studs
  }, opts));
}


    /* ══════════════════════ exécuteur d'ops ══════════════════════
     * La géométrie que l'agent envoie (`ops`) devient un modèle. Chaque lot est
     * posé dans l'ordre du tableau : c'est ce qui rend la pose « en direct »
     * honnête — le panneau ne rejoue pas un script, il exécute les lots reçus. */

    const entier = (v, def) => Math.max(1, Math.round(Number.isFinite(Number(v)) ? Number(v) : def))
    const reel = (v, def) => (Number.isFinite(Number(v)) ? Number(v) : def)
    const teinte = (v, secours) => (typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v.trim()) ? v.trim() : secours)
    const SECOURS = ['#4C9A52', '#9BA3A7', '#C4291C', '#2A6FD6', '#D9C08C', '#7A4E2B', '#F2C31A']
    /** Les ops que le panneau sait poser — un op inconnu est ignoré, sans groupe. */
    const OPS_CONNUES = new Set([
      'rect', 'wall', 'bloc', 'plate', 'dalle', 'disc', 'cylindre', 'ring', 'anneau',
      'cone', 'pyramide', 'pyramid', 'arbre', 'tree', 'brique', 'brick', 'point',
    ])
    /**
     * Clés d'archétype, en français comme en anglais. Une clé non reconnue
     * tombait en silence : `{op:'archetype',cle:'chateau'}` rendait 0 pièce
     * sans que rien ne le dise — le pire des échecs, une maquette vide qui a
     * l'air d'avoir réussi.
     */
    const CLES_ARCHETYPE = {
      chateau: 'castle', castle: 'castle', forteresse: 'castle',
      chalet: 'chalet', cabane: 'chalet', cabin: 'chalet',
      phare: 'lighthouse', lighthouse: 'lighthouse', port: 'lighthouse',
      fusee: 'rocket', rocket: 'rocket', navette: 'rocket',
      robot: 'robot', automate: 'robot',
      place: 'canal', canal: 'canal', horloge: 'canal', clock: 'canal', ville: 'canal',
      mosaique: 'mosaic', mosaic: 'mosaic', tableau: 'mosaic',
      van: 'camper', camper: 'camper', camping: 'camper', plage: 'camper',
      colibri: 'hummingbird', hummingbird: 'hummingbird', oiseau: 'hummingbird',
    }
    /** Résout une clé (française ou anglaise) vers un générateur, ou null. */
    const archetypeDe = (cle) => {
      const k = String(cle === undefined || cle === null ? '' : cle).toLowerCase().trim()
      const canonique = CLES_ARCHETYPE[k] || k
      return typeof BUILDERS[canonique] === 'function' ? { canonique: canonique, fabrique: BUILDERS[canonique] } : null
    }

    /** Verse un modèle déjà construit dans un Builder (archetype posé comme un lot). */
    function fusionner (dest, modele) {
      for (const k of modele.occ) dest.m.occ.add(k)
      for (const b of modele.bricks) {
        dest.m.bricks.push(b)
        if (b.group && !dest.m.groups.includes(b.group)) dest.m.groups.push(b.group)
      }
    }

    function executerOps (ops, builder) {
      const liste = Array.isArray(ops) ? ops : []
      let lots = 0
      for (const o of liste) {
        if (!o || typeof o !== 'object') continue
        const g = String(o.group || o.lot || o.op || 'lot')
        const col = teinte(o.color, SECOURS[lots % SECOURS.length])
        const op = String(o.op || '')
        if (op === 'archetype' || op === 'modele') {
          const a = archetypeDe(o.cle || o.key)
          if (a !== null) fusionner(builder, a.fabrique(hash(a.canonique + '|' + String(o.seed ?? 0))).model)
          lots++
          continue
        }
        // Un op inconnu est ignoré SANS créer de groupe : le nombre de
        // sub-builds affiché doit rester celui des lots réellement posés.
        if (!OPS_CONNUES.has(op)) continue
        builder.g(g)
        switch (op) {
          case 'rect': case 'wall': case 'bloc':
            builder.fill(rectMask(entier(o.w, 2), entier(o.d, 2), Math.round(reel(o.x, 0)), Math.round(reel(o.y, 0))),
              Math.round(reel(o.z, 0)), entier(o.h, 3), col)
            break
          case 'plate': case 'dalle':
            builder.fill(rectMask(entier(o.w, 2), entier(o.d, 2), Math.round(reel(o.x, 0)), Math.round(reel(o.y, 0))),
              Math.round(reel(o.z, 0)), entier(o.h, 1), col)
            break
          case 'disc': case 'cylindre':
            builder.fill(discMask(reel(o.cx, 0), reel(o.cy, 0), Math.max(0.6, reel(o.r, 3))),
              Math.round(reel(o.z, 0)), entier(o.h, 3), col)
            break
          case 'ring': case 'anneau':
            builder.fill(ringDiscMask(reel(o.cx, 0), reel(o.cy, 0), Math.max(0.6, reel(o.r, 4)), Math.max(0.6, reel(o.t, 2))),
              Math.round(reel(o.z, 0)), entier(o.h, 3), col)
            break
          case 'cone':
            cone(builder, reel(o.cx, 0), reel(o.cy, 0), Math.round(reel(o.z, 0)), Math.max(1, reel(o.r, 4)),
              entier(o.niveaux ?? o.n, 5), col)
            break
          case 'pyramide': case 'pyramid':
            pyramid(builder, Math.round(reel(o.x, 0)), Math.round(reel(o.y, 0)), Math.round(reel(o.z, 0)),
              entier(o.w, 8), entier(o.d, 8), entier(o.niveaux ?? o.n, 4), col)
            break
          case 'arbre': case 'tree':
            tree(builder, Math.round(reel(o.x, 0)), Math.round(reel(o.y, 0)), Math.round(reel(o.z, 1)), entier(o.h, 4))
            break
          case 'brique': case 'brick': case 'point':
            builder.put(Math.round(reel(o.x, 0)), Math.round(reel(o.y, 0)), Math.round(reel(o.z, 0)),
              entier(o.w, 2), entier(o.d, 4), entier(o.h, 3), col)
            break
        }
        lots++
      }
      return lots
    }

    // Un enregistrement reçu de l'hôte tient en un modèle et ce qu'il faut afficher.
    function construire (etat) {
      if (Array.isArray(etat.ops) && etat.ops.length > 0) {
        const b = new Builder(hash(String(etat.sessionId || '') + '|' + String(etat.version)))
        const lots = executerOps(etat.ops, b)
        return { model: b.m, lots, source: 'ops', desc: etat.prompt || '' }
      }
      const pl = plan(etat.prompt || '')
      const cle = typeof BUILDERS[etat.cle] === 'function' ? etat.cle : pl.key
      const built = BUILDERS[cle](hash(cle + '|0'))
      const titreConnu = (SHOWCASE.find((s) => s[0] === cle) || [])[1]
      return {
        model: built.model,
        lots: built.model.groups.length,
        source: 'archetype',
        cle,
        desc: built.desc || DEFAULT_DESC[cle] || '',
        titre: etat.titre && etat.titre !== 'Briques' ? etat.titre : (titreConnu || pl.name || 'Briques'),
      }
    }

    /* ══════════════════════ état partagé ══════════════════════
     * Le canevas est dessiné par une boucle rAF unique, PAS par React : un
     * modèle de 2 700 briques redessiné à chaque rendu React ferait tomber le
     * panneau. React ne rend que le chrome (titre, compteurs, transport). */

    const abonnes = new Set()
    let ETAT = { titre: 'Briques', version: -1, sessionId: '', total: 0, pose: 0, lots: 0, enCours: false, desc: '', source: '', cle: null, prompt: '', dureeMs: 0 }
    let MODELE = null
    let POSE = 0, POSE_MIN = 0, T0 = 0, DUREE = 8000, VITESSE = 1, EN_COURS = false
    const OUVERTURES_VUES = new Map() // sessionId → last reopen counter read (each session counts its own)
    let VERSION_VUE = -1, SESSION_VUE = ''
    let SESSION_ID = ''
    let SERVICE_SIDEBAR = null
    let CTX = null
    const CANEVAS = { el: null, cam: null, ombre: null, spin: false }

    function publier (patch) {
      ETAT = Object.assign({}, ETAT, patch)
      for (const f of Array.from(abonnes)) { try { f() } catch { /* un abonné mort ne casse pas la boucle */ } }
    }

    function poser () {
      const total = MODELE ? MODELE.bricks.length : 0
      if (!total || !EN_COURS) return
      const ecoule = (performance.now() - T0) * VITESSE
      const part = DUREE <= 0 ? 1 : Math.max(0, Math.min(1, ecoule / DUREE))
      POSE = Math.min(total, Math.round(POSE_MIN + (total - POSE_MIN) * part))
      if (part >= 1) EN_COURS = false
    }

    function dessiner () {
      const el = CANEVAS.el
      if (!el || !MODELE) return
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const W = el.clientWidth || 320
      const H = el.clientHeight || 220
      if (el.width !== Math.round(W * dpr) || el.height !== Math.round(H * dpr)) {
        el.width = Math.round(W * dpr)
        el.height = Math.round(H * dpr)
      }
      const ctx = el.getContext('2d')
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const sc = CANEVAS.ombre
      if (sc) {
        if (sc.width !== el.width || sc.height !== el.height) { sc.width = el.width; sc.height = el.height }
        sc.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0)
      }
      const cam = CANEVAS.cam || (CANEVAS.cam = makeCam())
      const bd = MODELE.bounds()
      cam._z0 = bd.z0
      fitCamera(cam, W, H, bd, 0.86)
      renderScene(ctx, W, H, MODELE.bricks.slice(0, Math.max(1, POSE)), cam, {
        bg: '#f7f6f3',
        shadowCanvas: sc,
        occ: MODELE.occ,
        studs: !EN_COURS && (POSE < 1400),
      })
    }

    let RAF = 0
    let dernierPub = 0
    function boucle () {
      RAF = 0
      const anime = EN_COURS || CANEVAS.spin
      if (CANEVAS.spin && CANEVAS.cam) CANEVAS.cam.yaw += 0.005
      poser()
      if (CANEVAS.el) dessiner()
      const t = performance.now()
      if (t - dernierPub > 100) {
        dernierPub = t
        publier({ pose: POSE, enCours: EN_COURS, total: MODELE ? MODELE.bricks.length : 0 })
      }
      if (anime) RAF = requestAnimationFrame(boucle)
    }
    function reveiller () { if (!RAF) RAF = requestAnimationFrame(boucle) }

    /* ══════════════════════ hôte → panneau ══════════════════════ */

    function ouvrirOnglet () {
      // `sidebarRight` est lu À L'APPEL, pas au montage : c'est un service du
      // même paquet que `sidebarRightTabs`, mais on ne le déclare pas en inject
      // — un service manquant laisserait la fibre « pending » pour toujours, et
      // le panneau, le bouton de pied et la sonde tomberaient avec lui.
      if (CTX !== null && SERVICE_SIDEBAR === null) {
        try { SERVICE_SIDEBAR = CTX.get('sidebarRight') } catch { SERVICE_SIDEBAR = null }
      }
      if (!SERVICE_SIDEBAR || typeof SERVICE_SIDEBAR.openTab !== 'function') return
      try { SERVICE_SIDEBAR.openTab(KIND, {}) } catch (e) { /* pas de session montée : le bouton du pied reste */ }
    }

    function appliquer (etat) {
      const autre = etat.sessionId !== SESSION_VUE
      const remplace = etat.mode === 'nouveau' || MODELE === null || autre
      if (remplace) {
        const c = construire(etat)
        MODELE = c.model
        POSE_MIN = 0
        POSE = 0
        publier({
          titre: c.titre || etat.titre || 'Briques',
          desc: c.desc || etat.prompt || '',
          source: c.source,
          lots: c.lots,
          cle: c.cle || etat.cle || null,
          prompt: etat.prompt || '',
        })
      } else {
        const avant = MODELE.bricks.length
        const b = new Builder(hash(String(etat.sessionId) + '|' + String(etat.version)))
        b.m = MODELE
        executerOps(etat.ops, b)
        POSE_MIN = avant
        POSE = avant
      }
      VERSION_VUE = etat.version
      SESSION_VUE = etat.sessionId
      DUREE = Math.max(300, Number(etat.dureeMs) || 8000)
      DUREE_BUILD = DUREE
      const retard = Math.max(0, Date.now() - (Number(etat.t0) || Date.now()))
      T0 = performance.now() - Math.min(DUREE * 0.9, retard)
      VITESSE = 1
      EN_COURS = true
      publier({
        version: etat.version,
        sessionId: etat.sessionId,
        enCours: true,
        total: MODELE.bricks.length,
        pose: POSE,
        dureeMs: DUREE,
        desc: etat.prompt || ETAT.desc,
      })
      ouvrirOnglet()
      reveiller()
    }
    let DUREE_BUILD = 8000

    let enPanne = false
    async function interroger () {
      try {
        const url = ROUTE_STATE + (SESSION_ID ? '?session=' + encodeURIComponent(SESSION_ID) : '')
        const r = await fetch(url, { cache: 'no-store' })
        if (!r.ok) return
        const etat = await r.json()
        if (!etat || etat.vide) return
        enPanne = false
        // The agent asked to reopen the panel on the model it already has: open the tab, rebuild nothing. The first
        // reading only records the counter, so reloading the page does not pop the tab open for an old request.
        if (Number.isFinite(etat.ouverture)) {
          const vue = OUVERTURES_VUES.get(etat.sessionId)
          OUVERTURES_VUES.set(etat.sessionId, etat.ouverture)
          if (vue !== undefined && etat.ouverture > vue) ouvrirOnglet()
        }
        if (etat.version === VERSION_VUE && etat.sessionId === SESSION_VUE) return
        appliquer(etat)
      } catch (e) {
        if (!enPanne) { enPanne = true; publier({ desc: 'hôte injoignable — ' + String(e?.message ?? e) }) }
      }
    }

    /* ══════════════════════ le panneau ══════════════════════ */

    function Apercu ({ cle }) {
      return h('button', {
        className: 'kbb-chip',
        onClick: () => {
          fetch('/kybernos-bricks/push', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: SESSION_ID, cle, titre: (SHOWCASE.find((s) => s[0] === cle) || [])[1], duree_ms: 9000 }),
          }).catch(() => {})
        },
      }, (SHOWCASE.find((s) => s[0] === cle) || [])[1] || cle)
    }

    function PanneauBriques (props) {
      const [, maj] = React.useReducer((x) => x + 1, 0)
      const cvRef = React.useRef(null)
      const glisse = React.useRef(null)
      const [vue, setVue] = React.useState('iso')

      React.useEffect(() => {
        const id = props && (props.sessionId || props.session)
        if (typeof id === 'string' && id.length > 0 && id !== SESSION_ID) { SESSION_ID = id; VERSION_VUE = -1 }
      }, [props])

      React.useEffect(() => {
        const f = () => maj()
        abonnes.add(f)
        return () => { abonnes.delete(f) }
      }, [])

      React.useEffect(() => {
        const el = cvRef.current
        CANEVAS.el = el
        if (!CANEVAS.ombre) CANEVAS.ombre = document.createElement('canvas')
        if (el) {
          el.style.touchAction = 'none'
          const roue = (e) => {
            e.preventDefault()
            const cam = CANEVAS.cam || (CANEVAS.cam = makeCam())
            cam.zoom = Math.max(0.35, Math.min(3, cam.zoom * (e.deltaY > 0 ? 0.92 : 1.08)))
            reveiller()
          }
          el.addEventListener('wheel', roue, { passive: false })
          reveiller()
          const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => reveiller()) : null
          if (ro) ro.observe(el)
          return () => {
            el.removeEventListener('wheel', roue)
            if (ro) ro.disconnect()
            CANEVAS.el = null
          }
        }
        return () => { CANEVAS.el = null }
      }, [])

      const vueCam = (v) => {
        setVue(v)
        const cam = CANEVAS.cam || (CANEVAS.cam = makeCam())
        cam.yaw = (v === 'iso' ? 38 : v === 'front' ? 0 : 0) * RAD
        cam.pitch = (v === 'iso' ? 27 : v === 'front' ? 0 : 84) * RAD
        reveiller()
      }

      const onDown = (e) => {
        glisse.current = { x: e.clientX, y: e.clientY }
        try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* pas de capture : le clic reste utilisable */ }
        maj()
      }
      const onMove = (e) => {
        const g = glisse.current
        if (!g) return
        const cam = CANEVAS.cam || (CANEVAS.cam = makeCam())
        cam.yaw += (e.clientX - g.x) * 0.006
        cam.pitch = Math.max(0, Math.min(1.5, cam.pitch - (e.clientY - g.y) * 0.005))
        glisse.current = { x: e.clientX, y: e.clientY }
        reveiller()
      }
      const onUp = () => { glisse.current = null; maj() }

      const total = ETAT.total || 0
      const pose = Math.min(total, ETAT.pose || 0)
      const pct = total ? Math.round((100 * pose) / total) : 0

      const barre = h('div', { className: 'kbb-foot' },
        h('div', { className: 'kbb-line' },
          h('button', { className: 'kbb-step', title: 'Début', onClick: () => { POSE = 0; EN_COURS = false; publier({ pose: 0, enCours: false }); reveiller() } }, '\u25C0\u25C0'),
          h('button', {
            className: 'kbb-play',
            title: EN_COURS ? 'Pause' : 'Relire',
            onClick: () => {
              if (EN_COURS) { EN_COURS = false; publier({ enCours: false }); reveiller(); return }
              POSE_MIN = 0; POSE = 0; T0 = performance.now(); DUREE = DUREE_BUILD; EN_COURS = true
              publier({ enCours: true }); reveiller()
            },
          }, EN_COURS ? '\u23F8' : '\u25B6'),
          h('button', { className: 'kbb-step', title: 'Fin', onClick: () => { POSE = total; EN_COURS = false; publier({ pose: total, enCours: false }); reveiller() } }, '\u25B6\u25B6'),
          h('button', { className: 'kbb-sp' + (VITESSE === 0.5 ? ' on' : ''), onClick: () => { VITESSE = 0.5; maj() } }, '0.5\u00D7'),
          h('button', { className: 'kbb-sp' + (VITESSE === 1 ? ' on' : ''), onClick: () => { VITESSE = 1; maj() } }, '1\u00D7'),
          h('button', { className: 'kbb-sp' + (VITESSE === 2 ? ' on' : ''), onClick: () => { VITESSE = 2; maj() } }, '2\u00D7'),
          h('button', { className: 'kbb-sp' + (VITESSE === 4 ? ' on' : ''), onClick: () => { VITESSE = 4; maj() } }, '4\u00D7'),
          h('span', { className: 'kbb-badge' + (EN_COURS ? ' run' : '') }, total ? (EN_COURS ? pct + ' %' : 'Fini') : '\u2014'),
        ),
        h('div', { className: 'kbb-track', style: { marginTop: '7px' } },
          h('div', { className: 'kbb-lab' },
            h('b', {}, pose.toLocaleString('fr-FR')),
            ' / ' + total.toLocaleString('fr-FR') + ' pi\u00E8ces \u00B7 ' + (ETAT.lots || 0) + ' lots'),
          h('input', {
            className: 'kbb-range', type: 'range', min: 0, max: Math.max(1, total), value: pose,
            onChange: (e) => { POSE = Number(e.target.value); EN_COURS = false; publier({ pose: POSE, enCours: false }); reveiller() },
          })),
        ETAT.desc ? h('div', { className: 'kbb-note', title: ETAT.desc }, ETAT.desc) : null,
      )

      const vide = h('div', { className: 'kbb-empty' },
        h('div', {}, h('b', {}, 'Aucune maquette pour le moment')),
        h('div', {}, 'Demande au chat : ', h('code', {}, 'construis un château en briques')),
        h('div', { className: 'kbb-chips' }, ...SHOWCASE.map(([cle]) => h(Apercu, { key: cle, cle }))),
      )

      return h('div', { className: 'kbb-root' },
        h('div', { className: 'kbb-head' },
          h('span', { className: 'kbb-title', title: ETAT.titre }, ETAT.titre || 'Briques'),
          h('span', { className: 'kbb-badge' }, ETAT.source === 'ops' ? 'ops' : (ETAT.cle || 'arch\u00E9type'))),
        h('div', { className: 'kbb-view' },
          h('canvas', {
            ref: cvRef,
            className: glisse.current ? 'kbb-drag' : '',
            onPointerDown: onDown, onPointerMove: onMove, onPointerUp: onUp, onPointerCancel: onUp,
          }),
          !total ? vide : null,
          total ? h('div', { className: 'kbb-tools' },
            h('button', { className: 'kbb-tool' + (vue === 'iso' ? ' on' : ''), onClick: () => vueCam('iso') }, '3/4'),
            h('button', { className: 'kbb-tool' + (vue === 'front' ? ' on' : ''), onClick: () => vueCam('front') }, 'Front'),
            h('button', { className: 'kbb-tool' + (vue === 'top' ? ' on' : ''), onClick: () => vueCam('top') }, 'Top'),
            h('button', {
              className: 'kbb-tool' + (CANEVAS.spin ? ' on' : ''),
              onClick: (e) => { CANEVAS.spin = !CANEVAS.spin; e.currentTarget.classList.toggle('on', CANEVAS.spin); reveiller() },
            }, 'Spin')) : null),
        barre,
      )
    }

    /* ══════════════════════ montage ══════════════════════ */

    function apply (ctx) {
      CTX = ctx
      ctx.effect(() => {
        if (document.getElementById(STYLE_ID) === null) {
          const s = document.createElement('style')
          s.id = STYLE_ID
          s.textContent = CSS
          document.head.appendChild(s)
        }
      }, 'kybernos-bricks: styles')

      try { SERVICE_SIDEBAR = ctx.get('sidebarRight') } catch { SERVICE_SIDEBAR = null }
      try {
        const ui = ctx.get('uiSession')
        const cle = ui && ui.adapter && ui.adapter.current ? ui.adapter.current.getSnapshot().key : ''
        if (typeof cle === 'string' && cle.length > 0) SESSION_ID = cle
      } catch { /* la route retombe sur la dernière maquette déposée */ }

      let registre = null
      try { registre = ctx.get('sidebarRightTabs') } catch { registre = null }
      if (registre && typeof registre.register === 'function') {
        ctx.effect(() => registre.register({
          id: TYPE_ID,
          kind: KIND,
          title: () => 'Briques',
          guide: [{ title: () => 'Briques', description: () => 'Maquettes en briques pilotées par le chat : pose en direct brique par brique, puis relecture.' }],
        }), 'kybernos-bricks: type d onglet barre latérale droite')
      }

      ctx.effect(() => ctx.slots.inject(SLOT, () => ctx.slots.register(
        { name: SLOT, key: TYPE_ID }, PanneauBriques)), 'kybernos-bricks: corps de panneau')

      // Le panneau s'ouvre TOUT SEUL quand une maquette arrive (voir `ouvrirOnglet`).
      // Aucun bouton dans le pied de la sidebar : il y traînait un « ▦ Briques »
      // permanent, et le type d'onglet est déjà offert par le sélecteur de la
      // barre latérale droite — un raccourci de secours ne valait pas un meuble
      // de plus dans le menu principal.

      ctx.effect(() => {
        interroger()
        const t = setInterval(interroger, CADENCE_MS)
        return () => clearInterval(t)
      }, 'kybernos-bricks: sonde de l hote')
    }

    return {
      // `sidebarRightTabs` DOIT être déclaré : il est fourni par
      // ui-sidebar-right, et sans cette déclaration notre `apply` tournerait
      // AVANT le provide — le registre serait undefined et le type d'onglet ne
      // s'enregistrerait jamais (leçon payée par dsh-db-viewer, même trou).
      inject: ['slots', 'sidebarRightTabs'],
      apply,
      // Surface de test : le harnais monte le moteur et l'exécuteur d'ops sans
      // navigateur — aucun rendu React n'est nécessaire pour les vérifier.
      __test: { executerOps, construire, plan, BUILDERS, renderScene, fitCamera, makeCam, Builder, hash, SHOWCASE },
    }
  }
})
