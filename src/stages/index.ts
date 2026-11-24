import { project, uid } from '../lib/project';
import { sectionSvg } from '../lib/sectionSvg';
import { sectionEditor } from './sectionEditor';
import { siteStage } from './site';
import { costStage } from './cost';
import { sheetsStage } from './sheets';
import { guessExisting } from '../lib/osmGuess';
import { visualizeStage } from './visualize';
import { head, task, esc } from './ui';
import type { Alternative } from '../lib/types';

export interface Stage { id: string; name: string; done?: () => boolean; render(side: HTMLElement, canvas: HTMLElement): void | Promise<void>; dispose?: () => void }
export const repaintNav = () => (window as any).__repaintNav?.();
// Incremented on every stage change; async renders compare against it and stop if the user moved on.
export const live = { gen: 0 };


const site = siteStage;
const existing: Stage = {
  id: 'existing', name: 'Existing',
  done: () => !!project.seg().existingChecked,
  render(side, canvas) {
    const seg = project.seg();
    const gen = live.gen;
    const has = !!seg.path && seg.path.length > 1;
    side.innerHTML = `${head(2, 'Existing street', 'Describe the street as it is today, curb to curb and back of walk.')}
      ${task(1, 'Fill it in from OpenStreetMap', seg.existingChecked ? 'done' : 'now', `
        <p class="note">${has ? 'Reads lanes, bike lanes, parking and sidewalks along your segment.' : 'Mark the segment in Site first, or type the section in below.'}</p>
        <div class="row"><button class="btn" id="guess"${has ? '' : ' disabled'}>Fill from OpenStreetMap</button></div>
        <p class="note" id="gmsg" role="status"></p>`)}
      ${task(2, 'Check it and fix anything wrong', seg.existingChecked ? 'done' : 'now', `
        <p class="note">OpenStreetMap often has no parking or width data. Compare with a photo or aerial: remove parking that is not there, and adjust widths.</p>
        <div id="ed"></div>
        <label class="check-row"><input type="checkbox" id="ok"${seg.existingChecked ? ' checked' : ''}> This matches the street today</label>`)}`;
    const draw = () => { canvas.innerHTML = sectionSvg(seg.existing, `${seg.limits.from || 'Segment'} existing`); };
    const mount = () => sectionEditor(side.querySelector('#ed') as HTMLElement, seg.existing, () => { project.update(() => {}); draw(); });
    side.querySelector('#ok')!.addEventListener('change', e => { project.update(() => { seg.existingChecked = (e.target as HTMLInputElement).checked; }); repaintNav(); existing.render(side, canvas); });
    side.querySelector('#guess')!.addEventListener('click', async () => {
      const msg = side.querySelector('#gmsg')!;
      msg.textContent = 'Reading OpenStreetMap…';
      try {
        const g = await guessExisting((seg.path ?? []) as [number, number][]);
        if (gen !== live.gen) return;
        project.update(() => { seg.existing = g.section; seg.existingChecked = false; if (!seg.limits.from) seg.limits.from = g.street; });
        existing.render(side, canvas);
        side.querySelector('#gmsg')!.innerHTML = `Filled from <b>${esc(g.street)}</b> (${esc(g.cls)}). ${g.notes.map(esc).join('; ')}. © OpenStreetMap contributors`;
      } catch (err) { msg.textContent = (err as Error).message; }
    });
    mount(); draw();
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
