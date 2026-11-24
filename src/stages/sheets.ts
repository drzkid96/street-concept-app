import { live, type Stage } from './index';
import { head, task, esc } from './ui';
import { project } from '../lib/project';
import { buildSheets } from '../lib/sheet';
import { renderPages, store, download } from '../lib/pdfView';
import { engine, outputsStore, keeper } from '../lib/engine';

const fileName = () => `${new Date().toISOString().slice(0, 10)}_${(project.get().project.name || 'STREET-CONCEPT').toUpperCase().replace(/\W+/g, '-')}_CONCEPT-SHEETS.pdf`;

export const sheetsStage: Stage = {
  id: 'sheets', name: 'Review',
  async render(side, canvas) {
    const gen = live.gen, seg = project.seg();
    if (await engine.check()) {
      const parts = [...(outputsStore.existingReport ? [{ name: 'Existing conditions report', url: outputsStore.existingReport.pdf }] : []), ...(outputsStore.streetview?.pdfs ?? []).map(f => ({ name: 'Concept renderings sheet', url: f.url })), ...(outputsStore.sections ? [{ name: 'Concept sections sheet', url: outputsStore.sections.pdf }] : [])];
      const list = [...(outputsStore.compiled ? [{ name: `Compiled PDF set (${outputsStore.compiled.pages} pages)`, url: outputsStore.compiled.pdf }] : []), ...parts];
      let shown0 = 0;
      if (gen !== live.gen) return;
      const pf = project.get();
      let shown = shown0;
      side.innerHTML = `${head(7, 'Review', 'The package opens in the markup tool: draw callouts, clouds and boxes, then press Send for revisions, or Approved.')}
        ${task(1, 'Package', list.length ? 'now' : 'later', list.length ? `<div class="row"><button class="btn" id="open">Mark up</button></div><ul class="filelist">${list.map((f, i) => `<li><span>${esc(f.name)}</span><span><button class="linkbtn" data-i="${i}">view PDF</button> · <a class="linkbtn" target="_blank" rel="noopener" href="${keeper.href(f.url)}">open</a></span></li>`).join('')}</ul>` :
          `<p class="note">Nothing built yet. Go to <a href="#build">Build</a>.</p>`)}
        ${outputsStore.concepts?.xlsx ? `<p class="row"><a class="btn ghost" href="${keeper.href(outputsStore.concepts.xlsx)}" download="cost-estimate.xlsx">Download cost estimate (Excel)</a></p>` : ''}
        ${outputsStore.handoff ? `<p class="row"><a class="btn ghost" href="${keeper.href(outputsStore.handoff.zip)}" download="${esc(outputsStore.handoff.name)}">Download AI handoff ZIP</a></p>` : ''}
        <p class="note" id="msg" role="status"></p>`;
      const preview = () => { canvas.innerHTML = list.length ? `<iframe class="guide" title="Sheet" src="${keeper.href(list[shown].url)}"></iframe>` : '<div class="empty">Your sheets appear here.</div>'; };
      side.querySelectorAll<HTMLElement>('[data-i]').forEach(b => b.addEventListener('click', () => { shown = +b.dataset.i!; preview(); }));
      const openMarkup = async () => {
        side.querySelector('#msg')!.textContent = 'Opening the markup viewer…';
        try {
          const fd = new FormData(); fd.append('title', pf.project.name || 'Street concepts'); fd.append('rev', String(1 + pf.review.filter(r => r.kind === 'approved').length)); fd.append('urls', JSON.stringify(parts.map(f => f.url)));
          // the engine's own copies first; if it has restarted since the build, the copies kept in this browser are sent instead
          const r = await engine.form('/api/review', fd).catch(async err => {
            const mine = parts.map(f => [f, keeper.blob(f.url)] as const).filter(x => x[1]);
            if (!mine.length) throw err;
            const fd2 = new FormData(); fd2.append('title', fd.get('title') as string); fd2.append('rev', fd.get('rev') as string); fd2.append('urls', '[]');
            mine.forEach(([f, b], i) => fd2.append('files', b as Blob, `${String(i + 1).padStart(2, '0')}_${f.name.replace(/\W+/g, '-')}.pdf`));
            return engine.form('/api/review', fd2);
          });
          if (gen !== live.gen) return;
          canvas.innerHTML = `<iframe class="guide" title="Markup viewer" src="${engine.abs(r.page)}"></iframe>`;
          side.querySelector('#msg')!.textContent = 'Your markups save as you draw.';
        } catch (err) { preview(); side.querySelector('#msg')!.textContent = 'The markup tool did not open (' + (err as Error).message + '). Showing the PDF instead.'; }
      };
      side.querySelector('#open')?.addEventListener('click', openMarkup);
      if (parts.length) { canvas.innerHTML = '<div class="empty">Opening the markup tool…</div>'; openMarkup(); } else preview();
      return;
    }
    const missing = [!seg.length_ft && 'segment length (Site)', !seg.keymap && 'key map (Site, Save key map)', !seg.alternatives.length && 'alternatives', !seg.alternatives.some(a => a.render) && 'concept renderings (Visualize)'].filter(Boolean);
    side.innerHTML = `${head(7, 'Review', 'Build, read and download the concept sheets.')}
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
