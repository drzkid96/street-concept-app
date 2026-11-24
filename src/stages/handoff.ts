// CAD handoff: DXF (R12, LINE + TEXT) of the drawn segment with every section edge offset from the centerline,
// in CA State Plane Zone V (EPSG:2229, US survey feet) so it lands in place in LA County drawings.
import proj4 from 'proj4';
import type { Stage } from './index';
import { project } from '../lib/project';
import { download } from '../lib/pdfView';
import type { Section } from '../lib/types';

proj4.defs('EPSG:2229', '+proj=lcc +lat_0=33.5 +lon_0=-118 +lat_1=35.4666666666667 +lat_2=34.0333333333333 +x_0=2000000.0001016 +y_0=500000.0001016 +ellps=GRS80 +towgs84=0,0,0 +units=us-ft +no_defs');

type P = [number, number];
function offsetLine(pts: P[], d: number): P[] {
  // Offset a polyline by d (positive = left of travel direction), mitered at vertices.
  const n = pts.length, out: P[] = [];
  const norm = (a: P, b: P): P => { const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1; return [-dy / L, dx / L]; };
  for (let i = 0; i < n; i++) {
    const n1 = i > 0 ? norm(pts[i - 1], pts[i]) : norm(pts[i], pts[i + 1]);
    const n2 = i < n - 1 ? norm(pts[i], pts[i + 1]) : n1;
    let mx = n1[0] + n2[0], my = n1[1] + n2[1]; const ml = Math.hypot(mx, my) || 1; mx /= ml; my /= ml;
    const k = Math.min(4, 1 / Math.max(0.25, mx * n1[0] + my * n1[1]));
    out.push([pts[i][0] + mx * d * k, pts[i][1] + my * d * k]);
  }
  return out;
}

function edges(sec: Section) {
  const total = sec.elements.reduce((a, e) => a + e.width_ft, 0);
  let x = -total / 2;
  const res: { off: number; layer: string }[] = [];
  const road = new Set(['parking', 'bike_lane', 'bike_buffer', 'travel_lane', 'turn_lane', 'bus_lane', 'shoulder']);
  sec.elements.forEach((e, i) => {
    const prev = sec.elements[i - 1];
    const layer = !prev ? 'ROW' : (road.has(e.type) !== road.has(prev.type)) ? 'CURB' :
      (prev.direction !== e.direction && ['inbound', 'outbound'].includes(prev.direction) && ['inbound', 'outbound'].includes(e.direction)) ? 'STRIPE-YELLOW' :
      [e.type, prev.type].some(t => t.includes('bike')) ? 'STRIPE-BIKE' : [e.type, prev.type].includes('bus_lane') ? 'STRIPE-BUS' : 'STRIPE-WHITE';
    res.push({ off: x, layer }); x += e.width_ft;
  });
  res.push({ off: x, layer: 'ROW' });
  return res;
}

function dxf(lines: { layer: string; a: P; b: P }[], texts: { layer: string; at: P; h: number; t: string; rot: number }[]) {
  const LAYERS: Record<string, number> = { CENTERLINE: 1, ROW: 8, CURB: 7, 'STRIPE-WHITE': 7, 'STRIPE-YELLOW': 2, 'STRIPE-BIKE': 3, 'STRIPE-BUS': 1, LABELS: 7 };
  const g = (c: number, v: string | number) => `${c}\n${v}\n`;
  let s = g(0, 'SECTION') + g(2, 'HEADER') + g(9, '$INSUNITS') + g(70, 2) + g(0, 'ENDSEC');
  s += g(0, 'SECTION') + g(2, 'TABLES') + g(0, 'TABLE') + g(2, 'LAYER') + g(70, Object.keys(LAYERS).length);
  for (const [n, c] of Object.entries(LAYERS)) s += g(0, 'LAYER') + g(2, n) + g(70, 0) + g(62, c) + g(6, 'CONTINUOUS');
  s += g(0, 'ENDTAB') + g(0, 'ENDSEC') + g(0, 'SECTION') + g(2, 'ENTITIES');
  for (const l of lines) s += g(0, 'LINE') + g(8, l.layer) + g(10, l.a[0].toFixed(3)) + g(20, l.a[1].toFixed(3)) + g(30, 0) + g(11, l.b[0].toFixed(3)) + g(21, l.b[1].toFixed(3)) + g(31, 0);
  for (const t of texts) s += g(0, 'TEXT') + g(8, t.layer) + g(10, t.at[0].toFixed(3)) + g(20, t.at[1].toFixed(3)) + g(30, 0) + g(40, t.h) + g(1, t.t) + g(50, t.rot.toFixed(2));
  return s + g(0, 'ENDSEC') + g(0, 'EOF');
}

export const handoffStage: Stage = {
  id: 'handoff', name: 'Handoff',
  render(side, canvas) {
    const seg = project.seg();
    const opts = [['existing', 'Existing'], ...seg.alternatives.map((a, i) => [String(i), a.name])];
    side.innerHTML = `<h2>8. HANDOFF</h2>
      <p>CAD linework of the segment with every section edge offset from the drawn centerline. CA State Plane Zone V (EPSG:2229), US feet, so it overlays LA County base files in place.</p>
      <div class="field"><label for="which">Section</label><select id="which">${opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>
      <div class="row"><button class="btn" id="dxf">Download DXF</button><button class="btn ghost" id="json">Download project JSON</button></div>
      <p class="note" id="msg" role="status">Layers: CENTERLINE, ROW, CURB, STRIPE-WHITE, STRIPE-YELLOW, STRIPE-BIKE, STRIPE-BUS, LABELS. For DWG, hand the DXF to Claude (dxf-to-dwg skill) or open and save it in AutoCAD.</p>`;
    const sel = side.querySelector('#which') as HTMLSelectElement;
    const build = () => {
      const path = (seg.path ?? []) as P[];
      if (path.length < 2) return null;
      const sec = sel.value === 'existing' ? seg.existing : seg.alternatives[+sel.value].section;
      const sp = path.map(p => proj4('EPSG:4326', 'EPSG:2229', p) as P);
      const lines: { layer: string; a: P; b: P }[] = [], texts: { layer: string; at: P; h: number; t: string; rot: number }[] = [];
      const add = (pts: P[], layer: string) => { for (let i = 1; i < pts.length; i++) lines.push({ layer, a: pts[i - 1], b: pts[i] }); };
      add(sp, 'CENTERLINE');
      const E = edges(sec);
      E.forEach(e => add(offsetLine(sp, -e.off), e.layer));
      const [a, b] = sp, rot = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
      let x = -sec.elements.reduce((s, e) => s + e.width_ft, 0) / 2;
      sec.elements.forEach(el => { const at = offsetLine(sp, -(x + el.width_ft / 2))[0]; texts.push({ layer: 'LABELS', at, h: 1.5, t: `${el.type.replace('_', ' ').toUpperCase()} ${el.width_ft}'`, rot }); x += el.width_ft; });
      return { text: dxf(lines, texts), sp, E };
    };
    const preview = () => {
      const r = build();
      if (!r) { canvas.innerHTML = '<div class="empty">Draw the segment in Site first.</div>'; return; }
      const all = r.E.flatMap(e => offsetLine(r.sp, -e.off));
      const xs = all.map(p => p[0]), ys = all.map(p => p[1]);
      const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)], pad = 20;
      const col: Record<string, string> = { ROW: '#888', CURB: 'currentColor', 'STRIPE-YELLOW': '#D4A000', 'STRIPE-BIKE': '#2E8B57', 'STRIPE-BUS': '#C8102E', 'STRIPE-WHITE': '#8aa' };
      const poly = (pts: P[]) => pts.map(p => `${(p[0] - x0).toFixed(2)},${(y1 - p[1]).toFixed(2)}`).join(' ');
      canvas.innerHTML = `<svg class="cad" viewBox="${-pad} ${-pad} ${x1 - x0 + 2 * pad} ${y1 - y0 + 2 * pad}" style="color:var(--ink)">
        ${r.E.map(e => `<polyline points="${poly(offsetLine(r.sp, -e.off))}" fill="none" stroke="${col[e.layer]}" stroke-width="1" vector-effect="non-scaling-stroke"/>`).join('')}
        <polyline points="${poly(r.sp)}" fill="none" stroke="#E11" stroke-dasharray="6 4" stroke-width="1" vector-effect="non-scaling-stroke"/></svg>`;
    };
    sel.addEventListener('change', preview);
    side.querySelector('#dxf')!.addEventListener('click', () => {
      const r = build();
      if (!r) { side.querySelector('#msg')!.textContent = 'Draw the segment in Site first.'; return; }
      const nm = (sel.value === 'existing' ? 'EXISTING' : seg.alternatives[+sel.value].name).toUpperCase().replace(/\W+/g, '-');
      download(r.text, `${new Date().toISOString().slice(0, 10)}_${nm}_EPSG2229.dxf`, 'application/dxf');
    });
    side.querySelector('#json')!.addEventListener('click', () => download(project.exportJSON(), `${new Date().toISOString().slice(0, 10)}_PROJECT.json`, 'application/json'));
    preview();
  }
};
