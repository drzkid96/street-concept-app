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

const stepnav = document.getElementById('stepnav')!;
// Steps open in order: a step is reachable only when every step before it is complete.
const reach = () => { const k = STAGES.findIndex(s => !(s.done?.() ?? false)); return k < 0 ? STAGES.length - 1 : k; };
const paintNav = (id: string) => {
  const open = reach();
  nav.innerHTML = STAGES.map((s, i) => {
    const done = s.done?.() ?? false;
    return `<button data-id="${s.id}" aria-current="${s.id === id}" class="${done ? 'done' : ''}"${i > open ? ' disabled title="Finish the earlier steps first"' : ''}><span class="n">${done ? '✓' : i + 1}</span>${s.name.toUpperCase()}</button>`;
  }).join('');
  const i = STAGES.findIndex(s => s.id === id), prev = STAGES[i - 1], next = STAGES[i + 1];
  stepnav.innerHTML = `${prev ? `<button class="btn ghost" data-go="${prev.id}">← ${prev.name}</button>` : '<span></span>'}
    ${next ? `<button class="btn" data-go="${next.id}"${i + 1 > open ? ' disabled title="Finish this step first"' : ''}>Next: ${next.name} →</button>` : ''}`;
};
stepnav.addEventListener('click', e => { const b = (e.target as HTMLElement).closest('[data-go]') as HTMLElement | null; if (b) go(b.dataset.go!); });
// Stages call this after finishing something so the step ticks update without leaving the step.
(window as any).__repaintNav = () => paintNav(current?.id ?? 'site');

function go(id: string) {
  let s = STAGES.find(x => x.id === id) ?? STAGES[0];
  if (STAGES.indexOf(s) > reach()) s = STAGES[reach()];
  paintNav(s.id);
  if (location.hash !== '#' + s.id) history.replaceState(null, '', '#' + s.id);
  // Clean up the previous stage (maps, timers) and start from fresh panels so no listeners carry over.
  try { current?.dispose?.(); } catch (err) { console.warn(err); }
  live.gen++;
  const ns = side.cloneNode(false) as HTMLElement, nc = canvas.cloneNode(false) as HTMLElement;
  side.replaceWith(ns); canvas.replaceWith(nc); side = ns; canvas = nc;
  side.scrollTop = 0;
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

// Full address of the segment, top right
const addr = document.getElementById('addr')!;
const paintAddr = () => { const g = project.seg(); addr.hidden = !g.address; addr.innerHTML = g.address ? `<span class="lbl">LOCATION</span><b>${g.address}</b>` : ''; };
(window as any).__paintAddr = paintAddr; paintAddr();
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
