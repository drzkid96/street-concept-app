// Surroundings (frontages) for the drawings and the cost setting. Every scene is an fp-section-builder preset
// from the FP asset set; "park" uses the set's Park frontage. No new artwork is made here.
import type { Section, SectionElement } from './types';
import { split } from './roadway';
import type { LngLat } from './providers';
import { engine } from './engine';

export type Frontage = 'residential' | 'commercial' | 'park';
export const DEFAULT_SCENE = 'la-residential';
export const SCENES: [string, string, Frontage][] = [
  ['la-residential', 'LA residential (default)', 'residential'], ['la-neighborhood', 'LA neighborhood, single-family', 'residential'],
  ['la-commercial', 'LA commercial corridor', 'commercial'], ['la-core', 'LA downtown', 'commercial'], ['main-street', 'Main street', 'commercial'],
  ['park', 'Park or open space', 'park'], ['socal-suburban', 'Suburban', 'commercial'], ['coastal', 'Coastal', 'residential'], ['desert', 'Desert', 'residential'],
  ['san-diego', 'San Diego', 'residential'], ['sf-residential', 'SF residential', 'residential'], ['sf-commercial', 'SF commercial', 'commercial'],
  ['sf-core', 'SF downtown', 'commercial'], ['bay-suburban', 'Bay Area suburban', 'residential']];
export const frontageOf = (scene?: string): Frontage => SCENES.find(s => s[0] === (scene || DEFAULT_SCENE))?.[2] ?? 'residential';

// Roadside rules (outside the curbs; never edited by hand):
//  - commercial frontage: a full-width sidewalk to the building face, never a planting strip against a storefront;
//  - residential frontage (the default): sidewalk;
//  - park frontage: sidewalk where OpenStreetMap has one, planting where it says there is none.
// A side OpenStreetMap tags as having no sidewalk keeps none, except on commercial frontage.
export function roadsideFor(f: Frontage, sidewalk: boolean, side: 'L' | 'R'): SectionElement[] {
  void side;
  if (f === 'commercial') return [{ type: 'sidewalk', width_ft: 12, direction: 'none' }];
  if (f === 'park') return [sidewalk ? { type: 'sidewalk', width_ft: 8, direction: 'none' } : { type: 'parkway', width_ft: 8, direction: 'none' }];
  return [sidewalk ? { type: 'sidewalk', width_ft: 10, direction: 'none' } : { type: 'parkway', width_ft: 6, direction: 'none' }];
}
export function applyFrontage(sec: Section, scene: string | undefined, sw: { L: boolean; R: boolean } = { L: true, R: true }) {
  const f = frontageOf(scene), { road } = split(sec);
  sec.elements = [...roadsideFor(f, sw.L, 'L'), ...road, ...roadsideFor(f, sw.R, 'R')];
}

// Broad land use near the segment from OpenStreetMap (Overpass): park, commercial or residential.
// Anything unclear falls back to the LA residential default.
export async function sceneFromLandUse(path: LngLat[]): Promise<{ scene: string; why: string }> {
  const mid = path[Math.floor(path.length / 2)] ?? path[0];
  if (!mid) return { scene: DEFAULT_SCENE, why: 'default' };
  const [x, y] = mid, r = 150;
  const q = `[out:json][timeout:20];(way(around:${r},${y},${x})[landuse];relation(around:${r},${y},${x})[landuse];way(around:${r},${y},${x})[leisure~"^(park|golf_course|nature_reserve|recreation_ground)$"];relation(around:${r},${y},${x})[leisure~"^(park|nature_reserve)$"];way(around:${r},${y},${x})[natural~"^(wood|scrub|grassland)$"];node(around:${r},${y},${x})[shop];way(around:${r},${y},${x})[building~"^(retail|commercial|office|supermarket)$"];way(around:${r},${y},${x})[building~"^(house|residential|apartments|detached)$"];);out tags;`;
  try {
    void q;
    const j = await engine.json('/api/landuse', { lat: y, lon: x, radius: 150 });
    let park = 0, com = 0, res = 0;
    for (const e of j.elements ?? []) {
      const t = e.tags ?? {};
      const w = e.type === 'area' ? 3 : 1;   // an area the segment sits inside counts most
      if (/^(park|golf_course|nature_reserve|recreation_ground)$/.test(t.leisure ?? '') || /^(forest|grass|meadow|recreation_ground)$/.test(t.landuse ?? '') || t.natural) park += 3 * w;
      if (/^(commercial|retail)$/.test(t.landuse ?? '')) com += 3 * w;
      if (t.shop) com += 1;
      if (/^(retail|commercial|office|supermarket)$/.test(t.building ?? '')) com += 1;
      if (t.landuse === 'residential') res += 3 * w;
      if (/^(house|residential|apartments|detached)$/.test(t.building ?? '')) res += 0.5;
    }
    const best = Math.max(park, com, res);
    if (best < 3) return { scene: DEFAULT_SCENE, why: 'no clear land use nearby, so LA residential' };
    if (best === park) return { scene: 'park', why: 'park or open space nearby (OpenStreetMap)' };
    if (best === com) return { scene: 'la-commercial', why: 'commercial land use and shops nearby (OpenStreetMap)' };
    return { scene: DEFAULT_SCENE, why: 'residential land use nearby (OpenStreetMap)' };
  } catch { return { scene: DEFAULT_SCENE, why: 'land use not available, so LA residential' }; }
}
