import type { Stage } from './index';
import { project } from '../lib/project';
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

function csv(rows: (string | number)[][]) {
  return rows.map(r => r.map(v => typeof v === 'number' ? String(Math.round(v * 100) / 100) : `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
}

export const costStage: Stage = {
  id: 'cost', name: 'Cost',
  async render(side, canvas) {
    const seg = project.seg();
    side.innerHTML = `<h2>4. COST</h2>
      <p>Planning-level estimate of each alternative, priced as the change from existing over ${seg.length_ft.toLocaleString()}'.</p>
      <div class="field"><label for="ctx">Context</label><select id="ctx"><option value="urban">Urban</option><option value="suburban">Suburban</option><option value="rural">Rural</option></select></div>
      <div class="row"><button class="btn" id="csv">Download estimate (CSV)</button></div>
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
      (side.querySelector('#csv') as HTMLButtonElement).disabled = true;
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
    side.querySelector('#csv')!.addEventListener('click', () => {
      const res = costSummary(k);
      const rows: (string | number)[][] = [['Alternative', 'Group', 'Element', 'Item', 'Qty', 'Unit', 'Unit cost', 'Amount', 'Note']];
      res.forEach(r => {
        r.lines.forEach(l => rows.push([r.alt.name, l.group, l.element, l.item, l.qty, l.unit, l.rate, l.raw, l.note]));
        r.w.rows.slice(1).forEach(([n, v]) => rows.push([r.alt.name, 'Markup', '', n, '', '', '', v, '']));
        rows.push([r.alt.name, 'Total', '', `Estimate (range ${money(r.w.low)} to ${money(r.w.high)})`, '', '', '', r.w.total, '']);
      });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv(rows)], { type: 'text/csv' }));
      a.download = `${(project.get().project.name || 'estimate').replace(/\W+/g, '-')}-estimate.csv`;
      a.click(); URL.revokeObjectURL(a.href);
    });
    draw();
  }
};
