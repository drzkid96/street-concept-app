import type { Section, ElementType, Direction } from '../lib/types';
import { ELEMENTS, MATERIALS, materialOf } from '../lib/standards';
import { split, curbToCurb, roadsideLabel, setWidth, addElement, removeElement, setCurbToCurb, limitsFor } from '../lib/roadway';

const ROAD_TYPES = (Object.keys(ELEMENTS) as ElementType[]).filter(t => !['sidewalk', 'parkway', 'curb'].includes(t));
const DIRS: Direction[] = ['none', 'inbound', 'outbound', 'both'];
const DIR_LABEL: Record<Direction, string> = { none: '–', inbound: 'In', outbound: 'Out', both: 'Both' };

// Roadway editor: only the elements between the curbs. Curb to curb is fixed (Existing may set the measured value).
export function sectionEditor(host: HTMLElement, sec: Section, onChange: () => void, opts: { existing: boolean }) {
  let note = '';
  const render = () => {
    const { left, road, right } = split(sec), c2c = curbToCurb(sec);
    host.innerHTML = `
      <div class="c2c">${opts.existing
        ? `<label for="c2c">Curb to curb</label><span><input id="c2c" type="number" min="10" max="200" step="0.5" value="${c2c}"> ft</span>`
        : `<span class="lbl">Curb to curb</span><b>${c2c} ft</b><span class="note">fixed by the existing street</span>`}</div>
      <table class="sec-table"><colgroup><col style="width:46%"><col style="width:22%"><col style="width:20%"><col style="width:12%"></colgroup>
        <thead><tr><th>Roadway, left curb to right curb</th><th class="num">Width (ft)</th><th>Dir</th><th></th></tr></thead>
        <tbody>${road.map((e, i) => {
          const L = limitsFor(road, e);
          const hint = L.pref && (e.width_ft < L.pref[0] || e.width_ft > L.pref[1]) ? `<span class="badge warn">${L.label}: preferred ${L.pref[0]}${L.pref[1] !== L.pref[0] ? '–' + L.pref[1] : ''} ft</span>` : '';
          return `<tr data-i="${i}">
            <td><select data-k="type" aria-label="Element">${ROAD_TYPES.map(t => `<option value="${t}"${t === e.type ? ' selected' : ''}>${ELEMENTS[t].label}</option>`).join('')}</select>
              ${MATERIALS[e.type] ? `<select data-k="material" aria-label="Option" style="margin-top:.25rem">${MATERIALS[e.type]!.map(([v, l]) => `<option value="${v}"${v === materialOf(e.type, e.material) ? ' selected' : ''}>${l}</option>`).join('')}</select>` : ''}
              ${hint}</td>
            <td class="num"><input data-k="width_ft" type="number" min="${L.min}" max="${L.max}" step="0.5" value="${e.width_ft}" aria-label="Width" title="${L.label}: ${L.min} to ${L.max} ft"></td>
            <td><select data-k="direction" aria-label="Direction">${DIRS.map(d => `<option value="${d}"${d === e.direction ? ' selected' : ''}>${DIR_LABEL[d]}</option>`).join('')}</select></td>
            <td><button class="btn ghost" data-act="del" aria-label="Remove" style="min-height:32px;padding:.2rem .5rem">×</button></td>
          </tr>`;
        }).join('')}</tbody>
      </table>
      <div class="row addrow"><select id="addT" class="sel" aria-label="Element to add">${ROAD_TYPES.map(t => `<option value="${t}"${t === 'bike_lane' ? ' selected' : ''}>${ELEMENTS[t].label}</option>`).join('')}</select>
        <button class="btn ghost" data-act="add" data-where="left">Add at left curb</button><button class="btn ghost" data-act="add" data-where="right">Add at right curb</button></div>
      <p class="note" role="status">${note}</p>
      <p class="note roadside">Outside the curbs, unchanged: left ${roadsideLabel(left)}; right ${roadsideLabel(right)}.</p>`;
  };
  const act = (f: () => string) => { try { note = f(); } catch (err) { note = (err as Error).message; } render(); onChange(); };
  host.addEventListener('change', e => {
    const t = e.target as HTMLInputElement | HTMLSelectElement;
    if (t.id === 'c2c') { act(() => { setCurbToCurb(sec, parseFloat(t.value)); return 'Roadway scaled to the curb-to-curb width.'; }); return; }
    const tr = t.closest('tr[data-i]') as HTMLElement | null;
    if (!tr) return;
    const i = +tr.dataset.i!, el = split(sec).road[i];
    const k = t.dataset.k as 'type' | 'width_ft' | 'direction' | 'material';
    if (k === 'width_ft') act(() => setWidth(sec, i, parseFloat(t.value) || 0));
    else act(() => {
      if (k === 'type') { el.type = t.value as ElementType; el.material = materialOf(el.type); }
      else if (k === 'material') el.material = t.value;
      else if (k === 'direction') el.direction = t.value as Direction;
      return '';
    });
  });
  host.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('button[data-act]') as HTMLButtonElement | null;
    if (!b) return;
    if (b.dataset.act === 'add') act(() => addElement(sec, (host.querySelector('#addT') as HTMLSelectElement).value as ElementType, b.dataset.where as 'left' | 'right'));
    if (b.dataset.act === 'del') act(() => removeElement(sec, +(b.closest('tr') as HTMLElement).dataset.i!));
  });
  render();
}
