import { project, uid } from '../lib/project';
import { sectionSvg } from '../lib/sectionSvg';
import { sectionEditor } from './sectionEditor';
import { siteStage } from './site';
import { costStage } from './cost';
import { sheetsStage } from './sheets';
import { autoExisting, pathKey, type AutoResult } from '../lib/existingAuto';
import type { LngLat } from '../lib/providers';
import { visualizeStage } from './visualize';
import { head, task, esc } from './ui';
import type { Alternative } from '../lib/types';

export interface Stage { id: string; name: string; done?: () => boolean; render(side: HTMLElement, canvas: HTMLElement): void | Promise<void>; dispose?: () => void }
export const repaintNav = () => (window as any).__repaintNav?.();
// Incremented on every stage change; async renders compare against it and stop if the user moved on.
export const live = { gen: 0 };


const site = siteStage;
let autoRunning = '';
const existing: Stage = {
  id: 'existing', name: 'Existing',
  done: () => !!project.seg().existingChecked,
  render(side, canvas) {
    const seg = project.seg();
    const gen = live.gen;
    const path = (seg.path ?? []) as LngLat[];
    const has = path.length > 1, key = pathKey(path);
    const a = seg.existingAuto;
    // A section the person already confirmed is never refilled on its own, unless the segment itself moved.
    const stale = has && (a ? a.key !== key : !seg.existingChecked);
    const pct = (w: number) => `${w}%`;
    const sources = (r: AutoResult) => `
      <ul class="sources">
        <li><b>OpenStreetMap</b> <span class="wt">weight ${pct(100 - r.photo.weight)}</span><span>${esc(r.osm.street)} (${esc(r.osm.cls)}): ${esc(r.osm.summary)}.</span>${r.osm.notes.length ? `<span class="note">${r.osm.notes.map(esc).join('; ')}.</span>` : ''}</li>
        <li><b>Street View photo</b> <span class="wt">weight ${pct(r.photo.weight)}</span><span>${esc(r.photo.summary)}</span>${r.photo.source ? `<span class="note">${esc(r.photo.source)}</span>` : ''}</li>
      </ul>
      ${r.agree ? `<p class="note">${esc(r.agree)}</p>` : ''}
      ${r.changes.length ? `<table class="mini-t"><thead><tr><th>Width (ft)</th><th class="num">OSM</th><th class="num">Photo</th><th class="num">Used</th></tr></thead><tbody>${r.changes.map(c => `<tr><td>${esc(c.label)}</td><td class="num">${c.osm}</td><td class="num">${c.photo}</td><td class="num"><b>${c.final}</b></td></tr>`).join('')}</tbody></table>` : ''}
      ${r.flags.length ? `<ul class="flags">${r.flags.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : '<p class="okline">No conflicts between OpenStreetMap and the photo.</p>'}
      <div class="row"><button class="linkbtn" id="again">Fill again</button></div>`;
    side.innerHTML = `${head(2, 'Existing street', 'The street as it is today. Filled in for you from OpenStreetMap, checked against the Street View photo.')}
      ${task(1, 'Filled automatically', !has ? 'later' : stale ? 'now' : 'done', !has ? '<p class="note">Mark the segment in <a href="#site">Site</a> first.</p>' : stale ? '<p class="note" id="prog">Starting…</p>' : a ? sources(a) : '<p class="note">You entered and confirmed this section yourself.</p><div class="row"><button class="linkbtn" id="again">Fill again from OpenStreetMap and the photo</button></div>')}
      ${task(2, 'Check it and fix anything wrong', seg.existingChecked ? 'done' : stale ? 'later' : 'now', `
        <p class="note">OpenStreetMap rarely has widths or parking. Fix anything that does not match the street, then confirm.</p>
        <div id="ed"></div>
        <label class="check-row"><input type="checkbox" id="ok"${seg.existingChecked ? ' checked' : ''}${stale ? ' disabled' : ''}> This matches the street today</label>`)}`;
    const draw = () => { canvas.innerHTML = sectionSvg(seg.existing, `${seg.limits.from || 'Segment'} existing`); };
    sectionEditor(side.querySelector('#ed') as HTMLElement, seg.existing, () => { project.update(() => {}); draw(); });
    side.querySelector('#ok')!.addEventListener('change', e => { project.update(() => { seg.existingChecked = (e.target as HTMLInputElement).checked; }); repaintNav(); existing.render(side, canvas); });
    side.querySelector('#again')?.addEventListener('click', () => { project.update(() => { delete seg.existingAuto; seg.existingChecked = false; }); existing.render(side, canvas); });
    draw();
    if (stale && autoRunning !== key) {
      autoRunning = key;
      const prog = (t: string) => { const el = side.querySelector('#prog'); if (el && gen === live.gen) el.textContent = t; };
      autoExisting(path, prog).then(r => {
        autoRunning = '';
        project.update(() => {
          seg.existing = r.section; seg.existingAuto = r; seg.existingChecked = false;
          if (!seg.limits.from) seg.limits.from = r.osm.street;
          if (!seg.perspective && r.photoSrc) seg.perspective = r.photoSrc;   // the same photo starts the Render step
        });
        repaintNav();
        if (gen === live.gen) existing.render(side, canvas);
      }).catch(err => { autoRunning = ''; prog('Could not fill automatically: ' + (err as Error).message + '. Type the section in below.'); });
    }
  }
};

let altIdx = 0;
const alts: Stage = {
  id: 'alts', name: 'Alternatives',
  done: () => project.seg().alternatives.length > 0,
  render(side, canvas) {
    const seg = project.seg();
    if (altIdx >= seg.alternatives.length) altIdx = Math.max(0, seg.alternatives.length - 1);
    const a = seg.alternatives[altIdx];
    side.innerHTML = `${head(3, 'Alternatives', 'Design one or more concepts. Each new one starts as a copy of the existing street.')}
      <div class="chips" role="tablist">${seg.alternatives.map((x, i) => `<button class="chip" role="tab" aria-selected="${i === altIdx}" data-i="${i}">${esc(x.name)}</button>`).join('')}
        <button class="chip add" id="dup">+ New alternative</button></div>
      ${a ? `<div class="field"><label for="nm">Name</label><input id="nm" value="${esc(a.name)}"></div>
      <div class="field"><label for="tier">Delivery</label><select id="tier"><option value="quick-build">Quick-build (paint and posts)</option><option value="interim">Interim</option><option value="capital">Capital (concrete)</option></select></div>
      <p class="note">Change element types and widths. The total stays visible below the table.</p>
      <div id="ed"></div>
      <div class="row"><button class="btn ghost danger" id="del">Delete this alternative</button></div>` : '<p class="note">No alternatives yet. Press <b>+ New alternative</b> to start from the existing street.</p>'}`;
    side.querySelector('#dup')!.addEventListener('click', () => {
      const n: Alternative = { id: uid(), name: `Alternative ${seg.alternatives.length + 1}`, tier: 'quick-build', section: structuredClone(seg.existing) };
      project.update(() => { seg.alternatives.push(n); });
      altIdx = seg.alternatives.length - 1; repaintNav(); alts.render(side, canvas);
    });
    side.querySelectorAll<HTMLElement>('.chip[data-i]').forEach(b => b.addEventListener('click', () => { altIdx = +b.dataset.i!; alts.render(side, canvas); }));
    if (!a) { canvas.innerHTML = sectionSvg(seg.existing, 'Existing'); return; }
    (side.querySelector('#tier') as HTMLSelectElement).value = a.tier;
    side.querySelector('#nm')!.addEventListener('change', e => { project.update(() => { a.name = (e.target as HTMLInputElement).value || a.name; }); alts.render(side, canvas); });
    side.querySelector('#tier')!.addEventListener('change', e => { project.update(() => { a.tier = (e.target as HTMLSelectElement).value as Alternative['tier']; }); });
    side.querySelector('#del')!.addEventListener('click', e => { const b = e.currentTarget as HTMLButtonElement; if (!b.dataset.arm) { b.dataset.arm = '1'; b.textContent = 'Click again to delete'; return; } project.update(() => { seg.alternatives.splice(altIdx, 1); }); altIdx = Math.max(0, altIdx - 1); repaintNav(); alts.render(side, canvas); });
    const draw = () => { canvas.innerHTML = sectionSvg(seg.existing, 'Existing') + sectionSvg(a.section, a.name); };
    sectionEditor(side.querySelector('#ed') as HTMLElement, a.section, () => { project.update(() => {}); draw(); });
    draw();
  }
};


export const STAGES: Stage[] = [site, existing, alts, costStage, visualizeStage, sheetsStage];
