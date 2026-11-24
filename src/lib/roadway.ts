// Curb lines are fixed. Only the roadway (curb to curb) is adjustable; the roadside outside the curbs
// (sidewalks, parkways) carries over unchanged and is never dimensioned. When one roadway element changes
// width, the travel lanes absorb the difference so curb to curb stays the same.
import type { Section, SectionElement, ElementType } from './types';

const ROADSIDE = new Set<ElementType>(['sidewalk', 'parkway', 'curb']);
export const DEFAULT_W: Record<ElementType, number> = { sidewalk: 10, parkway: 6, curb: 0.5, parking: 8, bike_lane: 5, bike_buffer: 3, separated_bikeway: 7, travel_lane: 11, turn_lane: 10, bus_lane: 11, median: 4, shoulder: 4 };
const MIN_W: Partial<Record<ElementType, number>> = { travel_lane: 9, turn_lane: 9, bus_lane: 10, parking: 7, bike_lane: 4, separated_bikeway: 5, bike_buffer: 1, median: 2, shoulder: 1 };
const half = (n: number) => Math.round(n * 2) / 2;

export function split(sec: Section) {
  const els = sec.elements;
  let a = 0, b = els.length;
  while (a < b && ROADSIDE.has(els[a].type)) a++;
  while (b > a && ROADSIDE.has(els[b - 1].type)) b--;
  return { left: els.slice(0, a), road: els.slice(a, b), right: els.slice(b), a, b };
}
export const curbToCurb = (sec: Section) => split(sec).road.reduce((s, e) => s + e.width_ft, 0);
export const roadsideLabel = (els: SectionElement[]) => els.map(e => `${e.type === 'parkway' ? 'Parkway' : e.type === 'sidewalk' ? 'Sidewalk' : 'Curb'} ${e.width_ft} ft`).join(' + ') || 'none';

// Spread `delta` (ft, + = add width) over the travel lanes other than `skip`, then fix rounding on the widest.
function absorb(road: SectionElement[], delta: number, skip: SectionElement | null): boolean {
  let pool = road.filter(e => e !== skip && e.type === 'travel_lane');
  if (!pool.length) pool = road.filter(e => e !== skip && e.type !== 'bike_buffer');
  if (!pool.length) return false;
  const each = delta / pool.length;
  for (const e of pool) if (e.width_ft + each < (MIN_W[e.type] ?? 1)) return false;
  pool.forEach(e => { e.width_ft = half(e.width_ft + each); });
  return true;
}
function settle(road: SectionElement[], target: number) {
  const diff = half(target - road.reduce((s, e) => s + e.width_ft, 0));
  if (!diff) return;
  const w = [...road].filter(e => e.type === 'travel_lane').sort((x, y) => y.width_ft - x.width_ft)[0] ?? [...road].sort((x, y) => y.width_ft - x.width_ft)[0];
  if (w) w.width_ft = half(w.width_ft + diff);
}

// Each returns a short message for the person, or throws when the change cannot fit between the curbs.
export function setWidth(sec: Section, i: number, w: number): string {
  const { road } = split(sec), el = road[i], before = curbToCurb(sec);
  w = half(Math.max(MIN_W[el.type] ?? 0.5, w));
  const delta = w - el.width_ft;
  if (!delta) return '';
  if (!absorb(road, -delta, el)) throw new Error(`No room: the other lanes cannot ${delta > 0 ? 'give up' : 'take'} ${Math.abs(delta)} ft and keep their minimum widths.`);
  el.width_ft = w; settle(road, before);
  return `The travel lanes ${delta > 0 ? 'gave up' : 'took'} ${Math.abs(delta)} ft, so the curbs stay put.`;
}
export function addElement(sec: Section, type: ElementType, where: 'left' | 'right'): string {
  const { road, a, b } = split(sec), before = curbToCurb(sec);
  const w = DEFAULT_W[type];
  const el: SectionElement = { type, width_ft: w, direction: where === 'left' ? 'inbound' : 'outbound' };
  if (type === 'bike_buffer' || type === 'median') el.direction = 'none';
  const probe = [...road, el];
  if (!absorb(probe, -w, el)) throw new Error(`No room for a ${w} ft element: the travel lanes would drop below their minimum.`);
  probe.forEach((e, k) => { if (k < road.length) road[k].width_ft = e.width_ft; });
  sec.elements.splice(where === 'left' ? a : b, 0, el);
  settle(split(sec).road, before);
  return `Added ${w} ft next to the ${where} curb; the travel lanes made room.`;
}
export function removeElement(sec: Section, i: number): string {
  const { road, a } = split(sec), before = curbToCurb(sec), el = road[i];
  if (road.length < 2) throw new Error('The roadway needs at least one element.');
  sec.elements.splice(a + i, 1);
  const rest = split(sec).road;
  if (!absorb(rest, el.width_ft, null)) rest[0].width_ft += el.width_ft;
  settle(rest, before);
  return `Removed; its ${el.width_ft} ft went to the travel lanes.`;
}
// Existing only: a measured curb-to-curb width. The roadway scales in proportion.
export function setCurbToCurb(sec: Section, total: number) {
  const { road } = split(sec), cur = curbToCurb(sec);
  if (!(total > 8) || !cur) return;
  road.forEach(e => { e.width_ft = half(e.width_ft * total / cur); });
  settle(road, half(total));
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
