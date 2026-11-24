import type { Stage } from './index';
import { project } from '../lib/project';
import { sectionSvg } from '../lib/sectionSvg';

const esc = (t: string) => t.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

// Downscale uploads so the project file stays small enough to save locally.
function readImage(file: File, max = 1800): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => reject(new Error('Could not read that image'));
    img.src = URL.createObjectURL(file);
  });
}

export const visualizeStage: Stage = {
  id: 'visualize', name: 'Visualize',
  render(side, canvas) {
    const seg = project.seg();
    const alts = seg.alternatives;
    side.innerHTML = `<h2>5. VISUALIZE</h2>
      <p>Perspective image: upload a photo or rendering, or capture Street View, Panoramax or Mapillary in Site.</p>
      <label class="drop" id="drop" tabindex="0">
        <input id="file" type="file" accept="image/*" hidden>
        <b>Upload perspective image</b><span class="note">JPG or PNG, or drop it here</span>
      </label>
      <div class="row"><a class="btn ghost" href="#site">Capture street view</a>${seg.perspective ? '<button class="btn ghost" id="rm">Remove image</button>' : ''}</div>
      <div class="field"><label for="alt">Concept to overlay</label><select id="alt"><option value="-1">Existing</option>${alts.map((a, i) => `<option value="${i}">${esc(a.name)}</option>`).join('')}</select></div>
      <p class="note">Click the image to set the vanishing point.</p>
      <div class="todo"><b>To build</b>Lane lines from the section run to the vanishing point, FP asset placement scaled to depth, curb guide, layered SVG and PNG export.</div>
      <p id="msg" class="note" role="status"></p>`;

    const draw = () => {
      const p = seg.perspective;
      const i = +((side.querySelector('#alt') as HTMLSelectElement)?.value ?? -1);
      const sec = i >= 0 ? alts[i].section : seg.existing;
      if (!p) { canvas.innerHTML = `<div class="empty">No perspective image yet.<br>Upload one, or capture street view in Site.</div>`; return; }
      const vp = p.vp ?? [0.5, 0.45];
      canvas.innerHTML = `<div class="persp-wrap">
        <figure class="persp" id="persp">
          <div class="pimg"><img src="${esc(p.src)}" alt="Perspective view (${esc(p.source)})">
          <svg class="vp" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <line x1="${vp[0] * 100}" y1="0" x2="${vp[0] * 100}" y2="100" stroke="#6BD688" stroke-width=".25" stroke-dasharray="1 1"/>
            <line x1="0" y1="${vp[1] * 100}" x2="100" y2="${vp[1] * 100}" stroke="#6BD688" stroke-width=".25" stroke-dasharray="1 1"/>
            <circle cx="${vp[0] * 100}" cy="${vp[1] * 100}" r="1.2" fill="#6BD688" stroke="#00242E" stroke-width=".3"/>
          </svg></div>
          <figcaption>${esc(p.source)}${p.credit ? ' · ' + esc(p.credit) : ''}${p.link ? ` · <a href="${esc(p.link)}" target="_blank" rel="noopener">open</a>` : ''}</figcaption>
        </figure>
        ${sectionSvg(sec, i >= 0 ? alts[i].name : 'Existing')}
      </div>`;
      const fig = canvas.querySelector('#persp img') as HTMLImageElement;
      fig.addEventListener('click', e => {
        const r = fig.getBoundingClientRect();
        project.update(() => { seg.perspective!.vp = [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; });
        draw();
      });
    };

    const take = async (f?: File | null) => {
      if (!f || !f.type.startsWith('image/')) return;
      const msg = side.querySelector('#msg')!;
      msg.textContent = 'Loading…';
      try {
        const src = await readImage(f);
        project.update(() => { seg.perspective = { src, source: 'Upload', credit: f.name }; });
        visualizeStage.render(side, canvas);
      } catch (err) { msg.textContent = (err as Error).message; }
    };
    const drop = side.querySelector('#drop') as HTMLElement;
    side.querySelector('#file')!.addEventListener('change', e => take((e.target as HTMLInputElement).files?.[0]));
    drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (side.querySelector('#file') as HTMLInputElement).click(); } });
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); take(e.dataTransfer?.files?.[0]); });
    side.querySelector('#rm')?.addEventListener('click', () => { project.update(() => { delete seg.perspective; }); visualizeStage.render(side, canvas); });
    side.querySelector('#alt')!.addEventListener('change', draw);
    draw();
  }
};
