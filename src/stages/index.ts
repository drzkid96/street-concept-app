import { project, uid } from '../lib/project';
import { sectionSvg } from '../lib/sectionSvg';
import { sectionEditor } from './sectionEditor';
import { siteStage } from './site';
import { costStage } from './cost';
import { sheetsStage } from './sheets';
import { reviewStage } from './review';
import { guessExisting } from '../lib/osmGuess';
import { visualizeStage } from './visualize';
import { SSS, PRECEDENCE } from '../lib/standards';
import type { Alternative } from '../lib/types';

export interface Stage { id: string; name: string; render(side: HTMLElement, canvas: HTMLElement): void | Promise<void>; dispose?: () => void }
// Incremented on every stage change; async renders compare against it and stop if the user moved on.
export const live = { gen: 0 };

const todo = (t: string) => `<div class="todo"><b>To build</b>${t}</div>`;
const src = () => `<div class="srcbar">Standards: <a href="${SSS}/" target="_blank" rel="noopener">SoCal Super Standards</a>. Precedence: ${PRECEDENCE.join(' → ').replace(/_/g, ' ')}.</div>`;

const site = siteStage;
const existing: Stage = {
  id: 'existing', name: 'Existing',
  render(side, canvas) {
    const seg = project.seg();
    const gen = live.gen;
    side.innerHTML = `<h2>2. EXISTING</h2>
      <div class="row"><button class="btn" id="guess">Guess from OpenStreetMap</button></div>
      <p class="note" id="gmsg" role="status">Reads lanes, turn lanes, bike, bus, parking and sidewalk tags along the segment. Edit the result to match the field or as-builts.</p>
      <div id="ed"></div>${src()}
      ${todo('Curb tool on aerial (fp-render-curbs), section from S&S plan (ss-plan-section).')}`;
    const draw = () => { canvas.innerHTML = sectionSvg(seg.existing, `${seg.limits.from || 'Segment'} existing`); };
    const mount = () => sectionEditor(side.querySelector('#ed') as HTMLElement, seg.existing, () => { project.update(() => {}); draw(); });
    side.querySelector('#guess')!.addEventListener('click', async () => {
      const msg = side.querySelector('#gmsg')!;
      msg.textContent = 'Reading OpenStreetMap…';
      try {
        const g = await guessExisting((seg.path ?? []) as [number, number][]);
        if (gen !== live.gen) return;
        project.update(() => { seg.existing = g.section; if (!seg.limits.from) seg.limits.from = g.street; });
        existing.render(side, canvas);
        side.querySelector('#gmsg')!.innerHTML = `Guessed from <b>${g.street}</b> (${g.cls}). ${g.notes.join('; ')}. © OpenStreetMap contributors`;
      } catch (err) { msg.textContent = (err as Error).message; }
    });
    mount(); draw();
  }
};

let altIdx = 0;
const alts: Stage = {
  id: 'alts', name: 'Alternatives',
  render(side, canvas) {
    const seg = project.seg();
    if (altIdx >= seg.alternatives.length) altIdx = Math.max(0, seg.alternatives.length - 1);
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


const placeholder = (n: number, id: string, name: string, text: string, skills: string): Stage => ({
  id, name,
  render(side, canvas) {
    side.innerHTML = `<h2>${n}. ${name.toUpperCase()}</h2><p class="note">Replaces: ${skills}</p>${todo(text)}`;
    canvas.innerHTML = `<div class="empty">${name} workspace placeholder</div>`;
  }
});

export const STAGES: Stage[] = [
  site, existing, alts, costStage, visualizeStage, sheetsStage, reviewStage
];
