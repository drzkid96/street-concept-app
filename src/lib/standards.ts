import type { ElementType } from './types';

// Every rule links to its SoCal Super Standards page, which links to the official source page.
export const SSS = 'https://drzkid96.github.io/SoCal-Super-Standards';

export interface Rule {
  id: string;
  applies: ElementType[];
  min_ft?: number;
  max_ft?: number;
  layer: 'agency_comments' | 'agency_standard' | 'state' | 'fp_convention';
  source: string;
  link: string;
  verified: boolean; // false = placeholder value, confirm against source before relying on it
}

export const PRECEDENCE = ['agency_comments', 'agency_standard', 'state', 'fp_convention'] as const;

export const ELEMENTS: Record<ElementType, { label: string; fill: string; topic: string }> = {
  sidewalk:          { label: 'Sidewalk',          fill: 'var(--st-concrete)',  topic: 'accessibility' },
  parkway:           { label: 'Parkway',           fill: 'var(--st-landscape)', topic: 'curb-parking-loading' },
  curb:              { label: 'Curb',              fill: 'var(--st-concrete)',  topic: 'curb-parking-loading' },
  parking:           { label: 'Parking',           fill: 'var(--st-asphalt)',   topic: 'curb-parking-loading' },
  bike_lane:         { label: 'Bike lane',         fill: 'var(--st-bike)',      topic: 'bikeways' },
  bike_buffer:       { label: 'Bike buffer',       fill: 'var(--st-asphalt)',   topic: 'bikeways' },
  separated_bikeway: { label: 'Separated bikeway', fill: 'var(--st-bike)',      topic: 'bikeways' },
  travel_lane:       { label: 'Travel lane',       fill: 'var(--st-asphalt)',   topic: 'speed-and-calming' },
  turn_lane:         { label: 'Turn lane',         fill: 'var(--st-asphalt)',   topic: 'speed-and-calming' },
  bus_lane:          { label: 'Bus lane',          fill: 'var(--st-bus)',       topic: 'transit' },
  median:            { label: 'Median',            fill: 'var(--st-landscape)', topic: 'speed-and-calming' },
  shoulder:          { label: 'Shoulder',          fill: 'var(--st-asphalt)',   topic: 'speed-and-calming' }
};

export const topicLink = (t: ElementType) => `${SSS}/topics/${ELEMENTS[t].topic}/`;

// PLACEHOLDER values: verified=false until each is filled from the cited source page.
export const RULES: Rule[] = [
  { id: 'bike-lane-min', applies: ['bike_lane'], min_ft: 5, layer: 'state', source: 'CA MUTCD / Caltrans HDM', link: `${SSS}/topics/bikeways/`, verified: false },
  { id: 'sep-bikeway-min', applies: ['separated_bikeway'], min_ft: 5, layer: 'state', source: 'Caltrans DIB (Class IV)', link: `${SSS}/topics/bikeways/`, verified: false },
  { id: 'bus-lane-min', applies: ['bus_lane'], min_ft: 11, layer: 'agency_standard', source: 'LA Metro / LADOT', link: `${SSS}/topics/transit/`, verified: false },
  { id: 'travel-lane-min', applies: ['travel_lane', 'turn_lane'], min_ft: 10, layer: 'state', source: 'Caltrans HDM', link: `${SSS}/topics/speed-and-calming/`, verified: false },
  { id: 'parking-min', applies: ['parking'], min_ft: 7, layer: 'agency_standard', source: 'LADOT', link: `${SSS}/topics/curb-parking-loading/`, verified: false },
  { id: 'sidewalk-par', applies: ['sidewalk'], min_ft: 5, layer: 'state', source: 'PROWAG / CBC 11B', link: `${SSS}/topics/accessibility/`, verified: false }
];

// F&P conventions applied to every graphic
export const CONVENTIONS = {
  stopbar_offset_ft: 5,
  bike_lane_color: 'green',
  bus_lane_color: 'red',
  bus_lane_text: 'BUS LANE'
};

export function check(type: ElementType, width: number) {
  return RULES.filter(r => r.applies.includes(type)).flatMap(r => {
    if (r.min_ft != null && width < r.min_ft) return [{ rule: r, msg: `Below ${r.min_ft}' (${r.source})` }];
    if (r.max_ft != null && width > r.max_ft) return [{ rule: r, msg: `Above ${r.max_ft}' (${r.source})` }];
    return [];
  });
}
