// Photo: upload, or an interactive Google Street View at the segment start. Nothing is captured until the
// person presses "Use this view".
import { live, repaintNav, type Stage } from './index';
import { project } from '../lib/project';
import { outputsStore } from '../lib/engine';
import { bearing, type LngLat } from '../lib/providers';
import { GOOGLE_KEY } from '../lib/config';
import { head, task, esc } from './ui';

let gm: Promise<any> | null = null;
function loadMaps(): Promise<any> {
  return gm ??= new Promise((res, rej) => {
    (window as any).__gmInit = () => res((window as any).google.maps);
    (window as any).gm_authFailure = () => { gm = null; rej(new Error('Google refused the key for Street View on this site.')); };
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_KEY}&callback=__gmInit&loading=async&v=weekly`;
    s.onerror = () => { gm = null; rej(new Error('Google Maps could not load.')); };
    document.head.appendChild(s);
  });
}
function readImage(file: File, max = 1800): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src); resolve(c.toDataURL('image/jpeg', 0.88));
    };
    img.onerror = () => reject(new Error('That file could not be read as an image.'));
    img.src = URL.createObjectURL(file);
  });
}

let mode: 'idle' | 'sv' = 'idle';
export const photoStage: Stage = {
  id: 'photo', name: 'Photo',
  done: () => !!project.seg().perspective,
  render(side, canvas) {
    const gen = live.gen, seg = project.seg(), p = seg.perspective;
    const path = (seg.path ?? []) as LngLat[];
    let pano: any = null, msgText = '';
    const setPhoto = (ph: NonNullable<typeof p>) => {
      project.update(() => { seg.perspective = ph; });
      outputsStore.curbs = undefined; outputsStore.streetview = undefined;   // new photo: curbs start over
      mode = 'idle'; repaintNav(); photoStage.render(side, canvas);
    };
    const paint = () => {
      const picking = !p || mode === 'sv';
      side.innerHTML = `${head(4, 'Photo', 'The street photo the concepts are rendered on.')}
        ${task(1, 'Choose the source', p && mode === 'idle' ? 'done' : 'now', `
          <div class="row"><button class="btn${mode === 'sv' ? '' : ' ghost'}" id="sv">Google Street View</button><label class="btn ghost">Upload a photo<input id="file" type="file" accept="image/*" hidden></label></div>
          <p class="note">Upload any eye-level photo looking along the street.</p>`)}
        ${task(2, 'Approve the photo', p && mode === 'idle' ? 'done' : mode === 'sv' ? 'now' : 'later', mode === 'sv' ? `
          <p class="note">Street View is open at the start of your segment. Drag to turn, click the arrows on the road to move, scroll to zoom. Look straight along the street with both curbs in view. Nothing is captured until you approve.</p>
          <div class="row"><button class="btn" id="use">Use this view</button>${p ? '<button class="linkbtn" id="cancel">Keep the current photo</button>' : ''}</div>` : p ? `
          <div class="mini"><img src="${esc(p.src)}" alt="Approved photo"><div><b class="okline">Photo approved</b><br><span class="note">${esc(p.source)}${p.credit ? ' · ' + esc(p.credit) : ''}</span></div></div>
          <p class="note">To change it, choose a source again above. Changing the photo clears the curbs.</p>` : '<p class="note">Choose a source first.</p>')}
        <p class="note" id="msg" role="status">${esc(msgText)}</p>`;
      void picking;
      const $ = (q: string) => side.querySelector(q) as HTMLElement | null;
      $('#sv')!.addEventListener('click', () => { mode = 'sv'; paint(); openSv(); });
      $('#cancel')?.addEventListener('click', () => { mode = 'idle'; photoStage.render(side, canvas); });
      $('#file')!.addEventListener('change', async e => {
        const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return;
        try { setPhoto({ src: await readImage(f), source: 'Upload', credit: f.name }); } catch (err) { msgText = (err as Error).message; paint(); }
      });
      $('#use')?.addEventListener('click', () => {
        if (!pano) { msgText = 'Street View is still loading.'; paint(); return; }
        const pov = pano.getPov(), id = pano.getPano(), fov = Math.max(20, Math.min(120, 180 / Math.pow(2, pano.getZoom() ?? 1)));
        const loc = pano.getLocation?.()?.latLng, h = ((pov.heading % 360) + 360) % 360;
        setPhoto({
          src: `https://maps.googleapis.com/maps/api/streetview?size=640x400&scale=2&pano=${id}&heading=${h.toFixed(1)}&pitch=${pov.pitch.toFixed(1)}&fov=${fov.toFixed(0)}&key=${GOOGLE_KEY}`,
          source: 'Google Street View', credit: '© Google', heading: h,
          link: loc ? `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${loc.lat()},${loc.lng()}&heading=${h.toFixed(0)}` : undefined
        });
      });
    };
    const say = (t: string) => { msgText = t; const m = side.querySelector('#msg'); if (m) m.textContent = t; };
    async function openSv() {
      if (path.length < 1) { say('Mark the segment in Site first.'); return; }
      canvas.innerHTML = '<div class="pano" id="pano"><div class="empty">Loading Street View…</div></div>';
      try {
        const maps = await loadMaps();
        if (gen !== live.gen) return;
        const at = { lat: path[0][1], lng: path[0][0] };
        const r = await new maps.StreetViewService().getPanorama({ location: at, radius: 80, source: 'outdoor' });
        if (gen !== live.gen) return;
        pano = new maps.StreetViewPanorama(canvas.querySelector('#pano'), {
          pano: r.data.location.pano, pov: { heading: path[1] ? bearing(path[0], path[1]) : 0, pitch: 0 }, zoom: 1,
          addressControl: false, fullscreenControl: false, motionTracking: false, motionTrackingControl: false, showRoadLabels: true
        });
        say('');
      } catch (err) { canvas.innerHTML = '<div class="empty">Street View is not available here. Upload a photo instead.</div>'; say((err as Error).message || 'No Street View here.'); }
    }
    paint();
    if (mode === 'sv') openSv();
    else if (p) canvas.innerHTML = `<div class="persp-wrap"><figure class="persp"><img src="${esc(p.src)}" alt="Approved photo"><figcaption>${esc(p.source)}${p.credit ? ' · ' + esc(p.credit) : ''}. Next: Curbs.</figcaption></figure></div>`;
    else canvas.innerHTML = '<div class="empty">Choose Google Street View or upload a photo.</div>';
  }
};
