// Curb lines are fixed. Only the roadway (curb to curb) is adjustable; the roadside outside the curbs
// (sidewalks, parkways) carries over unchanged and is never dimensioned. When one roadway element changes
// width, the travel lanes absorb the difference so curb to curb stays the same.
import type { Section, SectionElement, ElementType } from './types';

const ROADSIDE = new Set<ElementType>(['sidewalk', 'parkway', 'curb']);
export const DEFAULT_W: Record<ElementType, number> = { sidewalk: 10, parkway: 6, curb: 0.5, parking: 8, bike_lane: 6, bike_buffer: 3, separated_bikeway: 7, travel_lane: 11, turn_lane: 10, bus_lane: 11, median: 4, shoulder: 4 };
// Logical limits (ft). Travel lanes prefer 10 to 11.
export const LIMITS: Partial<Record<ElementType, [number, number]>> = { travel_lane: [9, 16], turn_lane: [9, 14], bus_lane: [10, 16], bike_lane: [5, 9], bike_buffer: [1, 10], parking: [7, 10], separated_bikeway: [5, 12], median: [2, 20], shoulder: [0, 20] };
const half = (n: number) => Math.round(n * 2) / 2;
const lim = (t: ElementType) => LIMITS[t] ?? [0.5, 40];
export function split(sec: Section) {
  const els = sec.elements;
  let a = 0, b = els.length;
  while (a < b && ROADSIDE.has(els[a].type)) a++;
  while (b > a && ROADSIDE.has(els[b - 1].type)) b--;
  return { left: els.slice(0, a), road: els.slice(a, b), right: els.slice(b), a, b };
}
export const curbToCurb = (sec: Section) => split(sec).road.reduce((s, e) => s + e.width_ft, 0);
export const roadsideLabel = (els: SectionElement[]) => els.map(e => `${e.type === 'parkway' ? 'Parkway' : e.type === 'sidewalk' ? 'Sidewalk' : 'Curb'} ${e.width_ft} ft`).join(' + ') || 'none';

// Extra space: bike lanes, bike buffers and parking grow to their maximum first, then shoulders and buffers take
// the rest. Missing space: shoulders, buffers and travel lanes above 10 ft give first, then everything down to minimums.
const GIVE_ORDER: [ElementType[], number | null][] = [[['shoulder'], null], [['bike_buffer'], null], [['travel_lane'], 10], [['parking'], null], [['bike_lane'], null], [['turn_lane', 'bus_lane', 'travel_lane', 'separated_bikeway', 'median'], null]];
const TAKE_ORDER: [ElementType[], number | null][] = [[['bike_lane'], null], [['bike_buffer'], null], [['parking'], null], [['shoulder'], null]];
function spread(pool: SectionElement[], amount: number, cap: (e: SectionElement) => number): number {
  // even shares, each element limited by cap(e); returns what could not be placed (same sign as amount)
  let left = amount;
  for (let pass = 0; pass < 6 && Math.abs(left) > 0.01; pass++) {
    const room = pool.filter(e => amount > 0 ? cap(e) - e.width_ft > 0.01 : e.width_ft - cap(e) > 0.01);
    if (!room.length) break;
    const each = left / room.length;
    for (const e of room) { const lim = amount > 0 ? Math.min(each, cap(e) - e.width_ft) : Math.max(each, cap(e) - e.width_ft); e.width_ft += lim; left -= lim; }
  }
  return left;
}
function absorb(road: SectionElement[], delta: number, skip: SectionElement | null): boolean {
  const pool = (types: ElementType[]) => road.filter(e => e !== skip && types.includes(e.type));
  let left = delta;
  for (const [types, floor] of delta > 0 ? TAKE_ORDER : GIVE_ORDER) {
    if (Math.abs(left) < 0.01) break;
    left = spread(pool(types), left, e => delta > 0 ? lim(e.type)[1] : Math.max(floor ?? lim(e.type)[0], lim(e.type)[0]));
  }
  if (delta > 0 && left > 0.01) {
    // nothing left to grow: the travel lanes take it up to their maximum
    left = spread(pool(['travel_lane', 'turn_lane']), left, e => lim(e.type)[1]);
  }
  road.forEach(e => { e.width_ft = half(e.width_ft); });
  return Math.abs(left) < 0.26;
}
function settle(road: SectionElement[], target: number, sec?: Section) {
  let diff = half(target - road.reduce((s, e) => s + e.width_ft, 0));
  if (!diff) return;
  if (diff > 0 && sec) {
    const sh = road.find(e => e.type === 'shoulder');
    if (sh) { sh.width_ft = half(sh.width_ft + diff); return; }
    const t = road.filter(e => e.type === 'travel_lane' && e.width_ft + diff <= 16)[0];
    if (!t) { const { b } = split(sec); sec.elements.splice(b, 0, { type: 'shoulder', width_ft: diff, direction: 'outbound' }); return; }
  }
  const w = [...road].filter(e => e.type === 'travel_lane').sort((x, y) => y.width_ft - x.width_ft)[0] ?? [...road].sort((x, y) => y.width_ft - x.width_ft)[0];
  if (w) w.width_ft = half(w.width_ft + diff);
}

// Each returns a short message for the person, or throws when the change cannot fit between the curbs.
export function setWidth(sec: Section, i: number, w: number): string {
  const { road } = split(sec), el = road[i], before = curbToCurb(sec);
  const [lo, hi] = lim(el.type), asked = w; w = half(Math.min(hi, Math.max(lo, w)));
  const held = asked !== w ? ` ${el.type.replace(/_/g, ' ')}s are ${lo} to ${hi} ft, so it is ${w} ft.` : '';
  const delta = w - el.width_ft;
  if (!delta) return held.trim();
  const snap = road.map(e => e.width_ft);
  if (!absorb(road, -delta, el) && delta > 0) { road.forEach((e, k) => { e.width_ft = snap[k]; }); throw new Error(`No room: the other elements cannot give up ${delta} ft and stay at their minimum widths.`); }
  el.width_ft = w; settle(road, before, sec);
  return (delta > 0 ? `${Math.abs(delta)} ft came from shoulders, buffers and lanes above 10 ft, so the curbs stay put.` : `${Math.abs(delta)} ft went to bike lanes, buffers and parking up to their maximum, then shoulders.`) + held;
}
export function addElement(sec: Section, type: ElementType, where: 'left' | 'right'): string {
  const { road, a, b } = split(sec), before = curbToCurb(sec);
  const w = DEFAULT_W[type];
  const el: SectionElement = { type, width_ft: w, direction: where === 'left' ? 'inbound' : 'outbound' };
  if (type === 'bike_buffer' || type === 'median') el.direction = 'none';
  const probe = [...road, el], snap = road.map(e => e.width_ft);
  if (!absorb(probe, -w, el)) { road.forEach((e, k) => { e.width_ft = snap[k]; }); throw new Error(`No room for a ${w} ft element: the other elements would drop below their minimum widths.`); }
  probe.forEach((e, k) => { if (k < road.length) road[k].width_ft = e.width_ft; });
  sec.elements.splice(where === 'left' ? a : b, 0, el);
  settle(split(sec).road, before, sec);
  return `Added ${w} ft next to the ${where} curb; shoulders, buffers and lanes above 10 ft made room.`;
}
export function removeElement(sec: Section, i: number): string {
  const { road, a } = split(sec), before = curbToCurb(sec), el = road[i];
  if (road.length < 2) throw new Error('The roadway needs at least one element.');
  sec.elements.splice(a + i, 1);
  const rest = split(sec).road;
  absorb(rest, el.width_ft, null);
  settle(rest, before, sec);
  return `Removed; its ${el.width_ft} ft went to bike lanes, buffers and parking up to their maximum, then shoulders.`;
}
// Existing only: a measured curb-to-curb width. The roadway scales in proportion.
export function setCurbToCurb(sec: Section, total: number) {
  const { road } = split(sec), cur = curbToCurb(sec);
  if (!(total > 8) || !cur) return;
  total = half(total);
  if (!absorb(road, total - cur, null)) { road.forEach(e => { e.width_ft = half(e.width_ft * total / cur); }); }
  settle(split(sec).road, total, sec);
}
// Alternatives keep the existing roadside and the existing curb-to-curb width.
export function conformTo(alt: Section, existing: Section) {
  const ex = split(existing), al = split(alt);
  alt.elements = [...structuredClone(ex.left), ...al.road, ...structuredClone(ex.right)];
  const target = curbToCurb(existing), cur = curbToCurb(alt);
  // Small differences go to the travel lanes; a changed existing width rescales the whole roadway.
  if (Math.abs(target - cur) > 0.01 && cur > 0) {
    const r = split(alt).road;
    if (!(Math.abs(target - cur) <= 2 && absorb(r, target - cur, null))) setCurbToCurb(alt, target);
    settle(split(alt).road, target);
  }
}
