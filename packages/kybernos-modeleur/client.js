// ═══════════════════════════════════════════════════════════════════════════
// kybernos-modeleur — moitié CLIENT.
//
// Le panneau « Modeleur » de la barre latérale DROITE : un canevas qui pose
// les objets en direct, puis les relit — en 2D (dessin à l'échelle) comme en
// 3D (solides orbitables).
//
//   chat (outil `modeliser`)  →  route /kybernos-modeleur/state  →  ce panneau
//
// QUATRE PARTIES DANS CE FICHIER :
//   1. le MOTEUR 2D : ops normalisées, bornes, transformations, dessin ;
//   2. le MOTEUR 3D : primitives → facettes, projection, tri du peintre ;
//   3. l'EXÉCUTEUR D'OPS : la géométrie que l'agent envoie devient un modèle ;
//   4. le PANNEAU : onglet de la barre latérale droite + horloge de pose.
//
// La pose est calée sur `t0`/`dureeMs` de l'hôte : le panneau ne « joue » pas
// une animation locale, il rattrape une horloge qui a démarré au clic du chat.
// Canvas 2D partout, zéro dépendance : pas de CDN, pas de node_modules.
// ═══════════════════════════════════════════════════════════════════════════

window.__ModuleLoader__.load({
  id: '@local/kybernos-modeleur/client',
  factory (require) {
    const React = require('react')
    const h = React.createElement

    const TYPE_ID = 'kybernos-modeleur'
    const KIND = 'kybernos-modeleur'
    const SLOT = 'sidebar.right.pane.tab'
    const STYLE_ID = 'kybernos-modeleur-styles'
    const ROUTE_STATE = '/kybernos-modeleur/state'
    const ROUTE_PUSH = '/kybernos-modeleur/push'
    const ROUTE_ANNOTE = '/kybernos-modeleur/annote'
    /* ── vendor: perfect-freehand 1.2.2 (MIT, © Steve Ruiz) — getStroke ── */
    const LIB_PF = (() => {
function $(e,t,s,x=h=>h){return e*x(.5-t*(.5-s))}function ce(e){return[-e[0],-e[1]]}function l(e,t){return[e[0]+t[0],e[1]+t[1]]}function a(e,t){return[e[0]-t[0],e[1]-t[1]]}function b(e,t){return[e[0]*t,e[1]*t]}function xe(e,t){return[e[0]/t,e[1]/t]}function R(e){return[e[1],-e[0]]}function B(e,t){return e[0]*t[0]+e[1]*t[1]}function me(e,t){return e[0]===t[0]&&e[1]===t[1]}function Se(e){return Math.hypot(e[0],e[1])}function Pe(e){return e[0]*e[0]+e[1]*e[1]}function A(e,t){return Pe(a(e,t))}function G(e){return xe(e,Se(e))}function ae(e,t){return Math.hypot(e[1]-t[1],e[0]-t[0])}function L(e,t,s){let x=Math.sin(s),h=Math.cos(s),y=e[0]-t[0],n=e[1]-t[1],f=y*h-n*x,d=y*x+n*h;return[f+t[0],d+t[1]]}function K(e,t,s){return l(e,b(a(t,e),s))}function ee(e,t,s){return l(e,b(t,s))}var{min:C,PI:ke}=Math,le=.275,V=ke+1e-4;function te(e,t={}){let{size:s=16,smoothing:x=.5,thinning:h=.5,simulatePressure:y=!0,easing:n=r=>r,start:f={},end:d={},last:D=!1}=t,{cap:S=!0,easing:j=r=>r*(2-r)}=f,{cap:q=!0,easing:c=r=>--r*r*r+1}=d;if(e.length===0||s<=0)return[];let p=e[e.length-1].runningLength,g=f.taper===!1?0:f.taper===!0?Math.max(s,p):f.taper,T=d.taper===!1?0:d.taper===!0?Math.max(s,p):d.taper,oe=Math.pow(s*x,2),_=[],M=[],H=e.slice(0,10).reduce((r,i)=>{let o=i.pressure;if(y){let u=C(1,i.distance/s),W=C(1,1-u);o=C(1,r+(W-r)*(u*le))}return(r+o)/2},e[0].pressure),m=$(s,h,e[e.length-1].pressure,n),U,X=e[0].vector,z=e[0].point,F=z,O=z,E=F,J=!1;for(let r=0;r<e.length;r++){let{pressure:i}=e[r],{point:o,vector:u,distance:W,runningLength:I}=e[r];if(r<e.length-1&&p-I<3)continue;if(h){if(y){let v=C(1,W/s),Z=C(1,1-v);i=C(1,H+(Z-H)*(v*le))}m=$(s,h,i,n)}else m=s/2;U===void 0&&(U=m);let fe=I<g?j(I/g):1,be=p-I<T?c((p-I)/T):1;m=Math.max(.01,m*Math.min(fe,be));let se=(r<e.length-1?e[r+1]:e[r]).vector,Y=r<e.length-1?B(u,se):1,he=B(u,X)<0&&!J,ue=Y!==null&&Y<0;if(he||ue){let v=b(R(X),m);for(let Z=1/13,w=0;w<=1;w+=Z)O=L(a(o,v),o,V*w),_.push(O),E=L(l(o,v),o,V*-w),M.push(E);z=O,F=E,ue&&(J=!0);continue}if(J=!1,r===e.length-1){let v=b(R(u),m);_.push(a(o,v)),M.push(l(o,v));continue}let ie=b(R(K(se,u,Y)),m);O=a(o,ie),(r<=1||A(z,O)>oe)&&(_.push(O),z=O),E=l(o,ie),(r<=1||A(F,E)>oe)&&(M.push(E),F=E),H=i,X=u}let P=e[0].point.slice(0,2),k=e.length>1?e[e.length-1].point.slice(0,2):l(e[0].point,[1,1]),Q=[],N=[];if(e.length===1){if(!(g||T)||D){let r=ee(P,G(R(a(P,k))),-(U||m)),i=[];for(let o=1/13,u=o;u<=1;u+=o)i.push(L(r,P,V*2*u));return i}}else{if(!(g||T&&e.length===1))if(S)for(let i=1/13,o=i;o<=1;o+=i){let u=L(M[0],P,V*o);Q.push(u)}else{let i=a(_[0],M[0]),o=b(i,.5),u=b(i,.51);Q.push(a(P,o),a(P,u),l(P,u),l(P,o))}let r=R(ce(e[e.length-1].vector));if(T||g&&e.length===1)N.push(k);else if(q){let i=ee(k,r,m);for(let o=1/29,u=o;u<1;u+=o)N.push(L(i,k,V*3*u))}else N.push(l(k,b(r,m)),l(k,b(r,m*.99)),a(k,b(r,m*.99)),a(k,b(r,m)))}return _.concat(N,M.reverse(),Q)}function re(e,t={}){var q;let{streamline:s=.5,size:x=16,last:h=!1}=t;if(e.length===0)return[];let y=.15+(1-s)*.85,n=Array.isArray(e[0])?e:e.map(({x:c,y:p,pressure:g=.5})=>[c,p,g]);if(n.length===2){let c=n[1];n=n.slice(0,-1);for(let p=1;p<5;p++)n.push(K(n[0],c,p/4))}n.length===1&&(n=[...n,[...l(n[0],[1,1]),...n[0].slice(2)]]);let f=[{point:[n[0][0],n[0][1]],pressure:n[0][2]>=0?n[0][2]:.25,vector:[1,1],distance:0,runningLength:0}],d=!1,D=0,S=f[0],j=n.length-1;for(let c=1;c<n.length;c++){let p=h&&c===j?n[c].slice(0,2):K(S.point,n[c],y);if(me(S.point,p))continue;let g=ae(p,S.point);if(D+=g,c<j&&!d){if(D<x)continue;d=!0}S={point:p,pressure:n[c][2]>=0?n[c][2]:.5,vector:G(a(S.point,p)),distance:g,runningLength:D},f.push(S)}return f[0].vector=((q=f[1])==null?void 0:q.vector)||[0,0],f}function ne(e,t={}){return te(re(e,t),t)}var ve=ne;

      return { getStroke: ne }
    })()
    /* ── vendor: roughjs 4.6.6 (MIT, © Preet Shihn) — roughness canvas ── */
    const LIB_ROUGH = (() => {
function t(t,e,s){if(t&&t.length){const[n,o]=e,a=Math.PI/180*s,h=Math.cos(a),r=Math.sin(a);for(const e of t){const[t,s]=e;e[0]=(t-n)*h-(s-o)*r+n,e[1]=(t-n)*r+(s-o)*h+o}}}function e(t,e){return t[0]===e[0]&&t[1]===e[1]}function s(s,n,o,a=1){const h=o,r=Math.max(n,.1),i=s[0]&&s[0][0]&&"number"==typeof s[0][0]?[s]:s,c=[0,0];if(h)for(const e of i)t(e,c,h);const l=function(t,s,n){const o=[];for(const s of t){const t=[...s];e(t[0],t[t.length-1])||t.push([t[0][0],t[0][1]]),t.length>2&&o.push(t)}const a=[];s=Math.max(s,.1);const h=[];for(const t of o)for(let e=0;e<t.length-1;e++){const s=t[e],n=t[e+1];if(s[1]!==n[1]){const t=Math.min(s[1],n[1]);h.push({ymin:t,ymax:Math.max(s[1],n[1]),x:t===s[1]?s[0]:n[0],islope:(n[0]-s[0])/(n[1]-s[1])})}}if(h.sort(((t,e)=>t.ymin<e.ymin?-1:t.ymin>e.ymin?1:t.x<e.x?-1:t.x>e.x?1:t.ymax===e.ymax?0:(t.ymax-e.ymax)/Math.abs(t.ymax-e.ymax))),!h.length)return a;let r=[],i=h[0].ymin,c=0;for(;r.length||h.length;){if(h.length){let t=-1;for(let e=0;e<h.length&&!(h[e].ymin>i);e++)t=e;h.splice(0,t+1).forEach((t=>{r.push({s:i,edge:t})}))}if(r=r.filter((t=>!(t.edge.ymax<=i))),r.sort(((t,e)=>t.edge.x===e.edge.x?0:(t.edge.x-e.edge.x)/Math.abs(t.edge.x-e.edge.x))),(1!==n||c%s==0)&&r.length>1)for(let t=0;t<r.length;t+=2){const e=t+1;if(e>=r.length)break;const s=r[t].edge,n=r[e].edge;a.push([[Math.round(s.x),i],[Math.round(n.x),i]])}i+=n,r.forEach((t=>{t.edge.x=t.edge.x+n*t.edge.islope})),c++}return a}(i,r,a);if(h){for(const e of i)t(e,c,-h);!function(e,s,n){const o=[];e.forEach((t=>o.push(...t))),t(o,s,n)}(l,c,-h)}return l}function n(t,e){var n;const o=e.hachureAngle+90;let a=e.hachureGap;a<0&&(a=4*e.strokeWidth),a=Math.round(Math.max(a,.1));let h=1;return e.roughness>=1&&((null===(n=e.randomizer)||void 0===n?void 0:n.next())||Math.random())>.7&&(h=a),s(t,a,o,h||1)}class o{constructor(t){this.helper=t}fillPolygons(t,e){return this._fillPolygons(t,e)}_fillPolygons(t,e){const s=n(t,e);return{type:"fillSketch",ops:this.renderLines(s,e)}}renderLines(t,e){const s=[];for(const n of t)s.push(...this.helper.doubleLineOps(n[0][0],n[0][1],n[1][0],n[1][1],e));return s}}function a(t){const e=t[0],s=t[1];return Math.sqrt(Math.pow(e[0]-s[0],2)+Math.pow(e[1]-s[1],2))}class h extends o{fillPolygons(t,e){let s=e.hachureGap;s<0&&(s=4*e.strokeWidth),s=Math.max(s,.1);const o=n(t,Object.assign({},e,{hachureGap:s})),h=Math.PI/180*e.hachureAngle,r=[],i=.5*s*Math.cos(h),c=.5*s*Math.sin(h);for(const[t,e]of o)a([t,e])&&r.push([[t[0]-i,t[1]+c],[...e]],[[t[0]+i,t[1]-c],[...e]]);return{type:"fillSketch",ops:this.renderLines(r,e)}}}class r extends o{fillPolygons(t,e){const s=this._fillPolygons(t,e),n=Object.assign({},e,{hachureAngle:e.hachureAngle+90}),o=this._fillPolygons(t,n);return s.ops=s.ops.concat(o.ops),s}}class i{constructor(t){this.helper=t}fillPolygons(t,e){const s=n(t,e=Object.assign({},e,{hachureAngle:0}));return this.dotsOnLines(s,e)}dotsOnLines(t,e){const s=[];let n=e.hachureGap;n<0&&(n=4*e.strokeWidth),n=Math.max(n,.1);let o=e.fillWeight;o<0&&(o=e.strokeWidth/2);const h=n/4;for(const r of t){const t=a(r),i=t/n,c=Math.ceil(i)-1,l=t-c*n,u=(r[0][0]+r[1][0])/2-n/4,p=Math.min(r[0][1],r[1][1]);for(let t=0;t<c;t++){const a=p+l+t*n,r=u-h+2*Math.random()*h,i=a-h+2*Math.random()*h,c=this.helper.ellipse(r,i,o,o,e);s.push(...c.ops)}}return{type:"fillSketch",ops:s}}}class c{constructor(t){this.helper=t}fillPolygons(t,e){const s=n(t,e);return{type:"fillSketch",ops:this.dashedLine(s,e)}}dashedLine(t,e){const s=e.dashOffset<0?e.hachureGap<0?4*e.strokeWidth:e.hachureGap:e.dashOffset,n=e.dashGap<0?e.hachureGap<0?4*e.strokeWidth:e.hachureGap:e.dashGap,o=[];return t.forEach((t=>{const h=a(t),r=Math.floor(h/(s+n)),i=(h+n-r*(s+n))/2;let c=t[0],l=t[1];c[0]>l[0]&&(c=t[1],l=t[0]);const u=Math.atan((l[1]-c[1])/(l[0]-c[0]));for(let t=0;t<r;t++){const a=t*(s+n),h=a+s,r=[c[0]+a*Math.cos(u)+i*Math.cos(u),c[1]+a*Math.sin(u)+i*Math.sin(u)],l=[c[0]+h*Math.cos(u)+i*Math.cos(u),c[1]+h*Math.sin(u)+i*Math.sin(u)];o.push(...this.helper.doubleLineOps(r[0],r[1],l[0],l[1],e))}})),o}}class l{constructor(t){this.helper=t}fillPolygons(t,e){const s=e.hachureGap<0?4*e.strokeWidth:e.hachureGap,o=e.zigzagOffset<0?s:e.zigzagOffset,a=n(t,e=Object.assign({},e,{hachureGap:s+o}));return{type:"fillSketch",ops:this.zigzagLines(a,o,e)}}zigzagLines(t,e,s){const n=[];return t.forEach((t=>{const o=a(t),h=Math.round(o/(2*e));let r=t[0],i=t[1];r[0]>i[0]&&(r=t[1],i=t[0]);const c=Math.atan((i[1]-r[1])/(i[0]-r[0]));for(let t=0;t<h;t++){const o=2*t*e,a=2*(t+1)*e,h=Math.sqrt(2*Math.pow(e,2)),i=[r[0]+o*Math.cos(c),r[1]+o*Math.sin(c)],l=[r[0]+a*Math.cos(c),r[1]+a*Math.sin(c)],u=[i[0]+h*Math.cos(c+Math.PI/4),i[1]+h*Math.sin(c+Math.PI/4)];n.push(...this.helper.doubleLineOps(i[0],i[1],u[0],u[1],s),...this.helper.doubleLineOps(u[0],u[1],l[0],l[1],s))}})),n}}const u={};class p{constructor(t){this.seed=t}next(){return this.seed?(2**31-1&(this.seed=Math.imul(48271,this.seed)))/2**31:Math.random()}}const f=0,d=1,g=2,M={A:7,a:7,C:6,c:6,H:1,h:1,L:2,l:2,M:2,m:2,Q:4,q:4,S:4,s:4,T:2,t:2,V:1,v:1,Z:0,z:0};function k(t,e){return t.type===e}function b(t){const e=[],s=function(t){const e=new Array;for(;""!==t;)if(t.match(/^([ \t\r\n,]+)/))t=t.substr(RegExp.$1.length);else if(t.match(/^([aAcChHlLmMqQsStTvVzZ])/))e[e.length]={type:f,text:RegExp.$1},t=t.substr(RegExp.$1.length);else{if(!t.match(/^(([-+]?[0-9]+(\.[0-9]*)?|[-+]?\.[0-9]+)([eE][-+]?[0-9]+)?)/))return[];e[e.length]={type:d,text:`${parseFloat(RegExp.$1)}`},t=t.substr(RegExp.$1.length)}return e[e.length]={type:g,text:""},e}(t);let n="BOD",o=0,a=s[o];for(;!k(a,g);){let h=0;const r=[];if("BOD"===n){if("M"!==a.text&&"m"!==a.text)return b("M0,0"+t);o++,h=M[a.text],n=a.text}else k(a,d)?h=M[n]:(o++,h=M[a.text],n=a.text);if(!(o+h<s.length))throw new Error("Path data ended short");for(let t=o;t<o+h;t++){const e=s[t];if(!k(e,d))throw new Error("Param not a number: "+n+","+e.text);r[r.length]=+e.text}if("number"!=typeof M[n])throw new Error("Bad segment: "+n);{const t={key:n,data:r};e.push(t),o+=h,a=s[o],"M"===n&&(n="L"),"m"===n&&(n="l")}}return e}function y(t){let e=0,s=0,n=0,o=0;const a=[];for(const{key:h,data:r}of t)switch(h){case"M":a.push({key:"M",data:[...r]}),[e,s]=r,[n,o]=r;break;case"m":e+=r[0],s+=r[1],a.push({key:"M",data:[e,s]}),n=e,o=s;break;case"L":a.push({key:"L",data:[...r]}),[e,s]=r;break;case"l":e+=r[0],s+=r[1],a.push({key:"L",data:[e,s]});break;case"C":a.push({key:"C",data:[...r]}),e=r[4],s=r[5];break;case"c":{const t=r.map(((t,n)=>n%2?t+s:t+e));a.push({key:"C",data:t}),e=t[4],s=t[5];break}case"Q":a.push({key:"Q",data:[...r]}),e=r[2],s=r[3];break;case"q":{const t=r.map(((t,n)=>n%2?t+s:t+e));a.push({key:"Q",data:t}),e=t[2],s=t[3];break}case"A":a.push({key:"A",data:[...r]}),e=r[5],s=r[6];break;case"a":e+=r[5],s+=r[6],a.push({key:"A",data:[r[0],r[1],r[2],r[3],r[4],e,s]});break;case"H":a.push({key:"H",data:[...r]}),e=r[0];break;case"h":e+=r[0],a.push({key:"H",data:[e]});break;case"V":a.push({key:"V",data:[...r]}),s=r[0];break;case"v":s+=r[0],a.push({key:"V",data:[s]});break;case"S":a.push({key:"S",data:[...r]}),e=r[2],s=r[3];break;case"s":{const t=r.map(((t,n)=>n%2?t+s:t+e));a.push({key:"S",data:t}),e=t[2],s=t[3];break}case"T":a.push({key:"T",data:[...r]}),e=r[0],s=r[1];break;case"t":e+=r[0],s+=r[1],a.push({key:"T",data:[e,s]});break;case"Z":case"z":a.push({key:"Z",data:[]}),e=n,s=o}return a}function m(t){const e=[];let s="",n=0,o=0,a=0,h=0,r=0,i=0;for(const{key:c,data:l}of t){switch(c){case"M":e.push({key:"M",data:[...l]}),[n,o]=l,[a,h]=l;break;case"C":e.push({key:"C",data:[...l]}),n=l[4],o=l[5],r=l[2],i=l[3];break;case"L":e.push({key:"L",data:[...l]}),[n,o]=l;break;case"H":n=l[0],e.push({key:"L",data:[n,o]});break;case"V":o=l[0],e.push({key:"L",data:[n,o]});break;case"S":{let t=0,a=0;"C"===s||"S"===s?(t=n+(n-r),a=o+(o-i)):(t=n,a=o),e.push({key:"C",data:[t,a,...l]}),r=l[0],i=l[1],n=l[2],o=l[3];break}case"T":{const[t,a]=l;let h=0,c=0;"Q"===s||"T"===s?(h=n+(n-r),c=o+(o-i)):(h=n,c=o);const u=n+2*(h-n)/3,p=o+2*(c-o)/3,f=t+2*(h-t)/3,d=a+2*(c-a)/3;e.push({key:"C",data:[u,p,f,d,t,a]}),r=h,i=c,n=t,o=a;break}case"Q":{const[t,s,a,h]=l,c=n+2*(t-n)/3,u=o+2*(s-o)/3,p=a+2*(t-a)/3,f=h+2*(s-h)/3;e.push({key:"C",data:[c,u,p,f,a,h]}),r=t,i=s,n=a,o=h;break}case"A":{const t=Math.abs(l[0]),s=Math.abs(l[1]),a=l[2],h=l[3],r=l[4],i=l[5],c=l[6];if(0===t||0===s)e.push({key:"C",data:[n,o,i,c,i,c]}),n=i,o=c;else if(n!==i||o!==c){x(n,o,i,c,t,s,a,h,r).forEach((function(t){e.push({key:"C",data:t})})),n=i,o=c}break}case"Z":e.push({key:"Z",data:[]}),n=a,o=h}s=c}return e}function w(t,e,s){return[t*Math.cos(s)-e*Math.sin(s),t*Math.sin(s)+e*Math.cos(s)]}function x(t,e,s,n,o,a,h,r,i,c){const l=(u=h,Math.PI*u/180);var u;let p=[],f=0,d=0,g=0,M=0;if(c)[f,d,g,M]=c;else{[t,e]=w(t,e,-l),[s,n]=w(s,n,-l);const h=(t-s)/2,c=(e-n)/2;let u=h*h/(o*o)+c*c/(a*a);u>1&&(u=Math.sqrt(u),o*=u,a*=u);const p=o*o,k=a*a,b=p*k-p*c*c-k*h*h,y=p*c*c+k*h*h,m=(r===i?-1:1)*Math.sqrt(Math.abs(b/y));g=m*o*c/a+(t+s)/2,M=m*-a*h/o+(e+n)/2,f=Math.asin(parseFloat(((e-M)/a).toFixed(9))),d=Math.asin(parseFloat(((n-M)/a).toFixed(9))),t<g&&(f=Math.PI-f),s<g&&(d=Math.PI-d),f<0&&(f=2*Math.PI+f),d<0&&(d=2*Math.PI+d),i&&f>d&&(f-=2*Math.PI),!i&&d>f&&(d-=2*Math.PI)}let k=d-f;if(Math.abs(k)>120*Math.PI/180){const t=d,e=s,r=n;d=i&&d>f?f+120*Math.PI/180*1:f+120*Math.PI/180*-1,p=x(s=g+o*Math.cos(d),n=M+a*Math.sin(d),e,r,o,a,h,0,i,[d,t,g,M])}k=d-f;const b=Math.cos(f),y=Math.sin(f),m=Math.cos(d),P=Math.sin(d),v=Math.tan(k/4),S=4/3*o*v,O=4/3*a*v,L=[t,e],T=[t+S*y,e-O*b],D=[s+S*P,n-O*m],A=[s,n];if(T[0]=2*L[0]-T[0],T[1]=2*L[1]-T[1],c)return[T,D,A].concat(p);{p=[T,D,A].concat(p);const t=[];for(let e=0;e<p.length;e+=3){const s=w(p[e][0],p[e][1],l),n=w(p[e+1][0],p[e+1][1],l),o=w(p[e+2][0],p[e+2][1],l);t.push([s[0],s[1],n[0],n[1],o[0],o[1]])}return t}}const P={randOffset:function(t,e){return G(t,e)},randOffsetWithRange:function(t,e,s){return E(t,e,s)},ellipse:function(t,e,s,n,o){const a=T(s,n,o);return D(t,e,o,a).opset},doubleLineOps:function(t,e,s,n,o){return $(t,e,s,n,o,!0)}};function v(t,e,s,n,o){return{type:"path",ops:$(t,e,s,n,o)}}function S(t,e,s){const n=(t||[]).length;if(n>2){const o=[];for(let e=0;e<n-1;e++)o.push(...$(t[e][0],t[e][1],t[e+1][0],t[e+1][1],s));return e&&o.push(...$(t[n-1][0],t[n-1][1],t[0][0],t[0][1],s)),{type:"path",ops:o}}return 2===n?v(t[0][0],t[0][1],t[1][0],t[1][1],s):{type:"path",ops:[]}}function O(t,e,s,n,o){return function(t,e){return S(t,!0,e)}([[t,e],[t+s,e],[t+s,e+n],[t,e+n]],o)}function L(t,e){if(t.length){const s="number"==typeof t[0][0]?[t]:t,n=j(s[0],1*(1+.2*e.roughness),e),o=e.disableMultiStroke?[]:j(s[0],1.5*(1+.22*e.roughness),z(e));for(let t=1;t<s.length;t++){const a=s[t];if(a.length){const t=j(a,1*(1+.2*e.roughness),e),s=e.disableMultiStroke?[]:j(a,1.5*(1+.22*e.roughness),z(e));for(const e of t)"move"!==e.op&&n.push(e);for(const t of s)"move"!==t.op&&o.push(t)}}return{type:"path",ops:n.concat(o)}}return{type:"path",ops:[]}}function T(t,e,s){const n=Math.sqrt(2*Math.PI*Math.sqrt((Math.pow(t/2,2)+Math.pow(e/2,2))/2)),o=Math.ceil(Math.max(s.curveStepCount,s.curveStepCount/Math.sqrt(200)*n)),a=2*Math.PI/o;let h=Math.abs(t/2),r=Math.abs(e/2);const i=1-s.curveFitting;return h+=G(h*i,s),r+=G(r*i,s),{increment:a,rx:h,ry:r}}function D(t,e,s,n){const[o,a]=F(n.increment,t,e,n.rx,n.ry,1,n.increment*E(.1,E(.4,1,s),s),s);let h=q(o,null,s);if(!s.disableMultiStroke&&0!==s.roughness){const[o]=F(n.increment,t,e,n.rx,n.ry,1.5,0,s),a=q(o,null,s);h=h.concat(a)}return{estimatedPoints:a,opset:{type:"path",ops:h}}}function A(t,e,s,n,o,a,h,r,i){const c=t,l=e;let u=Math.abs(s/2),p=Math.abs(n/2);u+=G(.01*u,i),p+=G(.01*p,i);let f=o,d=a;for(;f<0;)f+=2*Math.PI,d+=2*Math.PI;d-f>2*Math.PI&&(f=0,d=2*Math.PI);const g=2*Math.PI/i.curveStepCount,M=Math.min(g/2,(d-f)/2),k=V(M,c,l,u,p,f,d,1,i);if(!i.disableMultiStroke){const t=V(M,c,l,u,p,f,d,1.5,i);k.push(...t)}return h&&(r?k.push(...$(c,l,c+u*Math.cos(f),l+p*Math.sin(f),i),...$(c,l,c+u*Math.cos(d),l+p*Math.sin(d),i)):k.push({op:"lineTo",data:[c,l]},{op:"lineTo",data:[c+u*Math.cos(f),l+p*Math.sin(f)]})),{type:"path",ops:k}}function _(t,e){const s=m(y(b(t))),n=[];let o=[0,0],a=[0,0];for(const{key:t,data:h}of s)switch(t){case"M":a=[h[0],h[1]],o=[h[0],h[1]];break;case"L":n.push(...$(a[0],a[1],h[0],h[1],e)),a=[h[0],h[1]];break;case"C":{const[t,s,o,r,i,c]=h;n.push(...Z(t,s,o,r,i,c,a,e)),a=[i,c];break}case"Z":n.push(...$(a[0],a[1],o[0],o[1],e)),a=[o[0],o[1]]}return{type:"path",ops:n}}function I(t,e){const s=[];for(const n of t)if(n.length){const t=e.maxRandomnessOffset||0,o=n.length;if(o>2){s.push({op:"move",data:[n[0][0]+G(t,e),n[0][1]+G(t,e)]});for(let a=1;a<o;a++)s.push({op:"lineTo",data:[n[a][0]+G(t,e),n[a][1]+G(t,e)]})}}return{type:"fillPath",ops:s}}function C(t,e){return function(t,e){let s=t.fillStyle||"hachure";if(!u[s])switch(s){case"zigzag":u[s]||(u[s]=new h(e));break;case"cross-hatch":u[s]||(u[s]=new r(e));break;case"dots":u[s]||(u[s]=new i(e));break;case"dashed":u[s]||(u[s]=new c(e));break;case"zigzag-line":u[s]||(u[s]=new l(e));break;default:s="hachure",u[s]||(u[s]=new o(e))}return u[s]}(e,P).fillPolygons(t,e)}function z(t){const e=Object.assign({},t);return e.randomizer=void 0,t.seed&&(e.seed=t.seed+1),e}function W(t){return t.randomizer||(t.randomizer=new p(t.seed||0)),t.randomizer.next()}function E(t,e,s,n=1){return s.roughness*n*(W(s)*(e-t)+t)}function G(t,e,s=1){return E(-t,t,e,s)}function $(t,e,s,n,o,a=!1){const h=a?o.disableMultiStrokeFill:o.disableMultiStroke,r=R(t,e,s,n,o,!0,!1);if(h)return r;const i=R(t,e,s,n,o,!0,!0);return r.concat(i)}function R(t,e,s,n,o,a,h){const r=Math.pow(t-s,2)+Math.pow(e-n,2),i=Math.sqrt(r);let c=1;c=i<200?1:i>500?.4:-.0016668*i+1.233334;let l=o.maxRandomnessOffset||0;l*l*100>r&&(l=i/10);const u=l/2,p=.2+.2*W(o);let f=o.bowing*o.maxRandomnessOffset*(n-e)/200,d=o.bowing*o.maxRandomnessOffset*(t-s)/200;f=G(f,o,c),d=G(d,o,c);const g=[],M=()=>G(u,o,c),k=()=>G(l,o,c),b=o.preserveVertices;return a&&(h?g.push({op:"move",data:[t+(b?0:M()),e+(b?0:M())]}):g.push({op:"move",data:[t+(b?0:G(l,o,c)),e+(b?0:G(l,o,c))]})),h?g.push({op:"bcurveTo",data:[f+t+(s-t)*p+M(),d+e+(n-e)*p+M(),f+t+2*(s-t)*p+M(),d+e+2*(n-e)*p+M(),s+(b?0:M()),n+(b?0:M())]}):g.push({op:"bcurveTo",data:[f+t+(s-t)*p+k(),d+e+(n-e)*p+k(),f+t+2*(s-t)*p+k(),d+e+2*(n-e)*p+k(),s+(b?0:k()),n+(b?0:k())]}),g}function j(t,e,s){if(!t.length)return[];const n=[];n.push([t[0][0]+G(e,s),t[0][1]+G(e,s)]),n.push([t[0][0]+G(e,s),t[0][1]+G(e,s)]);for(let o=1;o<t.length;o++)n.push([t[o][0]+G(e,s),t[o][1]+G(e,s)]),o===t.length-1&&n.push([t[o][0]+G(e,s),t[o][1]+G(e,s)]);return q(n,null,s)}function q(t,e,s){const n=t.length,o=[];if(n>3){const a=[],h=1-s.curveTightness;o.push({op:"move",data:[t[1][0],t[1][1]]});for(let e=1;e+2<n;e++){const s=t[e];a[0]=[s[0],s[1]],a[1]=[s[0]+(h*t[e+1][0]-h*t[e-1][0])/6,s[1]+(h*t[e+1][1]-h*t[e-1][1])/6],a[2]=[t[e+1][0]+(h*t[e][0]-h*t[e+2][0])/6,t[e+1][1]+(h*t[e][1]-h*t[e+2][1])/6],a[3]=[t[e+1][0],t[e+1][1]],o.push({op:"bcurveTo",data:[a[1][0],a[1][1],a[2][0],a[2][1],a[3][0],a[3][1]]})}if(e&&2===e.length){const t=s.maxRandomnessOffset;o.push({op:"lineTo",data:[e[0]+G(t,s),e[1]+G(t,s)]})}}else 3===n?(o.push({op:"move",data:[t[1][0],t[1][1]]}),o.push({op:"bcurveTo",data:[t[1][0],t[1][1],t[2][0],t[2][1],t[2][0],t[2][1]]})):2===n&&o.push(...R(t[0][0],t[0][1],t[1][0],t[1][1],s,!0,!0));return o}function F(t,e,s,n,o,a,h,r){const i=[],c=[];if(0===r.roughness){t/=4,c.push([e+n*Math.cos(-t),s+o*Math.sin(-t)]);for(let a=0;a<=2*Math.PI;a+=t){const t=[e+n*Math.cos(a),s+o*Math.sin(a)];i.push(t),c.push(t)}c.push([e+n*Math.cos(0),s+o*Math.sin(0)]),c.push([e+n*Math.cos(t),s+o*Math.sin(t)])}else{const l=G(.5,r)-Math.PI/2;c.push([G(a,r)+e+.9*n*Math.cos(l-t),G(a,r)+s+.9*o*Math.sin(l-t)]);const u=2*Math.PI+l-.01;for(let h=l;h<u;h+=t){const t=[G(a,r)+e+n*Math.cos(h),G(a,r)+s+o*Math.sin(h)];i.push(t),c.push(t)}c.push([G(a,r)+e+n*Math.cos(l+2*Math.PI+.5*h),G(a,r)+s+o*Math.sin(l+2*Math.PI+.5*h)]),c.push([G(a,r)+e+.98*n*Math.cos(l+h),G(a,r)+s+.98*o*Math.sin(l+h)]),c.push([G(a,r)+e+.9*n*Math.cos(l+.5*h),G(a,r)+s+.9*o*Math.sin(l+.5*h)])}return[c,i]}function V(t,e,s,n,o,a,h,r,i){const c=a+G(.1,i),l=[];l.push([G(r,i)+e+.9*n*Math.cos(c-t),G(r,i)+s+.9*o*Math.sin(c-t)]);for(let a=c;a<=h;a+=t)l.push([G(r,i)+e+n*Math.cos(a),G(r,i)+s+o*Math.sin(a)]);return l.push([e+n*Math.cos(h),s+o*Math.sin(h)]),l.push([e+n*Math.cos(h),s+o*Math.sin(h)]),q(l,null,i)}function Z(t,e,s,n,o,a,h,r){const i=[],c=[r.maxRandomnessOffset||1,(r.maxRandomnessOffset||1)+.3];let l=[0,0];const u=r.disableMultiStroke?1:2,p=r.preserveVertices;for(let f=0;f<u;f++)0===f?i.push({op:"move",data:[h[0],h[1]]}):i.push({op:"move",data:[h[0]+(p?0:G(c[0],r)),h[1]+(p?0:G(c[0],r))]}),l=p?[o,a]:[o+G(c[f],r),a+G(c[f],r)],i.push({op:"bcurveTo",data:[t+G(c[f],r),e+G(c[f],r),s+G(c[f],r),n+G(c[f],r),l[0],l[1]]});return i}function Q(t){return[...t]}function H(t,e=0){const s=t.length;if(s<3)throw new Error("A curve must have at least three points.");const n=[];if(3===s)n.push(Q(t[0]),Q(t[1]),Q(t[2]),Q(t[2]));else{const s=[];s.push(t[0],t[0]);for(let e=1;e<t.length;e++)s.push(t[e]),e===t.length-1&&s.push(t[e]);const o=[],a=1-e;n.push(Q(s[0]));for(let t=1;t+2<s.length;t++){const e=s[t];o[0]=[e[0],e[1]],o[1]=[e[0]+(a*s[t+1][0]-a*s[t-1][0])/6,e[1]+(a*s[t+1][1]-a*s[t-1][1])/6],o[2]=[s[t+1][0]+(a*s[t][0]-a*s[t+2][0])/6,s[t+1][1]+(a*s[t][1]-a*s[t+2][1])/6],o[3]=[s[t+1][0],s[t+1][1]],n.push(o[1],o[2],o[3])}}return n}function N(t,e){return Math.pow(t[0]-e[0],2)+Math.pow(t[1]-e[1],2)}function B(t,e,s){const n=N(e,s);if(0===n)return N(t,e);let o=((t[0]-e[0])*(s[0]-e[0])+(t[1]-e[1])*(s[1]-e[1]))/n;return o=Math.max(0,Math.min(1,o)),N(t,J(e,s,o))}function J(t,e,s){return[t[0]+(e[0]-t[0])*s,t[1]+(e[1]-t[1])*s]}function K(t,e,s,n){const o=n||[];if(function(t,e){const s=t[e+0],n=t[e+1],o=t[e+2],a=t[e+3];let h=3*n[0]-2*s[0]-a[0];h*=h;let r=3*n[1]-2*s[1]-a[1];r*=r;let i=3*o[0]-2*a[0]-s[0];i*=i;let c=3*o[1]-2*a[1]-s[1];return c*=c,h<i&&(h=i),r<c&&(r=c),h+r}(t,e)<s){const s=t[e+0];if(o.length){(a=o[o.length-1],h=s,Math.sqrt(N(a,h)))>1&&o.push(s)}else o.push(s);o.push(t[e+3])}else{const n=.5,a=t[e+0],h=t[e+1],r=t[e+2],i=t[e+3],c=J(a,h,n),l=J(h,r,n),u=J(r,i,n),p=J(c,l,n),f=J(l,u,n),d=J(p,f,n);K([a,c,p,d],0,s,o),K([d,f,u,i],0,s,o)}var a,h;return o}function U(t,e){return X(t,0,t.length,e)}function X(t,e,s,n,o){const a=o||[],h=t[e],r=t[s-1];let i=0,c=1;for(let n=e+1;n<s-1;++n){const e=B(t[n],h,r);e>i&&(i=e,c=n)}return Math.sqrt(i)>n?(X(t,e,c+1,n,a),X(t,c,s,n,a)):(a.length||a.push(h),a.push(r)),a}function Y(t,e=.15,s){const n=[],o=(t.length-1)/3;for(let s=0;s<o;s++){K(t,3*s,e,n)}return s&&s>0?X(n,0,n.length,s):n}const tt="none";class et{constructor(t){this.defaultOptions={maxRandomnessOffset:2,roughness:1,bowing:1,stroke:"#000",strokeWidth:1,curveTightness:0,curveFitting:.95,curveStepCount:9,fillStyle:"hachure",fillWeight:-1,hachureAngle:-41,hachureGap:-1,dashOffset:-1,dashGap:-1,zigzagOffset:-1,seed:0,disableMultiStroke:!1,disableMultiStrokeFill:!1,preserveVertices:!1,fillShapeRoughnessGain:.8},this.config=t||{},this.config.options&&(this.defaultOptions=this._o(this.config.options))}static newSeed(){return Math.floor(Math.random()*2**31)}_o(t){return t?Object.assign({},this.defaultOptions,t):this.defaultOptions}_d(t,e,s){return{shape:t,sets:e||[],options:s||this.defaultOptions}}line(t,e,s,n,o){const a=this._o(o);return this._d("line",[v(t,e,s,n,a)],a)}rectangle(t,e,s,n,o){const a=this._o(o),h=[],r=O(t,e,s,n,a);if(a.fill){const o=[[t,e],[t+s,e],[t+s,e+n],[t,e+n]];"solid"===a.fillStyle?h.push(I([o],a)):h.push(C([o],a))}return a.stroke!==tt&&h.push(r),this._d("rectangle",h,a)}ellipse(t,e,s,n,o){const a=this._o(o),h=[],r=T(s,n,a),i=D(t,e,a,r);if(a.fill)if("solid"===a.fillStyle){const s=D(t,e,a,r).opset;s.type="fillPath",h.push(s)}else h.push(C([i.estimatedPoints],a));return a.stroke!==tt&&h.push(i.opset),this._d("ellipse",h,a)}circle(t,e,s,n){const o=this.ellipse(t,e,s,s,n);return o.shape="circle",o}linearPath(t,e){const s=this._o(e);return this._d("linearPath",[S(t,!1,s)],s)}arc(t,e,s,n,o,a,h=!1,r){const i=this._o(r),c=[],l=A(t,e,s,n,o,a,h,!0,i);if(h&&i.fill)if("solid"===i.fillStyle){const h=Object.assign({},i);h.disableMultiStroke=!0;const r=A(t,e,s,n,o,a,!0,!1,h);r.type="fillPath",c.push(r)}else c.push(function(t,e,s,n,o,a,h){const r=t,i=e;let c=Math.abs(s/2),l=Math.abs(n/2);c+=G(.01*c,h),l+=G(.01*l,h);let u=o,p=a;for(;u<0;)u+=2*Math.PI,p+=2*Math.PI;p-u>2*Math.PI&&(u=0,p=2*Math.PI);const f=(p-u)/h.curveStepCount,d=[];for(let t=u;t<=p;t+=f)d.push([r+c*Math.cos(t),i+l*Math.sin(t)]);return d.push([r+c*Math.cos(p),i+l*Math.sin(p)]),d.push([r,i]),C([d],h)}(t,e,s,n,o,a,i));return i.stroke!==tt&&c.push(l),this._d("arc",c,i)}curve(t,e){const s=this._o(e),n=[],o=L(t,s);if(s.fill&&s.fill!==tt)if("solid"===s.fillStyle){const e=L(t,Object.assign(Object.assign({},s),{disableMultiStroke:!0,roughness:s.roughness?s.roughness+s.fillShapeRoughnessGain:0}));n.push({type:"fillPath",ops:this._mergedShape(e.ops)})}else{const e=[],o=t;if(o.length){const t="number"==typeof o[0][0]?[o]:o;for(const n of t)n.length<3?e.push(...n):3===n.length?e.push(...Y(H([n[0],n[0],n[1],n[2]]),10,(1+s.roughness)/2)):e.push(...Y(H(n),10,(1+s.roughness)/2))}e.length&&n.push(C([e],s))}return s.stroke!==tt&&n.push(o),this._d("curve",n,s)}polygon(t,e){const s=this._o(e),n=[],o=S(t,!0,s);return s.fill&&("solid"===s.fillStyle?n.push(I([t],s)):n.push(C([t],s))),s.stroke!==tt&&n.push(o),this._d("polygon",n,s)}path(t,e){const s=this._o(e),n=[];if(!t)return this._d("path",n,s);t=(t||"").replace(/\n/g," ").replace(/(-\s)/g,"-").replace("/(ss)/g"," ");const o=s.fill&&"transparent"!==s.fill&&s.fill!==tt,a=s.stroke!==tt,h=!!(s.simplification&&s.simplification<1),r=function(t,e,s){const n=m(y(b(t))),o=[];let a=[],h=[0,0],r=[];const i=()=>{r.length>=4&&a.push(...Y(r,e)),r=[]},c=()=>{i(),a.length&&(o.push(a),a=[])};for(const{key:t,data:e}of n)switch(t){case"M":c(),h=[e[0],e[1]],a.push(h);break;case"L":i(),a.push([e[0],e[1]]);break;case"C":if(!r.length){const t=a.length?a[a.length-1]:h;r.push([t[0],t[1]])}r.push([e[0],e[1]]),r.push([e[2],e[3]]),r.push([e[4],e[5]]);break;case"Z":i(),a.push([h[0],h[1]])}if(c(),!s)return o;const l=[];for(const t of o){const e=U(t,s);e.length&&l.push(e)}return l}(t,1,h?4-4*(s.simplification||1):(1+s.roughness)/2),i=_(t,s);if(o)if("solid"===s.fillStyle)if(1===r.length){const e=_(t,Object.assign(Object.assign({},s),{disableMultiStroke:!0,roughness:s.roughness?s.roughness+s.fillShapeRoughnessGain:0}));n.push({type:"fillPath",ops:this._mergedShape(e.ops)})}else n.push(I(r,s));else n.push(C(r,s));return a&&(h?r.forEach((t=>{n.push(S(t,!1,s))})):n.push(i)),this._d("path",n,s)}opsToPath(t,e){let s="";for(const n of t.ops){const t="number"==typeof e&&e>=0?n.data.map((t=>+t.toFixed(e))):n.data;switch(n.op){case"move":s+=`M${t[0]} ${t[1]} `;break;case"bcurveTo":s+=`C${t[0]} ${t[1]}, ${t[2]} ${t[3]}, ${t[4]} ${t[5]} `;break;case"lineTo":s+=`L${t[0]} ${t[1]} `}}return s.trim()}toPaths(t){const e=t.sets||[],s=t.options||this.defaultOptions,n=[];for(const t of e){let e=null;switch(t.type){case"path":e={d:this.opsToPath(t),stroke:s.stroke,strokeWidth:s.strokeWidth,fill:tt};break;case"fillPath":e={d:this.opsToPath(t),stroke:tt,strokeWidth:0,fill:s.fill||tt};break;case"fillSketch":e=this.fillSketch(t,s)}e&&n.push(e)}return n}fillSketch(t,e){let s=e.fillWeight;return s<0&&(s=e.strokeWidth/2),{d:this.opsToPath(t),stroke:e.fill||tt,strokeWidth:s,fill:tt}}_mergedShape(t){return t.filter(((t,e)=>0===e||"move"!==t.op))}}class st{constructor(t,e){this.canvas=t,this.ctx=this.canvas.getContext("2d"),this.gen=new et(e)}draw(t){const e=t.sets||[],s=t.options||this.getDefaultOptions(),n=this.ctx,o=t.options.fixedDecimalPlaceDigits;for(const a of e)switch(a.type){case"path":n.save(),n.strokeStyle="none"===s.stroke?"transparent":s.stroke,n.lineWidth=s.strokeWidth,s.strokeLineDash&&n.setLineDash(s.strokeLineDash),s.strokeLineDashOffset&&(n.lineDashOffset=s.strokeLineDashOffset),this._drawToContext(n,a,o),n.restore();break;case"fillPath":{n.save(),n.fillStyle=s.fill||"";const e="curve"===t.shape||"polygon"===t.shape||"path"===t.shape?"evenodd":"nonzero";this._drawToContext(n,a,o,e),n.restore();break}case"fillSketch":this.fillSketch(n,a,s)}}fillSketch(t,e,s){let n=s.fillWeight;n<0&&(n=s.strokeWidth/2),t.save(),s.fillLineDash&&t.setLineDash(s.fillLineDash),s.fillLineDashOffset&&(t.lineDashOffset=s.fillLineDashOffset),t.strokeStyle=s.fill||"",t.lineWidth=n,this._drawToContext(t,e,s.fixedDecimalPlaceDigits),t.restore()}_drawToContext(t,e,s,n="nonzero"){t.beginPath();for(const n of e.ops){const e="number"==typeof s&&s>=0?n.data.map((t=>+t.toFixed(s))):n.data;switch(n.op){case"move":t.moveTo(e[0],e[1]);break;case"bcurveTo":t.bezierCurveTo(e[0],e[1],e[2],e[3],e[4],e[5]);break;case"lineTo":t.lineTo(e[0],e[1])}}"fillPath"===e.type?t.fill(n):t.stroke()}get generator(){return this.gen}getDefaultOptions(){return this.gen.defaultOptions}line(t,e,s,n,o){const a=this.gen.line(t,e,s,n,o);return this.draw(a),a}rectangle(t,e,s,n,o){const a=this.gen.rectangle(t,e,s,n,o);return this.draw(a),a}ellipse(t,e,s,n,o){const a=this.gen.ellipse(t,e,s,n,o);return this.draw(a),a}circle(t,e,s,n){const o=this.gen.circle(t,e,s,n);return this.draw(o),o}linearPath(t,e){const s=this.gen.linearPath(t,e);return this.draw(s),s}polygon(t,e){const s=this.gen.polygon(t,e);return this.draw(s),s}arc(t,e,s,n,o,a,h=!1,r){const i=this.gen.arc(t,e,s,n,o,a,h,r);return this.draw(i),i}curve(t,e){const s=this.gen.curve(t,e);return this.draw(s),s}path(t,e){const s=this.gen.path(t,e);return this.draw(s),s}}const nt="http://www.w3.org/2000/svg";class ot{constructor(t,e){this.svg=t,this.gen=new et(e)}draw(t){const e=t.sets||[],s=t.options||this.getDefaultOptions(),n=this.svg.ownerDocument||window.document,o=n.createElementNS(nt,"g"),a=t.options.fixedDecimalPlaceDigits;for(const h of e){let e=null;switch(h.type){case"path":e=n.createElementNS(nt,"path"),e.setAttribute("d",this.opsToPath(h,a)),e.setAttribute("stroke",s.stroke),e.setAttribute("stroke-width",s.strokeWidth+""),e.setAttribute("fill","none"),s.strokeLineDash&&e.setAttribute("stroke-dasharray",s.strokeLineDash.join(" ").trim()),s.strokeLineDashOffset&&e.setAttribute("stroke-dashoffset",`${s.strokeLineDashOffset}`);break;case"fillPath":e=n.createElementNS(nt,"path"),e.setAttribute("d",this.opsToPath(h,a)),e.setAttribute("stroke","none"),e.setAttribute("stroke-width","0"),e.setAttribute("fill",s.fill||""),"curve"!==t.shape&&"polygon"!==t.shape||e.setAttribute("fill-rule","evenodd");break;case"fillSketch":e=this.fillSketch(n,h,s)}e&&o.appendChild(e)}return o}fillSketch(t,e,s){let n=s.fillWeight;n<0&&(n=s.strokeWidth/2);const o=t.createElementNS(nt,"path");return o.setAttribute("d",this.opsToPath(e,s.fixedDecimalPlaceDigits)),o.setAttribute("stroke",s.fill||""),o.setAttribute("stroke-width",n+""),o.setAttribute("fill","none"),s.fillLineDash&&o.setAttribute("stroke-dasharray",s.fillLineDash.join(" ").trim()),s.fillLineDashOffset&&o.setAttribute("stroke-dashoffset",`${s.fillLineDashOffset}`),o}get generator(){return this.gen}getDefaultOptions(){return this.gen.defaultOptions}opsToPath(t,e){return this.gen.opsToPath(t,e)}line(t,e,s,n,o){const a=this.gen.line(t,e,s,n,o);return this.draw(a)}rectangle(t,e,s,n,o){const a=this.gen.rectangle(t,e,s,n,o);return this.draw(a)}ellipse(t,e,s,n,o){const a=this.gen.ellipse(t,e,s,n,o);return this.draw(a)}circle(t,e,s,n){const o=this.gen.circle(t,e,s,n);return this.draw(o)}linearPath(t,e){const s=this.gen.linearPath(t,e);return this.draw(s)}polygon(t,e){const s=this.gen.polygon(t,e);return this.draw(s)}arc(t,e,s,n,o,a,h=!1,r){const i=this.gen.arc(t,e,s,n,o,a,h,r);return this.draw(i)}curve(t,e){const s=this.gen.curve(t,e);return this.draw(s)}path(t,e){const s=this.gen.path(t,e);return this.draw(s)}}var at={canvas:(t,e)=>new st(t,e),svg:(t,e)=>new ot(t,e),generator:t=>new et(t),newSeed:()=>et.newSeed()};

      return at
    })()
    const CADENCE_MS = 400
    const RAD = Math.PI / 180
    const TAU = Math.PI * 2

    const CSS = `
.kbm-root{display:flex;flex-direction:column;height:100%;min-height:0;font-size:12px;
  color:var(--dsw-alias-label-primary,#1a1a1a);background:var(--dsw-alias-bg-layer-2,#fff)}
.kbm-head{flex:none;display:flex;align-items:center;gap:8px;padding:10px 12px 8px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.07))}
.kbm-title{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kbm-badge{margin-left:auto;flex:none;font-size:10.5px;font-weight:600;padding:2px 8px;border-radius:99px;
  background:var(--dsw-alias-bg-module-platform,rgba(0,0,0,.05));color:var(--dsw-alias-label-secondary,#6b6b68)}
.kbm-badge.run{background:#e1502a;color:#fff}
.kbm-view{position:relative;flex:1;min-height:160px;background:#f7f6f3;overflow:hidden}
.kbm-view canvas{display:block;width:100%;height:100%;cursor:grab}
.kbm-saisie{position:absolute;min-width:120px;max-width:80%;padding:3px 7px;font:600 14px -apple-system,system-ui,sans-serif;background:rgba(255,255,255,.94);border:1px solid rgba(0,0,0,.25);border-radius:6px;outline:none;box-shadow:0 2px 8px rgba(0,0,0,.12);z-index:3}
.kbm-view canvas.kbm-drag{cursor:grabbing}
.kbm-empty{position:absolute;inset:0;display:flex;flex-direction:column;gap:6px;align-items:center;justify-content:center;
  padding:22px;text-align:center;color:var(--dsw-alias-label-tertiary,#8a8a87);font-size:12px;line-height:1.5}
.kbm-empty b{color:var(--dsw-alias-label-secondary,#4a4a47);font-weight:600}
.kbm-empty code{font-size:11px;background:var(--dsw-alias-bg-module-platform,rgba(0,0,0,.05));padding:1px 5px;border-radius:4px}
.kbm-tools{position:absolute;top:8px;left:8px;display:flex;gap:2px;background:rgba(255,255,255,.92);
  border-radius:9px;padding:3px;box-shadow:0 3px 12px rgba(28,42,28,.12)}
.kbm-tool{border:0;background:transparent;font:inherit;font-size:10.5px;color:#6b6b68;padding:3px 7px;border-radius:6px;cursor:pointer}
.kbm-tool.on{background:rgba(0,0,0,.08);color:#1a1a1a}
.kbm-coul{width:14px;height:14px;border-radius:50%;border:2px solid transparent;padding:0;cursor:pointer;flex:none}
.kbm-coul.on{border-color:#1a1a1a}
.kbm-tool:hover{background:rgba(0,0,0,.05)}
.kbm-tool.on{background:#efefec;color:#1a1a1a;font-weight:650}
.kbm-foot{flex:none;padding:8px 12px 10px;border-top:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.07))}
.kbm-line{display:flex;align-items:center;gap:7px}
.kbm-play{flex:none;width:26px;height:26px;border:0;border-radius:50%;background:#e1502a;color:#fff;cursor:pointer;
  display:grid;place-items:center;font-size:10px;line-height:1}
.kbm-play:hover{background:#c94522}
.kbm-step{flex:none;width:22px;height:22px;border:0;background:transparent;color:#6b6b68;cursor:pointer;border-radius:6px;font-size:11px}
.kbm-step:hover{background:rgba(0,0,0,.05)}
.kbm-sp{border:0;background:transparent;font:inherit;font-size:10.5px;color:#8a8a87;padding:3px 5px;border-radius:5px;cursor:pointer}
.kbm-sp.on{background:rgba(0,0,0,.06);color:#1a1a1a;font-weight:650}
.kbm-track{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.kbm-lab{font-size:10.5px;color:#7c7c79;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kbm-lab b{color:#2a2a28;font-weight:600}
.kbm-range{-webkit-appearance:none;appearance:none;width:100%;height:4px;border-radius:2px;background:rgba(0,0,0,.10);outline:0}
.kbm-range::-webkit-slider-thumb{-webkit-appearance:none;width:12px;height:12px;border-radius:50%;background:#e1502a;border:2px solid #fff;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.25)}
.kbm-note{margin-top:7px;font-size:10.5px;line-height:1.45;color:var(--dsw-alias-label-tertiary,#8a8a87);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kbm-note b{color:var(--dsw-alias-label-secondary,#4a4a47);font-weight:600}
.kbm-chip{display:inline-block;font-size:10.5px;padding:1px 7px;border-radius:99px;margin:0 4px 4px 0;
  background:var(--dsw-alias-bg-module-platform,rgba(0,0,0,.05));color:var(--dsw-alias-label-secondary,#6b6b68);cursor:pointer;border:0;font-family:inherit}
.kbm-chip:hover{background:rgba(0,0,0,.09)}
.kbm-chips{display:flex;flex-wrap:wrap;gap:0;margin-top:6px;max-height:52px;overflow:hidden}
`

    /* ══════════════════════ utilitaires ══════════════════════ */

    const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
    const reel = (v, def) => (typeof v === 'number' && Number.isFinite(v) ? v : def)
    const entier = (v, def) => Math.round(reel(v, def))
    const hexate = (c, def) => (typeof c === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c) ? c : def)

    function hexRgb (h) {
      const s = h.replace('#', '')
      const n = parseInt(s.length === 3 ? s.split('').map((x) => x + x).join('') : s, 16)
      return [n >> 16 & 255, n >> 8 & 255, n & 255]
    }
    const _nuances = new Map()
    function nuance (hex, k) {
      const cle = hex + '|' + k.toFixed(3)
      let v = _nuances.get(cle)
      if (v) return v
      v = '#' + hexRgb(hex).map((x) => clamp(Math.round(x * k), 0, 255).toString(16).padStart(2, '0')).join('')
      _nuances.set(cle, v)
      return v
    }

    /* ══════════════════════ MOTEUR 2D ══════════════════════
     * Un dessin à l'échelle : ops posées dans l'ordre, style par op
     * (stroke/fill/width/dash), repère Y vers le haut, ajusté au cadre. */

    const STYLE_2D = {
      line: { stroke: '#2A2A28', width: 2 },
      arrow: { stroke: '#2A2A28', width: 2 },
      rect: { stroke: '#2A6FD6', fill: 'rgba(42,111,214,.10)', width: 2 },
      circle: { stroke: '#2A6FD6', fill: 'rgba(42,111,214,.10)', width: 2 },
      ellipse: { stroke: '#2A6FD6', fill: 'rgba(42,111,214,.10)', width: 2 },
      arc: { stroke: '#2A2A28', width: 2 },
      poly: { stroke: '#2A6FD6', fill: 'rgba(42,111,214,.10)', width: 2, closed: true },
      path: { stroke: '#2A2A28', width: 2 },
      text: { fill: '#1a1a1a', size: 11 },
      axes: { stroke: '#8a8a87', width: 1 },
    }

    const OPS_2D = new Set(['line', 'arrow', 'rect', 'circle', 'ellipse', 'arc', 'poly', 'path', 'text', 'axes'])

    function style2D (o) {
      const def = STYLE_2D[o.op] || STYLE_2D.line
      return {
        stroke: hexate(o.stroke ?? o.color, def.stroke),
        fill: o.fill === null ? null : (o.fill !== undefined ? String(o.fill) : (typeof def.fill === 'string' ? def.fill : null)),
        width: Math.max(0.5, reel(o.width, def.width)),
        dash: Array.isArray(o.dash) && o.dash.length > 0 ? o.dash.map((d) => Math.max(0, reel(d, 0))) : null,
        closed: o.closed !== undefined ? !!o.closed : (def.closed === true),
        size: Math.max(4, reel(o.size, def.size)),
        anchor: ['start', 'middle', 'end'].includes(o.anchor) ? o.anchor : 'start',
        bold: !!o.bold,
      }
    }

    function points2D (o) {
      switch (o.op) {
        case 'line': case 'arrow':
          return [[o.x1, o.y1], [o.x2, o.y2]]
        case 'rect':
          return [[o.x, o.y], [o.x + o.w, o.y + o.h]]
        case 'circle': case 'arc':
          return [[o.cx - o.r, o.cy - o.r], [o.cx + o.r, o.cy + o.r]]
        case 'ellipse':
          return [[o.cx - o.rx, o.cy - o.ry], [o.cx + o.rx, o.cy + o.ry]]
        case 'poly':
          return o.points
        case 'text':
          return [[o.x, o.y], [o.x + 0.62 * o.style.size * String(o.text ?? '').length, o.y + o.style.size]]
        default:
          return []
      }
    }

    /** Normalise les ops 2D : nombres par défaut, style résolu. Les ops
     * inconnues sont ignorées (une faute de frappe ne casse pas le dessin). */
    function normaliser2D (ops) {
      const hors = []
      for (const brut of Array.isArray(ops) ? ops : []) {
        const o = brut && typeof brut === 'object' ? brut : {}
        if (!OPS_2D.has(o.op)) continue
        const n = { op: o.op, group: typeof o.group === 'string' ? o.group : '', style: style2D(o) }
        switch (o.op) {
          case 'line': case 'arrow':
            Object.assign(n, { x1: reel(o.x1, 0), y1: reel(o.y1, 0), x2: reel(o.x2, 1), y2: reel(o.y2, 0) })
            break
          case 'rect':
            Object.assign(n, { x: reel(o.x, 0), y: reel(o.y, 0), w: Math.abs(reel(o.w, 10)), h: Math.abs(reel(o.h, 6)), r: Math.max(0, reel(o.r, 0)) })
            break
          case 'circle':
            Object.assign(n, { cx: reel(o.cx, 0), cy: reel(o.cy, 0), r: Math.max(0.01, reel(o.r, 5)) })
            break
          case 'ellipse':
            Object.assign(n, { cx: reel(o.cx, 0), cy: reel(o.cy, 0), rx: Math.max(0.01, reel(o.rx, 6)), ry: Math.max(0.01, reel(o.ry, 4)) })
            break
          case 'arc':
            Object.assign(n, { cx: reel(o.cx, 0), cy: reel(o.cy, 0), r: Math.max(0.01, reel(o.r, 5)), a0: reel(o.a0, 0), a1: reel(o.a1, 360), pie: !!o.pie })
            break
          case 'poly': {
            const pts = (Array.isArray(o.points) ? o.points : [])
              .map((p) => (Array.isArray(p) ? [reel(p[0], 0), reel(p[1], 0)] : null))
              .filter(Boolean)
            if (pts.length < 2) continue
            Object.assign(n, { points: pts })
            break
          }
          case 'path': {
            const cmds = parserChemin(typeof o.d === 'string' ? o.d : '')
            if (cmds.length === 0) continue
            Object.assign(n, { cmds })
            break
          }
          case 'text':
            Object.assign(n, { x: reel(o.x, 0), y: reel(o.y, 0), text: String(o.text ?? '') })
            break
          case 'axes':
            Object.assign(n, { x: reel(o.x, 0), y: reel(o.y, 0), w: reel(o.w, 100), h: reel(o.h, 100) })
            break
        }
        hors.push(n)
      }
      return hors
    }

    /** Mini-parseur de chemin SVG : M L H V C Q Z (absolus et relatifs). */
    function parserChemin (d) {
      const jetons = d.match(/[MmLlHhVvCcQqZz]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) || []
      const cmds = []
      let i = 0
      let cx = 0, cy = 0, depart = [0, 0]
      const nb = () => Number(jetons[i++])
      while (i < jetons.length) {
        const t = jetons[i++]
        const rel = t === t.toLowerCase()
        const T = t.toUpperCase()
        if (T === 'Z') { cmds.push({ t: 'Z', pts: [] }); cx = depart[0]; cy = depart[1]; continue }
        if (T === 'M' || T === 'L') {
          let x = nb(), y = nb()
          if (rel) { x += cx; y += cy }
          if (T === 'M') { depart = [x, y]; cmds.push({ t: 'M', pts: [[x, y]] }) } else cmds.push({ t: 'L', pts: [[x, y]] })
          cx = x; cy = y
        } else if (T === 'H') {
          let x = nb(); if (rel) x += cx
          cmds.push({ t: 'L', pts: [[x, cy]] }); cx = x
        } else if (T === 'V') {
          let y = nb(); if (rel) y += cy
          cmds.push({ t: 'L', pts: [[cx, y]] }); cy = y
        } else if (T === 'C') {
          const p = [[nb(), nb()], [nb(), nb()], [nb(), nb()]]
          if (rel) p.forEach((q) => { q[0] += cx; q[1] += cy })
          cmds.push({ t: 'C', pts: p }); cx = p[2][0]; cy = p[2][1]
        } else if (T === 'Q') {
          const p = [[nb(), nb()], [nb(), nb()]]
          if (rel) p.forEach((q) => { q[0] += cx; q[1] += cy })
          cmds.push({ t: 'Q', pts: p }); cx = p[1][0]; cy = p[1][1]
        }
      }
      return cmds
    }

    function bornes2D (ops) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
      for (const o of ops) {
        for (const p of points2D(o)) {
          x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1])
          x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1])
        }
        if (o.op === 'path') for (const c of o.cmds) for (const p of c.pts) {
          x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1])
          x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1])
        }
      }
      if (!Number.isFinite(x0)) return { x0: 0, y0: 0, x1: 100, y1: 60 }
      return { x0, y0, x1, y1 }
    }

    const palier = (brut) => {
      const p = Math.pow(10, Math.floor(Math.log10(Math.max(1e-9, brut))))
      const m = brut / p
      return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * p
    }

    function dessinerGrille (ctx, W, H, tr) {
      const b = tr.cadre
      const pas = palier((b.x1 - b.x0 + b.y1 - b.y0) / 14)
      ctx.strokeStyle = 'rgba(0,0,0,.055)'
      ctx.lineWidth = 1
      ctx.beginPath()
      const xg = Math.ceil(b.x0 / pas) * pas
      for (let x = xg; x <= b.x1 + pas * 0.01; x += pas) {
        const sx = tr.kx(x)
        ctx.moveTo(sx, 0); ctx.lineTo(sx, H)
      }
      const yg = Math.ceil(b.y0 / pas) * pas
      for (let y = yg; y <= b.y1 + pas * 0.01; y += pas) {
        const sy = tr.ky(y)
        ctx.moveTo(0, sy); ctx.lineTo(W, sy)
      }
      ctx.stroke()
    }

    function tracerChemin (ctx, cmds, tr) {
      let cx = 0, cy = 0, depart = [0, 0]
      for (const c of cmds) {
        if (c.t === 'Z') { ctx.closePath(); cx = depart[0]; cy = depart[1]; continue }
        if (c.t === 'M') {
          const [x, y] = c.pts[0]
          ctx.moveTo(tr.kx(x), tr.ky(y)); cx = x; cy = y; depart = [x, y]
        } else if (c.t === 'L') {
          const [x, y] = c.pts[0]
          ctx.lineTo(tr.kx(x), tr.ky(y)); cx = x; cy = y
        } else if (c.t === 'Q') {
          const [[x1, y1], [x, y]] = c.pts
          ctx.quadraticCurveTo(tr.kx(x1), tr.ky(y1), tr.kx(x), tr.ky(y)); cx = x; cy = y
        } else if (c.t === 'C') {
          const [[x1, y1], [x2, y2], [x, y]] = c.pts
          ctx.bezierCurveTo(tr.kx(x1), tr.ky(y1), tr.kx(x2), tr.ky(y2), tr.kx(x), tr.ky(y)); cx = x; cy = y
        }
      }
    }

    /** Dessine les ops 2D [0 … pose[ avec la transformation `tr` ({kx,ky}). */
    function dessiner2D (ctx, ops, pose, tr, opts) {
      if (opts && opts.grille) dessinerGrille(ctx, tr.W, tr.H, tr)
      for (let i = 0; i < Math.min(pose, ops.length); i++) {
        const o = ops[i]
        const s = o.style
        ctx.lineWidth = Math.max(0.6, s.width * tr.k)
        ctx.setLineDash(s.dash ? s.dash.map((d) => d * tr.k) : [])
        ctx.beginPath()
        switch (o.op) {
          case 'line': case 'arrow':
            ctx.moveTo(tr.kx(o.x1), tr.ky(o.y1)); ctx.lineTo(tr.kx(o.x2), tr.ky(o.y2))
            if (o.op === 'arrow') {
              const a = Math.atan2(tr.ky(o.y2) - tr.ky(o.y1), tr.kx(o.x2) - tr.kx(o.x1))
              const t = Math.max(6, ctx.lineWidth * 3.4)
              ctx.moveTo(tr.kx(o.x2), tr.ky(o.y2))
              ctx.lineTo(tr.kx(o.x2) - t * Math.cos(a - 0.42), tr.ky(o.y2) - t * Math.sin(a - 0.42))
              ctx.moveTo(tr.kx(o.x2), tr.ky(o.y2))
              ctx.lineTo(tr.kx(o.x2) - t * Math.cos(a + 0.42), tr.ky(o.y2) - t * Math.sin(a + 0.42))
            }
            ctx.strokeStyle = s.stroke; ctx.stroke()
            break
          case 'rect': {
            const x = tr.kx(o.x), y = tr.ky(o.y + o.h), w = o.w * tr.k, hh = o.h * tr.k
            const r = Math.min(o.r * tr.k, w / 2, hh / 2)
            if (r > 0) ctx.roundRect(x, y, w, hh, r)
            else ctx.rect(x, y, w, hh)
            if (s.fill) { ctx.fillStyle = s.fill; ctx.fill() }
            ctx.strokeStyle = s.stroke; ctx.stroke()
            break
          }
          case 'circle':
            ctx.arc(tr.kx(o.cx), tr.ky(o.cy), Math.max(0.4, o.r * tr.k), 0, TAU)
            if (s.fill) { ctx.fillStyle = s.fill; ctx.fill() }
            ctx.strokeStyle = s.stroke; ctx.stroke()
            break
          case 'ellipse':
            ctx.ellipse(tr.kx(o.cx), tr.ky(o.cy), Math.max(0.4, o.rx * tr.k), Math.max(0.4, o.ry * tr.k), 0, 0, TAU)
            if (s.fill) { ctx.fillStyle = s.fill; ctx.fill() }
            ctx.strokeStyle = s.stroke; ctx.stroke()
            break
          case 'arc': {
            const a0 = o.a0 * RAD, a1 = o.a1 * RAD
            const cx = tr.kx(o.cx), cy = tr.ky(o.cy), r = Math.max(0.4, o.r * tr.k)
            // Canvas tourne horaire en repère Y-bas ; en Y-haut on inverse.
            if (o.pie || s.fill) {
              ctx.moveTo(cx, cy)
              ctx.arc(cx, cy, r, -a0, -a1, a1 > a0)
              ctx.closePath()
              ctx.fillStyle = s.fill || 'rgba(42,111,214,.10)'; ctx.fill()
              ctx.strokeStyle = s.stroke; ctx.stroke()
            } else {
              ctx.arc(cx, cy, r, -a0, -a1, a1 > a0)
              ctx.strokeStyle = s.stroke; ctx.stroke()
            }
            break
          }
          case 'poly': {
            o.points.forEach((p, j) => {
              if (j === 0) ctx.moveTo(tr.kx(p[0]), tr.ky(p[1]))
              else ctx.lineTo(tr.kx(p[0]), tr.ky(p[1]))
            })
            if (s.closed) ctx.closePath()
            if (s.closed && s.fill) { ctx.fillStyle = s.fill; ctx.fill() }
            ctx.strokeStyle = s.stroke; ctx.stroke()
            break
          }
          case 'path':
            tracerChemin(ctx, o.cmds, tr)
            if (s.fill) { ctx.fillStyle = s.fill; ctx.fill() }
            ctx.strokeStyle = s.stroke; ctx.stroke()
            break
          case 'text': {
            const taille = Math.max(6, s.size * tr.k)
            ctx.font = (s.bold ? '600 ' : '') + taille.toFixed(1) + 'px ui-sans-serif,system-ui,sans-serif'
            ctx.textAlign = s.anchor
            ctx.textBaseline = 'alphabetic'
            ctx.fillStyle = s.fill
            ctx.fillText(o.text, tr.kx(o.x), tr.ky(o.y))
            break
          }
          case 'axes': {
            ctx.strokeStyle = s.stroke
            ctx.moveTo(tr.kx(o.x), tr.ky(o.y)); ctx.lineTo(tr.kx(o.x + o.w), tr.ky(o.y))
            ctx.moveTo(tr.kx(o.x), tr.ky(o.y)); ctx.lineTo(tr.kx(o.x), tr.ky(o.y + o.h))
            ctx.stroke()
            break
          }
        }
      }
      ctx.setLineDash([])
    }

    /* ══════════════════════ MOTEUR 3D ══════════════════════
     * Chaque op produit des FACETTES (polygones 3D). Rendu : projection
     * yaw/pitch, tri du peintre par profondeur du centroïde, ombrage par
     * normale (lamertien à deux faces). Assez pour des solides qui ne
     * s'interpénètrent pas trop — le domaine visé. */

    const COULEUR_DEFAUT = '#9BA3A7'

    function primitiveBoite (o, ajouter) {
      const x0 = o.x, y0 = o.y, z0 = o.z, x1 = x0 + o.w, y1 = y0 + o.d, z1 = z0 + o.h
      const faces = [
        [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
        [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]],
        [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]],
        [[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]],
        [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]],
      ]
      for (const f of faces) ajouter(f, o.color)
    }

    function primitiveRevolution (o, ajouter) {
      // cylindre / tronc de cône (r→r2) / cône (r2=0) — n pans.
      // `rot` (degrés) tourne le départ des pans : un cône à 4 pans avec
      // rot:45 a ses arêtes SUR les diagonales — toit aligné sur des murs.
      const n = clamp(entier(o.n, 22), 6, 64)
      const r0 = Math.max(0.001, reel(o.r, 3))
      const r1 = Math.max(0, reel(o.r2, 0))
      const dec = reel(o.rot, 0) * RAD
      const z0 = o.z, z1 = o.z + Math.max(0.01, reel(o.h, 3))
      const pt = (a, r, z) => [o.cx + r * Math.cos(a), o.cy + r * Math.sin(a), z]
      for (let i = 0; i < n; i++) {
        const a0 = dec + (i / n) * TAU, a1 = dec + ((i + 1) / n) * TAU
        ajouter([pt(a0, r0, z0), pt(a1, r0, z0), pt(a1, r1, z1), pt(a0, r1, z1)], o.color)
      }
      if (r1 > 0.001) {
        const haut = []
        for (let i = 0; i < n; i++) haut.push(pt(dec + (i / n) * TAU, r1, z1))
        ajouter(haut, o.color)
      }
      if (o.fond === true && r0 > 0.001) {
        const bas = []
        for (let i = 0; i < n; i++) bas.push(pt(dec + (i / n) * TAU, r0, z0))
        ajouter(bas, o.color)
      }
    }

    function primitiveTube (o, ajouter) {
      const n = clamp(entier(o.n, 22), 6, 64)
      const ro = Math.max(0.6, reel(o.r, 4))
      const ri = Math.max(0.2, reel(o.t, 1) > 0 ? ro - Math.abs(reel(o.t, 1)) : ro * 0.6)
      const z0 = o.z, z1 = o.z + Math.max(0.01, reel(o.h, 3))
      const pt = (a, r, z) => [o.cx + r * Math.cos(a), o.cy + r * Math.sin(a), z]
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * TAU, a1 = ((i + 1) / n) * TAU
        ajouter([pt(a0, ro, z0), pt(a1, ro, z0), pt(a1, ro, z1), pt(a0, ro, z1)], o.color)
        ajouter([pt(a0, ri, z1), pt(a1, ri, z1), pt(a1, ri, z0), pt(a0, ri, z0)], o.color)
        ajouter([pt(a0, ro, z1), pt(a1, ro, z1), pt(a1, ri, z1), pt(a0, ri, z1)], o.color)
        if (o.fond === true) ajouter([pt(a0, ro, z0), pt(a1, ro, z0), pt(a1, ri, z0), pt(a0, ri, z0)], o.color)
      }
    }

    function primitiveSphere (o, ajouter) {
      const n = clamp(entier(o.n, 18), 6, 40)
      const m = clamp(entier(o.m, 10), 4, 24)
      const r = Math.max(0.1, reel(o.r, 3))
      const pt = (i, j) => {
        const phi = (i / n) * TAU
        const the = (j / m) * Math.PI
        return [o.cx + r * Math.sin(the) * Math.cos(phi), o.cy + r * Math.sin(the) * Math.sin(phi), o.cz + r * Math.cos(the)]
      }
      for (let j = 0; j < m; j++) {
        for (let i = 0; i < n; i++) {
          const quad = [pt(i, j), pt(i + 1, j), pt(i + 1, j + 1), pt(i, j + 1)]
          ajouter(j === 0 ? [quad[0], quad[1], quad[2]] : quad, o.color)
        }
      }
    }

    function primitiveExtrude (o, ajouter) {
      const pts = (Array.isArray(o.points) ? o.points : [])
        .map((p) => (Array.isArray(p) ? [reel(p[0], 0), reel(p[1], 0)] : null))
        .filter(Boolean)
      if (pts.length < 3) return
      const z0 = o.z, z1 = o.z + Math.max(0.01, reel(o.h, 2))
      ajouter(pts.map((p) => [p[0], p[1], z1]), o.color)
      if (o.fond === true) ajouter(pts.map((p) => [p[0], p[1], z0]), o.color)
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length]
        ajouter([[a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1]], o.color)
      }
    }

    /** Construit UN objet 3D (une liste de facettes) depuis une op. */
    function objet3D (o) {
      const facets = []
      const ajouter = (pts, couleur) => facets.push({ pts, color: hexate(couleur, COULEUR_DEFAUT) })
      switch (o.op) {
        case 'box': case 'bloc': case 'pave':
          primitiveBoite({ x: reel(o.x, 0), y: reel(o.y, 0), z: reel(o.z, 0), w: Math.abs(reel(o.w, 4)), d: Math.abs(reel(o.d, 4)), h: Math.abs(reel(o.h, 4)), color: o.color }, ajouter)
          break
        case 'cyl': case 'cylindre':
          primitiveRevolution({ cx: reel(o.cx, 0), cy: reel(o.cy, 0), z: reel(o.z, 0), r: reel(o.r, 3), r2: reel(o.r2, 0), h: reel(o.h, 3), n: o.n, rot: o.rot, fond: o.fond, color: o.color }, ajouter)
          break
        case 'cone': case 'cône':
          primitiveRevolution({ cx: reel(o.cx, 0), cy: reel(o.cy, 0), z: reel(o.z, 0), r: reel(o.r, 3), r2: 0, h: reel(o.h, 4), n: o.n, rot: o.rot, fond: o.fond, color: o.color }, ajouter)
          break
        case 'sphere': case 'sphère': case 'boule':
          primitiveSphere({ cx: reel(o.cx, 0), cy: reel(o.cy, 0), cz: reel(o.cz, reel(o.r, 3)), r: reel(o.r, 3), n: o.n, m: o.m, color: o.color }, ajouter)
          break
        case 'tube': case 'anneau':
          primitiveTube({ cx: reel(o.cx, 0), cy: reel(o.cy, 0), z: reel(o.z, 0), r: reel(o.r, 4), t: reel(o.t, 1), h: reel(o.h, 3), n: o.n, fond: o.fond, color: o.color }, ajouter)
          break
        case 'extrude': case 'prisme':
          primitiveExtrude({ points: o.points, z: reel(o.z, 0), h: reel(o.h, 2), fond: o.fond, color: o.color }, ajouter)
          break
        default:
          return null
      }
      return facets.length > 0 ? { group: typeof o.group === 'string' ? o.group : '', facets } : null
    }

    const OPS_3D = new Set(['box', 'bloc', 'pave', 'cyl', 'cylindre', 'cone', 'cône', 'sphere', 'sphère', 'boule', 'tube', 'anneau', 'extrude', 'prisme'])

    /** Normalise les ops 3D en objets (une op = un objet posé). */
    function normaliser3D (ops) {
      const objets = []
      for (const brut of Array.isArray(ops) ? ops : []) {
        const o = brut && typeof brut === 'object' ? brut : {}
        if (!OPS_3D.has(o.op)) continue
        const objet = objet3D(o)
        if (objet) objets.push(objet)
      }
      return objets
    }

    function bornes3D (objets) {
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity
      for (const objet of objets) for (const f of objet.facets) for (const p of f.pts) {
        x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); z0 = Math.min(z0, p[2])
        x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); z1 = Math.max(z1, p[2])
      }
      if (!Number.isFinite(x0)) return { x0: -5, y0: -5, z0: 0, x1: 5, y1: 5, z1: 5 }
      return { x0, y0, z0, x1, y1, z1 }
    }

    function makeCam () { return { yaw: 38 * RAD, pitch: 27 * RAD, zoom: 1 } }

    const LUMIERE = (() => {
      const v = [0.45, -0.55, 0.7]
      const n = Math.hypot(...v)
      return v.map((x) => x / n)
    })()

    function normale (pts) {
      // Newell : robuste aux polygones non plans et concaves.
      let nx = 0, ny = 0, nz = 0
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length]
        nx += (a[1] - b[1]) * (a[2] + b[2])
        ny += (a[2] - b[2]) * (a[0] + b[0])
        nz += (a[0] - b[0]) * (a[1] + b[1])
      }
      const n = Math.hypot(nx, ny, nz)
      return n > 1e-9 ? [nx / n, ny / n, nz / n] : [0, 0, 1]
    }

    /** Ordre de dessin (loin → près). En vue rasante (pitch < 60°), un
     * PLAFOND interne — face horizontale vers le haut située sous le point
     * culminant du modèle (dessus d'un mur sous un toit, dessus d'un socle) —
     * se dessine en premier : le tri du centroïde le placerait faussement
     * devant des facettes inclinées plus hautes mais plus lointaines. Le
     * sommet du modèle (cheminée qui traverse le toit) n'est pas pénalisé ;
     * en vue Top, tri normal — tout doit s'y voir. */
    function ordonnerFacettes (facettes, pitch, zglob) {
      const pen = pitch < 1.047 ? 1e4 : 0
      return facettes
        .map((f) => ({
          f,
          cle: f.prof + (pen !== 0 && Math.abs(f.n[2]) > 0.99 && f.zmax < zglob - 0.01 ? pen : 0),
        }))
        .sort((a, b) => b.cle - a.cle)
        .map((e) => e.f)
    }

    /** Projette et dessine les objets 3D révélés. `ctx` peut être un
     * enregistreur de test : aucune API hors Canvas 2D standard. */
    function dessiner3D (ctx, W, H, objets, cam, opts) {
      const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw)
      const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch)
      const plat = (p) => ({
        sx: p[0] * cy + p[1] * sy,
        sy: -p[0] * sy * sp + p[1] * cy * sp + p[2] * cp,
        prof: -(p[0] * cp * sy - p[1] * cp * cy + p[2] * sp),
      })
      const facettes = []
      let zglob = -Infinity
      for (const objet of objets) {
        for (const f of objet.facets) {
          const proj = f.pts.map(plat)
          let profMax = -Infinity
          let zmax = -Infinity
          for (let i = 0; i < proj.length; i++) {
            if (proj[i].prof > profMax) profMax = proj[i].prof
            if (f.pts[i][2] > zmax) zmax = f.pts[i][2]
          }
          if (zmax > zglob) zglob = zmax
          // clé = point le PLUS LOIN de la facette : une grande face proche
          // (mur) se dessine tôt, une petite saillante (porte, débord) après
          // elle — le centroïde donnait l'inverse pour les grandes faces.
          facettes.push({ proj, prof: profMax, color: f.color, n: normale(f.pts), zmax })
        }
      }
      if (facettes.length === 0) return
      // cadre : bbox projetée → échelle
      let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity
      for (const f of facettes) for (const p of f.proj) {
        bx0 = Math.min(bx0, p.sx); by0 = Math.min(by0, p.sy)
        bx1 = Math.max(bx1, p.sx); by1 = Math.max(by1, p.sy)
      }
      const zoom = (opts && opts.zoom) || 1
      const echelle = Math.min((W - 28) / Math.max(1e-6, bx1 - bx0), (H - 28) / Math.max(1e-6, by1 - by0)) * zoom
      const ox = W / 2 - ((bx0 + bx1) / 2) * echelle
      const oy = H / 2 + ((by0 + by1) / 2) * echelle
      const px = (p) => ox + p.sx * echelle
      const py = (p) => oy - p.sy * echelle
      for (const f of ordonnerFacettes(facettes, cam.pitch, zglob)) {
        const lambert = Math.abs(f.n[0] * LUMIERE[0] + f.n[1] * LUMIERE[1] + f.n[2] * LUMIERE[2])
        ctx.fillStyle = nuance(f.color, 0.52 + 0.58 * lambert)
        ctx.strokeStyle = 'rgba(0,0,0,.16)'
        ctx.lineWidth = 0.75
        ctx.beginPath()
        f.proj.forEach((p, i) => { if (i === 0) ctx.moveTo(px(p), py(p)); else ctx.lineTo(px(p), py(p)) })
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
      }
    }

    /* ══════════════════════ EXÉCUTEUR D'OPS ══════════════════════ */

    /** Une commande reçue de l'hôte devient un modèle : espace + objets. */
    function construire (etat) {
      const espace = etat.espace === '2d' ? '2d' : '3d'
      if (espace === '2d') {
        const ops = normaliser2D(etat.ops)
        return { espace, ops, objets: [], lots: ops.length, desc: etat.prompt || '' }
      }
      const objets = normaliser3D(etat.ops)
      return { espace, ops: [], objets, lots: objets.length, desc: etat.prompt || '' }
    }

    /* ══════════════════════ DÉMOS (chips de l'état vide) ══════════════════════ */

    const DEMOS = {
      phare: {
        titre: 'Phare — démo 3D',
        espace: '3d',
        ops: [
          { op: 'cyl', cx: 0, cy: 0, z: 0, r: 7, r2: 6.4, h: 1.2, color: '#C3C8CB', group: 'Socle' },
          { op: 'sphere', cx: -5.2, cy: 3.4, cz: 0.9, r: 1.7, color: '#7C848A', group: 'Rochers' },
          { op: 'sphere', cx: 4.6, cy: -4.2, cz: 0.8, r: 1.4, color: '#7C848A', group: 'Rochers' },
          { op: 'cone', cx: 0, cy: 0, z: 1.2, r: 4.6, h: 15, color: '#EFE4C8', group: 'Tour', n: 26 },
          { op: 'cyl', cx: 0, cy: 0, z: 16.2, r: 3.6, h: 0.9, color: '#C4291C', group: 'Galerie' },
          { op: 'tube', cx: 0, cy: 0, z: 17.1, r: 2.5, t: 0.5, h: 2.6, color: '#D9C08C', group: 'Lanterne' },
          { op: 'sphere', cx: 0, cy: 0, cz: 18.4, r: 1.4, color: '#F2C31A', group: 'Lanterne' },
          { op: 'cone', cx: 0, cy: 0, z: 19.8, r: 2.9, h: 2.6, color: '#C4291C', group: 'Dôme', n: 24 },
          { op: 'cyl', cx: 0, cy: 0, z: 22.4, r: 0.16, h: 1.6, color: '#C4291C', group: 'Dôme' },
        ],
      },
      maison: {
        titre: 'Maison — démo 3D',
        espace: '3d',
        ops: [
          { op: 'box', x: -8, y: -7, z: 0, w: 16, d: 14, h: 0.7, color: '#4C9A52', group: 'Terrain' },
          { op: 'box', x: -5, y: -4, z: 0.7, w: 10, d: 8, h: 4.4, color: '#EFE4C8', group: 'Murs' },
          { op: 'cone', cx: 0, cy: 0, z: 5.1, r: 7.0, h: 3.4, color: '#8E1B14', group: 'Toit', n: 4, rot: 45 },
          { op: 'box', x: -1, y: -4.3, z: 0.7, w: 2, d: 0.6, h: 2.6, color: '#7A4E2B', group: 'Porte' },
          { op: 'box', x: 3.2, y: 1.4, z: 5.4, w: 1.4, d: 1.4, h: 3.2, color: '#9BA3A7', group: 'Cheminée' },
        ],
      },
      schema: {
        titre: 'Coupe A-A — démo 2D',
        espace: '2d',
        ops: [
          { op: 'axes', x: 0, y: 0, w: 96, h: 56 },
          { op: 'rect', x: 8, y: 8, w: 60, h: 40, stroke: '#2A2A28', fill: 'rgba(42,111,214,.06)', group: 'Viro' },
          { op: 'circle', cx: 38, cy: 28, r: 13, stroke: '#C4291C', fill: 'rgba(196,41,28,.08)', group: 'Axe' },
          { op: 'line', x1: 38, y1: 8, x2: 38, y2: 48, stroke: '#8a8a87', width: 1, dash: [4, 3], group: 'Axe' },
          { op: 'arrow', x1: 68, y1: 28, x2: 88, y2: 28, group: 'Flux' },
          { op: 'text', x: 90, y: 30, text: 'sortie', size: 8, group: 'Flux' },
          { op: 'text', x: 8, y: 54, text: 'coupe A-A — éch. 1:2', size: 7, anchor: 'start' },
          { op: 'text', x: 38, y: 29.5, text: 'Ø 26', size: 8, anchor: 'middle', bold: true },
        ],
      },
    }

    /* ══════════════════════ état partagé ══════════════════════
     * Le canevas est dessiné par une boucle rAF unique, PAS par React :
     * React ne rend que le chrome (titre, compteurs, transport). */

    const abonnes = new Set()
    let ETAT = { titre: 'Modeleur', version: -1, sessionId: '', espace: '3d', total: 0, pose: 0, lots: 0, enCours: false, desc: '', prompt: '', dureeMs: 0 }
    let MODELE = null
    let POSE = 0, POSE_MIN = 0, T0 = 0, DUREE = 8000, VITESSE = 1, EN_COURS = false
    const OUVERTURES_VUES = new Map() // sessionId → last reopen counter read (each session counts its own)
    let VERSION_VUE = -1, SESSION_VUE = ''
    let SESSION_ID = ''
    let SERVICE_SIDEBAR = null
    let CTX = null
    const CANEVAS = { el: null, cam: null, cam2d: null, spin: false, grille: true }
    // Traits dessinés par-dessus le modèle (pinceau) : normalisés 0..1,
    // renvoyés à l'hôte puis relus par l'agent via `modeliser { relire: true }`.
    let ANN = { version: 0, traits: [] }
    const PINCEAU = { on: false, coul: '#E1502A', outil: 'trait', trait: null, texte: null }
    const COULEURS_PEN = ['#E1502A', '#2A6FD6', '#F2C31A']
    const OUTILS_PEN = [
      { id: 'trait', label: '✏', titre: 'Trait libre' },
      { id: 'rect', label: '▭', titre: 'Rectangle' },
      { id: 'ellipse', label: '◯', titre: 'Ellipse' },
      { id: 'fleche', label: '➔', titre: 'Flèche' },
      { id: 'texte', label: 'A', titre: 'Texte' },
    ]

    /** Graine stable par annotation : le wobble rough.js ne vibre pas d'une frame à l'autre. */
    function graineDe (t) {
      let hh = 2166136261
      const s = (t?.type || 'trait') + JSON.stringify(t?.pts ?? [])
      for (let i = 0; i < s.length; i++) { hh ^= s.charCodeAt(i); hh = Math.imul(hh, 16777619) }
      return hh >>> 0
    }

    /** Trace les annotations (coords 0..1 → pixels du canevas).
     * trait → perfect-freehand (feutre) ; rect/ellipse/flèche → rough.js
     * (main levée) ; texte → fillText. Sans `type`, un trait libre. */
    function tracerAnnotations (ctx, W, H, annotations) {
      if (!Array.isArray(annotations) || annotations.length === 0) return
      const rc = LIB_ROUGH.canvas(ctx.canvas)
      ctx.save()
      for (const t of annotations) {
        if (!t) continue
        const coul = t.coul || '#E1502A'
        const type = t.type || 'trait'
        const opts = { stroke: coul, strokeWidth: 2.5, roughness: 1.1, seed: graineDe(t) }
        if (type === 'trait') {
          const pts = Array.isArray(t.pts) ? t.pts.map((p) => [p[0] * W, p[1] * H]) : []
          if (pts.length < 2) continue
          const contour = LIB_PF.getStroke(pts, { size: 6, thinning: 0.55, smoothing: 0.6, streamline: 0.5 })
          if (contour.length < 3) continue
          ctx.fillStyle = coul
          ctx.beginPath()
          ctx.moveTo(contour[0][0], contour[0][1])
          for (let i = 1; i < contour.length; i++) ctx.lineTo(contour[i][0], contour[i][1])
          ctx.closePath()
          ctx.fill()
        } else if (type === 'rect') {
          const a = t.pts?.[0], b = t.pts?.[1]
          if (!a || !b) continue
          rc.rectangle(Math.min(a[0], b[0]) * W, Math.min(a[1], b[1]) * H,
            Math.abs(b[0] - a[0]) * W, Math.abs(b[1] - a[1]) * H, opts)
        } else if (type === 'ellipse') {
          const a = t.pts?.[0], b = t.pts?.[1]
          if (!a || !b) continue
          rc.ellipse((a[0] + b[0]) / 2 * W, (a[1] + b[1]) / 2 * H,
            Math.abs(b[0] - a[0]) * W, Math.abs(b[1] - a[1]) * H, opts)
        } else if (type === 'fleche') {
          const a = t.pts?.[0], b = t.pts?.[1]
          if (!a || !b) continue
          const x0 = a[0] * W, y0 = a[1] * H, x1 = b[0] * W, y1 = b[1] * H
          rc.line(x0, y0, x1, y1, opts)
          const ang = Math.atan2(y1 - y0, x1 - x0), L = 12
          rc.line(x1, y1, x1 - L * Math.cos(ang - 0.5), y1 - L * Math.sin(ang - 0.5), opts)
          rc.line(x1, y1, x1 - L * Math.cos(ang + 0.5), y1 - L * Math.sin(ang + 0.5), opts)
        } else if (type === 'texte') {
          const p0 = t.pts?.[0]
          if (!p0 || typeof t.text !== 'string' || t.text.length === 0) continue
          ctx.fillStyle = coul
          ctx.font = '600 15px -apple-system, system-ui, sans-serif'
          ctx.textBaseline = 'bottom'
          ctx.fillText(t.text.slice(0, 240), p0[0] * W, p0[1] * H)
        }
      }
      ctx.restore()
    }

    async function envoyerTraits () {
      try {
        const r = await fetch(ROUTE_ANNOTE, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: SESSION_ID, strokes: ANN.traits }),
        })
        if (r.ok) {
          const j = await r.json()
          if (j && Number.isInteger(j.annVersion)) ANN.version = j.annVersion
        }
      } catch { /* hôte injoignable : les traits restent locaux */ }
    }

    function publier (patch) {
      ETAT = Object.assign({}, ETAT, patch)
      for (const f of Array.from(abonnes)) { try { f() } catch { /* un abonné mort ne casse pas la boucle */ } }
    }

    function poser () {
      const total = ETAT.total || 0
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
      ctx.clearRect(0, 0, W, H)
      if (MODELE.espace === '2d') {
        const b = bornes2D(MODELE.ops)
        const cam = CANEVAS.cam2d || (CANEVAS.cam2d = { zoom: 1, dx: 0, dy: 0 })
        const k = Math.min((W - 36) / Math.max(1e-6, b.x1 - b.x0), (H - 36) / Math.max(1e-6, b.y1 - b.y0)) * cam.zoom
        const tr = {
          W, H, k,
          cadre: b,
          kx: (x) => W / 2 + (x - (b.x0 + b.x1) / 2) * k + cam.dx,
          ky: (y) => H / 2 + ((b.y0 + b.y1) / 2 - y) * k + cam.dy,
        }
        dessiner2D(ctx, MODELE.ops, POSE, tr, { grille: CANEVAS.grille })
      } else {
        const cam = CANEVAS.cam || (CANEVAS.cam = makeCam())
        if (CANEVAS.spin) cam.yaw += 0.005
        dessiner3D(ctx, W, H, MODELE.objets.slice(0, Math.max(0, POSE)), cam, { zoom: cam.zoom })
      }
      tracerAnnotations(ctx, W, H, PINCEAU.trait !== null || PINCEAU.texte !== null
        ? ANN.traits.concat([PINCEAU.trait].filter(Boolean))
        : ANN.traits)
    }

    let RAF = 0
    let dernierPub = 0
    function boucle () {
      RAF = 0
      const anime = EN_COURS || CANEVAS.spin
      poser()
      if (CANEVAS.el) dessiner()
      const t = performance.now()
      if (t - dernierPub > 100) {
        dernierPub = t
        publier({ pose: POSE, enCours: EN_COURS, total: ETAT.total })
      }
      if (anime) RAF = requestAnimationFrame(boucle)
    }
    function reveiller () { if (!RAF) RAF = requestAnimationFrame(boucle) }

    /* ══════════════════════ hôte → panneau ══════════════════════ */

    function ouvrirOnglet () {
      // `sidebarRight` est lu À L'APPEL, pas au montage : un service manquant
      // laisserait la fibre « pending » pour toujours (leçon dsh-db-viewer).
      if (CTX !== null && SERVICE_SIDEBAR === null) {
        try { SERVICE_SIDEBAR = CTX.get('sidebarRight') } catch { SERVICE_SIDEBAR = null }
      }
      if (!SERVICE_SIDEBAR || typeof SERVICE_SIDEBAR.openTab !== 'function') return
      try { SERVICE_SIDEBAR.openTab(KIND, {}) } catch { /* pas de session montée */ }
    }

    function appliquer (etat) {
      if (!Array.isArray(etat.ops)) { ouvrirOnglet(); return }
      const autre = etat.sessionId !== SESSION_VUE
      const remplace = etat.mode === 'nouveau' || MODELE === null || autre || MODELE.espace !== (etat.espace === '2d' ? '2d' : '3d')
      if (remplace) {
        const c = construire(etat)
        MODELE = { espace: c.espace, ops: c.ops, objets: c.objets }
        // Un nouveau modèle = feuille neuve ; on restaire quand même les
        // traits connus de l'hôte (rechargement de page, modèle inchangé).
        ANN = etat.ann && Array.isArray(etat.ann.strokes)
          ? { version: etat.ann.version ?? 0, traits: etat.ann.strokes }
          : { version: 0, traits: [] }
        POSE_MIN = 0
        POSE = 0
        publier({
          titre: etat.titre || 'Modeleur',
          espace: c.espace,
          lots: c.lots,
          desc: c.desc || etat.prompt || '',
        })
      } else {
        // `modifier` : on rejoue TOUTES les ops (anciennes + neuves) et on
        // n'anime que ce qui dépasse l'ancien total — l'œil voit l'ajout.
        const avant = MODELE.espace === '2d' ? MODELE.ops.length : MODELE.objets.length
        const cru = (MODELE.brut || []).concat(Array.isArray(etat.ops) ? etat.ops : [])
        const c = construire({ espace: MODELE.espace, ops: cru })
        MODELE = { espace: c.espace, ops: c.ops, objets: c.objets, brut: cru }
        POSE_MIN = Math.min(avant, c.lots)
        POSE = POSE_MIN
        publier({ lots: c.lots, desc: etat.prompt || ETAT.desc })
      }
      if (remplace) MODELE.brut = Array.isArray(etat.ops) ? etat.ops.slice() : []
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
        total: MODELE.espace === '2d' ? MODELE.ops.length : MODELE.objets.length,
        pose: POSE,
        dureeMs: DUREE,
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
        // The agent asked to reopen the panel on the model it already has: open the tab, redraw nothing. The first
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
      const demo = DEMOS[cle]
      return h('button', {
        className: 'kbm-chip',
        onClick: () => {
          fetch(ROUTE_PUSH, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: SESSION_ID, espace: demo.espace, ops: demo.ops, titre: demo.titre, dureeMs: 9000 }),
          }).catch(() => {})
        },
      }, demo ? demo.titre : cle)
    }

    function PanneauModeleur (props) {
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
        if (el) {
          el.style.touchAction = 'none'
          const roue = (e) => {
            e.preventDefault()
            if (MODELE && MODELE.espace === '2d') {
              const cam = CANEVAS.cam2d || (CANEVAS.cam2d = { zoom: 1, dx: 0, dy: 0 })
              cam.zoom = clamp(cam.zoom * (e.deltaY > 0 ? 0.92 : 1.08), 0.3, 6)
            } else {
              const cam = CANEVAS.cam || (CANEVAS.cam = makeCam())
              cam.zoom = clamp(cam.zoom * (e.deltaY > 0 ? 0.92 : 1.08), 0.35, 3)
            }
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
        cam.yaw = (v === 'iso' ? 38 : 0) * RAD
        cam.pitch = (v === 'iso' ? 27 : v === 'front' ? 2 : 84) * RAD
        reveiller()
      }

      const pointNorm = (e) => {
        const r = e.currentTarget.getBoundingClientRect()
        return [
          clamp((e.clientX - r.left) / Math.max(1, r.width), 0, 1),
          clamp((e.clientY - r.top) / Math.max(1, r.height), 0, 1),
        ]
      }
      const onDown = (e) => {
        if (PINCEAU.on) {
          const p = pointNorm(e)
          if (PINCEAU.outil === 'texte') {
            PINCEAU.texte = { x: p[0], y: p[1], valeur: '' }
            maj()
            return
          }
          PINCEAU.trait = { type: PINCEAU.outil, coul: PINCEAU.coul, pts: [p] }
          try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* pas de capture */ }
          reveiller()
          return
        }
        glisse.current = { x: e.clientX, y: e.clientY }
        try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* pas de capture */ }
        maj()
      }
      const onMove = (e) => {
        if (PINCEAU.trait !== null) {
          const t = PINCEAU.trait
          const p = pointNorm(e)
          if (t.type === 'trait') {
            const pts = t.pts
            const d = pts.length > 0 ? Math.hypot(p[0] - pts[pts.length - 1][0], p[1] - pts[pts.length - 1][1]) : 1
            if (d > 0.004) pts.push(p)
          } else if (t.pts.length === 1) {
            t.pts.push(p)
          } else {
            t.pts[1] = p
          }
          reveiller()
          return
        }
        const g = glisse.current
        if (!g) return
        const dx = e.clientX - g.x, dy = e.clientY - g.y
        if (MODELE && MODELE.espace === '2d') {
          const cam = CANEVAS.cam2d || (CANEVAS.cam2d = { zoom: 1, dx: 0, dy: 0 })
          cam.dx += dx; cam.dy += dy
        } else {
          const cam = CANEVAS.cam || (CANEVAS.cam = makeCam())
          cam.yaw += dx * 0.006
          cam.pitch = clamp(cam.pitch - dy * 0.005, 0, 1.5)
        }
        glisse.current = { x: e.clientX, y: e.clientY }
        reveiller()
      }
      const validerTexte = () => {
        const tx = PINCEAU.texte
        PINCEAU.texte = null
        if (tx && typeof tx.valeur === 'string' && tx.valeur.trim().length > 0) {
          ANN.traits.push({ type: 'texte', coul: PINCEAU.coul, pts: [[tx.x, tx.y]], text: tx.valeur.trim().slice(0, 240) })
          if (ANN.traits.length > 60) ANN.traits.shift()
          envoyerTraits()
        }
        reveiller()
        maj()
      }
      const onUp = () => {
        if (PINCEAU.trait !== null) {
          const t = PINCEAU.trait
          PINCEAU.trait = null
          const ok = t.type === 'trait'
            ? t.pts.length >= 2
            : t.pts.length === 2 && Math.hypot(t.pts[1][0] - t.pts[0][0], t.pts[1][1] - t.pts[0][1]) > 0.012
          if (ok) {
            ANN.traits.push(t)
            if (ANN.traits.length > 60) ANN.traits.shift()
            envoyerTraits()
          }
          reveiller()
          maj()
          return
        }
        glisse.current = null
        maj()
      }

      const total = ETAT.total || 0
      const pose = Math.min(total, ETAT.pose || 0)
      const pct = total ? Math.round((100 * pose) / total) : 0
      const en2d = ETAT.espace === '2d'
      const unite = en2d ? 'traits' : 'objets'

      const barre = h('div', { className: 'kbm-foot' },
        h('div', { className: 'kbm-line' },
          h('button', { className: 'kbm-step', title: 'Début', onClick: () => { POSE = 0; EN_COURS = false; publier({ pose: 0, enCours: false }); reveiller() } }, '\u25C0\u25C0'),
          h('button', {
            className: 'kbm-play',
            title: EN_COURS ? 'Pause' : 'Relire',
            onClick: () => {
              if (EN_COURS) { EN_COURS = false; publier({ enCours: false }); reveiller(); return }
              POSE_MIN = 0; POSE = 0; T0 = performance.now(); DUREE = DUREE_BUILD; EN_COURS = true
              publier({ enCours: true }); reveiller()
            },
          }, EN_COURS ? '\u23F8' : '\u25B6'),
          h('button', { className: 'kbm-step', title: 'Fin', onClick: () => { POSE = total; EN_COURS = false; publier({ pose: total, enCours: false }); reveiller() } }, '\u25B6\u25B6'),
          h('button', { className: 'kbm-sp' + (VITESSE === 0.5 ? ' on' : ''), onClick: () => { VITESSE = 0.5; maj() } }, '0.5\u00D7'),
          h('button', { className: 'kbm-sp' + (VITESSE === 1 ? ' on' : ''), onClick: () => { VITESSE = 1; maj() } }, '1\u00D7'),
          h('button', { className: 'kbm-sp' + (VITESSE === 2 ? ' on' : ''), onClick: () => { VITESSE = 2; maj() } }, '2\u00D7'),
          h('button', { className: 'kbm-sp' + (VITESSE === 4 ? ' on' : ''), onClick: () => { VITESSE = 4; maj() } }, '4\u00D7'),
          h('span', { className: 'kbm-badge' + (EN_COURS ? ' run' : '') }, total ? (EN_COURS ? pct + ' %' : 'Fini') : '\u2014'),
        ),
        h('div', { className: 'kbm-track', style: { marginTop: '7px' } },
          h('div', { className: 'kbm-lab' },
            h('b', {}, pose.toLocaleString('fr-FR')),
            ' / ' + total.toLocaleString('fr-FR') + ' ' + unite + ' \u00B7 ' + (ETAT.lots || 0) + ' lots'),
          h('input', {
            className: 'kbm-range', type: 'range', min: 0, max: Math.max(1, total), value: pose,
            onChange: (e) => { POSE = Number(e.target.value); EN_COURS = false; publier({ pose: POSE, enCours: false }); reveiller() },
          })),
        ETAT.desc ? h('div', { className: 'kbm-note', title: ETAT.desc }, ETAT.desc) : null,
        ANN.traits.length > 0
          ? h('div', { className: 'kbm-note' },
              `✏️ ${ANN.traits.length} trait(s) dessinés par-dessus — demande au chat : « réajuste d'après mes traits »`)
          : null,
      )

      const vide = h('div', { className: 'kbm-empty' },
        h('div', {}, h('b', {}, 'Aucun modèle pour le moment')),
        h('div', {}, 'Demande au chat : ', h('code', {}, 'dessine un phare en 3D')),
        h('div', { className: 'kbm-chips' }, ...Object.keys(DEMOS).map((cle) => h(Apercu, { key: cle, cle }))),
      )

      // `kbmo`: this panel's own class. `.kbm-root` alone is also the root of the AI Provider & Models page (`kbm-root kbmp`) and of the core's
      // Models page, so the mini-apps plugin cannot find the Modeleur by it (scripts/test-miniapps-panels.mjs).
      return h('div', { className: 'kbm-root kbmo' },
        h('div', { className: 'kbm-head' },
          h('span', { className: 'kbm-title', title: ETAT.titre }, ETAT.titre || 'Modeleur'),
          h('span', { className: 'kbm-badge' }, en2d ? '2D' : '3D')),
        h('div', { className: 'kbm-view' },
          h('canvas', {
            ref: cvRef,
            className: glisse.current ? 'kbm-drag' : '',
            style: PINCEAU.on ? { cursor: 'crosshair', touchAction: 'none' } : undefined,
            onPointerDown: onDown, onPointerMove: onMove, onPointerUp: onUp, onPointerCancel: onUp,
          }),
          !total ? vide : null,
          PINCEAU.texte !== null
            ? h('input', {
                className: 'kbm-saisie',
                style: { left: `${PINCEAU.texte.x * 100}%`, top: `calc(${PINCEAU.texte.y * 100}% - 22px)`, color: PINCEAU.coul },
                autoFocus: true,
                placeholder: 'ton texte…',
                onInput: (e) => { PINCEAU.texte.valeur = e.currentTarget.value },
                onKeyDown: (e) => {
                  if (e.key === 'Enter') validerTexte()
                  else if (e.key === 'Escape') { PINCEAU.texte = null; maj() }
                },
                onBlur: validerTexte,
              })
            : null,
          total ? h('div', { className: 'kbm-tools' },
            h('button', {
              className: 'kbm-tool' + (PINCEAU.on ? ' on' : ''),
              title: 'Dessiner par-dessus — le chat relit tes traits et réajuste',
              onClick: () => { PINCEAU.on = !PINCEAU.on; PINCEAU.trait = null; maj() },
            }, '✏'),
            PINCEAU.on
              ? [
                  ...OUTILS_PEN.map((o) => h('button', {
                    key: o.id,
                    className: 'kbm-tool' + (PINCEAU.outil === o.id ? ' on' : ''),
                    title: o.titre,
                    onClick: () => { PINCEAU.outil = o.id; PINCEAU.trait = null; PINCEAU.texte = null; maj() },
                  }, o.label)),
                  ...COULEURS_PEN.map((c) => h('button', {
                    key: c,
                    className: 'kbm-coul' + (PINCEAU.coul === c ? ' on' : ''),
                    style: { background: c },
                    onClick: () => { PINCEAU.coul = c; maj() },
                  })),
                ]
              : null,
            h('button', {
              className: 'kbm-tool',
              title: 'Effacer tous mes traits',
              onClick: () => { ANN.traits = []; PINCEAU.trait = null; envoyerTraits(); reveiller(); maj() },
            }, 'Effacer'),
            en2d
              ? [
                  h('button', { className: 'kbm-tool' + (CANEVAS.grille ? ' on' : ''), onClick: (e) => { CANEVAS.grille = !CANEVAS.grille; e.currentTarget.classList.toggle('on', CANEVAS.grille); reveiller() } }, 'Grille'),
                  h('button', {
                    className: 'kbm-tool',
                    onClick: () => { CANEVAS.cam2d = { zoom: 1, dx: 0, dy: 0 }; reveiller() },
                  }, 'Ajuster'),
                ]
              : [
                  h('button', { className: 'kbm-tool' + (vue === 'iso' ? ' on' : ''), onClick: () => vueCam('iso') }, '3/4'),
                  h('button', { className: 'kbm-tool' + (vue === 'front' ? ' on' : ''), onClick: () => vueCam('front') }, 'Front'),
                  h('button', { className: 'kbm-tool' + (vue === 'top' ? ' on' : ''), onClick: () => vueCam('top') }, 'Top'),
                  h('button', {
                    className: 'kbm-tool' + (CANEVAS.spin ? ' on' : ''),
                    onClick: (e) => { CANEVAS.spin = !CANEVAS.spin; e.currentTarget.classList.toggle('on', CANEVAS.spin); reveiller() },
                  }, 'Spin'),
                ]) : null),
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
      }, 'kybernos-modeleur: styles')

      try { SERVICE_SIDEBAR = ctx.get('sidebarRight') } catch { SERVICE_SIDEBAR = null }
      try {
        const ui = ctx.get('uiSession')
        const cle = ui && ui.adapter && ui.adapter.current ? ui.adapter.current.getSnapshot().key : ''
        if (typeof cle === 'string' && cle.length > 0) SESSION_ID = cle
      } catch { /* la route retombe sur la dernière commande déposée */ }

      let registre = null
      try { registre = ctx.get('sidebarRightTabs') } catch { registre = null }
      if (registre && typeof registre.register === 'function') {
        ctx.effect(() => registre.register({
          id: TYPE_ID,
          kind: KIND,
          title: () => 'Modeleur',
          guide: [{ title: () => 'Modeleur', description: () => 'Modèles 2D et 3D pilotés par le chat : dessin à l\'échelle, solides orbitables, pose en direct puis relecture.' }],
        }), 'kybernos-modeleur: type d onglet barre latérale droite')
      }

      ctx.effect(() => ctx.slots.inject(SLOT, () => ctx.slots.register(
        { name: SLOT, key: TYPE_ID }, PanneauModeleur)), 'kybernos-modeleur: corps de panneau')

      ctx.effect(() => {
        interroger()
        const t = setInterval(interroger, CADENCE_MS)
        return () => clearInterval(t)
      }, 'kybernos-modeleur: sonde de l hote')
    }

    return {
      // `sidebarRightTabs` DOIT être déclaré : fourni par ui-sidebar-right,
      // sans cette déclaration notre `apply` tournerait AVANT le provide.
      inject: ['slots', 'sidebarRightTabs'],
      apply,
      // Surface de test : le harnais monte les moteurs et l'exécuteur d'ops
      // sans navigateur — aucun rendu React n'est nécessaire pour les vérifier.
      __test: { normaliser2D, normaliser3D, bornes2D, bornes3D, dessiner2D, dessiner3D, construire, DEMOS, makeCam, OPS_2D, OPS_3D, parserChemin, ordonnerFacettes, tracerAnnotations, graineDe, traitsAnn: () => ANN.traits, poserTraits: (t) => { ANN.traits = t }, pinceau: PINCEAU },
    }
  }
})
