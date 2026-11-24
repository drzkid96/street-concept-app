// Build: every input is gathered in steps 1 to 5. Here the person picks the outputs and builds them in one run.
import { live, repaintNav, goTo, type Stage } from './index';
import { project } from '../lib/project';
import { engine, outputsStore, curbsOk } from '../lib/engine';
import { head, task, more, esc } from './ui';
import { aerialOf, type LngLat } from '../lib/providers';

const want = { render: true, sections: true, existing: false, cost: false, zip: false };
let method = 'default';
let renderJob = '';
let costFmt: 'excel' | 'pdf' = 'excel';
let building = false;
const log: string[] = [];

// Progress of a build: each output is a task with an expected duration (learned from the last run on this browser),
// and the rendering reports its own steps, so the bar and the time left stay honest while it runs.
type PTask = { key: string; label: string; est: number; t0?: number; t1?: number; lo?: number; hi?: number; sub?: string; n?: number };
const prog: { tasks: PTask[]; timer?: number } = { tasks: [] };
const EST_KEY = 'sca-build-secs';
const DEFAULT_EST: Record<string, number> = { existing: 12, sections: 15, cost: 8, 'render-lo': 150, 'render-hi': 420, compile: 5, zip: 10 };
const learned = (): Record<string, number> => { try { return JSON.parse(localStorage.getItem(EST_KEY) || '{}'); } catch { return {}; } };
const estOf = (k: string) => learned()[k] ?? DEFAULT_EST[k] ?? 10;
const learn = (k: string, secs: number) => { try { const l = learned(); l[k] = Math.round(l[k] ? 0.5 * l[k] + 0.5 * secs : secs); localStorage.setItem(EST_KEY, JSON.stringify(l)); } catch { /* ignore */ } };
// A rendering run, measured: a short setup, then the first concept (reading the vehicles, clearing the roadway, drawing) takes
// about 4.7 times as long as each concept after it. Shares of the whole run at each point the engine reports:
const R_SETUP = 0.12, R_VEH = 1.1, R_FIRST = 4.7, R_TAIL = 0.08;
const rWhole = (n: number) => R_SETUP + R_FIRST + Math.max(0, n - 1) + R_TAIL;
const rAt = (n: number, veh: number, pics: number) => (pics > 0 ? R_SETUP + R_FIRST + (pics - 1) : veh > 0 ? R_SETUP + R_VEH : 0) / rWhole(n);
const rNext = (n: number, veh: number, pics: number) => (pics > 0 ? R_SETUP + R_FIRST + pics : veh > 0 ? R_SETUP + R_FIRST : R_SETUP + R_VEH) / rWhole(n);
function progView(): { pct: number; text: string; now: string } {
  const now = Date.now(); let done = 0, total = 0, left = 0, cur: PTask | undefined, over = false;
  for (const t of prog.tasks) {
    total += t.est;
    if (t.t1) { done += t.est; continue; }
    if (t.t0) {
      cur = t;
      const el = (now - t.t0) / 1000;
      let f = Math.min(el / t.est, 0.97);
      if (t.lo != null) f = Math.max(t.lo, Math.min(f, (t.hi ?? 0.97) - 0.01, 0.97));   // never ahead of, or behind, what the engine has reported
      if (el > t.est) over = true;
      done += t.est * f; left += t.est * (1 - f);
    } else left += t.est;
  }
  const pct = total ? Math.max(1, Math.min(99, Math.round(100 * done / total))) : 0;
  const mins = left / 60;
  const text = over && left < 15 ? 'Taking a little longer than usual, still working' : left < 50 ? 'Less than a minute left' : `About ${Math.max(1, Math.round(mins))} min left`;
  return { pct, text, now: cur ? cur.label + (cur.sub ? ': ' + cur.sub : '') : '' };
}
function progTick() {
  const el = document.getElementById('prog'); if (!el) return;
  const v = progView();
  (el.querySelector('.progfill') as HTMLElement).style.width = v.pct + '%';
  el.querySelector('.progpct')!.textContent = v.pct + '%';
  el.querySelector('.progeta')!.textContent = v.text;
  el.querySelector('.prognow')!.textContent = v.now;
  el.setAttribute('aria-valuenow', String(v.pct));
}
const progBegin = (key: string) => { const t = prog.tasks.find(x => x.key === key); if (t && !t.t0) t.t0 = Date.now(); progTick(); };
const progEnd = (key: string, ok = true) => { const t = prog.tasks.find(x => x.key === key); if (t && t.t0 && !t.t1) { t.t1 = Date.now(); if (ok) learn(key, (t.t1 - t.t0) / 1000); } progTick(); };

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
      [curbsOk(seg), 'Curbs approved', 'visualize', 'Approve the curbs.']
    ];
    const canRender = inputs[0][0] && inputs[2][0] && inputs[4][0];
    const canCost = inputs[0][0] && inputs[2][0];
    const paint = () => {
      const any = (want.render && canRender) || (want.sections && canCost) || (want.cost && canCost) || want.existing || want.zip;
      side.innerHTML = `${head(6, 'Build', 'Everything is built from the inputs in steps 1 to 5, in one run.')}
        ${task(1, 'Inputs', inputs.every(i => i[0]) ? 'done' : 'now', `<ul class="checklist">${inputs.map(([ok, label, id, need]) => `<li class="${ok ? 'ok' : 'no'}"><span class="dot"></span><div><b>${esc(label)}</b>${ok ? '' : `<span><a href="#${id}">${esc(need)}</a></span>`}</div></li>`).join('')}</ul>`)}
        ${task(2, 'Choose the outputs', 'now', `
          <label class="pick"><input type="checkbox" id="wr"${want.render && canRender ? ' checked' : ''}${canRender ? '' : ' disabled'}><span><b>Concept renderings sheet</b><small>Each alternative rendered on the photo with FP assets, with key map, location, existing and proposed sections. A few minutes.${canRender ? '' : ' Needs approved curbs.'}</small></span></label>
<label class="pick"><input type="checkbox" id="ws"${want.sections && canCost ? ' checked' : ''}${canCost ? '' : ' disabled'}><span><b>Concept sections sheet</b><small>Existing and every concept, with the key map. No costs.</small></span></label>
          <label class="pick"><input type="checkbox" id="we"${want.existing ? ' checked' : ''}><span><b>Existing conditions report (optional)</b><small>Two pages from OpenStreetMap: aerial with traffic control and points of interest, street facts, Street View, existing section, land use, cross streets and transit.</small></span></label>
          <label class="pick"><input type="checkbox" id="wc"${want.cost && canCost ? ' checked' : ''}${canCost ? '' : ' disabled'}><span><b>Cost estimate (optional)</b><small>Planning-level costs by delivery tier for ${esc(seg.city ?? 'Los Angeles')}.</small>
            ${want.cost ? `<span class="fmt"><label><input type="radio" name="cf" value="excel"${costFmt === 'excel' ? ' checked' : ''}> Excel workbook</label><label><input type="radio" name="cf" value="pdf"${costFmt === 'pdf' ? ' checked' : ''}> PDF sheet, in the package</label></span>` : ''}</span></label>
          <label class="pick"><input type="checkbox" id="wz"${want.zip ? ' checked' : ''}><span><b>AI handoff ZIP (optional)</b><small>The project, the exact skill inputs (sections, photo, approved curbs) and every output, with a README, so another AI or person can pick it up and re-run it.</small></span></label>
          ${more(`<div class="field"><label for="mode">Pricing method</label><select id="mode"><option value="default">Delivery tiers, quick-build to capital (default)</option><option value="atp"${method === 'atp' ? ' selected' : ''}>Caltrans ATP method</option></select></div>`)}`)}
        <p class="note">Standard package: renderings and sections, compiled into one PDF.</p>
        ${task(3, 'Build', 'now', `
          <div class="row"><button class="btn" id="go"${any && !building ? '' : ' disabled'}>${building ? 'Building…' : 'Build outputs'}</button></div>
          ${building ? `<div class="prog" id="prog" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-label="Build progress"><div class="progtop"><b class="progpct"></b><span class="progeta"></span></div><div class="progbar"><div class="progfill"></div></div><div class="prognow"></div></div>` : ''}
          <ul class="buildlog">${log.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
          ${!building && (outputsStore.concepts || outputsStore.streetview || outputsStore.handoff) ? '<div class="row"><a class="btn" href="#sheets">See the outputs in Review →</a></div>' : ''}`)}`;
      side.querySelector('#wr')?.addEventListener('change', e => { want.render = (e.target as HTMLInputElement).checked; paint(); });
      side.querySelector('#ws')?.addEventListener('change', e => { want.sections = (e.target as HTMLInputElement).checked; paint(); });
      side.querySelector('#wc')?.addEventListener('change', e => { want.cost = (e.target as HTMLInputElement).checked; paint(); });
      side.querySelectorAll<HTMLInputElement>('input[name=cf]').forEach(r => r.addEventListener('change', () => { costFmt = r.value as typeof costFmt; }));
      side.querySelector('#we')?.addEventListener('change', e => { want.existing = (e.target as HTMLInputElement).checked; paint(); });
      side.querySelector('#wz')?.addEventListener('change', e => { want.zip = (e.target as HTMLInputElement).checked; paint(); });
      side.querySelector('#mode')?.addEventListener('change', e => { method = (e.target as HTMLSelectElement).value; });
      side.querySelector('#go')?.addEventListener('click', build);
      progTick();
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
      const KEYS: [string, string, string][] = [['Existing conditions report', 'existing', 'Existing conditions report'], ['Concept sections sheet', 'sections', 'Sections sheet'], ['Cost estimate', 'cost', 'Cost estimate'], ['Concept renderings', 'render', 'Renderings'], ['Compiling', 'compile', 'Compiling the PDF set'], ['AI handoff ZIP', 'zip', 'Handoff ZIP']];
      let hi = false;
      try { if (want.render && canRender && seg.curbMarks) { const bm = await createImageBitmap(await fetch(seg.curbMarks.photo).then(x => x.blob())); hi = bm.width * bm.height > 600000; } } catch { /* estimate only */ }
      const rk = hi ? 'render-hi' : 'render-lo';
      const plan: [boolean, string, string][] = [[want.existing, 'existing', 'Existing conditions report'], [want.sections && canCost, 'sections', 'Sections sheet'], [want.cost && canCost, 'cost', 'Cost estimate'], [want.render && canRender, rk, 'Renderings'], [true, 'compile', 'Compiling the PDF set'], [want.zip, 'zip', 'Handoff ZIP']];
      const nAlt = Math.max(1, pf.segments[0].alternatives.length);
      const unit = learned()[rk + '-unit'] ?? (learned()[rk] ? learned()[rk] / rWhole(3) : (hi ? 62 : 22));   // seconds per concept after the first
      prog.tasks = plan.filter(x => x[0]).map(([, key, label]) => ({ key, label, est: key === rk ? unit * rWhole(nAlt) : estOf(key), n: key === rk ? nAlt : undefined }));
      window.clearInterval(prog.timer); prog.timer = window.setInterval(progTick, 500);
      let curKey = '';
      const say = (t: string) => {
        if (curKey) progEnd(curKey, !/stopped|could not|timed out/i.test(log[log.length - 1] || ''));
        const k = KEYS.find(x => t.startsWith(x[0])); curKey = k ? (k[1] === 'render' ? rk : k[1]) : '';
        log.push(t); if (gen === live.gen) paint();
        if (curKey) progBegin(curKey);
      };
      outputsStore.compiled = undefined;
      if (!want.existing) outputsStore.existingReport = undefined;
      else {
        say('Existing conditions report: reading OpenStreetMap and laying out…');
        try {
          const path = (seg.path ?? []) as LngLat[];
          const aerial = await aerialOf(path).then(a => ({ ...a, source: 'Google' })).catch(() => undefined);   // without it the engine uses USGS imagery
          let photo: string | undefined;
          if (seg.perspective) photo = await fetch(seg.perspective.original ?? seg.perspective.src).then(x => x.blob()).then(b => new Promise<string>(res => { const fr = new FileReader(); fr.onload = () => res(fr.result as string); fr.readAsDataURL(b); })).catch(() => undefined);
          const r = await engine.json('/api/existing-report', { project: pf, aerial, photo, photo_credit: seg.perspective ? `${seg.perspective.source}${seg.perspective.credit ? ', ' + seg.perspective.credit : ''}. Looking along the segment.` : undefined });
          outputsStore.existingReport = { job: r.job, pdf: r.pdf };
          log[log.length - 1] = 'Existing conditions report: done.';
        } catch (err) { log[log.length - 1] = 'Existing conditions report: stopped. ' + (err as Error).message; }
        if (gen === live.gen) paint();
      }
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
          // a fresh engine job from the saved photo and curb marks: works even after the engine restarted
          const cm = seg.curbMarks!, blob = await fetch(cm.photo).then(x => { if (!x.ok) throw new Error('the photo could not be loaded'); return x.blob(); });
          const fd = new FormData(); fd.append('photo', blob, 'photo.jpg'); fd.append('marks', cm.marks); fd.append('width', String(cm.width));
          const c = await engine.form('/api/curbs/restore', fd) as { job: string };
          renderJob = c.job;
          let r: any, settled = false;
          const runP = engine.json('/api/streetview/run', { job: c.job, project: pf, street: seg.limits.from || pf.project.name, looking: outputsStore.look, title: pf.project.name, setting: seg.setting, inpaint: ((seg.perspective?.original ?? seg.perspective?.src) || '').startsWith('https://maps.googleapis.com') ? undefined : [] }).catch(() => null).then(x => { settled = true; return x; });
          const rt = prog.tasks.find(x => x.key === rk);
          while (!settled) {   // the engine reports each rendering step: the bar follows it
            await Promise.race([runP, new Promise(res => setTimeout(res, 3000))]);
            if (settled) break;
            const st: any = await Promise.race([fetch(engine.url + `/api/run/${c.job}`).then(x => x.ok ? x.json() : null).catch(() => null), new Promise(res => setTimeout(() => res(null), 4000))]);
            if (st?.step && rt) {
              const veh = st.veh ?? 0, pics = st.pics ?? 0, n = rt.n ?? 1;
              rt.sub = st.step === 'render' ? (pics >= n ? 'finishing the pictures' : pics > 0 ? `drawing concept ${pics + 1} of ${n}` : veh > 0 ? 'clearing the roadway in the photo' : 'reading the vehicles in the photo') : ({ assist: 'solving the curbs', prep: 'reading the photo', calibrate: 'fitting the camera', sections: 'drawing the sections', sheet: 'laying out the sheets' } as Record<string, string>)[st.step] ?? st.step;
              if (st.step === 'sections' || st.step === 'sheet') { rt.lo = 1 - R_TAIL / rWhole(n); rt.hi = 0.99; }
              else if (st.step === 'render') {
                const at = rAt(n, veh, pics);
                if (at > (rt.lo ?? 0) && at > 0.1) {   // a new point reached: the rest of the run is re-timed from the real pace
                  const el = (Date.now() - (rt.t0 ?? Date.now())) / 1000;
                  rt.est = Math.max(20, 0.3 * rt.est + 0.7 * el / at);
                }
                rt.lo = at; rt.hi = Math.min(0.97, rNext(n, veh, pics));
              } else { rt.lo = 0; rt.hi = R_SETUP / rWhole(n); }
            }
          }
          r = await runP;
          for (let i = 0; !r && i < 400; i++) {   // the request was cut off: the run continues on the engine
            await new Promise(res => setTimeout(res, 4000));
            const st = await engine.get(`/api/run/${c.job}`).catch(() => null);
            if (st?.state === 'done') r = st; else if (st?.state === 'none') throw new Error('The engine restarted and lost the curb marks. Approve the curbs again, then build.');
            else if (st?.step) { log[log.length - 1] = `Concept renderings: ${st.step}…`; if (gen === live.gen) paint(); }
          }
          if (!r) throw new Error('timed out waiting for the engine.');
          if (!r.ok) throw new Error(((r.steps || []).some((x: any) => x[0] === 'assist' && !x[1]) || !(r.steps || []).length ? '' : 'stopped at ' + ((r.steps || []).find((x: any) => !x[1]) || ['a step'])[0] + '. ') + String(r.log || '').split('\n').filter(Boolean).slice(0, (r.steps || []).some((x: any) => x[0] === 'assist' && !x[1]) ? 1 : undefined).slice(-2).join(' '));
          outputsStore.streetview = { job: r.job, pdfs: r.pdfs, renders: r.files.filter((x: any) => /_T\d+\.png$/.test(x.name)) };
          if (rt?.t0) { try { const l = learned(); const u = (Date.now() - rt.t0) / 1000 / rWhole(rt.n ?? 1); l[rk + '-unit'] = Math.round(l[rk + '-unit'] ? 0.4 * l[rk + '-unit'] + 0.6 * u : u); localStorage.setItem(EST_KEY, JSON.stringify(l)); } catch { /* ignore */ } }
          log[log.length - 1] = `Concept renderings: done (${outputsStore.streetview.renders.length} rendering${outputsStore.streetview.renders.length === 1 ? '' : 's'}, sheet PDF).`;
        } catch (err) { log[log.length - 1] = 'Concept renderings: ' + (err as Error).message; }
      }
      const urls = [...(outputsStore.existingReport ? [outputsStore.existingReport.pdf] : []), ...(outputsStore.streetview?.pdfs ?? []).map(f => f.url), ...(outputsStore.sections ? [outputsStore.sections.pdf] : []), ...(outputsStore.concepts?.fmt === 'pdf' && outputsStore.concepts.pdf ? [outputsStore.concepts.pdf] : [])];
      if (urls.length) {
        say('Compiling the PDF set…');
        try { const r = await engine.json('/api/compile', { urls, name: pf.project.name || seg.limits.from }); outputsStore.compiled = { job: r.job, pdf: r.pdf, pages: r.pages }; log[log.length - 1] = `PDF set: ${r.pages} page${r.pages === 1 ? '' : 's'} compiled.`; }
        catch (err) { log[log.length - 1] = 'PDF set: could not compile. ' + (err as Error).message; }
      }
      if (want.zip) {
        say('AI handoff ZIP: packing…');
        try {
          const r = await engine.json('/api/handoff', { project: pf, jobs: { existing: outputsStore.existingReport?.job, compiled: outputsStore.compiled?.job, sections: outputsStore.sections?.job, concepts: outputsStore.concepts?.job, curbs: renderJob || undefined, streetview: outputsStore.streetview?.job } });
          outputsStore.handoff = { zip: r.zip, name: r.name, bytes: r.bytes };
          log[log.length - 1] = `AI handoff ZIP: done (${Math.round(r.bytes / 1024 / 1024 * 10) / 10} MB).`;
        } catch (err) { log[log.length - 1] = 'AI handoff ZIP: stopped. ' + (err as Error).message; }
      }
      if (curKey) progEnd(curKey, !/stopped|could not|timed out/i.test(log[log.length - 1] || ''));
      window.clearInterval(prog.timer); prog.tasks = [];
      building = false; repaintNav();
      if (gen === live.gen && (outputsStore.compiled || outputsStore.concepts)) { goTo('sheets'); return; }
      if (gen === live.gen) { paint(); showCanvas(); }
    }
    paint(); showCanvas();
  }
};
