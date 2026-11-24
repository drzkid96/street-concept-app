// Hybrid provider layer: open services by default, Google as an option for each.
import { GOOGLE_KEY } from './config';

export type LngLat = [number, number];

// ---------- settings (remembered per browser) ----------
export interface Settings {
  basemap: string; geocoder: 'auto' | 'nominatim' | 'google'; snap: 'osrm' | 'google';
  street: 'google' | 'panoramax' | 'mapillary'; mapillaryToken: string;
}
const SKEY = 'sca-settings-v2';
const DEFAULTS: Settings = { basemap: 'google-satellite', geocoder: 'auto', snap: 'osrm', street: 'google', mapillaryToken: '' };
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
export interface Place { label: string; at: LngLat; by: string }
// Search: Google first (Places text search reads messy input; Geocoding handles intersections), then OpenStreetMap.
export function tidyQuery(q: string) {
  return q.replace(/\s+/g, ' ').replace(/\s*(&|@|\/|\+| x | at )\s*/gi, ' and ').replace(/\b(st|ave|blvd|dr|rd)\./gi, '$1').trim();
}
async function googleGeocode(q: string): Promise<Place[]> {
  const maps = await loadMaps();
  const r = await new maps.Geocoder().geocode({ address: q, region: 'us', bounds: { south: 32.5, west: -120.7, north: 35.8, east: -114.1 } }).catch(() => ({ results: [] }));
  return (r.results || []).map((p: any) => ({ label: p.formatted_address, at: [p.geometry.location.lng(), p.geometry.location.lat()] as LngLat, by: 'Google' }));
}
export async function geocode(raw: string): Promise<Place[]> {
  const q = tidyQuery(raw);
  if (settings.geocoder === 'nominatim') return nominatim(q);
  const [a, b] = await Promise.allSettled([google(q), googleGeocode(q)]);
  const out: Place[] = [];
  for (const r of [a, b]) if (r.status === 'fulfilled') for (const p of r.value)
    if (!out.some(o => Math.abs(o.at[0] - p.at[0]) < 2e-4 && Math.abs(o.at[1] - p.at[1]) < 2e-4)) out.push(p);
  if (out.length || settings.geocoder === 'google') return out;
  return nominatim(q).catch(() => [] as Place[]);
}
// Full address of a point (Google reverse geocoding): street address, city, county.
export async function reverseAddress([x, y]: LngLat): Promise<{ address: string; city: string; street: string } | null> {
  try {
    const maps = await loadMaps();
    const r = await new maps.Geocoder().geocode({ location: { lat: y, lng: x } });
    const r0 = r.results?.[0]; if (!r0) return null;
    const comp = (t: string) => r.results.flatMap((q: any) => q.address_components).find((c: any) => c.types.includes(t))?.long_name;
    return { address: r0.formatted_address, city: comp('locality') || comp('administrative_area_level_3') || comp('administrative_area_level_2') || '', street: comp('route') || '' };
  } catch { return null; }
}
async function google(q: string): Promise<Place[]> {
  {
    const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': GOOGLE_KEY, 'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location' },
      body: JSON.stringify({ textQuery: q, locationBias: { rectangle: { low: { latitude: 32.5, longitude: -120.7 }, high: { latitude: 35.8, longitude: -114.1 } } } })
    });
    if (!r.ok) throw new Error(`Google Places error ${r.status}`);
    const j = await r.json();
    return (j.places || []).map((p: any) => ({ label: p.formattedAddress || p.displayName?.text, at: [p.location.longitude, p.location.latitude] as LngLat, by: 'Google Places' }));
  }
}
async function nominatim(q: string): Promise<Place[]> {
  // Nominatim: 1 request/second max, no autocomplete (OSMF usage policy). Search runs on submit only.
  const u = new URL('https://nominatim.openstreetmap.org/search');
  u.search = new URLSearchParams({ q, format: 'jsonv2', limit: '6', countrycodes: 'us', viewbox: '-120.7,35.8,-114.1,32.5', bounded: '0' }).toString();
  const r = await fetch(u);
  if (!r.ok) throw new Error(`Nominatim error ${r.status}`);
  return (await r.json()).map((p: any) => ({ label: p.display_name, at: [+p.lon, +p.lat] as LngLat, by: 'OpenStreetMap (Nominatim)' }));
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
  // The demo server routes cars, so it obeys one-way streets. If the clicks run against the
  // one-way direction the route detours around the block: retry in reverse and keep the user's order.
  const route = async (pts: LngLat[]) => {
    const coords = pts.map(([x, y]) => `${x.toFixed(6)},${y.toFixed(6)}`).join(';');
    const j = await (await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`)).json();
    if (j.code !== 'Ok') throw new Error(`OSRM: ${j.message || j.code}`);
    return j.routes[0].geometry.coordinates as LngLat[];
  };
  const direct = lengthFt(path);
  const fwd = await route(path);
  if (lengthFt(fwd) <= direct * 1.3 + 50) return fwd;
  const rev = (await route([...path].reverse())).reverse();
  return lengthFt(rev) < lengthFt(fwd) ? rev : fwd;
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
    if (meta?.status === 'REQUEST_DENIED') throw new Error(`Google refused the key from this site (${location.host}). Add it to the key's website restrictions.`);
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
    const e = 0.004; // ~400 m: open coverage is sparser
    const r = await fetch(`https://api.panoramax.xyz/api/search?bbox=${x - e},${y - e},${x + e},${y + e}&limit=50`);
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

// Google satellite aerial of a path, for the cover sheet: centre and zoom chosen to fit, returned as a data URL.
export async function aerialOf(path: LngLat[]): Promise<{ dataUrl: string; center: LngLat; zoom: number; scale: number }> {
  const merc = ([lon, lat]: LngLat) => { const s = Math.sin(lat * Math.PI / 180); return [(lon + 180) / 360 * 256, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 256]; };
  const xs = path.map(p => merc(p)[0]), ys = path.map(p => merc(p)[1]);
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1e-6);
  const zoom = Math.max(13, Math.min(20, Math.floor(Math.log2(440 / span))));
  const lons = path.map(p => p[0]), lats = path.map(p => p[1]);
  const center: LngLat = [(Math.min(...lons) + Math.max(...lons)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2];
  const u = `https://maps.googleapis.com/maps/api/staticmap?center=${center[1]},${center[0]}&zoom=${zoom}&size=640x640&scale=2&maptype=satellite&key=${GOOGLE_KEY}`;
  const blob = await fetch(u).then(r => { if (!r.ok) throw new Error(`Google aerial ${r.status}`); return r.blob(); });
  const dataUrl = await new Promise<string>(res => { const fr = new FileReader(); fr.onload = () => res(fr.result as string); fr.readAsDataURL(blob); });
  return { dataUrl, center, zoom, scale: 2 };
}

// Google Maps JavaScript API (works with the site-restricted key; the Geocoding web service does not).
let gm: Promise<any> | null = null;
export function loadMaps(): Promise<any> {
  return gm ??= new Promise((res, rej) => {
    (window as any).__gmInit = () => res((window as any).google.maps);
    (window as any).gm_authFailure = () => { gm = null; rej(new Error('Google refused the key for Street View on this site.')); };
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_KEY}&callback=__gmInit&loading=async&v=weekly`;
    s.onerror = () => { gm = null; rej(new Error('Google Maps could not load.')); };
    document.head.appendChild(s);
  });
}
