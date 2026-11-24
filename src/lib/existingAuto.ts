// Existing section, filled automatically: OpenStreetMap first, checked against the segment's Street View photo.
// OpenStreetMap carries most of the weight. The photo can only nudge widths where its painted lines line up
// with the boundaries OpenStreetMap predicts, measured from a curb the photo actually found; otherwise it
// only raises flags for the person to look at.
import { guessExisting } from './osmGuess';
import { streetImage, bearing, type LngLat } from './providers';
import { engine } from './engine';
import type { Section, SectionElement } from './types';
import { sceneFromLandUse, applyFrontage } from './scenes';

export interface PhotoLine { x_ft: number; color: 'white' | 'yellow'; pattern: 'solid' | 'dashed'; strength: number }
export interface PhotoCheck { ok: boolean; reason?: string; quality?: number; curbs?: { L?: { x_ft: number; conf: number }; R?: { x_ft: number; conf: number } }; lines?: PhotoLine[]; curb_to_curb_ft?: number; width_conf?: number }
export interface WidthChange { label: string; osm: number; photo: number; final: number }
export interface AutoResult {
  key: string; at: string;
  osm: { street: string; cls: string; notes: string[]; widthTagged: boolean; summary: string };
  photo: { used: boolean; summary: string; source?: string; weight: number } ;
  agree: string; flags: string[]; changes: WidthChange[];
  section: Section;
  scene: string; sceneWhy: string; sidewalks: { L: boolean; R: boolean };
  photoSrc?: { src: string; source: string; credit: string; link?: string; heading?: number };
}

export const W_OSM = 0.8, W_OSM_TAGGED = 0.9, W_PHOTO = 0.2;
const ROADSIDE = new Set(['sidewalk', 'parkway', 'curb']);
const LABEL: Record<string, string> = { travel_lane: 'Travel lane', turn_lane: 'Turn lane', bus_lane: 'Bus lane', bike_lane: 'Bike lane', bike_buffer: 'Bike buffer', separated_bikeway: 'Separated bikeway', parking: 'Parking', median: 'Median', shoulder: 'Shoulder' };
const half = (n: number) => Math.round(n * 2) / 2;
export const pathKey = (p: LngLat[]) => p.length < 2 ? '' : [p[0], p[p.length - 1]].map(c => c.map(n => n.toFixed(5)).join(',')).join(';');

function osmSummary(sec: Section, oneway: boolean) {
  const n = (t: string) => sec.elements.filter(e => e.type === t).length;
  const parts = [`${n('travel_lane') + n('bus_lane')} travel lane${n('travel_lane') + n('bus_lane') === 1 ? '' : 's'}${oneway ? ', one-way' : ''}`];
  if (n('turn_lane')) parts.push('center turn lane');
  if (n('bike_lane') || n('separated_bikeway')) parts.push(`${n('bike_lane') + n('separated_bikeway')} bikeway${n('bike_lane') + n('separated_bikeway') === 1 ? '' : 's'}`);
  if (n('parking')) parts.push(`${n('parking')} parking lane${n('parking') === 1 ? '' : 's'}`);
  if (n('sidewalk')) parts.push(`${n('sidewalk')} sidewalk${n('sidewalk') === 1 ? '' : 's'}`);
  return parts.join(', ');
}

// Merge: match OSM's roadway boundaries to the photo's lines, measured from the curb the photo found.
export function blend(osmSec: Section, pc: PhotoCheck | null, widthTagged: boolean, oneway: boolean) {
  const sec: Section = structuredClone(osmSec);
  const flags: string[] = [], changes: WidthChange[] = [];
  const road = sec.elements.map((e, i) => ({ e, i })).filter(x => !ROADSIDE.has(x.e.type));
  const roadW = road.reduce((a, x) => a + x.e.width_ft, 0);
  const wO = widthTagged ? W_OSM_TAGGED : W_OSM;
  if (!pc || !pc.ok || !road.length) return { sec, flags, changes, used: false, summary: pc?.reason ? `Not used: ${pc.reason}.` : 'Not used: no photo here.', agree: '' };
  const q = pc.quality ?? 1;
  const side: 'R' | 'L' | null = pc.curbs?.R && (!pc.curbs?.L || pc.curbs.R.conf >= pc.curbs.L.conf) ? 'R' : pc.curbs?.L ? 'L' : null;
  if (!side) return { sec, flags, changes, used: false, summary: 'Not used: no curb could be found on the photo.', agree: '' };
  const curb = pc.curbs![side]!;
  const conf = curb.conf * q, wP = W_PHOTO * conf;
  // Distances from the anchor curb: OSM boundaries and photo lines.
  const bounds: number[] = []; let acc = 0;
  const order = side === 'R' ? [...road].reverse() : road;
  order.forEach(x => { acc += x.e.width_ft; bounds.push(acc); });       // last bound = far curb
  const lines = (pc.lines ?? []).map(l => ({ ...l, d: side === 'R' ? curb.x_ft - l.x_ft : l.x_ft - curb.x_ft })).filter(l => l.d > 0.8).sort((a, b) => a.d - b.d);
  const used = new Set<number>();
  const matched: (number | null)[] = bounds.map((b, bi) => {
    if (bi === bounds.length - 1 && side && pc.curbs?.[side === 'R' ? 'L' : 'R']) { const o = pc.curbs![side === 'R' ? 'L' : 'R']!; return Math.abs(o.x_ft - curb.x_ft); }
    const tol = 2 + 0.12 * b;
    let best = -1, bd = tol;
    lines.forEach((l, li) => { if (!used.has(li) && Math.abs(l.d - b) < bd) { bd = Math.abs(l.d - b); best = li; } });
    if (best < 0) return null;
    used.add(best); return lines[best].d;
  });
  // Width blend for each element whose two sides were both seen (the anchor curb counts as seen).
  let prevOsm = 0, prevPh: number | null = 0;
  order.forEach((x, k) => {
    const ph = matched[k];
    if (ph != null && prevPh != null) {
      const photoW = ph - prevPh, osmW = x.e.width_ft;
      if (photoW > 1 && photoW < 25) {
        const fin = half((wO * osmW + wP * photoW) / (wO + wP));
        changes.push({ label: LABEL[x.e.type] ?? x.e.type, osm: osmW, photo: Math.round(photoW * 10) / 10, final: fin });
        x.e.width_ft = fin;
        if (Math.abs(photoW - osmW) > Math.max(3, osmW * 0.35)) flags.push(`${LABEL[x.e.type] ?? x.e.type}: the photo measures about ${photoW.toFixed(0)} ft, OpenStreetMap suggests ${osmW} ft. Kept close to OpenStreetMap; check it.`);
      }
    }
    prevOsm = bounds[k]; prevPh = ph;
  });
  void prevOsm;
  // Lane configuration: strong lines OSM does not explain, and center lines that do not fit the direction.
  const checked = matched.slice(0, -1).filter(m => m != null).length, interior = bounds.length - 1;
  lines.forEach((l, li) => {
    if (used.has(li) || l.strength < 0.3 || l.d > roadW + 2) return;
    const where = `${l.d.toFixed(0)} ft from the ${side === 'R' ? 'right' : 'left'} curb`;
    if (l.color === 'yellow' && oneway) flags.push(`The photo shows a yellow line ${where}, but OpenStreetMap has this street as one-way. Kept one-way; check it.`);
    else if (l.pattern === 'solid' && l.strength >= 0.5) flags.push(`The photo shows a solid line ${where} that the OpenStreetMap layout does not have (an edge line, bike lane or parking line?). Kept the OpenStreetMap layout.`);
  });
  const yellow = lines.some(l => l.color === 'yellow' && l.strength >= 0.4);
  if (!oneway && !yellow && lines.length >= 2) flags.push('OpenStreetMap has two-way traffic, but no yellow center line shows on the photo. Kept two-way; check it.');
  const agree = interior ? `${checked} of ${interior} lane line${interior === 1 ? '' : 's'} from OpenStreetMap seen on the photo.` : '';
  const n = lines.length;
  const summary = `${side === 'R' ? 'Right' : 'Left'} curb found${pc.curb_to_curb_ft ? `, ${pc.curb_to_curb_ft} ft curb to curb` : ''}; ${n} painted line${n === 1 ? '' : 's'} ${n && n <= 4 ? ` (${lines.map(l => `${l.pattern} ${l.color} at ${l.d.toFixed(1)} ft`).join(', ')})` : n > 4 ? ' (too many to trust: cars or clutter in the photo)' : ''}. Photo confidence ${Math.round(conf * 100)}%.`;
  if (pc.curb_to_curb_ft && pc.width_conf) {
    const pw = pc.curb_to_curb_ft, fin = sec.elements.filter(e => !ROADSIDE.has(e.type)).reduce((a, e) => a + e.width_ft, 0);
    if (Math.abs(pw - fin) > Math.max(4, fin * 0.2)) flags.push(`Curb to curb: the photo measures about ${pw.toFixed(0)} ft, the section totals ${fin} ft. Check the widths.`);
  }
  return { sec, flags, changes, used: true, summary, agree, conf };
}

async function photoFor(path: LngLat[]) {
  const h = path[1] ? bearing(path[0], path[1]) : 0;
  const img = await streetImage(path[0], h).catch(() => null);
  return img;
}

export async function autoExisting(path: LngLat[], onStep: (t: string) => void, pinned?: string): Promise<AutoResult> {
  onStep('Reading OpenStreetMap streets and land use, and fetching the Street View photo…');
  const [g, img, land] = await Promise.all([guessExisting(path), photoFor(path), pinned ? Promise.resolve({ scene: pinned, why: 'your choice in Site' }) : sceneFromLandUse(path)]);
  applyFrontage(g.section, land.scene, g.sidewalks);
  const widthTagged = !!parseFloat(g.tags.width || '');
  const oneway = g.tags.oneway === 'yes';
  let pc: PhotoCheck | null = null;
  if (img && engine.on) {
    onStep('Checking widths and lane lines on the photo…');
    try {
      const blob = await fetch(img.src).then(r => r.blob());
      const fd = new FormData(); fd.append('photo', blob, 'photo.jpg'); fd.append('camera_h', img.source === 'Google Street View' ? '8.2' : '8.2');
      pc = await engine.form('/api/existing/photo-check', fd);
    } catch (err) { pc = { ok: false, reason: (err as Error).message }; }
  }
  const b = blend(g.section, pc, widthTagged, oneway);
  if (g.notes.some(n => n.includes('parking assumed'))) b.flags.unshift('Curb parking is assumed (OpenStreetMap has no parking tag). It is drawn unmarked (no edge line or T marks) unless an aerial image shows the paint; beside a bike lane it is always marked.');
  return {
    key: pathKey(path), at: new Date().toISOString(),
    osm: { street: g.street, cls: g.cls, notes: g.notes, widthTagged, summary: osmSummary(g.section, oneway) },
    photo: { used: b.used, summary: img ? b.summary : 'Not used: no Street View at the start of the segment.', source: img ? `${img.source}, ${img.credit}` : undefined, weight: b.used ? Math.round(100 * W_PHOTO * (b.conf ?? 0) / ((widthTagged ? W_OSM_TAGGED : W_OSM) + W_PHOTO * (b.conf ?? 0))) : 0 },
    agree: b.agree, flags: b.flags, changes: b.changes, section: b.sec,
    scene: land.scene, sceneWhy: land.why, sidewalks: g.sidewalks,
    photoSrc: img ? { src: img.src, source: img.source, credit: img.credit, link: img.link, heading: img.heading } : undefined
  };
}
export type { SectionElement };
