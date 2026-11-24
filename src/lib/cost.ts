// Planning-level cost engine. Port of fp-section-builder cost_engine.py (Section Mapping rules),
// priced from public/data/cost-knowledge.json (exported from CrossSection_Cost_Knowledge.xlsx).
// Sketch estimates only, never an engineering estimate.
import type { Section, SectionElement } from './types';

interface Comp { name: string; basis: string; flag: string; roundup: boolean; widthParam: string | null; w0: number | null; terms: { uid: string; qty: number }[]; rate: number }
interface Unit { item: string; base: number; unit?: string; category?: string }
export interface Knowledge { version: string; assumptions: Record<string, number>; composites: Record<string, Comp>; units: Record<string, Unit> }

// The F&P cost knowledge is internal pricing, so it is never published with the site.
// Each user imports the JSON once; it stays in that browser only.
const CK = 'sca-cost-knowledge-v1';
let K: Knowledge | null = null;
export async function loadKnowledge(): Promise<Knowledge | null> {
  if (K) return K;
  try { const raw = localStorage.getItem(CK); if (raw) K = JSON.parse(raw); } catch { /* ignore */ }
  return K;
}
export function importKnowledge(text: string): Knowledge {
  const k = JSON.parse(text) as Knowledge;
  if (!k?.composites || !k?.units || !k?.assumptions) throw new Error('Not a cost knowledge file');
  K = k;
  try { localStorage.setItem(CK, text); } catch { /* still usable this session */ }
  return k;
}
export function forgetKnowledge() { K = null; try { localStorage.removeItem(CK); } catch { /* ignore */ } }

export interface Line { group: string; element: string; item: string; qty: number; unit: string; rate: number; flag: string; note: string; raw: number }

function composite(k: Knowledge, cid: string, width?: number) {
  const c = k.composites[cid];
  let tot = 0;
  for (const t of c.terms) {
    let q = t.qty;
    if (width != null && c.w0 != null && Math.abs(q - c.w0) < 1e-9) q = width;
    tot += q * (k.units[t.uid]?.base ?? 0);
  }
  return c.roundup ? Math.ceil(tot - 1e-9) : Math.round(tot * 100) / 100;
}

const ROAD_T = new Set(['parking', 'bike_lane', 'bike_buffer', 'travel_lane', 'turn_lane', 'bus_lane', 'shoulder', 'separated_bikeway']);
const isRoad = (e: SectionElement) => ROAD_T.has(e.type) && e.material !== 'raised';
const offsets = (els: SectionElement[]) => { let x = 0; return els.map(e => { const o = x; x += e.width_ft; return { o: Math.round(o * 100) / 100, e }; }); };
const key = (o: number, e: SectionElement) => `${o}|${e.type}|${e.width_ft}|${e.direction}|${e.material ?? ''}`;
function curbs(els: SectionElement[]): [number, number] | null {
  const road = offsets(els).filter(({ e }) => isRoad(e));
  if (!road.length) return null;
  const last = road[road.length - 1];
  return [road[0].o, last.o + last.e.width_ft];
}
function laneLines(els: SectionElement[]) {
  const offs = offsets(els), pos: [number, number][] = [];
  for (let i = 1; i < offs.length; i++) {
    const a = offs[i - 1].e, b = offs[i].e;
    if (isRoad(a) && isRoad(b)) {
      const opp = ['inbound', 'outbound'].includes(a.direction) && ['inbound', 'outbound'].includes(b.direction) && a.direction !== b.direction;
      pos.push([offs[i].o, opp ? 2 : 1]);
    }
  }
  return pos;
}

export function priceConcept(k: Knowledge, existing: Section, concept: Section, lengthFt: number, context: 'urban' | 'suburban' | 'rural' = 'urban') {
  const LF = lengthFt, lines: Line[] = [], flags: string[] = [];
  const exKeys = new Set(offsets(existing.elements).map(({ o, e }) => key(o, e)));
  const comp = (group: string, el: string, cid: string, qty: number, unit: string, width?: number, note = '') => {
    const c = k.composites[cid], rate = composite(k, cid, width);
    lines.push({ group, element: el, item: c.name + (width != null ? ` (${width}')` : ''), qty, unit, rate, flag: c.flag || 'none', note, raw: qty * rate });
  };
  const unit = (group: string, el: string, uid: string, qty: number, u: string, note = '') => {
    const x = k.units[uid]; if (!x) { flags.push(`${el}: missing unit ${uid}`); return; }
    const flag = x.category === 'Civil' || x.category === 'Widening' ? 'utility+drainage' : 'none';
    lines.push({ group, element: el, item: x.item, qty, unit: u, rate: x.base, flag, note, raw: qty * x.base });
  };
  const els = concept.elements, offs = offsets(els);
  offs.forEach(({ o, e }, i) => {
    if (exKeys.has(key(o, e))) return;
    const el = `${e.type.replace('_', ' ')} ${e.width_ft}'`, w = e.width_ft;
    const nb = [els[i - 1], els[i + 1]].filter(Boolean);
    switch (e.type) {
      case 'sidewalk': comp('Cross-section', el, 'concreteSidewalkInstalled', LF, 'LF', w, 'includes curb & gutter'); break;
      case 'parkway': comp('Cross-section', el, 'landscapedArea', LF, 'LF', w); comp('Cross-section', el, 'treesInstalled', LF, 'LF', undefined, 'trees at 40 ft with grates'); break;
      case 'bike_lane': {
        const buffered = nb.some(n => n.type === 'bike_buffer');
        comp('Cross-section', el, buffered ? 'bufferedBikeLane' : 'standardBikeLanes', LF, 'LF', undefined, buffered ? 'buffer striping included' : '');
        if (e.material !== 'unpainted') unit('Cross-section', el, 'greenThermoplastic', w * LF, 'SF', 'proxy: full-length green');
        break;
      }
      case 'separated_bikeway':
        if (e.material === 'raised') comp('Cross-section', el, 'raisedOneWayCycletrack', LF, 'LF', w);
        else {
          comp('Cross-section', el, 'bufferedBikeLane', LF, 'LF', undefined, 'lane + buffer striping');
          if (e.material === 'curb') comp('Cross-section', el, 'raisedConcreteBuffer', LF, 'LF', 2, 'concrete curb separator (2 ft)');
          else comp('Cross-section', el, 'softHitPostsInstalled', LF, 'LF', undefined, 'flexible posts');
          unit('Cross-section', el, 'greenThermoplastic', 0.15 * w * LF, 'SF', 'proxy: green at conflict zones (~15%)');
        }
        break;
      case 'bike_buffer':
        if (!nb.some(n => n.type === 'bike_lane')) comp('Cross-section', el, 'bufferedBikeLane', LF, 'LF', undefined, 'painted buffer');
        if (e.material === 'posts') comp('Cross-section', el, 'softHitPostsInstalled', LF, 'LF', undefined, 'flexible posts');
        break;
      case 'median':
        if (e.material === 'concrete') comp('Cross-section', el, 'raisedConcreteBuffer', LF, 'LF', w);
        else { comp('Cross-section', el, 'raisedLandscapeBuffer', LF, 'LF', w, 'curbed planted median'); comp('Cross-section', el, 'treesInstalled', LF, 'LF', undefined, 'trees at 40 ft'); }
        break;
      case 'bus_lane': if (e.material !== 'unpainted') unit('Cross-section', el, 'colorEpoxy', w * LF, 'SF', 'proxy: red surfacing'); break;
      case 'curb': unit('Cross-section', el, 'concreteCurbGutter', LF, 'LF'); break;
    }
  });
  const [ex, co] = [curbs(existing.elements), curbs(els)];
  if (ex && co) (['left', 'right'] as const).forEach((side, j) => {
    const d = Math.abs(ex[j] - co[j]);
    if (d < 0.01) return;
    unit('Curb moves', `${side} curb moves ${d}'`, 'concreteCurbGutter', LF, 'LF');
    unit('Curb moves', `${side} curb moves ${d}'`, 'asphaltPatchAtNewCurb', 2 * LF, 'SF');
  });
  const wEx = existing.elements.reduce((a, e) => a + e.width_ft, 0), wCo = els.reduce((a, e) => a + e.width_ft, 0);
  if (wCo > wEx + 0.01) {
    const uid = context === 'rural' ? 'roadwayWideningRural' : context === 'suburban' ? 'roadwayWideningSuburban' : 'roadwayWideningUrban';
    unit('Widening', `concept ${wCo - wEx}' wider than existing`, uid, (wCo - wEx) * LF, 'SF');
  }
  const exl = new Set(laneLines(existing.elements).map(p => p[0]));
  const n = laneLines(els).filter(p => !exl.has(p[0])).reduce((a, p) => a + p[1], 0);
  if (n) unit('Restriping', `${n} new lane line(s)`, 'thermoplasticShoulderStripe4', n * LF, 'LF', 'proxy; removal not priced');
  return { lines, flags };
}

export function waterfall(k: Knowledge, lines: Line[]) {
  const A = k.assumptions;
  const base = lines.reduce((a, l) => a + l.raw, 0);
  const util = A.UTIL_CONT * lines.filter(l => l.flag.startsWith('utility')).reduce((a, l) => a + l.raw, 0);
  const drain = A.DRAIN_CONT * lines.filter(l => l.flag === 'utility+drainage').reduce((a, l) => a + l.raw, 0);
  const cs = base + util + drain, tc = A.TC * cs, mob = A.MOB * cs, cm = A.CM * cs;
  const sub = cs + tc + mob + cm, cont = A.CONT * sub, ct = sub + cont;
  const des = A.DESIGN * ct, env = A.ENV * ct, seg = ct + des + env, esc = seg * A.ESC_ESTIMATE;
  const rnd = (x: number) => A.ROUND_TO * Math.round(x / A.ROUND_TO);
  return { base, util, drain, tc, mob, cm, cont, design: des, env, total: rnd(esc), low: rnd(esc * (1 + A.RANGE_LOW)), high: rnd(esc * (1 + A.RANGE_HIGH)),
    rows: [['Construction items', base], ['Utility contingency', util], ['Drainage contingency', drain], ['Traffic control', tc], ['Mobilization', mob], ['Construction management', cm], ['Contingency', cont], ['Design', des], ['Environmental', env]] as [string, number][] };
}

export const money = (x: number) => '$' + Math.round(x).toLocaleString('en-US');
