// Build: every input is gathered in steps 1 to 5. Here the person picks the outputs and builds them in one run.
import { live, repaintNav, goTo, type Stage } from './index';
import { project } from '../lib/project';
import { engine, outputsStore } from '../lib/engine';
import { head, task, more, esc } from './ui';

const want = { render: true, sections: true, cost: false, zip: false };
let method = 'default';
let costFmt: 'excel' | 'pdf' = 'excel';
let building = false;
const log: string[] = [];

export const buildStage: Stage = {
  id: 'build', name: 'Build',
  done: () => !!(outputsStore.compiled || outputsStore.concepts || outputsStore.streetview || outputsStore.handoff),
  async render(side, canvas) {
    const gen = live.gen;
    if (!engine.on) { side.innerHTML = head(6, 'Build', 'Connecting to the engine…'); await engine.check(); if (gen !== live.gen) return; }
    const seg = project.seg();
    const inputs: [boolean, string, string, string][] = [
      [(seg.path?.length ?? 0) > 1, 'Segment and setting', 'site', 'Mark the segment in Site.'],
      [!!seg.existingChecked, 'Existing street confirmed', 'existing', 'Press Next on the Existing step.'],
      [seg.alternatives.some(a => a.enabled !== false), `${seg.alternatives.filter(a => a.enabled !== false).length || 'No'} alternative${seg.alternatives.filter(a => a.enabled !== false).length === 1 ? '' : 's'} switched on`, 'alts', 'Switch on at least one alternative.'],
      [!!seg.perspective, 'Photo approved', 'photo', 'Approve a photo.'],
      [!!outputsStore.curbs?.approved, 'Curbs approved', 'visualize', 'Approve the curbs.']
    ];
    const canRender = inputs[0][0] && inputs[2][0] && inputs[4][0];
    const canCost = inputs[0][0] && inputs[2][0];
    const paint = () => {
      const any = (want.render && canRender) || (want.sections && canCost) || (want.cost && canCost) || want.zip;
      side.innerHTML = `${head(6, 'Build', 'Everything is built from the inputs in steps 1 to 5, in one run.')}
        ${task(1, 'Inputs', inputs.every(i => i[0]) ? 'done' : 'now', `<ul class="checklist">${inputs.map(([ok, label, id, need]) => `<li class="${ok ? 'ok' : 'no'}"><span class="dot"></span><div><b>${esc(label)}</b>${ok ? '' : `<span><a href="#${id}">${esc(need)}</a></span>`}</div></li>`).join('')}</ul>`)}
        ${task(2, 'Choose the outputs', 'now', `
          <label class="pick"><input type="checkbox" id="wr"${want.render && canRender ? ' checked' : ''}${canRender ? '' : ' disabled'}><span><b>Concept renderings sheet</b><small>Each alternative rendered on the photo with FP assets, with key map, location, existing and proposed sections. A few minutes.${canRender ? '' : ' Needs approved curbs.'}</small></span></label>
<label class="pick"><input type="checkbox" id="ws"${want.sections && canCost ? ' checked' : ''}${canCost ? '' : ' disabled'}><span><b>Concept sections sheet</b><small>Existing and every concept, with the key map. No costs.</small></span></label>
          <label class="pick"><input type="checkbox" id="wc"${want.cost && canCost ? ' checked' : ''}${canCost ? '' : ' disabled'}><span><b>Cost estimate (optional)</b><small>Planning-level costs by delivery tier for ${esc(seg.city ?? 'Los Angeles')}.</small>
            ${want.cost ? `<span class="fmt"><label><input type="radio" name="cf" value="excel"${costFmt === 'excel' ? ' checked' : ''}> Excel workbook</label><label><input type="radio" name="cf" value="pdf"${costFmt === 'pdf' ? ' checked' : ''}> PDF sheet, in the package</label></span>` : ''}</span></label>
          <label class="pick"><input type="checkbox" id="wz"${want.zip ? ' checked' : ''}><span><b>AI handoff ZIP (optional)</b><small>The project, the exact skill inputs (sections, photo, approved curbs) and every output, with a README, so another AI or person can pick it up and re-run it.</small></span></label>
          ${more(`<div class="field"><label for="mode">Pricing method</label><select id="mode"><option value="default">Delivery tiers, quick-build to capital (default)</option><option value="atp"${method === 'atp' ? ' selected' : ''}>Caltrans ATP method</option></select></div>`)}`)}
        <p class="note">Standard package: renderings and sections, compiled into one PDF.</p>
        ${task(3, 'Build', 'now', `
          <div class="row"><button class="btn" id="go"${any && !building ? '' : ' disabled'}>${building ? 'Building…' : 'Build outputs'}</button></div>
          <ul class="buildlog">${log.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
          ${!building && (outputsStore.concepts || outputsStore.streetview || outputsStore.handoff) ? '<div class="row"><a class="btn" href="#sheets">See the outputs in Review →</a></div>' : ''}`)}`;
      side.querySelector('#wr')?.addEventListener('change', e => { want.render = (e.target as HTMLInputElement).checked; paint(); });
      side.querySelector('#ws')?.addEventListener('change', e => { want.sections = (e.target as HTMLInputElement).checked; paint(); });
      side.querySelector('#wc')?.addEventListener('change', e => { want.cost = (e.target as HTMLInputElement).checked; paint(); });
      side.querySelectorAll<HTMLInputElement>('input[name=cf]').forEach(r => r.addEventListener('change', () => { costFmt = r.value as typeof costFmt; }));
      side.querySelector('#wz')?.addEventListener('change', e => { want.zip = (e.target as HTMLInputElement).checked; paint(); });
      side.querySelector('#mode')?.addEventListener('change', e => { method = (e.target as HTMLSelectElement).value; });
      side.querySelector('#go')?.addEventListener('click', build);
    };
    const showCanvas = () => {
      const r = outputsStore.streetview?.renders ?? [], c = outputsStore.concepts;
      canvas.innerHTML = r.length || c ? `<div class="persp-wrap">${r.map(f => `<figure class="persp"><img src="${engine.abs(f.url)}" alt="${esc(f.name)}"><figcaption>${esc(f.name)}</figcaption></figure>`).join('')}</div>`
        : '<div class="empty">Outputs appear here after the build.</div>';
    };
    async function build() {
      building = true; log.length = 0; paint();
      // only the alternatives switched on go into the outputs
      const pf = structuredClone(project.get()); pf.segments.forEach(g => { g.alternatives = g.alternatives.filter(a => a.enabled !== false); });
      const say = (t: string) => { log.push(t); if (gen === live.gen) paint(); };
      outputsStore.compiled = undefined;
      if (!(want.cost && canCost)) outputsStore.concepts = undefined;
      if (!(want.sections && canCost)) outputsStore.sections = undefined;
      if (!(want.render && canRender)) outputsStore.streetview = undefined;
      if (want.sections && canCost) {
        say('Concept sections sheet: building…');
        try {
          const r = await engine.json('/api/sections-sheet', { project: pf, street: seg.limits.from });
          if (!r.ok || !r.pdf) throw new Error(String(r.log || '').split('\n').slice(-2).join(' '));
          outputsStore.sections = { job: r.job, pdf: r.pdf };
          log[log.length - 1] = 'Concept sections sheet: done.';
        } catch (err) { log[log.length - 1] = 'Concept sections sheet: stopped. ' + (err as Error).message; }
        if (gen === live.gen) paint();
      }
      if (want.cost && canCost) {
        say('Cost estimate: building…');
        try {
          const r = await engine.json('/api/concepts', { project: pf, street: seg.limits.from || undefined, city: seg.city || 'Los Angeles', setting: seg.setting || 'la-residential', mode: method });
          if (!r.ok) throw new Error(String(r.log || '').split('\n').slice(-2).join(' '));
          const f = (end: string) => r.files.find((x: any) => x.name.endsWith(end))?.url;
          const x = f('_estimate.xlsx'); if (!x) throw new Error('the skill did not write the workbook');
          outputsStore.concepts = { job: r.job, pdf: f('_sheet.pdf'), png: f('_sheet.png'), xlsx: x, fmt: costFmt, summary: r.summary };
          log[log.length - 1] = `Cost estimate: done in ${r.seconds} s.`;
        } catch (err) { log[log.length - 1] = 'Cost estimate: stopped. ' + (err as Error).message; }
        if (gen === live.gen) { paint(); showCanvas(); }
      }
      if (want.render && canRender) {
        say('Concept renderings: solving the curbs, removing parked cars, placing FP assets, building the sheet. A few minutes…');
        try {
          const c = outputsStore.curbs!;
          let r: any = await engine.json('/api/streetview/run', { job: c.job, project: pf, street: seg.limits.from || pf.project.name, looking: outputsStore.look, title: pf.project.name, setting: seg.setting }).catch(() => null);
          for (let i = 0; !r && i < 400; i++) {   // the request was cut off: the run continues on the engine
            await new Promise(res => setTimeout(res, 4000));
            const st = await engine.get(`/api/run/${c.job}`).catch(() => null);
            if (st?.state === 'done') r = st; else if (st?.state === 'none') throw new Error('The engine restarted and lost the curb marks. Approve the curbs again, then build.');
            else if (st?.step) { log[log.length - 1] = `Concept renderings: ${st.step}…`; if (gen === live.gen) paint(); }
          }
          if (!r) throw new Error('timed out waiting for the engine.');
          if (!r.ok) throw new Error(((r.steps || []).some((x: any) => x[0] === 'assist' && !x[1]) || !(r.steps || []).length ? '' : 'stopped at ' + ((r.steps || []).find((x: any) => !x[1]) || ['a step'])[0] + '. ') + String(r.log || '').split('\n').filter(Boolean).slice(0, (r.steps || []).some((x: any) => x[0] === 'assist' && !x[1]) ? 1 : undefined).slice(-2).join(' '));
          outputsStore.streetview = { job: r.job, pdfs: r.pdfs, renders: r.files.filter((x: any) => /_T\d+\.png$/.test(x.name)) };
          log[log.length - 1] = `Concept renderings: done (${outputsStore.streetview.renders.length} rendering${outputsStore.streetview.renders.length === 1 ? '' : 's'}, sheet PDF).`;
        } catch (err) { log[log.length - 1] = 'Concept renderings: ' + (err as Error).message; }
      }
      const urls = [...(outputsStore.streetview?.pdfs ?? []).map(f => f.url), ...(outputsStore.sections ? [outputsStore.sections.pdf] : []), ...(outputsStore.concepts?.fmt === 'pdf' && outputsStore.concepts.pdf ? [outputsStore.concepts.pdf] : [])];
      if (urls.length) {
        say('Compiling the PDF set…');
        try { const r = await engine.json('/api/compile', { urls, name: pf.project.name || seg.limits.from }); outputsStore.compiled = { job: r.job, pdf: r.pdf, pages: r.pages }; log[log.length - 1] = `PDF set: ${r.pages} page${r.pages === 1 ? '' : 's'} compiled.`; }
        catch (err) { log[log.length - 1] = 'PDF set: could not compile. ' + (err as Error).message; }
      }
      if (want.zip) {
        say('AI handoff ZIP: packing…');
        try {
          const r = await engine.json('/api/handoff', { project: pf, jobs: { compiled: outputsStore.compiled?.job, sections: outputsStore.sections?.job, concepts: outputsStore.concepts?.job, curbs: outputsStore.curbs?.job, streetview: outputsStore.streetview?.job } });
          outputsStore.handoff = { zip: r.zip, name: r.name, bytes: r.bytes };
          log[log.length - 1] = `AI handoff ZIP: done (${Math.round(r.bytes / 1024 / 1024 * 10) / 10} MB).`;
        } catch (err) { log[log.length - 1] = 'AI handoff ZIP: stopped. ' + (err as Error).message; }
      }
      building = false; repaintNav();
      if (gen === live.gen && (outputsStore.compiled || outputsStore.concepts)) { goTo('sheets'); return; }
      if (gen === live.gen) { paint(); showCanvas(); }
    }
    paint(); showCanvas();
  }
};
