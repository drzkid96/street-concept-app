// CA MUTCD pavement-marking shapes, exported unchanged from fp-section-builder la/glyphs.py (the skills' one glyph set).
// Polygons in feet: u across the lane, w along it, +w = direction of travel.
import G from './glyphs.json';

type Poly = [number, number][];
export type GlyphName = 'bike' | 'arrow' | 'sharrow' | 'lturn' | 'rturn' | 'twltl';
const SET = (G as unknown as { glyphs: Record<GlyphName, Poly[]> }).glyphs;

// Straight lane-use arrow for general and bus lanes: the skill's arrow outline at 8 ft (CA MUTCD Fig 3B lane-use arrow length).
const STRAIGHT: Poly[] = SET.arrow.map(p => p.map(([u, w]) => [u * 1.33, w * 1.33] as [number, number]));

export function glyph(name: GlyphName | 'straight'): Poly[] {
  return name === 'straight' ? STRAIGHT : SET[name];
}

export function extent(polys: Poly[]) {
  const us = polys.flat().map(p => p[0]), ws = polys.flat().map(p => p[1]);
  return { u0: Math.min(...us), u1: Math.max(...us), w0: Math.min(...ws), w1: Math.max(...ws) };
}

/** Plan view: glyph centred at (cx, cy) px, `s` px per ft, pointing up when dir = +1 (away) and down when -1 (toward the viewer). */
export function planPath(name: GlyphName | 'straight', cx: number, cy: number, s: number, dir: 1 | -1 = 1) {
  const polys = glyph(name), e = extent(polys), uc = (e.u0 + e.u1) / 2, wc = (e.w0 + e.w1) / 2;
  return polys.map(p => 'M' + p.map(([u, w]) => `${(cx + (u - uc) * s * dir).toFixed(2)},${(cy - (w - wc) * s * dir).toFixed(2)}`).join('L') + 'Z').join('');
}

/** Ground plane: glyph polygons as (x ft across the section, z ft ahead of the camera) for perspective projection. */
export function groundPolys(name: GlyphName | 'straight', xc: number, z0: number, dir: 1 | -1): [number, number][][] {
  const polys = glyph(name), e = extent(polys), uc = (e.u0 + e.u1) / 2;
  // dir +1: travel away from the camera (+w = +z); dir -1: toward it, so the glyph is turned end for end
  return polys.map(p => p.map(([u, w]) => [xc + (u - uc) * dir, z0 + (dir === 1 ? w - e.w0 : e.w1 - w)] as [number, number]));
}

/** Which glyph a lane carries. */
export function laneGlyph(type: string, direction: string): GlyphName | 'straight' | null {
  if (type === 'turn_lane') return direction === 'both' ? 'twltl' : 'lturn';
  if (type === 'bike_lane' || type === 'separated_bikeway') return 'arrow';
  if (type === 'travel_lane' || type === 'bus_lane') return 'straight';
  return null;
}
