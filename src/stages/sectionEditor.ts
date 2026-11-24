import type { Section, ElementType, Direction } from '../lib/types';
import { ELEMENTS, check, topicLink } from '../lib/standards';

const TYPES = Object.keys(ELEMENTS) as ElementType[];
const DIRS: Direction[] = ['none', 'inbound', 'outbound', 'both'];
const DIR_LABEL: Record<Direction, string> = { none: '–', inbound: 'In', outbound: 'Out', both: 'Both' };

// Editable table bound to a Section. onChange fires after every edit.
export function sectionEditor(host: HTMLElement, sec: Section, onChange: () => void) {
  const render = () => {
    const total = sec.elements.reduce((a, e) => a + e.width_ft, 0);
    host.innerHTML = `
      <table class="sec-table"><colgroup><col style="width:46%"><col style="width:22%"><col style="width:20%"><col style="width:12%"></colgroup>
        <thead><tr><th>Element</th><th class="num">Width (ft)</th><th>Dir</th><th></th></tr></thead>
        <tbody>${sec.elements.map((e, i) => {
          const issues = check(e.type, e.width_ft);
          return `<tr data-i="${i}">
            <td><select data-k="type">${TYPES.map(t => `<option value="${t}"${t === e.type ? ' selected' : ''}>${ELEMENTS[t].label}</option>`).join('')}</select>
              ${issues.map(x => `<a class="badge warn" href="${topicLink(e.type)}" target="_blank" rel="noopener" title="Placeholder rule, verify">${x.msg}</a>`).join(' ')}</td>
            <td class="num"><input data-k="width_ft" type="number" min="0" step="0.5" value="${e.width_ft}"></td>
            <td><select data-k="direction">${DIRS.map(d => `<option value="${d}"${d === e.direction ? ' selected' : ''}>${DIR_LABEL[d]}</option>`).join('')}</select></td>
            <td><button class="btn ghost" data-act="del" aria-label="Remove element" style="min-height:32px;padding:.2rem .5rem">×</button></td>
          </tr>`;
        }).join('')}</tbody>
        <tfoot><tr><td><b>Total</b></td><td class="num"><b>${total}'</b></td><td colspan="2"></td></tr></tfoot>
      </table>
      <div class="row"><button class="btn ghost" data-act="add">Add element</button></div>`;
  };
  host.addEventListener('change', e => {
    const t = e.target as HTMLInputElement | HTMLSelectElement;
    const tr = t.closest('tr[data-i]') as HTMLElement | null;
    if (!tr) return;
    const el = sec.elements[+tr.dataset.i!];
    const k = t.dataset.k as 'type' | 'width_ft' | 'direction';
    if (k === 'width_ft') el.width_ft = Math.max(0, parseFloat(t.value) || 0);
    else if (k === 'type') el.type = t.value as ElementType;
    else if (k === 'direction') el.direction = t.value as Direction;
    render(); onChange();
  });
  host.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('button[data-act]') as HTMLButtonElement | null;
    if (!b) return;
    if (b.dataset.act === 'add') sec.elements.push({ type: 'travel_lane', width_ft: 11, direction: 'inbound' });
    if (b.dataset.act === 'del') sec.elements.splice(+(b.closest('tr') as HTMLElement).dataset.i!, 1);
    render(); onChange();
  });
  render();
}
