// Connection to the Street Concept engine: Adrian's skills running unchanged (local Docker or a private host).
// When the engine is reachable, stages use the skills' own outputs; otherwise the built-in tools stay available.
const KEY = 'sca-engine-url';
export const engine = {
  // Served by the engine itself (cloud): same origin, no address needed. On GitHub Pages: the saved address.
  url: (() => { if (!location.hostname.endsWith('github.io')) return ''; try { return localStorage.getItem(KEY) || ''; } catch { return ''; } })(),
  health: null as null | { ok: boolean; skills: Record<string, string>; models: Record<string, boolean> },
  setUrl(u: string) { this.url = u.replace(/\/$/, ''); try { localStorage.setItem(KEY, this.url); } catch { /* ignore */ } },
  abs(path: string) { return path.startsWith('http') ? path : this.url + path; },
  async check(): Promise<boolean> {
    if (this.url === '' && location.hostname.endsWith('github.io')) { this.health = null; listeners.forEach(f => f()); return false; }
    try {
      const r = await fetch(this.url + '/api/health', { signal: AbortSignal.timeout(8000) });
      this.health = r.ok ? await r.json() : null;
    } catch { this.health = null; }
    listeners.forEach(f => f());
    return !!this.health;
  },
  get on() { return !!this.health; },
  /** One request to the engine. A 429 means Cloud Run did not hand the request to the engine at all (it is busy rendering), so it is safe to send again. */
  async send(path: string, init?: RequestInit): Promise<Response> {
    for (let i = 0; ; i++) {
      const r = await fetch(this.url + path, init);
      if (r.status === 429 && i < 5) { await new Promise(res => setTimeout(res, 2500 * (i + 1))); continue; }
      if ((r.headers.get('content-type') || '').includes('text/html') && path.startsWith('/api/')) throw new Error('Your sign-in expired. Reload the page, then try again.');
      return r;
    }
  },
  async json<T = any>(path: string, body: unknown): Promise<T> {
    const r = await this.send(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : r.status === 429 || r.status >= 502 ? 'The engine was busy or restarting. Try again in a moment.' : `Engine error ${r.status}`);
    return j;
  },
  async get<T = any>(path: string): Promise<T> { return (await this.send(path)).json(); },
  async form<T = any>(path: string, fd: FormData): Promise<T> {
    const r = await this.send(path, { method: 'POST', body: fd });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : r.status === 429 || r.status >= 502 ? 'The engine was busy or restarting. Try again in a moment.' : `Engine error ${r.status}`);
    return j;
  }
};
// Built files are copied into the browser as soon as they exist, so viewing, downloading and marking them up never
// depends on the engine still holding them (it forgets its files whenever it restarts or goes idle).
const kept = new Map<string, { blob: Blob; href: string }>();
export const keeper = {
  async keep(url?: string | null) {
    if (!url || kept.has(url)) return;
    try { const r = await engine.send(url); if (!r.ok) return; const blob = await r.blob(); kept.set(url, { blob, href: URL.createObjectURL(blob) }); } catch { /* still on the engine for now */ }
  },
  href(url: string) { return kept.get(url)?.href ?? engine.abs(url); },
  blob(url: string) { return kept.get(url)?.blob; },
  clear() { kept.forEach(k => URL.revokeObjectURL(k.href)); kept.clear(); }
};
const listeners = new Set<() => void>();
export const onEngine = (f: () => void) => { listeners.add(f); return () => listeners.delete(f); };

export interface EngineFile { name: string; url: string; bytes: number }
// Last engine outputs for this browser session, shared by Cost, Visualize, Sheets and Review.
export interface CurbStatus { hz: boolean; L: number; R: number; Lai: number; Rai: number; done: boolean }
export const outputsStore: {
  concepts?: { job: string; pdf: string; png?: string; fmt?: 'excel' | 'pdf'; xlsx?: string; summary: string[] };
  streetview?: { job: string; pdfs: EngineFile[]; renders: EngineFile[] };
  look?: string;
  existingReport?: { job: string; pdf: string };
  sections?: { job: string; pdf: string };
  compiled?: { job: string; pdf: string; pages: number };
  handoff?: { zip: string; name: string; bytes: number };
  cover?: { job: string; pdf: string; png: string };
  curbs?: { job: string; mode: 'manual' | 'ai'; guide: string; approved: boolean; status?: CurbStatus; photo: string };
} = {};

export const curbsOk = (g: { curbMarks?: { photo: string }; perspective?: { src: string } }) => !!g.curbMarks && !!g.perspective && g.curbMarks.photo === g.perspective.src;
