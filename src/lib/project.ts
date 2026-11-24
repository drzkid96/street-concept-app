import type { ProjectFile, Segment, Section } from './types';

const KEY = 'sca-project-v1';
type Listener = (p: ProjectFile) => void;
const listeners = new Set<Listener>();

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));

export const SAMPLE_EXISTING: Section = {
  elements: [
    { type: 'sidewalk', width_ft: 10, direction: 'none' },
    { type: 'parking', width_ft: 8, direction: 'outbound' },
    { type: 'travel_lane', width_ft: 11, direction: 'outbound' },
    { type: 'travel_lane', width_ft: 11, direction: 'outbound' },
    { type: 'turn_lane', width_ft: 10, direction: 'both' },
    { type: 'travel_lane', width_ft: 11, direction: 'inbound' },
    { type: 'travel_lane', width_ft: 11, direction: 'inbound' },
    { type: 'parking', width_ft: 8, direction: 'inbound' },
    { type: 'sidewalk', width_ft: 10, direction: 'none' }
  ]
};

function blank(): ProjectFile {
  return {
    project: { id: uid(), name: '', agency: '', brand: 'fp' },
    segments: [newSegment()],
    review: [],
    standards_version: '2026-11'
  };
}

export function newSegment(): Segment {
  return {
    id: uid(), limits: { from: '', to: '' }, length_ft: 0, curbs: [],
    existing: structuredClone(SAMPLE_EXISTING), alternatives: []
  };
}

let state: ProjectFile = load();

function load(): ProjectFile {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as ProjectFile;
  } catch { /* storage unavailable */ }
  return blank();
}

export const project = {
  get: () => state,
  seg: () => state.segments[0],
  update(fn: (p: ProjectFile) => void) {
    fn(state);
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ }
    listeners.forEach(l => l(state));
  },
  replace(p: ProjectFile) { state = p; project.update(() => {}); },
  subscribe(l: Listener) { listeners.add(l); return () => listeners.delete(l); },
  exportJSON: () => JSON.stringify(state, null, 2)
};
