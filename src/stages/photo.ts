// Photo: upload, or an interactive Google Street View at the segment start. Nothing is captured until the
// person presses "Use this view".
import { live, repaintNav, goTo, type Stage } from './index';
import { project } from '../lib/project';
import { outputsStore, engine } from '../lib/engine';
import { bearing, type LngLat } from '../lib/providers';
import { GOOGLE_KEY } from '../lib/config';
import { head, task, esc } from './ui';
import { loadMaps } from '../lib/providers';
import { hiresStreetView } from '../lib/hires';

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

/** Feet from a point to the segment path. */
function offPath(pt: LngLat, path: LngLat[]): number {
  const kx = 364000 * Math.cos(pt[1] * Math.PI / 180), ky = 364000;
  const P = path.map(q => [(q[0] - pt[0]) * kx, (q[1] - pt[1]) * ky]);
  let best = Infinity;
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[i + 1] ?? a, dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
    const t = L2 ? Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / L2)) : 0;
    best = Math.min(best, Math.hypot(a[0] + t * dx, a[1] + t * dy));
  }
  return best;
}

/** A Street View photo taken somewhere other than this segment (left over from an earlier one) is dropped, with its curbs. True when it was dropped. */
export async function verifyPhoto(): Promise<boolean> {
  const seg = project.seg(), p = seg.perspective, path = (seg.path ?? []) as LngLat[];
  if (!p || p.source !== 'Google Street View' || path.length < 1) return false;
  let at = p.at as LngLat | undefined;
  try {
    if (!at) {
      const id = new URL(p.src).searchParams.get('pano'); if (!id) return false;
      const maps = await loadMaps();
      const ll = (await new maps.StreetViewService().getPanorama({ pano: id })).data.location.latLng;
      at = [ll.lng(), ll.lat()];
      project.update(() => { if (seg.perspective === p) p.at = at as [number, number]; });
    }
  } catch { return false; }
  if (offPath(at, path) <= 500) return false;
  project.update(() => { delete seg.perspective; delete seg.curbMarks; });
  outputsStore.curbs = undefined; outputsStore.streetview = undefined;
  return true;
}

(window as any).__hires = hiresStreetView;
let mode: 'idle' | 'sv' = 'idle';
/** The full instruction for an image model: vehicles out, curb and frontage rebuilt, colour touch-ups, same frame. */
export function editPrompt(w: number, h: number): string {
  return [
    `Edit the attached street photo and return ONE edited image at exactly the same framing, camera position, perspective, aspect ratio and size (${w} x ${h} px). Do not crop, zoom, rotate, widen or re-compose it.`,
    '',
    'REMOVE: every vehicle in the photo, parked and moving (cars, trucks, vans, buses, motorcycles, trailers), with their shadows and reflections. Also remove trash bins left in the roadway and any watermark or logo.',
    '',
    'REBUILD what the vehicles were hiding, matching the rest of the photo exactly:',
    '- Curb line: one continuous, sharp, straight curb and gutter on each side, running true to the visible curb on either side of each gap and to the vanishing point. The curb edge must be crisp, never smudged, blurred, wavy or broken. Keep painted curb colours where they exist.',
    '- Pavement: the same asphalt or concrete, with the existing lane lines, stop bars, crosswalks and pavement legends continued where they were hidden.',
    '- Parkway and sidewalk: the same grass, planting, tree wells, driveways and sidewalk scoring.',
    '- Frontage: the lower walls, fences, hedges, doors and windows of the buildings behind the vehicles, consistent with each building.',
    '',
    'DO NOT CHANGE: curb positions, street width, lane lines and pavement markings that are visible, signs, poles, trees, buildings, the sky, people on the sidewalk, or the time of day. Add nothing new: no vehicles, people, bike lanes, planters or street furniture.',
    '',
    'COLOUR TOUCH-UPS, subtle and natural: neutral white balance, even exposure, gently lifted shadows and recovered highlights, slightly more clarity and local contrast on the pavement and curbs, natural saturation, haze cleared from the distance. No filters, no HDR look, no vignette.',
    '',
    'The result must look like an unedited photograph of the same empty street. Return only the image.'
  ].join('\n');
}
const imageOf = (src: string) => fetch(src).then(x => { if (!x.ok) throw new Error('the photo could not be loaded'); return x.blob(); }).then(b => createImageBitmap(b));
async function pngOf(src: string): Promise<Blob> {
  const bm = await imageOf(src), c = document.createElement('canvas'); c.width = bm.width; c.height = bm.height;
  c.getContext('2d')!.drawImage(bm, 0, 0);
  return new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('the photo could not be prepared')), 'image/png'));
}
/** The edited picture, fitted back to the size of the photo it came from (centre-cropped if the model changed the shape). */
async function fitTo(file: File, w: number, h: number): Promise<{ src: string; reshaped: boolean }> {
  const bm = await createImageBitmap(file), c = document.createElement('canvas');
  // the edit often comes back sharper than the photo that went out: keep that detail, up to 1600 px wide, in the original shape
  const k = Math.max(1, Math.min(1600 / w, bm.width / w)); w = Math.round(w * k); h = Math.round(h * k); c.width = w; c.height = h;
  const ar = w / h, br = bm.width / bm.height; let sx = 0, sy = 0, sw = bm.width, sh = bm.height;
  if (br > ar) { sw = bm.height * ar; sx = (bm.width - sw) / 2; } else { sh = bm.width / ar; sy = (bm.height - sh) / 2; }
  const g = c.getContext('2d')!; g.imageSmoothingQuality = 'high'; g.drawImage(bm, sx, sy, sw, sh, 0, 0, w, h);
  return { src: c.toDataURL('image/jpeg', 0.9), reshaped: Math.abs(br / ar - 1) > 0.03 };
}
const CLEAR_KEY = 'sca-clear-cars';
let clearCars = (() => { try { return localStorage.getItem(CLEAR_KEY) === '1'; } catch { return false; } })();
let working = false;
const toDataUrl = (b: Blob) => new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result as string); fr.onerror = () => rej(new Error('The photo could not be read.')); fr.readAsDataURL(b); });
/** The same photo with the vehicles removed, by the engine (the rendering skill's own detector and fill). */
async function withoutCars<T extends { src: string; original?: string }>(ph: T): Promise<T & { original: string; cleared: number }> {
  const from = ph.original ?? ph.src;
  const blob = await fetch(from).then(x => { if (!x.ok) throw new Error('the photo could not be loaded'); return x.blob(); });
  const fd = new FormData(); fd.append('photo', blob, 'photo.jpg');
  const r = await engine.form('/api/photo/clear', fd) as { photo: string; removed?: number };
  const out = await fetch(engine.abs(r.photo)).then(x => x.blob()).then(toDataUrl);
  return { ...ph, src: out, original: from, cleared: r.removed ?? 0 };
}
let dropped = false;
export const photoStage: Stage = {
  id: 'photo', name: 'Photo',
  done: () => !!project.seg().perspective,
  render(side, canvas) {
    const gen = live.gen, seg = project.seg(), p = seg.perspective;
    const path = (seg.path ?? []) as LngLat[];
    let pano: any = null, msgText = dropped ? 'The earlier photo was taken on a different street, so it was removed. Choose a photo for this segment.' : '';
    dropped = false;
    if (p) verifyPhoto().then(gone => { if (gone && gen === live.gen) { dropped = true; repaintNav(); photoStage.render(side, canvas); } });
    const setPhoto = (ph: NonNullable<typeof p>) => {
      project.update(() => { seg.perspective = ph; delete seg.curbMarks; });
      outputsStore.curbs = undefined; outputsStore.streetview = undefined;   // new photo: curbs start over
      mode = 'idle'; repaintNav(); goTo('visualize');   // approved: straight on to the curbs
    };
    const approve = async (ph: NonNullable<typeof p>, clean = clearCars) => {
      if (!clean) { setPhoto(ph); return; }
      if (working) return;
      working = true; say('Removing the cars from the photo… about half a minute.');
      side.querySelectorAll('button').forEach(x => ((x as HTMLButtonElement).disabled = true));
      try {
        const c = await withoutCars(ph);
        working = false;
        if (gen !== live.gen) { project.update(() => { seg.perspective = c; delete seg.curbMarks; }); return; }
        setPhoto(c);
      } catch (err) {
        working = false;
        if (gen !== live.gen) return;
        project.update(() => { seg.perspective = ph; delete seg.curbMarks; });
        outputsStore.curbs = undefined; outputsStore.streetview = undefined; mode = 'idle'; repaintNav();
        dropped = false; photoStage.render(side, canvas);
        const m = side.querySelector('#msg'); if (m) m.textContent = 'The photo is saved, but the cars could not be removed (' + (err as Error).message + '). You can mark the curbs on it as it is.';
      }
    };
    const paint = () => {
      const picking = !p || mode === 'sv';
      side.innerHTML = `${head(4, 'Photo', 'The street photo the concepts are rendered on.')}
        ${task(1, 'Choose the source', p && mode === 'idle' ? 'done' : 'now', `
          <div class="row"><button class="btn${mode === 'sv' ? '' : ' ghost'}" id="sv">Google Street View</button><label class="btn ghost">Upload a photo<input id="file" type="file" accept="image/*" hidden></label></div>
          <p class="note">Upload any eye-level photo looking along the street.</p>
          <label class="check-row"><input type="checkbox" id="clear"${clearCars ? ' checked' : ''}> Remove cars from the photo before marking curbs</label>`)}
        ${task(2, 'Approve the photo', p && mode === 'idle' ? 'done' : mode === 'sv' ? 'now' : 'later', mode === 'sv' ? `
          <p class="note">Street View is open at the start of your segment. Drag to turn, click the arrows on the road to move, scroll to zoom. Look straight along the street with both curbs in view. Nothing is captured until you approve.</p>
          <div class="row"><button class="btn" id="use">Use this view</button>${p ? '<button class="linkbtn" id="cancel">Keep the current photo</button>' : ''}</div>` : p ? `
          <div class="mini"><img src="${esc(p.src)}" alt="Approved photo"><div><b class="okline">Photo approved</b><br><span class="note">${esc(p.source)}${p.credit ? ' · ' + esc(p.credit) : ''}${p.original ? ` · ${p.edited ? 'your edited version' : p.cleared ? p.cleared + ' vehicle' + (p.cleared === 1 ? '' : 's') + ' removed' : 'no vehicles found'}` : ''}</span></div></div>

          <p class="note">To change it, choose a source again above. Changing the photo clears the curbs.</p>` : '<p class="note">Choose a source first.</p>')}
        ${p && mode === 'idle' ? task(3, 'Clean up the photo (optional)', 'now', `
          <p class="note">ChatGPT or Gemini removes the cars, rebuilds the curbs and frontage and touches up the colour. The instruction is written for you.</p>
          <div class="row"><button class="btn" id="gpt" title="Opens ChatGPT with the instruction filled in and the photo copied: paste it with Ctrl+V, then send">1. Open ChatGPT</button><button class="btn ghost" id="gem" title="Opens Gemini with the instruction copied and the photo downloaded: paste the instruction, attach the photo, then send">or Gemini</button><label class="btn" title="Bring the edited image back; it becomes the photo">2. Upload the result<input id="edited" type="file" accept="image/*" hidden></label></div>
          <div class="row minor"><button class="linkbtn" id="cpP">Copy the instruction</button><button class="linkbtn" id="cpI">Copy the photo</button><button class="linkbtn" id="dlI">Download the photo</button></div>
          <p class="note">Quicker and rougher, here: ${p.original ? '<button class="linkbtn" id="restore">restore the original photo</button>' : '<button class="linkbtn" id="clearnow">remove the cars automatically</button>'}</p>`) : ''}
        <p class="note" id="msg" role="status">${esc(msgText)}</p>`;
      void picking;
      const $ = (q: string) => side.querySelector(q) as HTMLElement | null;
      $('#clear')!.addEventListener('change', e => { clearCars = (e.target as HTMLInputElement).checked; try { localStorage.setItem(CLEAR_KEY, clearCars ? '1' : '0'); } catch { /* ignore */ } });
      // the photo as taken goes out for editing, never an earlier edit of it
      const srcOut = () => p!.original ?? p!.src;
      const dims = async () => { const bm = await imageOf(srcOut()); return [bm.width, bm.height] as const; };
      const copyText = (t: string) => navigator.clipboard.writeText(t);
      const copyPhoto = async () => navigator.clipboard.write([new ClipboardItem({ 'image/png': pngOf(srcOut()) })]);
      const download = async () => { const b = await pngOf(srcOut()), a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'street-photo.png'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
      // copy first (the page must still have focus), then open: both happen inside the click's own few seconds of permission
      const openTo = (url: string, okText: string) => {
        const win = window.open(url, '_blank');
        const m = side.querySelector('#msg');
        if (win) say(okText);
        else if (m) { m.innerHTML = `Your browser blocked the new tab. <a href="${esc(url)}" target="_blank" rel="noopener">Open it here</a>. ${esc(okText)}`; }
      };
      $('#gpt')?.addEventListener('click', async () => {
        try {
          const [w, h] = await dims(); let pasted = true;
          await copyPhoto().catch(async () => { pasted = false; await download(); });
          openTo('https://chatgpt.com/?prompt=' + encodeURIComponent(editPrompt(w, h)), pasted ? 'ChatGPT is open with the instruction filled in. Paste the photo there (Ctrl+V), send, save the result, then upload it here.' : 'ChatGPT is open with the instruction filled in. Attach the downloaded photo (street-photo.png), send, save the result, then upload it here.');
        } catch (err) { say('Could not prepare the photo: ' + (err as Error).message); }
      });
      $('#gem')?.addEventListener('click', async () => {
        try {
          const [w, h] = await dims(); await copyText(editPrompt(w, h)); await download();
          openTo('https://gemini.google.com/app', 'Gemini is open. Paste the instruction (Ctrl+V), attach the downloaded photo (street-photo.png), send, save the result, then upload it here.');
        } catch (err) { say('Could not prepare the photo: ' + (err as Error).message); }
      });
      $('#cpP')?.addEventListener('click', async () => { try { const [w, h] = await dims(); await copyText(editPrompt(w, h)); say('Instruction copied.'); } catch (err) { say((err as Error).message); } });
      $('#cpI')?.addEventListener('click', () => copyPhoto().then(() => say('Photo copied.'), err => say('The photo could not be copied (' + (err as Error).message + '). Use Download instead.')));
      $('#dlI')?.addEventListener('click', () => download().catch(err => say((err as Error).message)));
      $('#edited')?.addEventListener('change', async e => {
        const f = (e.target as HTMLInputElement).files?.[0]; if (!f || !p) return;
        try {
          const [w, h] = await dims(), r = await fitTo(f, w, h);
          const { cleared: _c, ...rest } = p;
          setPhoto({ ...rest, src: r.src, original: srcOut(), edited: true });
        } catch (err) { say('That file could not be used: ' + (err as Error).message); }
      });
      $('#clearnow')?.addEventListener('click', () => { if (p) approve(p, true); });
      $('#restore')?.addEventListener('click', () => { if (p?.original) { const { original, cleared: _c, edited: _e, ...rest } = p; setPhoto({ ...rest, src: original }); } });
      $('#sv')!.addEventListener('click', () => { mode = 'sv'; paint(); openSv(); });
      $('#cancel')?.addEventListener('click', () => { mode = 'idle'; photoStage.render(side, canvas); });
      $('#file')!.addEventListener('change', async e => {
        const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return;
        try { await approve({ src: await readImage(f), source: 'Upload', credit: f.name }); } catch (err) { msgText = (err as Error).message; paint(); }
      });
      $('#use')?.addEventListener('click', async () => {
        if (!pano) { msgText = 'Street View is still loading.'; paint(); return; }
        if (working) return;
        const pov = pano.getPov(), id = pano.getPano(), fov = Math.max(20, Math.min(120, 180 / Math.pow(2, pano.getZoom() ?? 1)));
        const loc = pano.getLocation?.()?.latLng, h = ((pov.heading % 360) + 360) % 360;
        const base = {
          source: 'Google Street View', credit: '© Google', heading: h, at: loc ? [loc.lng(), loc.lat()] as [number, number] : undefined,
          link: loc ? `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${loc.lat()},${loc.lng()}&heading=${h.toFixed(0)}` : undefined
        };
        working = true; say('Capturing the view at full resolution…');
        side.querySelectorAll('button').forEach(x => ((x as HTMLButtonElement).disabled = true));
        let src: string;
        try { src = await hiresStreetView(id, h, pov.pitch, fov, GOOGLE_KEY, (a, b) => say(`Capturing the view at full resolution… ${a} of ${b}`)); }
        catch {   // the single frame Google serves directly: coarser, but never a dead end
          src = `https://maps.googleapis.com/maps/api/streetview?size=640x400&scale=2&pano=${id}&heading=${h.toFixed(1)}&pitch=${pov.pitch.toFixed(1)}&fov=${fov.toFixed(0)}&key=${GOOGLE_KEY}`;
        }
        working = false;
        if (gen !== live.gen) return;
        approve({ src, ...base });
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
    if (!p && path.length) mode = 'sv';   // no photo yet: Street View opens right away
    paint();
    if (mode === 'sv') openSv();
    else if (p) canvas.innerHTML = `<div class="persp-wrap"><figure class="persp"><img src="${esc(p.src)}" alt="Approved photo"><figcaption>${esc(p.source)}${p.credit ? ' · ' + esc(p.credit) : ''}. Next: Curbs.</figcaption></figure></div>`;
    else canvas.innerHTML = '<div class="empty">Choose Google Street View or upload a photo.</div>';
  }
};
