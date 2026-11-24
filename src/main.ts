import '@fontsource-variable/albert-sans';
import './styles/tokens.css';
import './styles/app.css';
import { STAGES, live, type Stage } from './stages';
import { project } from './lib/project';
import { engine, onEngine } from './lib/engine';

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

const pill = document.getElementById('eng')!;
const paint = () => {
  pill.className = 'pill ' + (engine.on ? 'on' : 'off');
  pill.textContent = engine.on ? 'Skills engine connected' : 'Engine offline';
  pill.title = engine.on ? `${engine.url}\n` + Object.entries(engine.health!.skills).map(([k, v]) => `${k} ${v}`).join('\n') : `${engine.url} not reachable. Start the engine, or click to change its address.`;
};
onEngine(paint);
pill.addEventListener('click', () => {
  const box = document.createElement('div');
  box.className = 'cbox engbox';
  box.innerHTML = `<label>Engine address<input value="${engine.url}"></label><div class="row"><button class="btn">Connect</button><button class="btn ghost">Close</button></div>`;
  document.querySelector('.top')!.appendChild(box);
  const [ok, close] = box.querySelectorAll('button');
  ok.addEventListener('click', async () => { engine.setUrl((box.querySelector('input') as HTMLInputElement).value.trim()); await engine.check(); box.remove(); go(location.hash.slice(1)); });
  close.addEventListener('click', () => box.remove());
});
engine.check();
setInterval(() => engine.check(), 30000);

go(location.hash.slice(1) || 'site');
