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
}

export interface Segment {
  id: string;
  limits: { from: string; to: string };
  length_ft: number;
  location?: { lat: number; lng: number; heading?: number; pano_id?: string };
  path?: { lat: number; lng: number }[];
  curbs: unknown[];
  existing: Section;
  alternatives: Alternative[];
}

export interface ProjectFile {
  project: { id: string; name: string; agency: string; brand: 'fp' | 'personal' };
  segments: Segment[];
  review: unknown[];
  standards_version: string;
}
