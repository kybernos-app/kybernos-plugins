// Charts of the deck: drawn as SVG from the JSON in the block's data-chart (column, bar, line, doughnut). Nothing is stored in the markup but that JSON.
import { getLang } from './i18n.js'

const fmt = (n) => n.toLocaleString(getLang() === 'fr' ? 'fr-FR' : 'en-US', { maximumFractionDigits: 1 })
const PAL_LIGHT = ['#1E2761', '#3A6EA5', '#D4A843', '#9AA7B5', '#7A8A94'];
const PAL_DARK = ['#CADCFC', '#6FA0D8', '#D4A843', '#9AA7B5', '#7A8A94'];
// What a chart is drawn with: set from the slide it sits on (a dark slide gets light text, faint grid lines and a first colour that shows on it).
let PAL = PAL_LIGHT, INK = '#555', GRID = '#e3e7ef', DARK = false;
function nice(max) {
  for (const k of [-1, 0, 1, 2, 3]) for (const m of [1, 2, 2.5, 5]) { const st = m * 10 ** k; if (Math.ceil(max / st) <= 6) return { st, top: Math.ceil(max / st) * st }; }
  return { st: max / 5, top: max };
}
const TX = (x, y, s, o = {}) => `<text x="${x}" y="${y}" font-size="${o.size || 20}" fill="${o.fill || INK}" text-anchor="${o.anchor || 'middle'}" ${o.bold ? 'font-weight="700"' : ''}>${s}</text>`;
function legend(W, H, series, names, x0) {
  const items = names.map((n, i) => ({ n, c: series[i] }));
  const w = items.reduce((a, it) => a + 40 + it.n.length * 11, 0); let x = x0 ?? (W - w) / 2, o = '';
  for (const it of items) { o += `<rect x="${x}" y="${H - 28}" width="16" height="16" rx="3" fill="${it.c}"/>` + TX(x + 24, H - 14, it.n, { anchor: 'start', size: 19 }); x += 40 + it.n.length * 11; }
  return o;
}
export function drawChart (el) {
  const d = JSON.parse(el.dataset.chart), W = +el.dataset.w, H = +el.dataset.h, cats = d.categories, S = d.series;
  DARK = !!(el.closest && el.closest('.slide.dark'));
  PAL = DARK ? PAL_DARK : PAL_LIGHT; INK = DARK ? '#E6ECF8' : '#555'; GRID = DARK ? 'rgba(255,255,255,.2)' : '#e3e7ef';
  const col = (s, i) => s.color || PAL[i % PAL.length];
  let g = '';
  if (d.type === 'doughnut') {
    const vals = S[0].values, tot = vals.reduce((a, b) => a + b, 0), lw = d.legend === 'right' ? 250 : 0;
    const cx = (W - lw) / 2, cy = H / 2, R = Math.min(cx, cy) - 14, r = R * .58; let a = -Math.PI / 2;
    vals.forEach((v, i) => {
      const b = a + v / tot * 2 * Math.PI, big = b - a > Math.PI ? 1 : 0, p = (rr, t) => `${cx + rr * Math.cos(t)} ${cy + rr * Math.sin(t)}`;
      g += `<path d="M${p(R, a)}A${R} ${R} 0 ${big} 1 ${p(R, b)}L${p(r, b)}A${r} ${r} 0 ${big} 0 ${p(r, a)}Z" fill="${PAL[i % PAL.length]}" stroke="#fff" stroke-width="3"/>`;
      if (d.labels) { const m = (a + b) / 2, rr = (R + r) / 2; g += TX(cx + rr * Math.cos(m), cy + rr * Math.sin(m) + 7, v + (getLang() === 'fr' ? ' %' : '%'), { fill: i === 2 || (DARK && i === 0) ? '#1E2761' : '#fff', bold: true, size: 22 }); }
      a = b;
    });
    cats.forEach((c, i) => { const y = H / 2 - cats.length * 20 + i * 40; g += `<rect x="${W - lw + 10}" y="${y}" width="18" height="18" rx="3" fill="${PAL[i % PAL.length]}"/>` + TX(W - lw + 38, y + 15, c, { anchor: 'start', size: 22 }); });
  } else {
    const max = Math.max(...S.flatMap(s => s.values)), sc = nice(max), lg = d.legend === 'bottom' ? 46 : 0;
    const horiz = d.type === 'bar', L = horiz ? 190 : 70, R = 30, Tp = 24, B = lg + (horiz ? 30 : 40);
    const pw = W - L - R, ph = H - Tp - B;
    for (let v = 0; v <= sc.top + 1e-9; v += sc.st) {
      if (horiz) { const x = L + v / sc.top * pw; g += `<line x1="${x}" y1="${Tp}" x2="${x}" y2="${Tp + ph}" stroke="${GRID}"/>` + TX(x, Tp + ph + 26, fmt(v), { size: 18 }); }
      else { const y = Tp + ph - v / sc.top * ph; g += `<line x1="${L}" y1="${y}" x2="${L + pw}" y2="${y}" stroke="${GRID}"/>` + TX(L - 10, y + 6, fmt(v), { anchor: 'end', size: 18 }); }
    }
    if (d.type === 'line') {
      S.forEach((s, si) => {
        const pts = s.values.map((v, i) => [L + (i + .5) / cats.length * pw, Tp + ph - v / sc.top * ph]);
        g += `<polyline points="${pts.map(p => p.join(',')).join(' ')}" fill="none" stroke="${col(s, si)}" stroke-width="4" stroke-linejoin="round"/>` + pts.map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="7" fill="#fff" stroke="${col(s, si)}" stroke-width="4"/>`).join('');
      });
      cats.forEach((c, i) => { g += TX(L + (i + .5) / cats.length * pw, Tp + ph + 28, c, { size: 20 }); });
    } else {
      const gw = (horiz ? ph : pw) / cats.length, bw = gw * .66 / S.length;
      cats.forEach((c, i) => {
        const g0 = i * gw + gw * .17;
        S.forEach((s, si) => {
          const v = s.values[i], len = v / sc.top * (horiz ? pw : ph), o = g0 + si * bw;
          if (horiz) { g += `<rect x="${L}" y="${Tp + o}" width="${len}" height="${bw}" fill="${col(s, si)}"/>`; if (d.labels) g += TX(L + len + 8, Tp + o + bw / 2 + 7, fmt(v), { anchor: 'start', bold: true, size: 22 }); }
          else { g += `<rect x="${L + o}" y="${Tp + ph - len}" width="${bw}" height="${len}" fill="${col(s, si)}"/>`; if (d.labels) g += TX(L + o + bw / 2, Tp + ph - len - 9, fmt(v), { bold: true, size: 22 }); }
        });
        g += horiz ? TX(L - 12, Tp + i * gw + gw / 2 + 7, c, { anchor: 'end', size: 22 }) : TX(L + i * gw + gw / 2, Tp + ph + 30, c, { size: 21 });
      });
    }
    if (d.legend === 'bottom') g += legend(W, H, S.map(col), S.map(s => s.name));
  }
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Calibri,Carlito,Arial,sans-serif" aria-hidden="true">${g}</svg>`;
}
