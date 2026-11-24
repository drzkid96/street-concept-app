// Default alternatives: three bikeway tiers (as fp-render-streetview does by default), each fitted inside the
// existing curbs with the width rules in roadway.ts. A: Class II bike lane. B: buffered bike lane. C: Class IV.
import type { Alternative, Section, SectionElement, Direction } from './types';
import { split, curbToCurb, fitRoad } from './roadway';

const uid = () => Math.random().toString(36).slice(2, 10);
type Tier = 'A' | 'B' | 'C';

function sides(road: SectionElement[]): ('L' | 'R')[] {
  const dirs = new Set(road.filter(e => e.type === 'travel_lane').map(e => e.direction));
  return dirs.has('inbound') && dirs.has('outbound') ? ['L', 'R'] : ['R'];   // one-way: bikeway on the right
}
function build(existing: Section, tier: Tier): Section {
  const { left, road: ex, right } = split(existing);
  const target = curbToCurb(existing);
  // travel lanes and centre treatments carry over; bikeways are rebuilt; parking kept where present
  let mid = ex.filter(e => ['travel_lane', 'turn_lane', 'bus_lane', 'median'].includes(e.type)).map(e => ({ ...e }));
  mid.forEach(e => { if (e.type === 'travel_lane') e.width_ft = Math.min(e.width_ft, 10.5); });
  const parkL = ex[0]?.type === 'parking' ? { ...ex[0] } : null, parkR = ex[ex.length - 1]?.type === 'parking' ? { ...ex[ex.length - 1] } : null;
  const side = (s: 'L' | 'R', park: SectionElement | null): SectionElement[] => {
    const dir: Direction = s === 'L' ? 'inbound' : 'outbound';
    const bike: SectionElement = { type: 'bike_lane', width_ft: 6, direction: dir, material: 'green' };
    const out: SectionElement[] = [];   // curb outward to the travel lanes
    if (tier === 'C') {
      out.push({ type: 'separated_bikeway', width_ft: 7, direction: dir, material: 'posts' });
      if (park) out.push(park); else out.push({ type: 'bike_buffer', width_ft: 3, direction: 'none', material: 'posts' });
    } else {
      if (park) out.push(park);
      if (tier === 'B') { if (park) out.push({ type: 'bike_buffer', width_ft: 2, direction: 'none', material: 'paint' }); out.push(bike); out.push({ type: 'bike_buffer', width_ft: 3, direction: 'none', material: 'paint' }); }
      else out.push(bike);
    }
    return s === 'L' ? out : out.reverse();
  };
  const bs = sides(ex);
  const L = bs.includes('L') ? side('L', parkL) : parkL ? [parkL] : [];
  const R = bs.includes('R') ? side('R', parkR) : parkR ? [parkR] : [];
  let road = [...L, ...mid, ...R];
  // Make room if needed: travel lanes to 10, then a road diet (two-way, 2+ lanes each way -> 1 each way + centre
  // turn lane), then drop parking (left first; a protected bikeway keeps a post buffer in its place), then a lane
  // where two or more run one way.
  const need = () => road.reduce((a, e) => a + e.width_ft, 0) - target;
  if (need() > 0) road.forEach(e => { if (e.type === 'travel_lane') e.width_ft = 10; });
  const tl = () => road.filter(e => e.type === 'travel_lane'), dirN = (d: Direction) => tl().filter(e => e.direction === d).length;
  if (need() > 0 && dirN('inbound') >= 2 && dirN('outbound') >= 2) {
    const inb = tl().filter(e => e.direction === 'inbound'), outb = tl().filter(e => e.direction === 'outbound');
    const keepIn = inb[inb.length - 1], keepOut = outb[0];
    const cut = new Set([...inb, ...outb].filter(e => e !== keepIn && e !== keepOut));
    const at = road.indexOf(keepIn) + 1;
    road = road.filter(e => !cut.has(e));
    if (!road.some(e => e.type === 'turn_lane')) road.splice(road.indexOf(keepIn) + 1, 0, { type: 'turn_lane', width_ft: 10, direction: 'both' });
    void at;
  }
  for (const drop of [parkL, parkR]) {
    if (!(need() > 0) || !drop || !road.includes(drop)) continue;
    const i = road.indexOf(drop);
    if (tier === 'C') road[i] = { type: 'bike_buffer', width_ft: 3, direction: 'none', material: 'posts' };
    else {
      road.splice(i, 1);
      // a parking-side buffer (B) has nothing to buffer once parking is gone
      const j = drop === parkL ? i : i - 1;
      if (road[j]?.type === 'bike_buffer' && road[j].width_ft <= 2) road.splice(j, 1);
    }
  }
  while (need() > 0) {
    const byDir = (d: Direction) => tl().filter(e => e.direction === d);
    const victim = byDir('outbound').length > 1 ? byDir('outbound')[0] : byDir('inbound').length > 1 ? byDir('inbound')[0] : null;
    if (!victim) break;
    road = road.filter(e => e !== victim);
  }
  const sec: Section = { elements: [...structuredClone(left), ...road, ...structuredClone(right)] };
  fitRoad(sec, target);
  return sec;
}
const NAMES: Record<Tier, [string, Alternative['tier']]> = { A: ['Bike lanes (Class II)', 'quick-build'], B: ['Buffered bike lanes (Class II)', 'quick-build'], C: ['Protected bikeway (Class IV)', 'interim'] };
export function defaultAlternatives(existing: Section): Alternative[] {
  return (['A', 'B', 'C'] as Tier[]).map(t => ({ id: uid(), name: NAMES[t][0], tier: NAMES[t][1], section: build(existing, t), enabled: true }));
}
