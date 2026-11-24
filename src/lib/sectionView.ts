// Cross-sections drawn by fp-section-builder on the engine (FP asset blocks, dimensioned curb to curb only).
// Only drawings from the FP asset set are shown: a status line until the first drawing, then the previous
// drawing (dimmed) while an edit re-renders.
import { engine } from './engine';
import type { Section } from './types';

export interface SectionItem { id: string; title: string; section: Section; existing?: boolean }
let timer = 0, ticket = 0;

export function showSections(canvas: HTMLElement, items: SectionItem[], setting: string | undefined) {
  const esc = (t: string) => t.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
  let host = canvas.querySelector('.secs') as HTMLElement | null;
  if (!host || host.dataset.n !== String(items.length)) {
    canvas.innerHTML = `<div class="secs" data-n="${items.length}">${items.map(it => `<figure class="secfig" data-id="${esc(it.id)}"><figcaption>${esc(it.title.toUpperCase())}</figcaption><div class="secimg"><p class="drawing">Drawing with the FP asset set…</p></div></figure>`).join('')}</div>`;
    host = canvas.querySelector('.secs') as HTMLElement;
  } else items.forEach(it => { const cap = host!.querySelector(`[data-id="${it.id}"] figcaption`); if (cap) cap.textContent = it.title.toUpperCase(); });
  host.classList.add('busy');
  clearTimeout(timer);
  const mine = ++ticket;
  timer = window.setTimeout(async () => {
    try {
      const r = await engine.json('/api/section', { setting, sections: items.map(it => ({ id: it.id, title: it.title, existing: !!it.existing, elements: it.section.elements })) });
      if (mine !== ticket) return;
      await Promise.all(r.sections.map((s: { id: string; png: string }) => new Promise<void>(res => {
        const box = host!.querySelector(`[data-id="${s.id}"] .secimg`) as HTMLElement | null;
        if (!box) return res();
        const img = new Image(); img.alt = 'Cross-section'; img.onload = () => { if (mine === ticket) box.replaceChildren(img); res(); }; img.onerror = () => res(); img.src = engine.abs(s.png);
      })));
    } catch { host!.querySelectorAll('.drawing').forEach(p => { p.textContent = 'The drawing engine did not answer. Edit again to retry.'; }); }
    if (mine === ticket) host!.classList.remove('busy');
  }, 450);
}
