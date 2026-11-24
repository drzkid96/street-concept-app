// Build: every input is gathered in steps 1 to 4. Here the person picks the outputs and builds them in one run.
import { live, repaintNav, type Stage } from './index';
import { project } from '../lib/project';
import { engine, outputsStore } from '../lib/engine';
import { head, task, more, esc } from './ui';

const want = { render: true, cost: true, zip: true };
let method = 'default';
let building = false;
const log: string[] = [];

export const buildStage: Stage = {
  id: 'build', name: 'Build',
  done: () => !!(outputsStore.concepts || outputsStore.streetview || outputsStore.handoff),
  async render(side, canvas) {
    const gen = live.gen;
    if (!engine.on) { side.innerHTML = head(5, 'Build', 'Connecting to the engine…'); await engine.check(); if (gen !== live.gen) return; }
    const seg = project.seg();
    const inputs: [boolean, string, string, string][] = [
      [(seg.path?.length ?? 0) > 1, 'Segment and setting', 'site', 'Mark the segment in Site.'],
      [!!seg.existingChecked, 'Existing street confirmed', 'existing', 'Confirm the existing street.'],
      [seg.alternatives.length > 0, `${seg.alternatives.length || 'No'} alternative${seg.alternatives.length === 1 ? '' : 's'}`, 'alts', 'Add at least one alternative.'],
      [!!outputsStore.curbs?.approved, 'Photo with approved curbs', 'visualize', 'Approve the curbs on a photo (needed for renderings only).']
    ];
    const canRender = inputs[0][0] && inputs[2][0] && inputs[3][0];
    const canCost = inputs[0][0] && inputs[2][0];
    const paint = () => {
      const any = (want.render && canRender) || (want.cost && canCost) || want.zip;
      side.innerHTML = `${head(5, 'Build', 'Everything is built from the inputs in steps 1 to 4, in one run.')}
        ${task(1, 'Inputs', inputs.every(i => i[0]) ? 'done' : 'now', `<ul class="checklist">${inputs.map(([ok, label, id, need]) => `<li class="${ok ? 'ok' : 'no'}"><span class="dot"></span><div><b>${esc(label)}</b>${ok ? '' : `<span><a href="#${id}">${esc(need)}</a></span>`}</div></li>`).join('')}</ul>`)}
        ${task(2, 'Choose the outputs', 'now', `
          <label class="pick"><input type="checkbox" id="wr"${want.render && canRender ? ' checked' : ''}${canRender ? '' : ' disabled'}><span><b>Concept renderings sheet</b><small>Each alternative rendered on the photo with FP assets, with existing and proposed sections. A few minutes.${canRender ? '' : ' Needs approved curbs.'}</small></span></label>
          <label class="pick"><input type="checkbox" id="wc"${want.cost && canCost ? ' checked' : ''}${canCost ? '' : ' disabled'}><span><b>Concepts and cost one-pager</b><small>11x17 sheet: every concept with planning-level costs by delivery tier for ${esc(seg.city ?? 'Los Angeles')}. About 10 seconds.</small></span></label>
          <label class="pick"><input type="checkbox" id="wz"${want.zip ? ' checked' : ''}><span><b>AI handoff ZIP</b><small>The project, the exact skill inputs (sections, photo, approved curbs) and every output, with a README, so another AI or person can pick it up and re-run it.</small></span></label>
          ${more(`<div class="field"><label for="mode">Pricing method</label><select id="mode"><option value="default">Delivery tiers, quick-build to capital (default)</option><option value="atp"${method === 'atp' ? ' selected' : ''}>Caltrans ATP method</option></select></div>`)}`)}
        ${task(3, 'Build', 'now', `
          <div class="row"><button class="btn" id="go"${any && !building ? '' : ' disabled'}>${building ? 'Building…' : 'Build outputs'}</button></div>
          <ul class="buildlog">${log.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
          ${!building && (outputsStore.concepts || outputsStore.streetview || outputsStore.handoff) ? '<div class="row"><a class="btn" href="#sheets">See the outputs in Review →</a></div>' : ''}`)}`;
      side.querySelector('#wr')?.addEventListener('change', e => { want.render = (e.target as HTMLInputElement).checked; paint(); });
      side.querySelector('#wc')?.addEventListener('change', e => { want.cost = (e.target as HTMLInputElement).checked; paint(); });
      side.querySelector('#wz')?.addEventListener('change', e => { want.zip = (e.target as HTMLInputElement).checked; paint(); });
      side.querySelector('#mode')?.addEventListener('change', e => { method = (e.target as HTMLSelectElement).value; });
      side.querySelector('#go')?.addEventListener('click', build);
    };
    const showCanvas = () => {
      const r = outputsStore.streetview?.renders ?? [], c = outputsStore.concepts;
      canvas.innerHTML = r.length || c ? `<div class="persp-wrap">${r.map(f => `<figure class="persp"><img src="${engine.abs(f.url)}" alt="${esc(f.name)}"><figcaption>${esc(f.name)}</figcaption></figure>`).join('')}${c?.png ? `<figure class="persp"><img src="${engine.abs(c.png)}" alt="Concepts and cost one-pager"><figcaption>Concepts and cost one-pager</figcaption></figure>` : ''}</div>`
        : '<div class="empty">Outputs appear here after the build.</div>';
    };
    async function build() {
      building = true; log.length = 0; paint();
      const pf = project.get(), say = (t: string) => { log.push(t); if (gen === live.gen) paint(); };
      if (want.cost && canCost) {
        say('Concepts and cost one-pager: building…');
        try {
          const r = await engine.json('/api/concepts', { project: pf, street: seg.limits.from || undefined, city: seg.city || 'Los Angeles', setting: seg.setting || 'la-residential', mode: method });
          if (!r.ok) throw new Error(String(r.log || '').split('\n').slice(-2).join(' '));
          const f = (end: string) => r.files.find((x: any) => x.name.endsWith(end))?.url;
          outputsStore.concepts = { job: r.job, pdf: f('_sheet.pdf'), png: f('_sheet.png'), summary: r.summary };
          log[log.length - 1] = `Concepts and cost one-pager: done in ${r.seconds} s.`;
        } catch (err) { log[log.length - 1] = 'Concepts and cost one-pager: stopped. ' + (err as Error).message; }
        if (gen === live.gen) { paint(); showCanvas(); }
      }
      if (want.render && canRender) {
        say('Concept renderings: solving the curbs, removing parked cars, placing FP assets, building the sheet. A few minutes…');
        try {
          const c = outputsStore.curbs!;
          const r = await engine.json('/api/streetview/run', { job: c.job, project: pf, street: seg.limits.from || pf.project.name, looking: outputsStore.look, title: pf.project.name, setting: seg.setting });
          if (!r.ok) throw new Error('stopped at ' + ((r.steps || []).find((x: any) => !x[1]) || ['a step'])[0] + '. ' + String(r.log || '').split('\n').slice(-2).join(' '));
          outputsStore.streetview = { job: r.job, pdfs: r.pdfs, renders: r.files.filter((x: any) => /_T\d+\.png$/.test(x.name)) };
          log[log.length - 1] = `Concept renderings: done (${outputsStore.streetview.renders.length} rendering${outputsStore.streetview.renders.length === 1 ? '' : 's'}, sheet PDF).`;
        } catch (err) { log[log.length - 1] = 'Concept renderings: ' + (err as Error).message; }
      }
      if (want.zip) {
        say('AI handoff ZIP: packing…');
        try {
          const r = await engine.json('/api/handoff', { project: project.get(), jobs: { concepts: outputsStore.concepts?.job, curbs: outputsStore.curbs?.job, streetview: outputsStore.streetview?.job } });
          outputsStore.handoff = { zip: r.zip, name: r.name, bytes: r.bytes };
          log[log.length - 1] = `AI handoff ZIP: done (${Math.round(r.bytes / 1024 / 1024 * 10) / 10} MB).`;
        } catch (err) { log[log.length - 1] = 'AI handoff ZIP: stopped. ' + (err as Error).message; }
      }
      building = false; repaintNav();
      if (gen === live.gen) { paint(); showCanvas(); }
    }
    paint(); showCanvas();
  }
};
