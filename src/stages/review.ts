// Markup review over the built sheets: callout, cloud, box, line, pen; select + delete; SEND and APPROVED.
import { live, type Stage } from './index';
import { project } from '../lib/project';
import { buildSheets } from '../lib/sheet';
import { renderPages, store, download } from '../lib/pdfView';
import type { Markup } from '../lib/types';

type Tool = Markup['tool'] | 'select';
const TOOLS: [Tool, string][] = [['select', 'Select'], ['callout', 'Callout'], ['cloud', 'Cloud'], ['box', 'Box'], ['line', 'Line'], ['pen', 'Pen']];
let marks: Markup[] = [];
let tool: Tool = 'callout';

const esc = (t: string) => t.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

function cloudPath([[x1, y1], [x2, y2]]: [number, number][]) {
  const [a, b, c, d] = [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
  const r = 1.2, seg = (p: number, q: number) => Math.max(1, Math.round(Math.abs(q - p) / (r * 2)));
  let s = `M${a} ${b}`;
  const run = (fx: number, fy: number, tx: number, ty: number) => { const n = seg(fx === tx ? fy : fx, fx === tx ? ty : tx); for (let i = 1; i <= n; i++) { const x = fx + (tx - fx) * i / n, y = fy + (ty - fy) * i / n; s += ` A${r} ${r} 0 0 1 ${x} ${y}`; } };
  run(a, b, c, b); run(c, b, c, d); run(c, d, a, d); run(a, d, a, b);
  return s;
}

function svgFor(m: Markup, i: number) {
  const st = `stroke="#E11" stroke-width=".35" fill="none" vector-effect="non-scaling-stroke" data-i="${i}" class="mk"`;
  const [p, q] = m.pts;
  switch (m.tool) {
    case 'box': return `<rect x="${Math.min(p[0], q[0])}" y="${Math.min(p[1], q[1])}" width="${Math.abs(q[0] - p[0])}" height="${Math.abs(q[1] - p[1])}" ${st}/>`;
    case 'cloud': return `<path d="${cloudPath(m.pts)}" ${st}/>`;
    case 'line': return `<line x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}" ${st}/>`;
    case 'pen': return `<polyline points="${m.pts.map(x => x.join(',')).join(' ')}" ${st}/>`;
    case 'callout': {
      const lines = (m.text || '').match(/.{1,28}(\s|$)/g)?.map(x => x.trim()) ?? [''];
      const fs = 1.5, w = Math.max(...lines.map(l => l.length)) * fs * 0.55 + 1.2, h = lines.length * fs * 1.25 + 0.8;
      return `<g data-i="${i}" class="mk"><line x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}" stroke="#E11" stroke-width=".3" vector-effect="non-scaling-stroke"/>
        <circle cx="${p[0]}" cy="${p[1]}" r=".45" fill="#E11"/>
        <rect x="${q[0]}" y="${q[1] - h / 2}" width="${w}" height="${h}" fill="#fff" stroke="#E11" stroke-width=".3" vector-effect="non-scaling-stroke"/>
        ${lines.map((l, k) => `<text x="${q[0] + 0.6}" y="${q[1] - h / 2 + 0.4 + fs * (k + 1)}" font-size="${fs}" font-family="Albert Sans, sans-serif" font-weight="600" fill="#E11" textLength="${(l.length * fs * 0.55).toFixed(2)}" lengthAdjust="spacingAndGlyphs">${esc(l)}</text>`).join('')}</g>`;
    }
  }
}

export const reviewStage: Stage = {
  id: 'review', name: 'Review',
  async render(side, canvas) {
    const gen = live.gen;
    const pf = project.get();
    side.innerHTML = `<h2>7. REVIEW</h2>
      <div class="tools" role="toolbar" aria-label="Markup tools">${TOOLS.map(([t, l]) => `<button class="btn ghost" data-t="${t}" aria-pressed="${t === tool}">${l}</button>`).join('')}</div>
      <p class="note">Drag on a sheet to place a mark. Callouts ask for text. Select a mark and press Delete to remove it.</p>
      <div class="row"><button class="btn ghost" id="clear">Clear all</button></div>
      <div class="row"><button class="btn" id="send">Send markups</button><button class="btn" id="ok" style="background:var(--fp-jade)">Approved</button></div>
      <p class="note" id="msg" role="status"></p>
      <h3 style="margin-top:1rem">HISTORY</h3>
      <ul class="hist">${pf.review.slice().reverse().map(r => `<li><b>${r.kind === 'approved' ? 'Approved' : 'Sent'}</b> ${new Date(r.at).toLocaleString()} · ${r.markups.length} mark${r.markups.length === 1 ? '' : 's'}</li>`).join('') || '<li class="note">No reviews yet.</li>'}</ul>`;
    const msg = side.querySelector('#msg')!;
    if (!store.pdf) {
      canvas.innerHTML = '<div class="empty">Building sheets for review…</div>';
      try { store.pdf = await buildSheets(pf); store.builtAt = new Date().toISOString(); } catch (err) { canvas.innerHTML = `<div class="empty">${esc((err as Error).message)}</div>`; return; }
      if (gen !== live.gen) return;
    }
    canvas.innerHTML = '<div class="pages" id="pages"></div>';
    const pagesEl = canvas.querySelector('#pages') as HTMLElement;
    await renderPages(store.pdf, pagesEl, Math.min(1400, canvas.clientWidth - 40));
    if (gen !== live.gen) return;
    const overlays: SVGSVGElement[] = [];
    pagesEl.querySelectorAll<HTMLElement>('.page').forEach(pg => {
      pg.insertAdjacentHTML('beforeend', `<svg class="mkup" viewBox="0 0 100 64.7" preserveAspectRatio="none"></svg>`);
      overlays.push(pg.querySelector('svg')!);
    });
    let selected = -1;
    const redraw = () => overlays.forEach((svg, pi) => {
      svg.innerHTML = marks.map((m, i) => m.page === pi ? svgFor(m, i) : '').join('');
      if (selected >= 0) svg.querySelector(`[data-i="${selected}"]`)?.classList.add('sel');
    });
    redraw();

    side.querySelectorAll<HTMLButtonElement>('[data-t]').forEach(b => b.addEventListener('click', () => {
      tool = b.dataset.t as Tool;
      side.querySelectorAll('[data-t]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    }));
    overlays.forEach((svg, pi) => {
      const pt = (e: PointerEvent): [number, number] => { const r = svg.getBoundingClientRect(); return [+((e.clientX - r.left) / r.width * 100).toFixed(2), +((e.clientY - r.top) / r.height * 64.7).toFixed(2)]; };
      let cur: Markup | null = null;
      svg.addEventListener('pointerdown', e => {
        if (tool === 'select') {
          const t = (e.target as Element).closest('[data-i]') as SVGElement | null;
          selected = t ? +t.dataset.i! : -1; redraw(); return;
        }
        svg.setPointerCapture(e.pointerId);
        const p = pt(e);
        cur = { page: pi, tool, pts: tool === 'pen' ? [p] : [p, p] };
        marks.push(cur); redraw();
      });
      svg.addEventListener('pointermove', e => {
        if (!cur) return;
        let p = pt(e);
        if (cur.tool === 'line' && e.shiftKey) { const [a] = cur.pts; const ang = Math.round(Math.atan2(p[1] - a[1], p[0] - a[0]) / (Math.PI / 4)) * Math.PI / 4, d = Math.hypot(p[0] - a[0], p[1] - a[1]); p = [a[0] + d * Math.cos(ang), a[1] + d * Math.sin(ang)]; }
        if (cur.tool === 'pen') cur.pts.push(p); else cur.pts[1] = p;
        redraw();
      });
      svg.addEventListener('pointerup', () => {
        if (!cur) return;
        const m = cur; cur = null;
        if (m.tool === 'callout') {
          const box = document.createElement('div');
          box.className = 'cbox';
          box.innerHTML = `<label>Callout text<textarea rows="3"></textarea></label><div class="row"><button class="btn">Add</button><button class="btn ghost">Cancel</button></div>`;
          side.appendChild(box);
          const ta = box.querySelector('textarea')!; ta.focus();
          const [add, cancel] = box.querySelectorAll('button');
          add.addEventListener('click', () => { m.text = ta.value.trim(); if (!m.text) marks.splice(marks.indexOf(m), 1); box.remove(); redraw(); });
          cancel.addEventListener('click', () => { marks.splice(marks.indexOf(m), 1); box.remove(); redraw(); });
        }
      });
    });
    const onKey = (e: KeyboardEvent) => { if ((e.key === 'Delete' || e.key === 'Backspace') && selected >= 0 && !(e.target as HTMLElement).closest('textarea,input')) { marks.splice(selected, 1); selected = -1; redraw(); } };
    document.addEventListener('keydown', onKey);
    reviewStage.dispose = () => document.removeEventListener('keydown', onKey);

    const record = (kind: 'send' | 'approved') => {
      const rec = { at: new Date().toISOString(), kind, sheets: overlays.length, markups: marks.map(m => ({ ...m })) };
      project.update(p => { p.review.push(rec); });
      return rec;
    };
    side.querySelector('#clear')!.addEventListener('click', () => { marks = []; selected = -1; redraw(); });
    side.querySelector('#send')!.addEventListener('click', async () => {
      if (!marks.length) { msg.textContent = 'No markups to send.'; return; }
      const rec = record('send');
      const payload = JSON.stringify({ project: pf.project.name, sheetsBuilt: store.builtAt, ...rec }, null, 2);
      download(payload, `${rec.at.slice(0, 10)}_MARKUPS.json`, 'application/json');
      try { await navigator.clipboard.writeText(payload); msg.textContent = 'Markups saved to the project, downloaded and copied. Paste them to Claude to revise.'; }
      catch { msg.textContent = 'Markups saved to the project and downloaded.'; }
      reviewStage.render(side, canvas);
    });
    side.querySelector('#ok')!.addEventListener('click', () => {
      record('approved');
      marks = [];
      msg.textContent = 'Approval recorded.';
      reviewStage.render(side, canvas);
    });
  }
};
