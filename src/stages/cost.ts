import type { Stage } from './index';
import { project } from '../lib/project';
import { engine, outputsStore } from '../lib/engine';
import { live, repaintNav } from './index';
import { head, task, more } from './ui';
import { SCENES } from '../lib/scenes';
import { loadKnowledge, importKnowledge, forgetKnowledge, priceConcept, waterfall, money, type Line, type Knowledge } from '../lib/cost';

const esc = (t: string) => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
let context: 'urban' | 'suburban' | 'rural' = 'urban';

export function costSummary(k: Knowledge) {
  const seg = project.seg();
  return seg.alternatives.map(a => {
    const { lines, flags } = priceConcept(k, seg.existing, a.section, seg.length_ft, context);
    return { alt: a, lines, flags, w: waterfall(k, lines) };
  });
}

export const costStage: Stage = {
  id: 'cost', name: 'Cost',
  done: () => !!outputsStore.concepts,
  async render(side, canvas) {
    const seg = project.seg();
    if (await engine.check()) return engineCost(side, canvas);
    side.innerHTML = `${head(4, 'Cost', 'Planning-level estimate of each alternative.')}
      <div class="srcbar">Engine not connected: built-in estimate. Start the engine to run fp-section-builder (one-pager, tiers, regional prices).</div>
      <p>Planning-level estimate of each alternative, priced as the change from existing over ${seg.length_ft.toLocaleString()}'.</p>
      <div class="field"><label for="ctx">Context</label><select id="ctx"><option value="urban">Urban</option><option value="suburban">Suburban</option><option value="rural">Rural</option></select></div>
      <div class="srcbar" id="src">Loading cost knowledge…</div>
      <p class="note">Sketch-level only. Composites and markups from the F&amp;P cross-section cost knowledge workbook; striping removal not priced.</p>`;
    (side.querySelector('#ctx') as HTMLSelectElement).value = context;
    const loaded = await loadKnowledge();
    if (!loaded) {
      side.querySelector('#src')!.innerHTML = `Cost data is not loaded in this browser. It is F&amp;P internal pricing, so it is not published with the site.
        <label class="btn" style="display:inline-grid;margin-top:.5rem">Import cost data (JSON)<input type="file" id="ck" accept="application/json" hidden></label>`;
      side.querySelector('#ck')!.addEventListener('change', async e => {
        const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return;
        try { importKnowledge(await f.text()); costStage.render(side, canvas); }
        catch (err) { side.querySelector('#src')!.insertAdjacentHTML('beforeend', `<p class="badge warn">${esc((err as Error).message)}</p>`); }
      });
      canvas.innerHTML = '<div class="empty">Import the cost data to price the alternatives.</div>';
      return;
    }
    const k: Knowledge = loaded;
    side.querySelector('#src')!.insertAdjacentHTML('afterend', '<div class="row"><button class="btn ghost" id="forget">Remove cost data from this browser</button></div>');
    side.querySelector('#forget')!.addEventListener('click', () => { forgetKnowledge(); costStage.render(side, canvas); });
    side.querySelector('#src')!.textContent = `Cost knowledge ${k.version}. Contingency ${k.assumptions.CONT * 100}%, design ${k.assumptions.DESIGN * 100}%, environmental ${k.assumptions.ENV * 100}%. Range ${k.assumptions.RANGE_LOW * 100}% to +${k.assumptions.RANGE_HIGH * 100}%.`;

    const draw = () => {
      if (!seg.length_ft) { canvas.innerHTML = '<div class="empty">Draw the segment in Site first. Quantities need its length.</div>'; return; }
      if (!seg.alternatives.length) { canvas.innerHTML = '<div class="empty">Create an alternative first.</div>'; return; }
      const res = costSummary(k);
      const lineRows = (ls: Line[]) => ls.map(l => `<tr><td>${esc(l.group)}</td><td>${esc(l.element)}</td><td>${esc(l.item)}${l.note ? `<div class="note">${esc(l.note)}</div>` : ''}</td><td class="num">${Math.round(l.qty).toLocaleString()} ${esc(l.unit)}</td><td class="num">${money(l.rate)}</td><td class="num">${money(l.raw)}</td></tr>`).join('');
      canvas.innerHTML = `<div style="padding:1.25rem;display:grid;gap:1.5rem">
        <div class="scroll"><table><thead><tr><th>Alternative</th><th>Tier</th><th class="num">Low</th><th class="num">Estimate</th><th class="num">High</th></tr></thead><tbody>
          ${res.map(r => `<tr><td>${esc(r.alt.name)}</td><td>${esc(r.alt.tier)}</td><td class="num">${money(r.w.low)}</td><td class="num"><b>${money(r.w.total)}</b></td><td class="num">${money(r.w.high)}</td></tr>`).join('')}
        </tbody></table></div>
        ${res.map(r => `<section><h3>${esc(r.alt.name.toUpperCase())}</h3>
          <div class="scroll"><table><thead><tr><th>Group</th><th>Element</th><th>Item</th><th class="num">Qty</th><th class="num">Unit cost</th><th class="num">Amount</th></tr></thead>
          <tbody>${lineRows(r.lines) || '<tr><td colspan="6">No changes from existing.</td></tr>'}
          ${r.w.rows.slice(1).filter(x => x[1]).map(([n, v]) => `<tr><td colspan="5">${n}</td><td class="num">${money(v)}</td></tr>`).join('')}
          <tr><td colspan="5"><b>Total (rounded)</b></td><td class="num"><b>${money(r.w.total)}</b></td></tr></tbody></table></div>
          ${r.flags.map(f => `<p class="badge warn">${esc(f)}</p>`).join(' ')}</section>`).join('')}
      </div>`;
    };
    side.querySelector('#ctx')!.addEventListener('change', e => { context = (e.target as HTMLSelectElement).value as typeof context; draw(); });
    draw();
  }
};

// ---------------------------------------------------------------- engine: fp-section-builder (cost/run.py), unchanged
const SETTINGS = SCENES;
const ENG = { city: 'Los Angeles', setting: 'la-commercial', mode: 'default' };

async function engineCost(side: HTMLElement, canvas: HTMLElement) {
  const gen = live.gen, seg = project.seg();
  if (seg.setting) ENG.setting = seg.setting;
  const built = !!outputsStore.concepts, ready = seg.alternatives.length > 0;
  side.innerHTML = `${head(4, 'Cost', 'Prices every alternative and builds the 11x17 concepts and cost one-pager.')}
    ${task(1, 'Describe the setting', built ? 'done' : 'now', `
      <div class="field"><label for="city">City (sets regional prices)</label><input id="city" value="${esc(ENG.city)}"></div>
      <div class="field"><label for="setting">Surroundings (scenery and cost complexity)</label><select id="setting">${SETTINGS.map(([v, l]) => `<option value="${v}"${v === ENG.setting ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
      ${more(`<div class="field"><label for="mode">Pricing method</label><select id="mode"><option value="default">Delivery tiers, quick-build to capital (default)</option><option value="atp"${ENG.mode === 'atp' ? ' selected' : ''}>Caltrans ATP method</option></select></div>`)}`)}
    ${task(2, 'Build the one-pager', built ? 'done' : ready ? 'now' : 'later', `
      ${ready ? '' : '<p class="note">Add an alternative first.</p>'}
      <div class="row"><button class="btn" id="run"${ready ? '' : ' disabled'}>${built ? 'Rebuild one-pager' : 'Build one-pager'}</button><a class="btn ghost" id="pdf" target="_blank" rel="noopener" hidden>Open PDF</a></div>
      <p class="note" id="msg" role="status">Takes about 10 seconds.</p>`)}`;
  const $ = (q: string) => side.querySelector(q) as HTMLInputElement;
  const msg = (t: string) => { side.querySelector('#msg')!.textContent = t; };
  const show = () => {
    const o = outputsStore.concepts;
    if (!o) { canvas.innerHTML = '<div class="empty">The one-pager appears here after you build it.</div>'; return; }
    const a = $('#pdf') as unknown as HTMLAnchorElement; a.href = engine.abs(o.pdf); a.hidden = false;
    canvas.innerHTML = `<div style="padding:1rem;display:grid;gap:1rem">
      ${o.png ? `<img src="${engine.abs(o.png)}" alt="Concepts and cost one-pager" style="width:100%;background:#fff;box-shadow:0 2px 10px rgba(0,0,0,.12)">` : ''}
      <div class="srcbar">${o.summary.map(esc).join('<br>')}</div></div>`;
  };
  ['#city', '#setting', '#mode'].forEach(q => $(q).addEventListener('change', () => { ENG.city = $('#city').value.trim(); ENG.setting = $('#setting').value; ENG.mode = $('#mode').value; project.update(() => { seg.setting = ENG.setting; }); }));
  $('#run').addEventListener('click', async () => {
    ENG.city = $('#city').value.trim(); ENG.setting = $('#setting').value; ENG.mode = $('#mode').value;
    msg('Building…'); ($('#run') as unknown as HTMLButtonElement).disabled = true;
    try {
      const r = await engine.json('/api/concepts', { project: project.get(), street: seg.limits.from || undefined, city: ENG.city || undefined, setting: ENG.setting, mode: ENG.mode });
      if (gen !== live.gen) return;
      if (!r.ok) { msg('The cost skill stopped: ' + r.log.split('\n').slice(-3).join(' ')); return; }
      const f = (end: string) => r.files.find((x: any) => x.name.endsWith(end))?.url;
      outputsStore.concepts = { job: r.job, pdf: f('_sheet.pdf'), png: f('_sheet.png'), summary: r.summary };
      repaintNav(); engineCost(side, canvas);
      return;
    } catch (err) { msg((err as Error).message); }
    ($('#run') as unknown as HTMLButtonElement).disabled = false;
  });
  show();
}
