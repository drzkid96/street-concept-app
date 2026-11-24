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
  lineLeft?: string;  // line at this element's left edge (first element: at the left curb)
  lineRight?: string; // line at this element's right edge; unset = automatic
}

export interface Section { elements: SectionElement[] }

export interface Alternative {
  id: string;
  name: string;
  tier: 'quick-build' | 'interim' | 'capital';
  section: Section;
  render?: string; // data URL of the concept rendering from Visualize
  enabled?: boolean; // included in the outputs (default on)
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
  city?: string; // sets the regional prices
  cityAuto?: boolean; // city filled from the address, not typed
  address?: string; // full address of the segment midpoint (Google)
  settingPinned?: boolean; // frontage chosen by the person; otherwise read from OSM land use
  setting?: string; // drawing surroundings and cost setting (fp-section-builder scene, or 'park')
  existingAuto?: import('./existingAuto').AutoResult; // how the existing section was filled (OSM + photo check)
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
