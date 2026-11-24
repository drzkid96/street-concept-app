// Hybrid provider layer: open services by default, Google as an option for each.
import { GOOGLE_KEY } from './config';

export type LngLat = [number, number];

// ---------- settings (remembered per browser) ----------
export interface Settings {
  basemap: string; geocoder: 'nominatim' | 'google'; snap: 'osrm' | 'google';
  street: 'google' | 'panoramax' | 'mapillary'; mapillaryToken: string;
}
const SKEY = 'sca-settings-v1';
const DEFAULTS: Settings = { basemap: 'osm-liberty', geocoder: 'nominatim', snap: 'osrm', street: 'google', mapillaryToken: '' };
export const settings: Settings = (() => {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SKEY) || '{}') }; } catch { return { ...DEFAULTS }; }
})();
export function saveSettings() { try { localStorage.setItem(SKEY, JSON.stringify(settings)); } catch { /* ignore */ } }

// ---------- basemaps ----------
export interface Basemap { id: string; label: string; kind: 'style' | 'raster' | 'google'; url?: string; attribution?: string; open: boolean; maxzoom?: number }
export const BASEMAPS: Basemap[] = [
  { id: 'osm-liberty', label: 'Streets (OpenFreeMap)', kind: 'style', url: 'https://tiles.openfreemap.org/styles/liberty', open: true },
  { id: 'osm-positron', label: 'Light (OpenFreeMap)', kind: 'style', url: 'https://tiles.openfreemap.org/styles/positron', open: true },
  { id: 'usgs-imagery', label: 'Aerial, NAIP (USGS)', kind: 'raster', url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}', attribution: 'USGS The National Map: Orthoimagery', open: true, maxzoom: 16 },
  { id: 'usgs-imagery-topo', label: 'Aerial + labels (USGS)', kind: 'raster', url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryTopo/MapServer/tile/{z}/{y}/{x}', attribution: 'USGS The National Map', open: true, maxzoom: 16 },
  { id: 'google-satellite', label: 'Aerial, high-res (Google)', kind: 'google', open: false, maxzoom: 22 }
];

let googleSession: { id: string; expiry: number } | null = null;
export async function googleTileUrl(): Promise<string> {
  if (!googleSession || Date.now() / 1000 > googleSession.expiry - 3600) {
    const r = await fetch(`https://tile.googleapis.com/v1/createSession?key=${GOOGLE_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mapType: 'satellite', language: 'en-US', region: 'US' })
    });
    if (!r.ok) throw new Error(`Google tiles session failed (${r.status})`);
    const j = await r.json();
    googleSession = { id: j.session, expiry: +j.expiry };
  }
  return `https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=${googleSession.id}&key=${GOOGLE_KEY}`;
}

// ---------- geocoding ----------
export interface Place { label: string; at: LngLat }
export async function geocode(q: string): Promise<Place[]> {
  if (settings.geocoder === 'google') {
    const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': GOOGLE_KEY, 'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location' },
      body: JSON.stringify({ textQuery: q, locationBias: { rectangle: { low: { latitude: 32.5, longitude: -120.7 }, high: { latitude: 35.8, longitude: -114.1 } } } })
    });
    if (!r.ok) throw new Error(`Google Places error ${r.status}`);
    const j = await r.json();
    return (j.places || []).map((p: any) => ({ label: p.formattedAddress || p.displayName?.text, at: [p.location.longitude, p.location.latitude] as LngLat }));
  }
  // Nominatim: 1 request/second max, no autocomplete (OSMF usage policy). Search runs on submit only.
  const u = new URL('https://nominatim.openstreetmap.org/search');
  u.search = new URLSearchParams({ q, format: 'jsonv2', limit: '6', countrycodes: 'us', viewbox: '-120.7,35.8,-114.1,32.5', bounded: '0' }).toString();
  const r = await fetch(u);
  if (!r.ok) throw new Error(`Nominatim error ${r.status}`);
  return (await r.json()).map((p: any) => ({ label: p.display_name, at: [+p.lon, +p.lat] as LngLat }));
}

// ---------- snap to roads ----------
export async function snap(path: LngLat[]): Promise<LngLat[]> {
  if (path.length < 2) return path;
  if (settings.snap === 'google') {
    const p = path.map(([x, y]) => `${y},${x}`).join('|');
    const r = await fetch(`https://roads.googleapis.com/v1/snapToRoads?interpolate=true&path=${encodeURIComponent(p)}&key=${GOOGLE_KEY}`);
    if (!r.ok) throw new Error(`Google Roads error ${r.status}`);
    const j = await r.json();
    return (j.snappedPoints || []).map((s: any) => [s.location.longitude, s.location.latitude] as LngLat);
  }
  // OSRM public demo server (fair use). Uses route through the points, which follows the street network.
  const coords = path.map(([x, y]) => `${x.toFixed(6)},${y.toFixed(6)}`).join(';');
  const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`);
  const j = await r.json();
  if (j.code !== 'Ok') throw new Error(`OSRM: ${j.message || j.code}`);
  return j.routes[0].geometry.coordinates as LngLat[];
}

// ---------- elevation (USGS 3DEP, open) ----------
export async function elevationFt([x, y]: LngLat): Promise<number | null> {
  try {
    const r = await fetch(`https://epqs.nationalmap.gov/v1/json?x=${x}&y=${y}&units=Feet&wkid=4326`);
    const v = +(await r.json()).value;
    return Number.isFinite(v) && v > -1000 ? v : null;
  } catch { return null; }
}

// ---------- geometry ----------
const R = 20902231; // earth radius, ft
export function lengthFt(path: LngLat[]) {
  let s = 0;
  for (let i = 1; i < path.length; i++) {
    const [x1, y1] = path[i - 1], [x2, y2] = path[i];
    const p1 = y1 * Math.PI / 180, p2 = y2 * Math.PI / 180, dp = p2 - p1, dl = (x2 - x1) * Math.PI / 180;
    const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    s += 2 * R * Math.asin(Math.sqrt(a));
  }
  return s;
}
export function bearing([x1, y1]: LngLat, [x2, y2]: LngLat) {
  const p1 = y1 * Math.PI / 180, p2 = y2 * Math.PI / 180, dl = (x2 - x1) * Math.PI / 180;
  const b = Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl));
  return (b * 180 / Math.PI + 360) % 360;
}

// ---------- street-level imagery ----------
export interface StreetImage { src: string; source: string; credit: string; link?: string; heading?: number; at: LngLat }

export async function streetImage(at: LngLat, heading: number): Promise<StreetImage | null> {
  const [x, y] = at;
  if (settings.street === 'google') {
    const meta = await fetch(`https://maps.googleapis.com/maps/api/streetview/metadata?location=${y},${x}&source=outdoor&key=${GOOGLE_KEY}`).then(r => r.json()).catch(() => null);
    if (meta && meta.status && meta.status !== 'OK') return null;
    const loc = meta?.pano_id ? `pano=${meta.pano_id}` : `location=${y},${x}`;
    return {
      src: `https://maps.googleapis.com/maps/api/streetview?size=640x400&scale=2&${loc}&heading=${heading.toFixed(0)}&pitch=0&fov=80&source=outdoor&key=${GOOGLE_KEY}`,
      source: 'Google Street View', credit: `© Google${meta?.date ? ', ' + meta.date : ''}`, heading, at,
      link: `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${y},${x}&heading=${heading.toFixed(0)}`
    };
  }
  const d = 0.0012;
  if (settings.street === 'panoramax') {
    const r = await fetch(`https://api.panoramax.xyz/api/search?bbox=${x - d},${y - d},${x + d},${y + d}&limit=20`);
    const j = await r.json();
    const f = nearest(j.features || [], at, (f: any) => f.geometry.coordinates);
    if (!f) return null;
    return { src: f.assets.sd?.href || f.assets.hd?.href, source: 'Panoramax', credit: `${f.properties?.exif?.['Exif.Image.Artist'] || 'Panoramax contributor'}, CC-BY-SA 4.0`, link: `https://api.panoramax.xyz/#focus=pic&pic=${f.id}`, at: f.geometry.coordinates };
  }
  if (!settings.mapillaryToken) throw new Error('Add a Mapillary access token first');
  const r = await fetch(`https://graph.mapillary.com/images?access_token=${encodeURIComponent(settings.mapillaryToken)}&fields=id,thumb_1024_url,geometry,compass_angle,creator&bbox=${x - d},${y - d},${x + d},${y + d}&limit=30`);
  const j = await r.json();
  if (j.error) throw new Error(`Mapillary: ${j.error.message}`);
  const f = nearest(j.data || [], at, (f: any) => f.geometry.coordinates);
  if (!f) return null;
  return { src: f.thumb_1024_url, source: 'Mapillary', credit: `${f.creator?.username || 'Mapillary contributor'}, CC-BY-SA 4.0`, link: `https://www.mapillary.com/app/?pKey=${f.id}`, heading: f.compass_angle, at: f.geometry.coordinates };
}

function nearest<T>(items: T[], at: LngLat, get: (t: T) => LngLat): T | null {
  let best: T | null = null, bd = Infinity;
  for (const it of items) { const d = lengthFt([at, get(it)]); if (d < bd) { bd = d; best = it; } }
  return best;
}
