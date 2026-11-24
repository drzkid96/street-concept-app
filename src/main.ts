import '@fontsource-variable/albert-sans';
import './styles/tokens.css';
import './styles/app.css';
import { STAGES, live, type Stage } from './stages';
import { project } from './lib/project';
import type { ProjectFile } from './lib/types';

const nav = document.getElementById('stages')!;
let side = document.getElementById('side')!;
let canvas = document.getElementById('canvas')!;
let current: Stage | null = null;
const name = document.getElementById('proj-name') as HTMLInputElement;

nav.innerHTML = STAGES.map((s, i) => `<button data-id="${s.id}"><span class="n">${i + 1}</span>${s.name.toUpperCase()}</button>`).join('');

function go(id: string) {
  const s = STAGES.find(x => x.id === id) ?? STAGES[0];
  nav.querySelectorAll('button').forEach(b => b.setAttribute('aria-current', String(b.dataset.id === s.id)));
  if (location.hash !== '#' + s.id) history.replaceState(null, '', '#' + s.id);
  // Clean up the previous stage (maps, timers) and start from fresh panels so no listeners carry over.
  try { current?.dispose?.(); } catch (err) { console.warn(err); }
  live.gen++;
  const ns = side.cloneNode(false) as HTMLElement, nc = canvas.cloneNode(false) as HTMLElement;
  side.replaceWith(ns); canvas.replaceWith(nc); side = ns; canvas = nc;
  current = s;
  Promise.resolve(s.render(side, canvas)).catch(err => {
    console.error(err);
    side.insertAdjacentHTML('beforeend', `<p class="badge warn">Something went wrong in this step: ${String(err?.message || err).replace(/</g, '&lt;')}</p>`);
  });
}
nav.addEventListener('click', e => { const b = (e.target as HTMLElement).closest('button'); if (b) go(b.dataset.id!); });
window.addEventListener('hashchange', () => go(location.hash.slice(1)));

name.value = project.get().project.name;
name.addEventListener('change', () => project.update(p => { p.project.name = name.value; }));

document.getElementById('export')!.addEventListener('click', () => {
  const blob = new Blob([project.exportJSON()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(project.get().project.name || 'project').replace(/\W+/g, '-')}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});
document.getElementById('import')!.addEventListener('change', async e => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  try { project.replace(JSON.parse(await f.text()) as ProjectFile); name.value = project.get().project.name; go(location.hash.slice(1)); }
  catch { side.insertAdjacentHTML('afterbegin', '<p class="badge warn">Not a valid project file</p>'); }
});

go(location.hash.slice(1) || 'site');
