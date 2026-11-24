// Small high-resolution aerial of the segment for checking lanes, with a measuring tool.
// The measurement is in ground feet, so it stays true at any zoom; the scale bar follows the zoom too.
import maplibregl from 'maplibre-gl';
import { styleFor } from './mapView';
import { lengthFt, type LngLat } from './providers';

export function aerialMini(host: HTMLElement, path: LngLat[]) {
  host.innerHTML = `<div class="mini-map"><div class="mm" ></div>
    <div class="mm-tools"><button class="btn ghost sm" data-m="measure" aria-pressed="false">Measure</button><button class="btn ghost sm" data-m="clear">Clear</button><span class="mm-out" aria-live="polite">Measure a lane: press Measure, then click two points.</span></div></div>`;
  const el = host.querySelector('.mm') as HTMLElement;
  const xs = path.map(p => p[0]), ys = path.map(p => p[1]);
  const map = new maplibregl.Map({ container: el, style: { version: 8, sources: {}, layers: [] }, center: path[0] ?? [-118.25, 34.05], zoom: 18, attributionControl: { compact: true } });
  map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right');
  map.addControl(new maplibregl.ScaleControl({ unit: 'imperial', maxWidth: 140 }), 'bottom-left');
  let pts: LngLat[] = [], measuring = false;
  const out = host.querySelector('.mm-out') as HTMLElement, btn = host.querySelector('[data-m=measure]') as HTMLButtonElement;
  const draw = () => {
    if (!map.isStyleLoaded()) return;
    const fc = (f: any[]) => ({ type: 'FeatureCollection', features: f });
    const seg = fc(path.length > 1 ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: path } }] : []);
    const ms = fc([...(pts.length > 1 ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts } }] : []), ...pts.map(p => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: p } }))]);
    for (const [id, data] of [['seg', seg], ['ms', ms]] as const) {
      const src = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
      if (src) src.setData(data as any); else map.addSource(id, { type: 'geojson', data: data as any });
    }
    if (!map.getLayer('seg')) {
      map.addLayer({ id: 'seg', type: 'line', source: 'seg', paint: { 'line-color': '#6BD688', 'line-width': 3, 'line-opacity': 0.8 } });
      map.addLayer({ id: 'ms', type: 'line', source: 'ms', filter: ['==', '$type', 'LineString'], paint: { 'line-color': '#FFD400', 'line-width': 2.5 } });
      map.addLayer({ id: 'msp', type: 'circle', source: 'ms', filter: ['==', '$type', 'Point'], paint: { 'circle-radius': 4, 'circle-color': '#FFD400', 'circle-stroke-color': '#00242E', 'circle-stroke-width': 1.5 } });
    }
  };
  styleFor('google-satellite').then(st => { map.setStyle(st as any); map.once('styledata', () => setTimeout(draw, 50)); }).catch(() => { out.textContent = 'The aerial could not load.'; });
  const fitSeg = () => {
    if (path.length < 2) return;
    const lat = ys[0], dy = 50 / 364000, dx = dy / Math.cos(lat * Math.PI / 180);   // about 50 ft around the segment
    map.setMinZoom(0);
    map.fitBounds([[Math.min(...xs) - dx, Math.min(...ys) - dy], [Math.max(...xs) + dx, Math.max(...ys) + dy]], { padding: 8, maxZoom: 21, duration: 0 });
    map.setMinZoom(map.getZoom());   // zooming out stops here; panning stays free
  };
  map.on('load', fitSeg); const ro = new ResizeObserver(() => { try { map.resize(); fitSeg(); } catch { /* map removed */ } }); ro.observe(el);
  map.on('idle', draw);
  map.on('click', e => {
    if (!measuring) return;
    if (pts.length >= 2) pts = [];
    pts.push([e.lngLat.lng, e.lngLat.lat]);
    if (pts.length === 2) out.innerHTML = `<b>${lengthFt(pts).toFixed(1)} ft</b> between the two points.`;
    draw();
  });
  btn.addEventListener('click', () => { measuring = !measuring; btn.setAttribute('aria-pressed', String(measuring)); map.getCanvas().style.cursor = measuring ? 'crosshair' : ''; out.textContent = measuring ? 'Click two points, for example curb to lane line.' : 'Measure a lane: press Measure, then click two points.'; });
  host.querySelector('[data-m=clear]')!.addEventListener('click', () => { pts = []; draw(); out.textContent = measuring ? 'Click two points.' : ''; });
  return () => { ro.disconnect(); map.remove(); };
}
