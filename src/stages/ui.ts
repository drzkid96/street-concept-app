// Shared sidebar pieces: step header, numbered tasks, "more options" drawer.
export const esc = (t: unknown) => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function head(n: number, title: string, lead: string) {
  return `<header class="step-head"><span class="eyebrow">Step ${n} of 7</span><h2>${esc(title.toUpperCase())}</h2><p class="lead">${lead}</p></header>`;
}
// One task in a stage: state is done / now / later (later is dimmed until the earlier task is done).
// Collapsible: the current task is open, finished and later ones are closed, unless the person toggled them.
export function task(i: number, title: string, state: 'done' | 'now' | 'later', body: string, id = '', summary = '') {
  const mem = (window as any).__taskOpen?.[title];
  const open = mem ?? state === 'now';
  return `<details class="task ${state}" data-key="${esc(title)}"${id ? ` id="${id}"` : ''}${open ? ' open' : ''}><summary><span class="tn">${state === 'done' ? '✓' : i}</span><span>${esc(title)}</span>${summary ? `<span class="sum">${esc(summary)}</span>` : ''}</summary><div class="tb">${body}</div></details>`;
}
export function more(body: string, label = 'More options') {
  return `<details class="more"><summary>${esc(label)}</summary><div>${body}</div></details>`;
}
