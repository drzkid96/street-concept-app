// Perspective concept overlay, auto-scaled from camera geometry.
// Ground point (X lateral ft from camera, Z ft ahead) projects to u = cx + f·X/Z, v = horizon + f·h/Z,
// with f = (W/2)/tan(FOV/2). Street View captures know FOV (80°) and pitch (0 → horizon mid-frame).
// Two curb clicks solve camera height and lateral position exactly from the section's curb-to-curb width.
import { live, type Stage } from './index';
import { project } from '../lib/project';
import { sectionSvg } from '../lib/sectionSvg';
import { CONVENTIONS, materialOf } from '../lib/standards';
import { groundPolys, laneGlyph } from '../lib/glyph';
import { engine, outputsStore } from '../lib/engine';
import type { Section, Segment, Perspective } from '../lib/types';

const esc = (t: string) => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const ROAD = new Set(['parking', 'bike_lane', 'bike_buffer', 'travel_lane', 'turn_lane', 'bus_lane', 'shoulder', 'separated_bikeway']);
// Only treatments are tinted; existing pavement and sidewalks stay as photographed.
const COLOR: Record<string, string> = { bike_lane: '#2E8B57', separated_bikeway: '#2E8B57', bus_lane: '#C8102E', median: '#7FA65A', parkway: '#7FA65A' };

export interface Cam { fov: number; h: number; xcam: number; horizon: number; cx: number }

function readImage(file: File, max = 1800): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', 0.88));
    };
    img.onerror = () => reject(new Error('Could not read that image'));
    img.src = URL.createObjectURL(file);
  });
}
async function toDataUrl(src: string): Promise<string> {
  if (src.startsWith('data:')) return src;
  const b = await fetch(src).then(r => { if (!r.ok) throw new Error(`Image ${r.status}`); return r.blob(); });
  return new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result as string); fr.readAsDataURL(b); });
}

// Default camera: Street View car (8.2 ft, 80° FOV) in the innermost outbound lane; uploads: pedestrian at 5.5 ft, 65° FOV on the near sidewalk.
export function defaultCam(p: Perspective, sec: Section): Cam {
  const sv = p.source === 'Google Street View';
  let x = 0, xcam = 0, firstOut = -1;
  sec.elements.forEach(e => { if (firstOut < 0 && e.direction === 'outbound' && e.type === 'travel_lane') firstOut = x + e.width_ft / 2; x += e.width_ft; });
  if (sv) xcam = firstOut >= 0 ? firstOut : x / 2;
  else xcam = x / 2; // photos are usually taken from a crosswalk or median, looking down the street
  const vp = p.vp;
  return { fov: sv ? 80 : 65, h: sv ? 8.2 : 5.5, xcam, horizon: vp ? vp[1] : sv ? 0.5 : 0.45, cx: vp ? vp[0] : 0.5 };
}

export function overlay(sec: Section, cam: Cam, W: number, H: number, opacity: number) {
  const f = (W / 2) / Math.tan(cam.fov * Math.PI / 360), yh = cam.horizon * H, cx = cam.cx * W;
  const zNear = Math.max(4, f * cam.h / (H - yh)), zFar = 320;
  const P = (x: number, z: number) => [cx + f * (x - cam.xcam) / z, yh + f * cam.h / z];
  const quad = (x0: number, x1: number, z0 = zNear, z1 = zFar) => [P(x0, z0), P(x1, z0), P(x1, z1), P(x0, z1)].map(p => p.map(n => n.toFixed(1)).join(',')).join(' ');
  let x = 0;
  const lanes: string[] = [], fills: string[] = [], text: string[] = [], posts: string[] = [];
  sec.elements.forEach((e, i) => {
    const x0 = x, x1 = x + e.width_ft, mat = materialOf(e.type, e.material);
    const col = mat === 'unpainted' ? null : (e.type === 'median' && mat === 'concrete') ? '#D8D4C8' : COLOR[e.type];
    if (col) fills.push(`<polygon points="${quad(x0, x1)}" fill="${col}" fill-opacity="${opacity}"/>`);
    if (e.type === 'bus_lane' && mat !== 'unpainted') {
      const z = Math.max(zNear * 1.8, 45), [u, v] = P((x0 + x1) / 2, z), wpx = f * e.width_ft * 0.6 / z;
      text.push(`<text x="${u.toFixed(1)}" y="${v.toFixed(1)}" font-size="${(wpx / 4.6).toFixed(1)}" text-anchor="middle" fill="#fff" font-family="Albert Sans, sans-serif" font-weight="700" transform="translate(${u.toFixed(1)} ${v.toFixed(1)}) scale(1 .35) translate(${(-u).toFixed(1)} ${(-v).toFixed(1)})">${CONVENTIONS.bus_lane_text}</text>`);
    }
    // CA MUTCD markings (skill glyph set) laid on the ground plane, so they foreshorten like real paint
    const gname = laneGlyph(e.type, e.direction);
    if (gname && (e.direction !== 'none' || gname === 'twltl')) {
      const dir: 1 | -1 = e.direction === 'inbound' ? -1 : 1, xc = (x0 + x1) / 2;
      for (const z0 of [Math.max(zNear * 1.3, 22), Math.max(zNear * 1.3, 22) + 110]) {
        // bike lane legend: bicycle (72 in), 72 in gap, arrow downstream (CA MUTCD Fig 9E-1)
        const set = gname === 'arrow' ? [...groundPolys('bike', xc, dir === 1 ? z0 : z0 + 12, dir), ...groundPolys('arrow', xc, dir === 1 ? z0 + 12 : z0, dir)] : groundPolys(gname, xc, z0, dir);
        for (const poly of set) text.push(`<polygon points="${poly.map(([gx, gz]) => P(gx, gz).map(n => n.toFixed(1)).join(',')).join(' ')}" fill="#fff" fill-opacity=".92"/>`);
      }
    }
    if (mat === 'posts') for (let z = Math.max(zNear * 1.2, 12); z < 200; z += 20) {
      const totalW = sec.elements.reduce((a, q) => a + q.width_ft, 0);
      const px = e.type === 'separated_bikeway' ? ((x0 + x1) / 2 < totalW / 2 ? x1 - 0.75 : x0 + 0.75) : (x0 + x1) / 2, [u, v] = P(px, z), hpx = f * 3 / z;
      posts.push(`<rect x="${(u - hpx * 0.06).toFixed(1)}" y="${(v - hpx).toFixed(1)}" width="${(hpx * 0.12).toFixed(1)}" height="${hpx.toFixed(1)}" fill="#fff" stroke="#C8102E" stroke-width="${(hpx * 0.03).toFixed(2)}"/>`);
    }
    const prev = sec.elements[i - 1];
    if (prev && ROAD.has(prev.type) && ROAD.has(e.type)) {
      const opp = prev.direction !== e.direction && ['inbound', 'outbound'].includes(prev.direction) && ['inbound', 'outbound'].includes(e.direction);
      const solid = opp || e.type.includes('bike') || prev.type.includes('bike') || e.type === 'bus_lane' || prev.type === 'bus_lane';
      const color = opp ? '#F2C200' : '#fff';
      const line = (xx: number) => {
        if (solid) lanes.push(`<polygon points="${quad(xx - 0.17, xx + 0.17)}" fill="${color}"/>`);
        else for (let z = zNear; z < zFar; z += 40) lanes.push(`<polygon points="${quad(xx - 0.17, xx + 0.17, z, Math.min(z + 10, zFar))}" fill="${color}"/>`);
      };
      if (opp) { line(x0 - 0.35); line(x0 + 0.35); } else line(x0);
    }
    x = x1;
  });
  return [{ layer: 'surface-colour', svg: fills.join('') }, { layer: 'striping', svg: lanes.join('') }, { layer: 'legends', svg: text.join('') }, { layer: 'separators', svg: posts.join('') }];
}

export const visualizeStage: Stage = {
  id: 'visualize', name: 'Visualize',
  render(side, canvas) {
    const gen = live.gen;
    const seg: Segment = project.seg();
    const alts = seg.alternatives;
    let which = alts.length ? 0 : -1;
    const sec = () => which >= 0 ? alts[which].section : seg.existing;
    const p = seg.perspective;
    let cam: Cam | null = p ? { ...defaultCam(p, sec()), ...(p.cam ?? {}) } : null;
    let opacity = 0.55, mode: 'vp' | 'curbL' | 'curbR' | null = null;
    let clickL: [number, number] | null = null;

    side.innerHTML = `<h2>5. VISUALIZE</h2>
      <div id="eng"></div>
      <label class="drop" id="drop" tabindex="0"><input id="file" type="file" accept="image/*" hidden><b>Upload perspective image</b><span class="note">Photo or rendering, JPG or PNG, or drop it here</span></label>
      <div class="row"><a class="btn ghost" href="#site">Capture street view</a>${p ? '<button class="btn ghost" id="rm">Remove image</button>' : ''}</div>
      ${p ? `
      <div class="field"><label for="alt">Concept to render</label><select id="alt">${alts.map((a, i) => `<option value="${i}"${i === which ? ' selected' : ''}>${esc(a.name)}</option>`).join('')}<option value="-1"${which < 0 ? ' selected' : ''}>Existing</option></select></div>
      <h3>AUTO-SCALE</h3>
      <p class="note">Scaled from camera geometry${p.source === 'Google Street View' ? ' (Street View: 80° view, 8.2 ft camera, centered on the horizon)' : ' (photo defaults: 65° view, 5.5 ft eye height, street center)'}. For an exact fit, click the two curb lines near the bottom of the image.</p>
      <div class="row"><button class="btn ghost" data-m="curbL">Fit to curbs</button><button class="btn ghost" data-m="vp">Set horizon point</button></div>
      <div class="field"><label for="fov">Field of view <span id="fovV"></span></label><input id="fov" type="range" min="30" max="110" step="1"></div>
      <div class="field"><label for="ch">Camera height <span id="chV"></span></label><input id="ch" type="range" min="3" max="40" step="0.1"></div>
      <div class="field"><label for="cx">Camera position across section <span id="cxV"></span></label><input id="cx" type="range" min="-20" step="0.5"></div>
      <div class="field"><label for="op">Overlay opacity <span id="opV"></span></label><input id="op" type="range" min="0.1" max="1" step="0.05"></div>
      <div class="row"><button class="btn ghost" id="reset">Reset auto-scale</button></div>
      <div class="row"><button class="btn" id="save">Save rendering to sheets</button></div>` : ''}
      <p id="msg" class="note" role="status"></p>`;
    const $ = <T extends HTMLElement>(s: string) => side.querySelector(s) as T | null;
    const msg = (t: string) => { $('#msg')!.textContent = t; };

    let imgEl: HTMLImageElement | null = null;
    const persist = () => project.update(() => { if (seg.perspective && cam) seg.perspective.cam = { ...cam }; });
    const sync = () => {
      if (!cam) return;
      const total = sec().elements.reduce((a, e) => a + e.width_ft, 0);
      ($('#fov') as HTMLInputElement).value = String(cam.fov); $('#fovV')!.textContent = `${cam.fov}°`;
      ($('#ch') as HTMLInputElement).value = String(cam.h); $('#chV')!.textContent = `${cam.h.toFixed(1)} ft`;
      const cxI = $('#cx') as HTMLInputElement; cxI.max = String(total + 20); cxI.value = String(cam.xcam); $('#cxV')!.textContent = `${cam.xcam.toFixed(1)} ft from left edge`;
      ($('#op') as HTMLInputElement).value = String(opacity); $('#opV')!.textContent = `${Math.round(opacity * 100)}%`;
    };
    const svgMarkup = (W: number, H: number, withImage: string | null, cls = '') => {
      const layers = overlay(sec(), cam!, W, H, opacity);
      return `<svg xmlns="http://www.w3.org/2000/svg" ${cls} viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
        ${withImage ? `<g id="photo"><image href="${withImage}" width="${W}" height="${H}"/></g>` : ''}
        <defs><clipPath id="below"><rect x="0" y="${(cam!.horizon * H).toFixed(1)}" width="${W}" height="${H}"/></clipPath></defs>
        <g clip-path="url(#below)">${layers.map(l => `<g id="${l.layer}">${l.svg}</g>`).join('')}</g></svg>`;
    };
    const draw = () => {
      if (!p || !cam) { canvas.innerHTML = `<div class="empty">No perspective image yet.<br>Upload one, or capture street view in Site.</div>`; return; }
      if (!imgEl) {
        canvas.innerHTML = `<div class="persp-wrap"><figure class="persp"><div class="pimg"><img alt="Perspective view (${esc(p.source)})"><div class="ovl" id="ov"></div></div>
          <figcaption>${esc(p.source)}${p.credit ? ' · ' + esc(p.credit) : ''}${p.link ? ` · <a href="${esc(p.link)}" target="_blank" rel="noopener">open</a>` : ''}</figcaption></figure><div id="secv"></div></div>`;
        imgEl = canvas.querySelector('.pimg img') as HTMLImageElement;
        imgEl.crossOrigin = 'anonymous';
        imgEl.onload = () => { if (gen === live.gen) draw(); };
        imgEl.onerror = () => msg('The image could not be loaded.');
        imgEl.src = p.src;
        imgEl.addEventListener('click', onClick);
        return;
      }
      if (!imgEl.naturalWidth) return;
      const W = imgEl.naturalWidth, H = imgEl.naturalHeight;
      (canvas.querySelector('#ov') as HTMLElement).innerHTML = svgMarkup(W, H, null, 'class="vp" preserveAspectRatio="none"') +
        `<svg class="vp" viewBox="0 0 100 100" preserveAspectRatio="none"><circle cx="${cam.cx * 100}" cy="${cam.horizon * 100}" r=".9" fill="#6BD688" stroke="#00242E" stroke-width=".3"/></svg>`;
      (canvas.querySelector('#secv') as HTMLElement).innerHTML = sectionSvg(sec(), which >= 0 ? alts[which].name : 'Existing');
    };
    function onClick(e: MouseEvent) {
      if (!imgEl || !cam || !mode) return;
      const r = imgEl.getBoundingClientRect(), fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
      if (mode === 'vp') { cam.cx = fx; cam.horizon = fy; mode = null; msg('Horizon point set.'); }
      else {
        const W = imgEl.naturalWidth, H = imgEl.naturalHeight, u = fx * W, v = fy * H;
        if (v <= cam.horizon * H + 2) { msg('Click below the horizon, on the curb line near the bottom of the image.'); return; }
        if (mode === 'curbL') { clickL = [u, v]; mode = 'curbR'; msg('Now click the right curb line.'); return; }
        if (mode === 'curbR' && clickL) {
          const els = sec().elements; let x = 0, xL = NaN, xR = NaN;
          els.forEach(el => { if (ROAD.has(el.type) && isNaN(xL)) xL = x; x += el.width_ft; if (ROAD.has(el.type)) xR = x; });
          const cx = cam.cx * W, yh = cam.horizon * H;
          const a = (clickL[0] - cx) / (clickL[1] - yh), b = (u - cx) / (v - yh);
          const h = (xR - xL) / (b - a);
          mode = null; clickL = null;
          if (!(h > 1 && h < 60)) { msg('Those clicks do not fit this section. Check the horizon point and try again.'); return; }
          cam.h = +h.toFixed(2); cam.xcam = +(xL - h * a).toFixed(2);
          msg(`Fitted to ${xR - xL}' curb to curb: camera ${cam.h.toFixed(1)} ft high, ${cam.xcam.toFixed(1)} ft from the left edge.`);
        }
      }
      persist(); sync(); draw();
    }

    const take = async (file?: File | null) => {
      if (!file || !file.type.startsWith('image/')) return;
      msg('Loading…');
      try {
        const src = await readImage(file);
        project.update(() => { seg.perspective = { src, source: 'Upload', credit: file.name }; });
        if (gen === live.gen) visualizeStage.render(side, canvas);
      } catch (err) { msg((err as Error).message); }
    };
    const drop = $('#drop')!;
    $('#file')!.addEventListener('change', e => take((e.target as HTMLInputElement).files?.[0]));
    drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ($('#file') as HTMLInputElement).click(); } });
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); take(e.dataTransfer?.files?.[0]); });
    $('#rm')?.addEventListener('click', () => { project.update(() => { delete seg.perspective; }); visualizeStage.render(side, canvas); });

    if (p && cam) {
      $('#alt')!.addEventListener('change', e => { which = +(e.target as HTMLSelectElement).value; sync(); draw(); });
      side.querySelectorAll<HTMLButtonElement>('[data-m]').forEach(b => b.addEventListener('click', () => { mode = b.dataset.m as typeof mode; clickL = null; msg(mode === 'vp' ? 'Click the point where the street meets the horizon.' : 'Click the left curb line near the bottom of the image.'); }));
      const num = (id: string, set: (v: number) => void) => $(id)!.addEventListener('input', e => { set(+(e.target as HTMLInputElement).value); persist(); sync(); draw(); });
      num('#fov', v => { cam!.fov = v; }); num('#ch', v => { cam!.h = v; }); num('#cx', v => { cam!.xcam = v; }); num('#op', v => { opacity = v; });
      $('#reset')!.addEventListener('click', () => { cam = defaultCam(p, sec()); persist(); sync(); draw(); msg('Auto-scale reset.'); });
      const compose = async () => {
        if (!imgEl?.naturalWidth) throw new Error('Image not loaded');
        const W = imgEl.naturalWidth, H = imgEl.naturalHeight;
        const photo = await toDataUrl(p.src);
        const svg = svgMarkup(W, H, photo);
        const img = new Image();
        await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('Could not compose the rendering')); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); });
        const c = document.createElement('canvas'); c.width = W; c.height = H;
        c.getContext('2d')!.drawImage(img, 0, 0);
        return { jpg: c.toDataURL('image/jpeg', 0.88) };
      };
      $('#save')!.addEventListener('click', async () => {
        if (which < 0) { msg('Pick an alternative to save its rendering.'); return; }
        msg('Composing…');
        try { const r = await compose(); project.update(() => { alts[which].render = r.jpg; }); msg(`Saved to "${alts[which].name}" for the sheets.`); }
        catch (err) { msg((err as Error).message); }
      });
      sync();
    }
    draw();
    engine.check().then(on => { if (on && p && gen === live.gen) engineRender(side.querySelector('#eng') as HTMLElement, canvas, seg, p); });
  }
};

// ---------------------------------------------------------------- engine: fp-render-curbs Curb Guide + fp-render-streetview, unchanged
const LOOK = ['north', 'east', 'south', 'west'];
function engineRender(box: HTMLElement, canvas: HTMLElement, seg: Segment, p: Perspective) {
  const gen = live.gen;
  const road = seg.existing.elements.filter(e => !['sidewalk', 'parkway', 'curb'].includes(e.type)).reduce((a, e) => a + e.width_ft, 0);
  const h = seg.location?.heading ?? p.heading ?? 0;
  box.innerHTML = `<div class="srcbar"><b>FP rendering (engine)</b><br>fp-render-streetview renders every alternative on this photo with FP assets, then builds the concept-sheet PDF. Curbs come first: mark them in the Curb Guide and press <b>Copy all</b> to approve.</div>
    <div class="field"><label for="w">Curb to curb (ft)</label><input id="w" type="number" min="20" max="160" step="0.5" value="${road || 40}"></div>
    <div class="field"><label for="look">Looking</label><select id="look">${LOOK.map(x => `<option${x === LOOK[Math.round(h / 90) % 4] ? ' selected' : ''}>${x}</option>`).join('')}</select></div>
    <div class="row"><button class="btn" id="guide">Open Curb Guide</button><button class="btn" id="render" disabled>Render concepts</button></div>
    <p class="note" id="emsg" role="status"></p><div id="eout"></div>`;
  const $ = (q: string) => box.querySelector(q) as HTMLInputElement;
  const msg = (t: string) => { box.querySelector('#emsg')!.textContent = t; };
  let approved = false;
  const ready = () => { ($('#render') as unknown as HTMLButtonElement).disabled = !(outputsStore.curbJob && approved); };
  // Curbs count as approved once the person presses Copy all in the guide (the marks reach the engine)
  const poll = window.setInterval(async () => {
    if (!outputsStore.curbJob || approved) return;
    try { const r = await fetch(engine.abs(`/api/curbs/${outputsStore.curbJob}/marks`)).then(x => x.json()); if (r.ok) { approved = true; msg('Curbs approved. Ready to render.'); ready(); } } catch { /* engine busy */ }
  }, 2500);
  ready();
  const showPdfs = () => {
    const o = outputsStore.streetview;
    box.querySelector('#eout')!.innerHTML = o ? o.pdfs.map(f => `<a class="btn ghost" target="_blank" rel="noopener" href="${engine.abs(f.url)}">${esc(f.name)}</a>`).join(' ') : '';
  };
  showPdfs();
  const onMsg = async (ev: MessageEvent) => {
    if (ev.data?.type !== 'curbs-marks' || ev.data.job !== outputsStore.curbJob) return;
    approved = true; msg('Curbs approved. Ready to render.'); ready();
  };
  window.addEventListener('message', onMsg);
  visualizeStage.dispose = () => { window.removeEventListener('message', onMsg); clearInterval(poll); };
  $('#guide').addEventListener('click', async () => {
    msg('Preparing the Curb Guide (AI prefill)…');
    try {
      const blob = await fetch(p.src).then(r => r.blob());
      const fd = new FormData(); fd.append('photo', blob, 'photo.jpg'); fd.append('width', $('#w').value);
      const r = await engine.form('/api/curbs/helper', fd);
      if (gen !== live.gen) return;
      outputsStore.curbJob = r.job; approved = false; ready();
      canvas.innerHTML = `<iframe class="guide" title="Curb Guide" src="${engine.abs(r.guide)}"></iframe>`;
      msg('Mark the curbs, then press Copy all in the guide to approve them.');
    } catch (err) { msg((err as Error).message); }
  });
  $('#render').addEventListener('click', async () => {
    msg('Rendering with fp-render-streetview (solving curbs, removing photo cars, rendering, sections, sheet). This can take a few minutes…');
    ($('#render') as unknown as HTMLButtonElement).disabled = true;
    try {
      const pf = project.get();
      const r = await engine.json('/api/streetview/run', { job: outputsStore.curbJob, project: pf, street: seg.limits.from || pf.project.name, looking: $('#look').value, title: pf.project.name });
      if (gen !== live.gen) return;
      outputsStore.streetview = { job: r.job, pdfs: r.pdfs };
      const renders = r.files.filter((f: any) => /_T\d+\.png$/.test(f.name));
      canvas.innerHTML = `<div class="persp-wrap">${renders.map((f: any) => `<figure class="persp"><img src="${engine.abs(f.url)}" alt="${esc(f.name)}"><figcaption>${esc(f.name)}</figcaption></figure>`).join('') || '<div class="empty">No renders yet</div>'}</div>`;
      msg(r.ok ? 'Rendered. Concept sheets are ready below.' : 'Stopped at ' + (r.steps.find((s: any) => !s[1]) || ['?'])[0] + ': ' + r.log.split('\n').slice(-4).join(' '));
      showPdfs();
    } catch (err) { msg((err as Error).message); }
    ready();
  });
}
