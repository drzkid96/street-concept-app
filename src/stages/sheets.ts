import { live, type Stage } from './index';
import { project } from '../lib/project';
import { buildSheets } from '../lib/sheet';
import { renderPages, store, download } from '../lib/pdfView';

const fileName = () => `${new Date().toISOString().slice(0, 10)}_${(project.get().project.name || 'STREET-CONCEPT').toUpperCase().replace(/\W+/g, '-')}_CONCEPT-SHEETS.pdf`;

export const sheetsStage: Stage = {
  id: 'sheets', name: 'Sheets',
  async render(side, canvas) {
    const gen = live.gen, seg = project.seg();
    const missing = [!seg.length_ft && 'segment length (Site)', !seg.keymap && 'key map (Site, Save key map)', !seg.alternatives.length && 'alternatives', !seg.alternatives.some(a => a.render) && 'concept renderings (Visualize)'].filter(Boolean);
    side.innerHTML = `<h2>6. SHEETS</h2>
      <p>11x17 landscape concept sheets: overview with key map, existing section and cost summary, then one sheet per alternative.</p>
      <div class="row"><button class="btn" id="build">Build sheets</button><button class="btn ghost" id="dl" disabled>Download PDF</button><a class="btn ghost" href="#review">Review</a></div>
      ${missing.length ? `<div class="srcbar">Optional inputs not yet set: ${missing.join(', ')}. Sheets build without them.</div>` : ''}
      <p class="note" id="msg" role="status">Albert Sans embedded. Text is fitted to its box before drawing, so labels cannot overlap or clip.</p>`;
    const msg = side.querySelector('#msg')!, dl = side.querySelector('#dl') as HTMLButtonElement;
    const show = async (bytes: Uint8Array) => {
      canvas.innerHTML = '<div class="pages" id="pages"></div>';
      await renderPages(bytes, canvas.querySelector('#pages') as HTMLElement, Math.min(1400, canvas.clientWidth - 40));
      dl.disabled = false;
    };
    side.querySelector('#build')!.addEventListener('click', async () => {
      msg.textContent = 'Building…';
      try {
        const bytes = await buildSheets(project.get());
        if (gen !== live.gen) return;
        store.pdf = bytes; store.builtAt = new Date().toISOString();
        await show(bytes);
        msg.textContent = `Built ${new Date().toLocaleTimeString()}. ${Math.round(bytes.length / 1024)} KB.`;
      } catch (err) { msg.textContent = 'Build failed: ' + (err as Error).message; }
    });
    dl.addEventListener('click', () => store.pdf && download(store.pdf, fileName(), 'application/pdf'));
    if (store.pdf) await show(store.pdf);
    else canvas.innerHTML = '<div class="empty">Build the sheets to preview them here.</div>';
  }
};
