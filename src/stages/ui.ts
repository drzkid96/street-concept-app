// Shared sidebar pieces: step header, numbered tasks, "more options" drawer.
export const esc = (t: unknown) => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function head(n: number, title: string, lead: string) {
  return `<header class="step-head"><span class="eyebrow">Step ${n} of 6</span><h2>${esc(title.toUpperCase())}</h2><p class="lead">${lead}</p></header>`;
}
// One task in a stage: state is done / now / later (later is dimmed until the earlier task is done).
export function task(i: number, title: string, state: 'done' | 'now' | 'later', body: string, id = '') {
  return `<section class="task ${state}"${id ? ` id="${id}"` : ''}><h3><span class="tn">${state === 'done' ? '✓' : i}</span>${esc(title)}</h3><div class="tb">${body}</div></section>`;
}
export function more(body: string, label = 'More options') {
  return `<details class="more"><summary>${esc(label)}</summary><div>${body}</div></details>`;
}
