import { project, uid } from '../lib/project';
import { sectionEditor } from './sectionEditor';
import { siteStage } from './site';
import { buildStage } from './build';
import { photoStage } from './photo';
import { sheetsStage } from './sheets';
import { autoExisting, pathKey, type AutoResult } from '../lib/existingAuto';
import type { LngLat } from '../lib/providers';
import { visualizeStage } from './visualize';
import { head, task, esc } from './ui';
import { showSections } from '../lib/sectionView';
import { aerialMini } from '../lib/aerialMini';
import { defaultAlternatives } from '../lib/concepts';
import { conformTo } from '../lib/roadway';
import { SCENES, DEFAULT_SCENE, applyFrontage } from '../lib/scenes';
import type { Alternative } from '../lib/types';

export interface Stage { id: string; name: string; done?: () => boolean; ready?: () => boolean; confirm?: () => void; render(side: HTMLElement, canvas: HTMLElement): void | Promise<void>; dispose?: () => void }
export const repaintNav = () => (window as any).__repaintNav?.();
export const goTo = (id: string) => (window as any).__go?.(id);
// Incremented on every stage change; async renders compare against it and stop if the user moved on.
export const live = { gen: 0 };


const site = siteStage;
let autoRunning = '';
const existing: Stage = {
  id: 'existing', name: 'Existing',
  done: () => !!project.seg().existingChecked,
  // Next is the confirmation: no separate tick box.
  ready: () => { const g = project.seg(); return (g.path?.length ?? 0) > 1 && !!g.existingAuto && g.existing.elements.length > 0; },
  confirm: () => project.update(() => { project.seg().existingChecked = true; }),
  render(side, canvas) {
    existing.dispose?.();
    const seg = project.seg();
    const gen = live.gen;
    const path = (seg.path ?? []) as LngLat[];
    const has = path.length > 1, key = pathKey(path);
    const a = seg.existingAuto;
    // A section the person already confirmed is never refilled on its own, unless the segment itself moved.
    const stale = has && (!a || a.key !== key);
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
        <p class="note">Only the roadway between the curbs is edited. OpenStreetMap rarely has widths or parking: fix anything that does not match the street, then confirm.</p>
        <div class="field"><label for="scene">Frontage type</label><select id="scene">${SCENES.map(([v, l]) => `<option value="${v}"${v === (seg.setting || DEFAULT_SCENE) ? ' selected' : ''}>${l}</option>`).join('')}</select>
          <span class="note">${a?.sceneWhy ? `Picked from ${esc(a.sceneWhy)}. ` : ''}Sidewalks follow the frontage.</span></div>

        <div id="ed"></div>
<p class="note">When it matches the street, press <b>Next</b>.</p>`)}`;
    if (!stale && seg.settingPinned && a && a.scene !== seg.setting) project.update(() => { applyFrontage(seg.existing, seg.setting, a.sidewalks); a.scene = seg.setting!; a.sceneWhy = 'your choice in Site'; seg.alternatives.forEach(x => conformTo(x.section, seg.existing)); });
    canvas.innerHTML = '<div class="ex-split"><div id="aer"></div><div id="secHost"></div></div>';
    const stopMap = has ? aerialMini(canvas.querySelector('#aer') as HTMLElement, path) : null;
    existing.dispose = () => stopMap?.();
    const draw = () => showSections(canvas.querySelector('#secHost') as HTMLElement, [{ id: 'ex', title: `${seg.limits.from || 'Segment'}: existing`, section: seg.existing, existing: true }], seg.setting);
    sectionEditor(side.querySelector('#ed') as HTMLElement, seg.existing, () => { project.update(() => { seg.alternatives.forEach(x => conformTo(x.section, seg.existing)); }); draw(); }, { existing: true });
    side.querySelector('#scene')?.addEventListener('change', e => { project.update(() => { seg.setting = (e.target as HTMLSelectElement).value; seg.settingPinned = true; applyFrontage(seg.existing, seg.setting, a?.sidewalks); if (a) { a.scene = seg.setting; a.sceneWhy = 'your choice'; } seg.alternatives.forEach(x => conformTo(x.section, seg.existing)); }); existing.render(side, canvas); });
    side.querySelector('#again')?.addEventListener('click', () => { project.update(() => { delete seg.existingAuto; seg.existingChecked = false; }); existing.render(side, canvas); });
    draw();
    if (stale && autoRunning !== key) {
      autoRunning = key;
      const prog = (t: string) => { const el = side.querySelector('#prog'); if (el && gen === live.gen) el.textContent = t; };
      autoExisting(path, prog, seg.settingPinned ? seg.setting : undefined).then(r => {
        autoRunning = '';
        project.update(() => {
          seg.existing = r.section; seg.existingAuto = r; seg.existingChecked = false;
          if (!seg.fromTyped) seg.limits.from = r.osm.street;
          seg.setting = r.scene;
          seg.alternatives.forEach(x => conformTo(x.section, r.section));
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
  done: () => project.seg().alternatives.some(a => a.enabled !== false),
  render(side, canvas) {
    const seg = project.seg();
    // Three concepts by default (bikeway tiers), each fitted inside the existing curbs. Each can be switched off.
    if (!seg.alternatives.length && seg.existing.elements.length) project.update(() => { seg.alternatives = defaultAlternatives(seg.existing); });
    if (altIdx >= seg.alternatives.length) altIdx = Math.max(0, seg.alternatives.length - 1);
    const a = seg.alternatives[altIdx];
    side.innerHTML = `${head(3, 'Alternatives', 'Three bikeway concepts are ready by default, each fitted inside the existing curbs. Edit them, switch any off, or add your own.')}
      <ul class="altlist">${seg.alternatives.map((x, i) => `<li class="${i === altIdx ? 'cur' : ''}${x.enabled === false ? ' off' : ''}"><input type="checkbox" data-on="${i}" aria-label="Include ${esc(x.name)} in the outputs"${x.enabled === false ? '' : ' checked'}><button class="linkbtn" data-i="${i}">${String.fromCharCode(65 + i)}. ${esc(x.name)}</button></li>`).join('')}</ul>
      <div class="row"><button class="chip add" id="dup">+ New from existing</button><button class="chip add" id="defaults">Reset to the three default concepts</button></div>
      <p class="note">Ticked concepts go into the outputs.</p>
      ${a ? `<div class="field"><label for="nm">Name</label><input id="nm" value="${esc(a.name)}"></div>
      <div class="field"><label for="tier">Delivery</label><select id="tier"><option value="quick-build">Quick-build (paint and posts)</option><option value="interim">Interim</option><option value="capital">Capital (concrete)</option></select></div>
      <p class="note">Change the roadway between the curbs. The curbs and everything outside them stay as they are today.</p>
      <div id="ed"></div>
      <div class="row"><button class="btn ghost danger" id="del">Delete this alternative</button></div>` : '<p class="note">No alternatives yet. Press <b>+ New alternative</b> to start from the existing street.</p>'}`;
    side.querySelector('#dup')!.addEventListener('click', () => {
      const n: Alternative = { id: uid(), name: `Alternative ${seg.alternatives.length + 1}`, tier: 'quick-build', section: structuredClone(seg.existing) };
      project.update(() => { seg.alternatives.push(n); });
      altIdx = seg.alternatives.length - 1; repaintNav(); alts.render(side, canvas);
    });
    side.querySelectorAll<HTMLElement>('.altlist [data-i]').forEach(b => b.addEventListener('click', () => { altIdx = +b.dataset.i!; alts.render(side, canvas); }));
    side.querySelectorAll<HTMLInputElement>('[data-on]').forEach(c => c.addEventListener('change', () => { project.update(() => { seg.alternatives[+c.dataset.on!].enabled = c.checked; }); repaintNav(); alts.render(side, canvas); }));
    side.querySelector('#defaults')!.addEventListener('click', e => { const b = e.currentTarget as HTMLButtonElement; if (!b.dataset.arm) { b.dataset.arm = '1'; b.textContent = 'Click again: replaces all alternatives'; return; } project.update(() => { seg.alternatives = defaultAlternatives(seg.existing); }); altIdx = 0; repaintNav(); alts.render(side, canvas); });
    if (!a) { showSections(canvas, [{ id: 'ex', title: 'Existing', section: seg.existing, existing: true }], seg.setting); return; }
    conformTo(a.section, seg.existing);
    (side.querySelector('#tier') as HTMLSelectElement).value = a.tier;
    side.querySelector('#nm')!.addEventListener('change', e => { project.update(() => { a.name = (e.target as HTMLInputElement).value || a.name; }); alts.render(side, canvas); });
    side.querySelector('#tier')!.addEventListener('change', e => { project.update(() => { a.tier = (e.target as HTMLSelectElement).value as Alternative['tier']; }); });
    side.querySelector('#del')!.addEventListener('click', e => { const b = e.currentTarget as HTMLButtonElement; if (!b.dataset.arm) { b.dataset.arm = '1'; b.textContent = 'Click again to delete'; return; } project.update(() => { seg.alternatives.splice(altIdx, 1); }); altIdx = Math.max(0, altIdx - 1); repaintNav(); alts.render(side, canvas); });
    const draw = () => showSections(canvas, [{ id: 'ex', title: 'Existing', section: seg.existing, existing: true }, { id: 'alt', title: a.name, section: a.section }], seg.setting);
    sectionEditor(side.querySelector('#ed') as HTMLElement, a.section, () => { project.update(() => {}); draw(); }, { existing: false });
    draw();
  }
};


export const STAGES: Stage[] = [site, existing, alts, photoStage, visualizeStage, buildStage, sheetsStage];
