import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { BASEMAPS, googleTileUrl, settings, saveSettings, type LngLat } from './providers';
import { LA } from './config';

const OVERLAY = { line: 'seg-line', pts: 'seg-pts' };

async function styleFor(id: string): Promise<string | maplibregl.StyleSpecification> {
  const b = BASEMAPS.find(x => x.id === id) ?? BASEMAPS[0]; // unknown or retired ids fall back to streets
  if (b.kind === 'style') return b.url!;
  const tiles = b.kind === 'google' ? await googleTileUrl() : b.url!;
  return {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: { base: { type: 'raster', tiles: [tiles], tileSize: 256, maxzoom: b.maxzoom ?? 19, attribution: b.kind === 'google' ? 'Map data © Google' : b.attribution } },
    layers: [{ id: 'base', type: 'raster', source: 'base' }]
  };
}

export class MapView {
  map: maplibregl.Map;
  private path: LngLat[] = [];
  onChange: (p: LngLat[]) => void = () => {};

  constructor(el: HTMLElement, center?: LngLat, path: LngLat[] = []) {
    this.path = path;
    this.map = new maplibregl.Map({ container: el, style: BASEMAPS[0].url!, center: center ?? LA, zoom: center ? 17 : 11, attributionControl: { compact: true }, canvasContextAttributes: { preserveDrawingBuffer: true } });
    this.map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    this.map.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-left');
    this.map.on('style.load', () => this.drawOverlay());
    this.map.on('click', e => { this.path.push([e.lngLat.lng, e.lngLat.lat]); this.changed(); });
    this.setBasemap(settings.basemap);
  }

  async setBasemap(id: string) {
    settings.basemap = id; saveSettings();
    try { this.map.setStyle(await styleFor(id)); }
    catch (err) { console.warn(err); this.map.setStyle(BASEMAPS[0].url!); }
  }

  setPath(p: LngLat[]) { this.path = p; this.changed(); }
  getPath() { return this.path; }
  flyTo(at: LngLat) { this.map.flyTo({ center: at, zoom: 18 }); }

  private changed() { this.drawOverlay(); this.onChange(this.path); }

  private drawOverlay() {
    const m = this.map;
    if (!m.isStyleLoaded()) return;
    const line = { type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: this.path } };
    const pts = { type: 'FeatureCollection' as const, features: this.path.map((c, i) => ({ type: 'Feature' as const, properties: { i }, geometry: { type: 'Point' as const, coordinates: c } })) };
    const src = m.getSource(OVERLAY.line) as maplibregl.GeoJSONSource | undefined;
    if (src) { src.setData(line); (m.getSource(OVERLAY.pts) as maplibregl.GeoJSONSource).setData(pts); return; }
    m.addSource(OVERLAY.line, { type: 'geojson', data: line });
    m.addSource(OVERLAY.pts, { type: 'geojson', data: pts });
    m.addLayer({ id: OVERLAY.line + '-casing', type: 'line', source: OVERLAY.line, paint: { 'line-color': '#00242E', 'line-width': 8 } });
    m.addLayer({ id: OVERLAY.line, type: 'line', source: OVERLAY.line, paint: { 'line-color': '#6BD688', 'line-width': 4 } });
    m.addLayer({ id: OVERLAY.pts, type: 'circle', source: OVERLAY.pts, paint: { 'circle-radius': 5, 'circle-color': '#FFFFFF', 'circle-stroke-color': '#00574A', 'circle-stroke-width': 2 } });
  }
}
