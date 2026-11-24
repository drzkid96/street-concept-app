import { live, type Stage } from './index';
import { head, task, esc } from './ui';
import { project } from '../lib/project';
import { buildSheets } from '../lib/sheet';
import { renderPages, store, download } from '../lib/pdfView';
import { engine, outputsStore } from '../lib/engine';

const fileName = () => `${new Date().toISOString().slice(0, 10)}_${(project.get().project.name || 'STREET-CONCEPT').toUpperCase().replace(/\W+/g, '-')}_CONCEPT-SHEETS.pdf`;

export const sheetsStage: Stage = {
  id: 'sheets', name: 'Sheets',
  async render(side, canvas) {
    const gen = live.gen, seg = project.seg();
    if (await engine.check()) {
      const list = [...(outputsStore.concepts ? [{ name: 'Concepts and cost one-pager', url: outputsStore.concepts.pdf }] : []),
        ...(outputsStore.streetview?.pdfs ?? []).map(f => ({ name: `Concept renderings sheet (${f.name})`, url: f.url }))];
      if (gen !== live.gen) return;
      const pf = project.get();
      let shown = list.length - 1;
      side.innerHTML = `${head(6, 'Sheets', 'Read the PDFs, then mark them up for revisions or approve them.')}
        ${task(1, 'Read the sheets', list.length ? 'now' : 'later', list.length ? `<ul class="filelist">${list.map((f, i) => `<li><button class="linkbtn" data-i="${i}">${esc(f.name)}</button><a class="note" target="_blank" rel="noopener" href="${engine.abs(f.url)}">open in new tab</a></li>`).join('')}</ul>` :
          `<p class="note">Nothing yet. Build the one-pager in <a href="#cost">Cost</a>, and render the concepts in <a href="#visualize">Render</a>.</p>`)}
        ${task(2, 'Mark up or approve', list.length ? 'now' : 'later', `
          <p class="note">Opens the markup viewer on every sheet: draw callouts, clouds and boxes, then press <b>Send</b> for revisions, or <b>Approved</b>.</p>
          <div class="row"><button class="btn" id="open"${list.length ? '' : ' disabled'}>Open markup viewer</button></div>`)}
        <p class="note" id="msg" role="status"></p>`;
      const preview = () => { canvas.innerHTML = list.length ? `<iframe class="guide" title="Sheet" src="${engine.abs(list[shown].url)}"></iframe>` : '<div class="empty">Your sheets appear here.</div>'; };
      side.querySelectorAll<HTMLElement>('[data-i]').forEach(b => b.addEventListener('click', () => { shown = +b.dataset.i!; preview(); }));
      side.querySelector('#open')!.addEventListener('click', async () => {
        side.querySelector('#msg')!.textContent = 'Opening the markup viewer…';
        try {
          const fd = new FormData(); fd.append('title', pf.project.name || 'Street concepts'); fd.append('rev', String(1 + pf.review.filter(r => r.kind === 'approved').length)); fd.append('urls', JSON.stringify(list.map(f => f.url)));
          const r = await engine.form('/api/review', fd);
          if (gen !== live.gen) return;
          canvas.innerHTML = `<iframe class="guide" title="Markup viewer" src="${engine.abs(r.page)}"></iframe>`;
          side.querySelector('#msg')!.textContent = 'Your markups save as you draw.';
        } catch (err) { side.querySelector('#msg')!.textContent = (err as Error).message; }
      });
      preview();
      return;
    }
    const missing = [!seg.length_ft && 'segment length (Site)', !seg.keymap && 'key map (Site, Save key map)', !seg.alternatives.length && 'alternatives', !seg.alternatives.some(a => a.render) && 'concept renderings (Visualize)'].filter(Boolean);
    side.innerHTML = `${head(6, 'Sheets', 'Build, read and download the concept sheets.')}
      <p>11x17 landscape concept sheets: overview with key map, existing section and cost summary, then one sheet per alternative.</p>
      <div class="row"><button class="btn" id="build">Build sheets</button><button class="btn ghost" id="dl" disabled>Download PDF</button></div>
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
