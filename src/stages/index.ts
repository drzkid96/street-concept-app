import { project, uid } from '../lib/project';
import { sectionSvg } from '../lib/sectionSvg';
import { sectionEditor } from './sectionEditor';
import { siteStage } from './site';
import { visualizeStage } from './visualize';
import { SSS, PRECEDENCE } from '../lib/standards';
import type { Alternative } from '../lib/types';

export interface Stage { id: string; name: string; render(side: HTMLElement, canvas: HTMLElement): void }

const todo = (t: string) => `<div class="todo"><b>To build</b>${t}</div>`;
const src = () => `<div class="srcbar">Standards: <a href="${SSS}/" target="_blank" rel="noopener">SoCal Super Standards</a>. Precedence: ${PRECEDENCE.join(' → ').replace(/_/g, ' ')}.</div>`;

const site = siteStage;
const existing: Stage = {
  id: 'existing', name: 'Existing',
  render(side, canvas) {
    const seg = project.seg();
    side.innerHTML = `<h2>2. EXISTING</h2><p class="note">Sample section loaded. Edit to match field or as-built.</p><div id="ed"></div>${src()}
      ${todo('Curb tool on aerial (fp-render-curbs), section from S&S plan (ss-plan-section), section from aerial with optional AI assist.')}`;
    const draw = () => { canvas.innerHTML = sectionSvg(seg.existing, `${seg.limits.from || 'Segment'} existing`); };
    sectionEditor(side.querySelector('#ed') as HTMLElement, seg.existing, () => { project.update(() => {}); draw(); });
    draw();
  }
};

let altIdx = 0;
const alts: Stage = {
  id: 'alts', name: 'Alternatives',
  render(side, canvas) {
    const seg = project.seg();
    const list = () => seg.alternatives.map((a, i) => `<option value="${i}"${i === altIdx ? ' selected' : ''}>${a.name}</option>`).join('');
    side.innerHTML = `<h2>3. ALTERNATIVES</h2>
      <div class="row"><select id="pick" class="sel" aria-label="Alternative">${list()}</select><button class="btn" id="dup">New from existing</button></div>
      <div class="field"><label for="nm">Name</label><input id="nm"></div>
      <div class="field"><label for="tier">Tier</label><select id="tier"><option>quick-build</option><option>interim</option><option>capital</option></select></div>
      <div id="ed"></div>${src()}
      ${todo('Auto-name from changes (e.g. "Road diet + Class IV"), tier presets, side-by-side compare.')}`;
    const ed = side.querySelector('#ed') as HTMLElement;
    const show = () => {
      const a = seg.alternatives[altIdx];
      if (!a) { ed.innerHTML = '<p class="note">No alternatives yet.</p>'; canvas.innerHTML = '<div class="empty">Create an alternative from the existing section.</div>'; return; }
      (side.querySelector('#nm') as HTMLInputElement).value = a.name;
      (side.querySelector('#tier') as HTMLSelectElement).value = a.tier;
      const fresh = ed.cloneNode(false) as HTMLElement; ed.replaceWith(fresh);
      const draw = () => { canvas.innerHTML = sectionSvg(seg.existing, 'Existing') + sectionSvg(a.section, a.name); };
      sectionEditor(fresh, a.section, () => { project.update(() => {}); draw(); });
      draw();
    };
    side.querySelector('#dup')!.addEventListener('click', () => {
      const a: Alternative = { id: uid(), name: `Alternative ${seg.alternatives.length + 1}`, tier: 'quick-build', section: structuredClone(seg.existing) };
      project.update(() => { seg.alternatives.push(a); });
      altIdx = seg.alternatives.length - 1; alts.render(side, canvas);
    });
    side.querySelector('#pick')!.addEventListener('change', e => { altIdx = +(e.target as HTMLSelectElement).value; alts.render(side, canvas); });
    side.querySelector('#nm')!.addEventListener('change', e => { const a = seg.alternatives[altIdx]; if (a) project.update(() => { a.name = (e.target as HTMLInputElement).value; }); alts.render(side, canvas); });
    side.querySelector('#tier')!.addEventListener('change', e => { const a = seg.alternatives[altIdx]; if (a) project.update(() => { a.tier = (e.target as HTMLSelectElement).value as Alternative['tier']; }); });
    show();
  }
};

const cost: Stage = {
  id: 'cost', name: 'Cost',
  render(side, canvas) {
    const seg = project.seg();
    side.innerHTML = `<h2>4. COST</h2><p>Quantities = element width × segment length (${seg.length_ft.toLocaleString()}').</p>
      ${todo('Unit costs from fp-section-builder 2025-26 F&P bid prices by region, Caltrans unit costs as fallback (reliability A/B/C), delivery tier factors, .xlsx export.')}`;
    const rows = seg.alternatives.map(a => {
      const changed = a.section.elements.filter((e, i) => JSON.stringify(e) !== JSON.stringify(seg.existing.elements[i]));
      const sf = changed.reduce((s, e) => s + e.width_ft * seg.length_ft, 0);
      return `<tr><td>${a.name}</td><td>${a.tier}</td><td class="num">${changed.length}</td><td class="num">${Math.round(sf).toLocaleString()}</td><td class="num">—</td></tr>`;
    }).join('');
    canvas.innerHTML = `<div style="padding:1.25rem"><div class="scroll"><table><thead><tr><th>Alternative</th><th>Tier</th><th class="num">Changed elements</th><th class="num">Changed area (sf)</th><th class="num">Estimate</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5">No alternatives yet.</td></tr>'}</tbody></table></div>
      <p class="note">Estimate column fills once unit cost data is loaded.</p></div>`;
  }
};

const placeholder = (n: number, id: string, name: string, text: string, skills: string): Stage => ({
  id, name,
  render(side, canvas) {
    side.innerHTML = `<h2>${n}. ${name.toUpperCase()}</h2><p class="note">Replaces: ${skills}</p>${todo(text)}`;
    canvas.innerHTML = `<div class="empty">${name} workspace placeholder</div>`;
  }
});

export const STAGES: Stage[] = [
  site, existing, alts, cost,
  visualizeStage,
  placeholder(6, 'sheets', 'Sheets', '11x17 landscape sheets with pdf-lib, Albert Sans embedded, automated overlap and clipping check.', 'fp-core-brand, adrian-work-playbook'),
  placeholder(7, 'review', 'Review', 'Markup viewer (callouts, clouds, lines, pen, snap). SEND exports markup JSON to the project; APPROVED locks the revision.', 'fp-core-review'),
  placeholder(8, 'handoff', 'Handoff', 'DXF export in browser; DWG through a LibreDWG service.', 'dxf-to-dwg')
];
