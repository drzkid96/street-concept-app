// 11x17 landscape concept sheets, drawn with pdf-lib. Albert Sans embedded (OFL, from fp-core-brand).
import { PDFDocument, rgb, type PDFFont, type PDFPage, type PDFImage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { Section, Segment, ProjectFile } from './types';
import { ELEMENTS, CONVENTIONS, materialOf } from './standards';
import { loadKnowledge, priceConcept, waterfall, money } from './cost';

const W = 1224, H = 792, M = 36;             // 17 x 11 in, 0.5 in margin
const hex = (h: string) => { const n = parseInt(h.slice(1), 16); return rgb((n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255); };
const C = { slate: hex('#00242E'), emerald: hex('#00574A'), jade: hex('#1B795A'), lg: hex('#6BD688'), pale: hex('#D9F1D6'), cream: hex('#EEEDE8'), band: hex('#F2F2F2'), grid: hex('#E7E8E8'), white: rgb(1, 1, 1), muted: hex('#5b6b70') };
const FILL: Record<string, string> = { sidewalk: '#C9C6BD', curb: '#C9C6BD', parkway: '#7FA65A', median: '#7FA65A', bike_lane: '#2E8B57', separated_bikeway: '#2E8B57', bus_lane: '#C8102E' };

interface Fonts { r: PDFFont; s: PDFFont; b: PDFFont }

// Fit text to a width: shrink to a floor, then truncate with an ellipsis. Prevents overlap and clipping.
function fit(f: PDFFont, t: string, size: number, maxW: number, min = 7) {
  let s = size;
  while (s > min && f.widthOfTextAtSize(t, s) > maxW) s -= 0.5;
  let txt = t;
  while (txt.length > 1 && f.widthOfTextAtSize(txt, s) > maxW) txt = txt.slice(0, -2) + '…';
  return { txt, s };
}
function text(p: PDFPage, f: PDFFont, t: string, x: number, y: number, size: number, maxW: number, color = C.slate, align: 'l' | 'c' | 'r' = 'l') {
  const { txt, s } = fit(f, t, size, maxW);
  const w = f.widthOfTextAtSize(txt, s);
  p.drawText(txt, { x: align === 'c' ? x + (maxW - w) / 2 : align === 'r' ? x + maxW - w : x, y, size: s, font: f, color });
}

function wrap(p: PDFPage, f: PDFFont, t: string, x: number, y: number, size: number, maxW: number, color = C.slate, lh = 1.3) {
  const words = t.split(' '); let line = '', yy = y;
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (f.widthOfTextAtSize(test, size) > maxW && line) { p.drawText(line, { x, y: yy, size, font: f, color }); yy -= size * lh; line = w; }
    else line = test;
  }
  if (line) p.drawText(line, { x, y: yy, size, font: f, color });
  return yy;
}
const SHORT: Record<string, string> = { separated_bikeway: 'Class IV', bike_lane: 'Bike lane', bike_buffer: 'Buffer', travel_lane: 'Travel lane', turn_lane: 'Turn lane', bus_lane: 'Bus lane' };

function drawSection(p: PDFPage, F: Fonts, sec: Section, title: string, x: number, y: number, w: number, h: number) {
  text(p, F.s, title.toUpperCase(), x, y + h - 14, 13, w * 0.7);
  const total = sec.elements.reduce((a, e) => a + e.width_ft, 0) || 1;
  text(p, F.r, `${total}' TOTAL`, x, y + h - 14, 10, w, C.slate, 'r');
  const k = w / total, roadY = y + 46, roadH = h - 80;
  let cx = x;
  for (const e of sec.elements) {
    const ew = e.width_ft * k, mat = materialOf(e.type, e.material);
    const raised = ['sidewalk', 'parkway', 'median', 'curb'].includes(e.type) || mat === 'raised';
    let fill = FILL[e.type] ?? '#4A4F54';
    if (mat === 'unpainted') fill = '#4A4F54';
    if (e.type === 'median' && mat === 'concrete') fill = '#C9C6BD';
    p.drawRectangle({ x: cx, y: roadY, width: ew, height: roadH + (raised ? 6 : 0), color: hex(fill), borderColor: C.white, borderWidth: 0.75 });
    if (e.type === 'bus_lane' && ew > 34) text(p, F.b, CONVENTIONS.bus_lane_text, cx + 2, roadY + roadH / 2, 9, ew - 4, C.white, 'c');
    if (e.direction === 'inbound' || e.direction === 'outbound') {
      const d = e.direction === 'outbound' ? 1 : -1, ax = cx + ew / 2, ay = roadY + 14;
      p.drawLine({ start: { x: ax - 8 * d, y: ay }, end: { x: ax + 8 * d, y: ay }, thickness: 1.5, color: C.white });
      p.drawLine({ start: { x: ax + 8 * d, y: ay }, end: { x: ax + 3 * d, y: ay + 4 }, thickness: 1.5, color: C.white });
      p.drawLine({ start: { x: ax + 8 * d, y: ay }, end: { x: ax + 3 * d, y: ay - 4 }, thickness: 1.5, color: C.white });
    }
    if (mat === 'posts') p.drawRectangle({ x: cx + (e.type === 'separated_bikeway' ? 2 : ew / 2 - 1.5), y: roadY + roadH, width: 3, height: 18, color: C.white, borderColor: hex('#C8102E'), borderWidth: 0.6 });
    p.drawLine({ start: { x: cx, y: roadY - 4 }, end: { x: cx, y: roadY - 10 }, thickness: 0.5, color: C.slate });
    text(p, F.s, SHORT[e.type] ?? ELEMENTS[e.type].label, cx + 1, roadY - 22, 8, ew - 2, C.slate, 'c');
    text(p, F.r, `${e.width_ft}'`, cx + 1, roadY - 33, 8, ew - 2, C.slate, 'c');
    cx += ew;
  }
  p.drawLine({ start: { x: cx, y: roadY - 4 }, end: { x: cx, y: roadY - 10 }, thickness: 0.5, color: C.slate });
}

function table(p: PDFPage, F: Fonts, x: number, yTop: number, cols: { h: string; w: number; r?: boolean }[], rows: string[][], rowH = 18) {
  let y = yTop - rowH, cx = x;
  const tw = cols.reduce((a, c) => a + c.w, 0);
  p.drawRectangle({ x, y, width: tw, height: rowH, color: C.emerald });
  cols.forEach(c => { text(p, F.s, c.h, cx + 5, y + rowH / 2 - 3.5, 9, c.w - 10, C.white, c.r ? 'r' : 'l'); cx += c.w; });
  rows.forEach((r, i) => {
    y -= rowH; cx = x;
    if (i % 2) p.drawRectangle({ x, y, width: tw, height: rowH, color: C.band });
    p.drawLine({ start: { x, y }, end: { x: x + tw, y }, thickness: 0.5, color: C.cream });
    cols.forEach((c, j) => { text(p, j === 0 ? F.s : F.r, r[j] ?? '', cx + 5, y + rowH / 2 - 3.5, 9, c.w - 10, C.slate, c.r ? 'r' : 'l'); cx += c.w; });
  });
  return y;
}

function titleBlock(p: PDFPage, F: Fonts, pf: ProjectFile, seg: Segment, title: string, n: number, of: number) {
  const h = 54, y = M;
  p.drawRectangle({ x: M, y, width: W - 2 * M, height: h, color: C.slate });
  text(p, F.b, (pf.project.name || 'Untitled corridor').toUpperCase(), M + 14, y + 30, 16, 520, C.white);
  text(p, F.r, [seg.limits.from, seg.limits.to].filter(Boolean).join(' to ') || 'Segment limits not set', M + 14, y + 12, 10, 520, hex('#D9F1D6'));
  text(p, F.s, title.toUpperCase(), M + 560, y + 30, 13, 360, C.lg);
  text(p, F.r, `Planning-level concept. ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`, M + 560, y + 12, 9, 360, C.white);
  text(p, F.b, `${n} / ${of}`, W - M - 120, y + 20, 16, 106, C.white, 'r');
}

async function image(doc: PDFDocument, src: string): Promise<PDFImage | null> {
  try {
    const bytes = await fetch(src).then(r => r.arrayBuffer());
    const u8 = new Uint8Array(bytes);
    return u8[0] === 0x89 ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  } catch { return null; }
}
function drawImageFit(p: PDFPage, img: PDFImage, x: number, y: number, w: number, h: number) {
  const k = Math.min(w / img.width, h / img.height), iw = img.width * k, ih = img.height * k;
  p.drawImage(img, { x: x + (w - iw) / 2, y: y + (h - ih) / 2, width: iw, height: ih });
}

export async function buildSheets(pf: ProjectFile): Promise<Uint8Array> {
  const seg = pf.segments[0];
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const base = import.meta.env.BASE_URL;
  const load = (n: string) => fetch(`${base}fonts/AlbertSans-${n}.ttf`).then(r => r.arrayBuffer());
  const F: Fonts = { r: await doc.embedFont(await load('Regular'), { subset: true }), s: await doc.embedFont(await load('SemiBold'), { subset: true }), b: await doc.embedFont(await load('Bold'), { subset: true }) };
  doc.setTitle(`${pf.project.name || 'Street concept'} concept sheets`);
  doc.setCreator('Street Concept App');
  const k = await loadKnowledge();
  const priced = seg.alternatives.map(a => { if (!k) return { a, lines: [] as ReturnType<typeof priceConcept>['lines'], w: null }; const { lines } = priceConcept(k, seg.existing, a.section, seg.length_ft); return { a, lines, w: waterfall(k, lines) }; });
  const of = 1 + seg.alternatives.length;

  // Sheet 1: overview
  {
    const p = doc.addPage([W, H]);
    titleBlock(p, F, pf, seg, 'Overview and existing', 1, of);
    const top = H - M;
    const mapW = 470, mapH = 380;
    p.drawRectangle({ x: M, y: top - mapH, width: mapW, height: mapH, color: C.cream });
    const km = seg.keymap ? await image(doc, seg.keymap) : null;
    if (km) drawImageFit(p, km, M, top - mapH, mapW, mapH);
    else text(p, F.r, 'Key map: save one from Site', M, top - mapH / 2, 11, mapW, C.muted, 'c');
    text(p, F.s, 'KEY MAP', M, top - mapH - 16, 10, 200);
    const info: string[][] = [
      ['Segment length', seg.length_ft ? `${seg.length_ft.toLocaleString()}'` : 'Not drawn'],
      ['Grade (end to end)', seg.grade_pct != null ? `${seg.grade_pct.toFixed(1)}%` : 'n/a'],
      ['Agency', pf.project.agency || 'n/a'],
      ['Alternatives', String(seg.alternatives.length)]
    ];
    table(p, F, M, top - mapH - 30, [{ h: 'Item', w: 200 }, { h: 'Value', w: 270, r: true }], info);
    const sx = M + mapW + 30, sw = W - M - sx;
    drawSection(p, F, seg.existing, 'Existing', sx, top - 250, sw, 250);
    const rows = priced.map(r => [r.a.name, r.a.tier, r.w ? money(r.w.low) : '-', r.w ? money(r.w.total) : 'Not priced', r.w ? money(r.w.high) : '-']);
    text(p, F.s, 'ALTERNATIVES AND PLANNING-LEVEL COST', sx, top - 290, 12, sw);
    table(p, F, sx, top - 300, [{ h: 'Alternative', w: sw - 400 }, { h: 'Tier', w: 100 }, { h: 'Low', w: 100, r: true }, { h: 'Estimate', w: 100, r: true }, { h: 'High', w: 100, r: true }],
      rows.length ? rows : [['No alternatives yet', '', '', '', '']]);
    wrap(p, F.r, `Costs: ${k ? `F&P cross-section cost knowledge ${k.version}` : 'not priced (cost data not loaded)'}, priced as the change from existing; includes contingency, design and environmental. Standards: SoCal Super Standards (CA MUTCD, Caltrans, LADOT, PROWAG). Map data © OpenStreetMap contributors where used.`, sx, M + 80, 8, sw, C.muted);
  }

  // One sheet per alternative
  for (let i = 0; i < priced.length; i++) {
    const { a, lines, w } = priced[i];
    const p = doc.addPage([W, H]);
    titleBlock(p, F, pf, seg, a.name, i + 2, of);
    const top = H - M, colW = (W - 2 * M - 30) / 2;
    drawSection(p, F, seg.existing, 'Existing', M, top - 200, colW, 200);
    drawSection(p, F, a.section, a.name, M, top - 430, colW, 200);
    const rx = M + colW + 30;
    // What changes, one row per changed element (from the cost lines), under the sections
    const changed = [...new Map(lines.filter(l => l.group !== 'Restriping').map(l => [l.element, l])).values()].slice(0, 9);
    text(p, F.s, 'CHANGES FROM EXISTING', M, top - 470, 12, colW);
    table(p, F, M, top - 478, [{ h: 'Element', w: colW * 0.45 }, { h: 'Treatment', w: colW * 0.55 }],
      changed.length ? changed.map(l => [l.element.replace(/\b\w/, c => c.toUpperCase()), l.item]) : [['Restripe within existing curbs', '']], 17);
    const rnd = a.render || (seg.perspective?.src ?? null);
    const imgH = 330;
    p.drawRectangle({ x: rx, y: top - imgH, width: colW, height: imgH, color: C.cream });
    const im = rnd ? await image(doc, rnd) : null;
    if (im) drawImageFit(p, im, rx, top - imgH, colW, imgH);
    else text(p, F.r, 'Perspective: render one in Visualize', rx, top - imgH / 2, 11, colW, C.muted, 'c');
    text(p, F.r, a.render ? 'Concept rendering' : seg.perspective ? `Perspective: ${seg.perspective.source}${seg.perspective.credit ? ', ' + seg.perspective.credit : ''}` : '', rx, top - imgH - 14, 8, colW, C.muted);
    if (!w) { text(p, F.r, 'Planning-level cost: import the cost data in Cost to price this alternative.', rx, top - imgH - 40, 10, colW, C.muted); continue; }
    const items = lines.slice(0, 12).map(l => [l.item, `${Math.round(l.qty).toLocaleString()} ${l.unit}`, money(l.raw)]);
    if (lines.length > 12) items.push([`${lines.length - 12} more items`, '', money(lines.slice(12).reduce((s, l) => s + l.raw, 0))]);
    items.push(['Markups (contingency, TC, mobilization, CM, design, env.)', '', money(w.rows.slice(1).reduce((s, r) => s + r[1], 0))]);
    items.push(['TOTAL (rounded)', `${money(w.low)} to ${money(w.high)}`, money(w.total)]);
    text(p, F.s, 'PLANNING-LEVEL COST', rx, top - imgH - 36, 12, colW);
    table(p, F, rx, top - imgH - 44, [{ h: 'Item', w: colW - 250 }, { h: 'Quantity / range', w: 150, r: true }, { h: 'Amount', w: 100, r: true }], items, 17);
  }
  return doc.save();
}
