export type ElementType =
  | 'sidewalk' | 'parkway' | 'curb' | 'parking' | 'bike_lane' | 'bike_buffer'
  | 'separated_bikeway' | 'travel_lane' | 'turn_lane' | 'bus_lane' | 'median' | 'shoulder';

export type Direction = 'inbound' | 'outbound' | 'both' | 'none';

export interface SectionElement {
  type: ElementType;
  width_ft: number;
  direction: Direction;
  material?: string;
  std_ref?: string;
}

export interface Section { elements: SectionElement[] }

export interface Alternative {
  id: string;
  name: string;
  tier: 'quick-build' | 'interim' | 'capital';
  section: Section;
  render?: string; // data URL of the concept rendering from Visualize
}

export interface Segment {
  id: string;
  limits: { from: string; to: string };
  length_ft: number;
  location?: { lat: number; lng: number; heading?: number; pano_id?: string };
  path?: [number, number][];
  clicks?: [number, number][]; // the person's start/end (and any middle) clicks; path is snapped through them
  grade_pct?: number;
  perspective?: Perspective;
  keymap?: string; // data URL snapshot from Site
  curbPts?: [number, number][]; // left/right curb at image bottom, fractions
  curbs: unknown[];
  existing: Section;
  existingChecked?: boolean;
  alternatives: Alternative[];
}

export interface ReviewRecord { at: string; kind: 'send' | 'approved'; sheets: number; markups: Markup[]; note?: string }
export interface Markup { page: number; tool: 'callout' | 'cloud' | 'box' | 'line' | 'pen'; pts: [number, number][]; text?: string }

export interface ProjectFile {
  project: { id: string; name: string; agency: string; brand: 'fp' | 'personal' };
  segments: Segment[];
  review: ReviewRecord[];
  standards_version: string;
}

export interface Perspective {
  src: string;            // URL or data URL
  source: string;         // Upload, Google Street View, Panoramax, Mapillary
  credit?: string;
  link?: string;
  heading?: number;
  vp?: [number, number];  // vanishing point, fraction of image width/height
  cam?: { fov: number; h: number; xcam: number; horizon: number; cx: number }; // auto-scale camera
}
