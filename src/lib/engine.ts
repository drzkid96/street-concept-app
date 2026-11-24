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
  async json<T = any>(path: string, body: unknown): Promise<T> {
    const r = await fetch(this.url + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : r.status >= 502 ? 'The engine was busy or restarting. Try again in a moment.' : `Engine error ${r.status}`);
    return j;
  },
  async get<T = any>(path: string): Promise<T> { return (await fetch(this.url + path)).json(); },
  async form<T = any>(path: string, fd: FormData): Promise<T> {
    const r = await fetch(this.url + path, { method: 'POST', body: fd });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.detail || `Engine error ${r.status}`);
    return j;
  }
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
  sections?: { job: string; pdf: string };
  compiled?: { job: string; pdf: string; pages: number };
  handoff?: { zip: string; name: string; bytes: number };
  cover?: { job: string; pdf: string; png: string };
  curbs?: { job: string; mode: 'manual' | 'ai'; guide: string; approved: boolean; status?: CurbStatus; photo: string };
} = {};
