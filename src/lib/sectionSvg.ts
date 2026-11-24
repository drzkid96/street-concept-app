import type { Section } from './types';
import { ELEMENTS, CONVENTIONS, materialOf } from './standards';
import { planPath, laneGlyph, glyph, extent } from './glyph';

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

// Plan-agnostic 2D section: element widths to scale, labels and dimensions below.
export function sectionSvg(sec: Section, title = ''): string {
  const els = sec.elements;
  const total = els.reduce((a, e) => a + (e.width_ft || 0), 0) || 1;
  const W = 1000, scale = (W - 40) / total, top = 60, roadH = 90;
  let x = 20;
  const parts: string[] = [];
  els.forEach(e => {
    const w = e.width_ft * scale, meta = ELEMENTS[e.type], mat = materialOf(e.type, e.material);
    const fill = mat === 'unpainted' ? 'var(--st-asphalt)' : (e.type === 'median' && mat === 'concrete') ? 'var(--st-concrete)' : meta.fill;
    const raised = e.type === 'sidewalk' || e.type === 'parkway' || e.type === 'median' || e.type === 'curb' || mat === 'raised';
    const y = raised ? top - 8 : top;
    parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${roadH + (raised ? 8 : 0)}" fill="${fill}" stroke="var(--bg)" stroke-width="1"/>`);
    if ((mat === 'posts' || mat === 'curb') && w > 6) { const px = e.type === 'separated_bikeway' ? x + 3 : x + w / 2; parts.push(mat === 'posts' ? `<rect x="${px - 1.5}" y="${top - 22}" width="3" height="22" fill="#fff" stroke="#C8102E" stroke-width=".8"/>` : `<rect x="${px - 3}" y="${top - 8}" width="8" height="8" fill="var(--st-concrete)"/>`); }
    if (e.type === 'bus_lane' && w > 40)
      parts.push(`<text x="${x + w / 2}" y="${top + roadH / 2 + 5}" text-anchor="middle" font-size="13" font-weight="700" fill="#fff">${CONVENTIONS.bus_lane_text}</text>`);
    // CA MUTCD marking (skill glyph set), in plan: up = away from the viewer
    const gname = laneGlyph(e.type, e.direction);
    if (gname && (e.direction !== 'none' || gname === 'twltl')) {
      const ex = extent(glyph(gname)), gl = ex.w1 - ex.w0, gw = ex.u1 - ex.u0;
      const sc = Math.min((roadH * 0.62) / gl, (w * 0.7) / gw);
      parts.push(`<path d="${planPath(gname, x + w / 2, top + roadH * 0.55, sc, e.direction === 'inbound' ? -1 : 1)}" fill="#fff"/>`);
    }
    const ly = top + roadH + 26;
    if (w > 28) {
      parts.push(`<text x="${x + w / 2}" y="${ly}" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">${esc(meta.label)}</text>`);
      parts.push(`<text x="${x + w / 2}" y="${ly + 16}" text-anchor="middle" font-size="12" fill="currentColor">${e.width_ft}'</text>`);
    }
    parts.push(`<line x1="${x}" y1="${top + roadH + 6}" x2="${x}" y2="${top + roadH + 12}" stroke="currentColor"/>`);
    x += w;
  });
  parts.push(`<line x1="${x}" y1="${top + roadH + 6}" x2="${x}" y2="${top + roadH + 12}" stroke="currentColor"/>`);
  return `<svg class="section-svg" viewBox="0 0 ${W} ${top + roadH + 70}" role="img" aria-label="Cross-section ${esc(title)}" style="color:var(--ink)">
    <text x="20" y="28" font-size="16" font-weight="600" fill="currentColor">${esc(title.toUpperCase())}</text>
    <text x="${W - 20}" y="28" text-anchor="end" font-size="13" fill="currentColor">${total}' TOTAL</text>
    ${parts.join('')}
  </svg>`;
}
