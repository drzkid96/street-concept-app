// Guess the existing cross-section from OpenStreetMap tags (Nominatim reverse, extratags).
// Widths are typical SoCal defaults by street class; OSM "width" rescales the roadway when present.
import type { Section, SectionElement, Direction } from './types';
import type { LngLat } from './providers';

type Tags = Record<string, string>;
export interface Guess { section: Section; street: string; cls: string; tags: Tags; notes: string[]; sidewalks: { L: boolean; R: boolean } }

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function reverse([x, y]: LngLat) {
  const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${y}&lon=${x}&format=jsonv2&zoom=17&extratags=1`);
  const j = await r.json();
  return j?.osm_type === 'way' ? { name: j.name as string, cls: j.type as string, tags: (j.extratags || {}) as Tags } : null;
}

// Sample start, middle and end; keep the street name seen most often (avoids grabbing a cross street).
export async function guessExisting(path: LngLat[]): Promise<Guess> {
  if (!path.length) throw new Error('Draw the segment in Site first');
  const picks = path.length === 1 ? [path[0]] : [path[Math.floor(path.length / 2)], path[0], path[path.length - 1]];
  const hits: NonNullable<Awaited<ReturnType<typeof reverse>>>[] = [];
  for (let i = 0; i < picks.length; i++) { if (i) await sleep(1100); const h = await reverse(picks[i]).catch(() => null); if (h) hits.push(h); }
  if (!hits.length) throw new Error('No OpenStreetMap street found here');
  const count = new Map<string, number>();
  hits.forEach(h => count.set(h.name, (count.get(h.name) || 0) + 1));
  const best = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const h = hits.find(x => x.name === best)!;
  return { ...build(h.cls, h.tags), street: h.name, cls: h.cls, tags: h.tags };
}

const isYes = (v?: string) => !!v && !['no', 'none', 'separate'].includes(v);

export function build(cls: string, t: Tags): { section: Section; notes: string[]; sidewalks: { L: boolean; R: boolean } } {
  const notes: string[] = [];
  const major = ['primary', 'secondary', 'trunk', 'primary_link', 'secondary_link'].includes(cls);
  const laneW = major ? 11 : cls === 'tertiary' ? 11 : 10;
  const oneway = t.oneway === 'yes';
  const total = parseInt(t.lanes || '') || (oneway ? (major ? 3 : 1) : (major ? 4 : 2));
  if (!t.lanes) notes.push(`lane count assumed (${total}) for ${cls}`);
  let fwd = parseInt(t['lanes:forward'] || ''), bwd = parseInt(t['lanes:backward'] || '');
  const ctl = t['lanes:both_ways'] === '1' || /left/.test(t['turn:lanes:both_ways'] || '');
  if (oneway) { fwd = total; bwd = 0; }
  else if (!fwd || !bwd) { const n = total - (ctl ? 1 : 0); fwd = Math.ceil(n / 2); bwd = Math.floor(n / 2); }
  const bus = parseInt(t['lanes:bus'] || '') || (t['busway'] ? 1 : 0);

  const side = (s: 'left' | 'right') => {
    const v = (k: string) => t[`${k}:${s}`] ?? t[`${k}:both`] ?? t[k];
    const cyc = v('cycleway'), park = v('parking') ?? v('parking:lane'), sw = v('sidewalk');
    return {
      bike: cyc === 'lane' ? 'lane' : cyc === 'track' || cyc === 'separate' ? 'track' : null,
      parking: park ? ['parallel', 'lane', 'yes', 'diagonal', 'perpendicular'].some(p => park.includes(p)) : major ? null : 'assumed',
      sidewalk: sw ? (isYes(sw) || sw === 'separate') : true
    };
  };
  const L = side('left'), R = side('right');
  if (R.parking === 'assumed' || L.parking === 'assumed') notes.push('curb parking assumed (not tagged)');
  const swW = major ? 12 : 10;

  const els: SectionElement[] = [];
  const edge = (s: typeof L, dir: Direction, outer: boolean) => {
    const a: SectionElement[] = [];
    if (s.sidewalk) a.push({ type: 'sidewalk', width_ft: swW, direction: 'none' });
    if (s.bike === 'track') a.push({ type: 'separated_bikeway', width_ft: 6, direction: dir, material: 'posts' });
    if (s.parking) a.push({ type: 'parking', width_ft: 8, direction: dir });
    if (s.bike === 'lane') a.push({ type: 'bike_lane', width_ft: 6, direction: dir, material: 'green' });
    return outer ? a : a.reverse();
  };
  // left side of the section = inbound (backward) side; on a one-way street both sides face the direction of travel
  els.push(...edge(L, oneway ? 'outbound' : 'inbound', true));
  for (let i = 0; i < bwd; i++) els.push({ type: bus && i === 0 && !oneway ? 'bus_lane' : 'travel_lane', width_ft: bus && i === 0 && !oneway ? 11 : laneW, direction: 'inbound' });
  if (ctl) els.push({ type: 'turn_lane', width_ft: 10, direction: 'both' });
  for (let i = 0; i < fwd; i++) els.push({ type: bus && i === fwd - 1 ? 'bus_lane' : 'travel_lane', width_ft: bus && i === fwd - 1 ? 11 : laneW, direction: 'outbound' });
  els.push(...edge(R, 'outbound', false));

  const width = parseFloat(t.width || '');
  if (width > 0) {
    const ft = width * 3.28084;
    const road = els.filter(e => e.type !== 'sidewalk');
    const cur = road.reduce((a, e) => a + e.width_ft, 0);
    const k = ft / cur;
    road.forEach(e => { e.width_ft = Math.round(e.width_ft * k * 2) / 2; });
    notes.push(`roadway scaled to tagged width ${Math.round(ft)}'`);
  } else notes.push(`widths are ${major ? 'arterial' : 'local'} defaults; verify in the field or on aerial`);
  return { section: { elements: els }, notes, sidewalks: { L: L.sidewalk, R: R.sidewalk } };
}
