// Render: photo → curbs (person approves, AI optional) → fp-render-streetview renders and concept sheet.
// The Curb Guide is the fp-render-curbs page served unchanged; the engine's bridge script reports its
// state here and takes Approve / Accept / Clear commands, so the whole flow is driven from this sidebar.
import { live, repaintNav, type Stage } from './index';
import { project } from '../lib/project';
import { engine, outputsStore, type CurbStatus } from '../lib/engine';
import { settings, saveSettings, streetImage, bearing, type LngLat } from '../lib/providers';
import { head, task, more, esc } from './ui';
import type { Segment, Perspective } from '../lib/types';

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
    img.onerror = () => reject(new Error('That file could not be read as an image.'));
    img.src = URL.createObjectURL(file);
  });
}

const LOOK = ['north', 'east', 'south', 'west'];
const opt = (v: string, label: string, cur: string) => `<option value="${v}"${v === cur ? ' selected' : ''}>${label}</option>`;
let curbChoice: 'manual' | 'ai' = 'manual';
let changing = false;
let rendering = false;

export const visualizeStage: Stage = {
  id: 'visualize', name: 'Render',
  done: () => !!outputsStore.streetview,
  async render(side, canvas) {
    const gen = live.gen;
    if (!engine.on) { side.innerHTML = head(5, 'Render', 'Connecting to the engine…'); await engine.check(); if (gen !== live.gen) return; }
    const seg: Segment = project.seg();
    const p: Perspective | undefined = seg.perspective;
    const road = seg.existing.elements.filter(e => !['sidewalk', 'parkway', 'curb'].includes(e.type)).reduce((a, e) => a + e.width_ft, 0) || 40;
    const heading = seg.location?.heading ?? p?.heading ?? 0;
    let look = LOOK[Math.round(heading / 90) % 4];
    const cb = () => (outputsStore.curbs && p && outputsStore.curbs.photo === p.src) ? outputsStore.curbs : undefined;
    let msgText = '';

    if (!engine.on) {
      side.innerHTML = `${head(5, 'Render', 'Puts each alternative onto a street photo.')}<p class="badge warn">The rendering engine is not responding.</p><div class="row"><button class="btn" id="retry">Try again</button></div>`;
      side.querySelector('#retry')!.addEventListener('click', async () => { await engine.check(); visualizeStage.render(side, canvas); });
      canvas.innerHTML = '<div class="empty">Waiting for the engine.</div>';
      return;
    }

    // ---------- sidebar
    const paint = () => {
      const keepOpen = (side.querySelector('details.more') as HTMLDetailsElement | null)?.open;
      const c = cb(), st = c?.status, approved = !!c?.approved;
      const s1 = p ? 'done' : 'now', s2 = !p ? 'later' : approved ? 'done' : 'now', s3 = !approved ? 'later' : outputsStore.streetview ? 'done' : 'now';
      side.innerHTML = `${head(5, 'Render', 'Puts each alternative onto a street photo. Three steps: choose a photo, mark the curbs, render.')}
        ${task(1, 'Choose a photo', s1, p && !changing ? `
          <div class="mini"><img src="${esc(p.src)}" alt="Selected photo"><div><span class="note">${esc(p.source)}${p.credit ? ' · ' + esc(p.credit) : ''}</span><br><button class="linkbtn" id="chg">Change photo</button></div></div>` : `
          <div class="row"><button class="btn" id="sv">Use Street View</button><label class="btn ghost">Upload a photo<input id="file" type="file" accept="image/*" hidden></label>${p ? '<button class="linkbtn" id="keep">Keep the current photo</button>' : ''}</div>
          <p class="note">Street View looks along your segment from its start. Upload works for any eye-level street photo or rendering.</p>`)}
        ${task(2, 'Mark the curbs', s2, !p ? '<p class="note">Choose a photo first.</p>' : !c ? `
          <p class="note">The renderer needs to know exactly where both curbs are. Choose how to start:</p>
          <fieldset class="choice">
            <label><input type="radio" name="cm" value="manual"${curbChoice === 'manual' ? ' checked' : ''}><span><b>I will mark them</b><small>Click along each curb on the photo. Most reliable.</small></span></label>
            <label><input type="radio" name="cm" value="ai"${curbChoice === 'ai' ? ' checked' : ''}><span><b>Let AI find them</b><small>AI suggests curb lines. You accept them or fix them.</small></span></label>
          </fieldset>
          <div class="field"><label for="w">Curb-to-curb width (ft)</label><input id="w" type="number" min="12" max="160" step="0.5" value="${road}"></div>
          <div class="row"><button class="btn" id="start">${curbChoice === 'ai' ? 'Find curbs with AI' : 'Start marking'}</button></div>` : curbPanel(c, st, approved))}
        ${task(3, 'Render the concepts', s3, `
          <p class="note">${approved ? `Renders ${seg.alternatives.length} alternative${seg.alternatives.length === 1 ? '' : 's'} on the photo and builds the concept sheet PDF. Takes a few minutes.` : 'Available once the curbs are approved.'}</p>
          <div class="row"><button class="btn" id="render"${approved && !rendering && seg.alternatives.length ? '' : ' disabled'}>${rendering ? 'Rendering…' : outputsStore.streetview ? 'Render again' : 'Render concepts'}</button></div>
          ${outputsStore.streetview ? `<div class="row">${outputsStore.streetview.pdfs.map(f => `<a class="btn ghost" target="_blank" rel="noopener" href="${engine.abs(f.url)}">Open ${esc(f.name)}</a>`).join('')}</div>` : ''}`)}
        ${more(`
          <div class="field"><label for="src">Street View source</label><select id="src">${opt('google', 'Google Street View', settings.street)}${opt('panoramax', 'Panoramax (open data)', settings.street)}${opt('mapillary', 'Mapillary (needs a token)', settings.street)}</select></div>
          <div class="field" id="mlyWrap"${settings.street === 'mapillary' ? '' : ' hidden'}><label for="mly">Mapillary access token</label><input id="mly" type="password" autocomplete="off" value="${esc(settings.mapillaryToken)}"></div>
          <div class="field"><label for="look">Photo looks toward</label><select id="look">${LOOK.map(x => opt(x, x[0].toUpperCase() + x.slice(1), look)).join('')}</select></div>`)}
        <p class="note" id="msg" role="status">${esc(msgText)}</p>`;
      if (keepOpen) (side.querySelector('details.more') as HTMLDetailsElement).open = true;
      wire();
    };

    function curbPanel(c: NonNullable<ReturnType<typeof cb>>, st: CurbStatus | undefined, approved: boolean) {
      if (approved) return `<p class="okline">Curbs approved.</p><div class="row"><button class="btn ghost" id="edit">Change the curbs</button></div>`;
      const s = st ?? { hz: false, L: 0, R: 0, Lai: 0, Rai: 0, done: false };
      const allAi = (s.Lai + s.Rai) > 0 && s.Lai === s.L && s.Rai === s.R;
      const missing = [!s.hz && 'the horizon', s.L < 2 && 'the left curb', s.R < 2 && 'the right curb'].filter(Boolean) as string[];
      const how = c.mode === 'ai'
        ? (s.Lai + s.Rai === 0 && s.L + s.R === 0 ? 'The AI could not find the curbs on this photo. Mark them yourself as listed below.'
          : missing.length ? `The AI found part of it. Finish what is still open below.`
          : 'Yellow diamonds are the AI\'s suggestion. If they sit on the curbs, accept them. If not, drag them onto the curb line.')
        : 'Work through the three items on the photo. Each turns green when it is done.';
      const item = (ok: boolean, ai: boolean, label: string, todo: string, okText: string) =>
        `<li class="${ok ? (ai ? 'ai' : 'ok') : 'no'}"><span class="dot"></span><div><b>${label}</b><span>${ok ? (ai ? 'AI suggestion' : okText) : todo}</span></div></li>`;
      return `<p class="note">${how}</p>
        <ul class="checklist">
          ${item(s.hz, false, 'Horizon', 'Press <button class="linkbtn" data-tool="vp">Horizon</button>, then click where the road disappears in the distance.', 'Set')}
          ${item(s.L >= 2, s.Lai > 0 && s.Lai === s.L, 'Left curb', s.L ? 'Click 1 more point along the left curb.' : 'Click 2 or more points along the left curb face, far to near.', 'Marked')}
          ${item(s.R >= 2, s.Rai > 0 && s.Rai === s.R, 'Right curb', s.R ? 'Click 1 more point along the right curb.' : 'Click 2 or more points along the right curb face, far to near.', 'Marked')}
        </ul>
        <p class="note">Drag any point to move it. <button class="linkbtn" id="undo">Undo</button> (or Z) takes back the last change.</p>
        <div class="row"><button class="btn" id="approve"${s.done ? '' : ' disabled'}>${allAi ? 'Accept AI curbs' : 'Approve curbs'}</button>
          ${c.mode === 'ai' && s.Lai + s.Rai > 0 ? '<button class="btn ghost" id="clearai">Remove AI suggestions</button>' : ''}</div>
        ${s.done ? '' : `<p class="note">To approve, finish ${missing.join(', ')}.</p>`}
        <div class="row"><button class="linkbtn" id="restart">Start over with a different method</button></div>`;
    }

    // ---------- canvas
    const showCanvas = () => {
      const c = cb();
      if (outputsStore.streetview && c?.approved && !rendering && outputsStore.streetview.renders.length) {
        canvas.innerHTML = `<div class="persp-wrap">${outputsStore.streetview.renders.map(f => `<figure class="persp"><img src="${engine.abs(f.url)}" alt="${esc(f.name)}"><figcaption>${esc(f.name)}</figcaption></figure>`).join('')}</div>`;
      } else if (c) {
        const f = canvas.querySelector('iframe.guide') as HTMLIFrameElement | null;
        if (!f || f.dataset.job !== c.job) canvas.innerHTML = `<iframe class="guide" data-job="${esc(c.job)}" title="Curb marking" src="${engine.abs(c.guide)}"></iframe>`;
      } else if (p) {
        canvas.innerHTML = `<div class="persp-wrap"><figure class="persp"><img src="${esc(p.src)}" alt="Selected photo"><figcaption>Next: choose how to mark the curbs, on the left.</figcaption></figure></div>`;
      } else canvas.innerHTML = '<div class="empty">Choose a photo on the left.</div>';
    };
    const send = (m: object) => { const c = cb(); const f = canvas.querySelector('iframe.guide') as HTMLIFrameElement | null; if (c && f?.contentWindow) f.contentWindow.postMessage({ job: c.job, ...m }, '*'); };

    // ---------- events
    function wire() {
      const $ = (q: string) => side.querySelector(q) as HTMLElement | null;
      const say = (t: string) => { msgText = t; const m = $('#msg'); if (m) m.textContent = t; };
      $('#chg')?.addEventListener('click', () => { changing = true; paint(); });
      $('#keep')?.addEventListener('click', () => { changing = false; paint(); });
      $('#sv')?.addEventListener('click', async () => {
        const path = (seg.path ?? []) as LngLat[];
        if (path.length < 1) { say('Mark the segment in Site first, or upload a photo.'); return; }
        say('Finding Street View…');
        try {
          const h = path[1] ? bearing(path[0], path[1]) : 0;
          const img = await streetImage(path[0], h);
          if (gen !== live.gen) return;
          if (!img) { say('No street-level imagery here from this source. Try another source under More options, or upload a photo.'); return; }
          project.update(() => { seg.perspective = { src: img.src, source: img.source, credit: img.credit, link: img.link, heading: img.heading }; });
          changing = false; visualizeStage.render(side, canvas);
        } catch (err) { say((err as Error).message); }
      });
      $('#file')?.addEventListener('change', async e => {
        const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return;
        say('Loading…');
        try { const src = await readImage(f); project.update(() => { seg.perspective = { src, source: 'Upload', credit: f.name }; }); changing = false; visualizeStage.render(side, canvas); }
        catch (err) { say((err as Error).message); }
      });
      side.querySelectorAll<HTMLInputElement>('input[name=cm]').forEach(r => r.addEventListener('change', () => { curbChoice = r.value as typeof curbChoice; const b = $('#start'); if (b) b.textContent = curbChoice === 'ai' ? 'Find curbs with AI' : 'Start marking'; }));
      $('#start')?.addEventListener('click', async () => {
        if (!p) return;
        const b = $('#start') as HTMLButtonElement; b.disabled = true;
        say(curbChoice === 'ai' ? 'Finding the curbs…' : 'Opening the photo…');
        try {
          const blob = await fetch(p.src).then(r => { if (!r.ok) throw new Error(`Photo ${r.status}`); return r.blob(); });
          const fd = new FormData(); fd.append('photo', blob, 'photo.jpg'); fd.append('width', (side.querySelector('#w') as HTMLInputElement).value); fd.append('prefill', curbChoice === 'ai' ? 'auto' : 'none');
          const r = await engine.form('/api/curbs/helper', fd);
          if (gen !== live.gen) return;
          if (!r.ok) throw new Error('The curb tool stopped: ' + String(r.log || '').split('\n').slice(-2).join(' '));
          outputsStore.curbs = { job: r.job, mode: curbChoice, guide: r.guide, approved: false, photo: p.src };
          outputsStore.streetview = undefined;
          msgText = ''; paint(); showCanvas(); repaintNav();
        } catch (err) { say((err as Error).message); b.disabled = false; }
      });
      side.querySelectorAll<HTMLElement>('[data-tool]').forEach(b => b.addEventListener('click', () => send({ cmd: 'tool', tool: b.dataset.tool })));
      $('#undo')?.addEventListener('click', () => send({ cmd: 'undo' }));
      $('#clearai')?.addEventListener('click', () => send({ cmd: 'clear-ai' }));
      $('#approve')?.addEventListener('click', () => { say('Saving the curbs…'); send({ cmd: cb()?.mode === 'ai' ? 'accept-ai' : 'approve' }); });
      $('#edit')?.addEventListener('click', () => { const c = cb(); if (!c) return; c.approved = false; outputsStore.streetview = undefined; msgText = ''; paint(); showCanvas(); repaintNav(); });
      $('#restart')?.addEventListener('click', () => { outputsStore.curbs = undefined; outputsStore.streetview = undefined; msgText = ''; paint(); showCanvas(); repaintNav(); });
      $('#src')?.addEventListener('change', e => { settings.street = (e.target as HTMLSelectElement).value as typeof settings.street; saveSettings(); const w = $('#mlyWrap'); if (w) w.hidden = settings.street !== 'mapillary'; });
      $('#mly')?.addEventListener('change', e => { settings.mapillaryToken = (e.target as HTMLInputElement).value.trim(); saveSettings(); });
      $('#look')?.addEventListener('change', e => { look = (e.target as HTMLSelectElement).value; });
      $('#render')?.addEventListener('click', render);
    }

    async function render() {
      const c = cb(); if (!c?.approved) return;
      rendering = true; msgText = 'Rendering: solving the curbs, removing parked cars, placing FP assets, building the sheet. This takes a few minutes.'; paint();
      try {
        const pf = project.get();
        const r = await engine.json('/api/streetview/run', { job: c.job, project: pf, street: seg.limits.from || pf.project.name, looking: look, title: pf.project.name });
        rendering = false;
        if (gen !== live.gen) return;
        if (!r.ok) { msgText = 'The renderer stopped at ' + ((r.steps || []).find((s: any) => !s[1]) || ['a step'])[0] + '. ' + String(r.log || '').split('\n').slice(-3).join(' '); paint(); return; }
        outputsStore.streetview = { job: r.job, pdfs: r.pdfs, renders: r.files.filter((f: any) => /_T\d+\.png$/.test(f.name)) };
        msgText = 'Done. Next: Sheets, to read and mark up the PDFs.'; paint(); showCanvas(); repaintNav();
      } catch (err) { rendering = false; msgText = (err as Error).message; paint(); }
    }

    // Messages from the Curb Guide bridge (same origin, same job only).
    const onMsg = (ev: MessageEvent) => {
      const c = cb(), d = ev.data;
      if (!c || !d || d.job !== c.job) return;
      if (d.type === 'curbs-status') { const { type, job, ...s } = d; void type; void job; c.status = s as CurbStatus; if (!c.approved) paint(); }
      else if (d.type === 'curbs-approved') { c.approved = true; msgText = 'Curbs approved. Next: render the concepts.'; paint(); repaintNav(); }
      else if (d.type === 'curbs-error') { msgText = d.text; paint(); }
    };
    window.addEventListener('message', onMsg);
    visualizeStage.dispose = () => window.removeEventListener('message', onMsg);
    paint(); showCanvas();
  }
};
