import type { Stage } from './index';
import { project } from '../lib/project';
import { MapView } from '../lib/mapView';
import { BASEMAPS, settings, saveSettings, geocode, snap, elevationFt, lengthFt, bearing, streetImage, type LngLat, type StreetImage } from '../lib/providers';

const esc = (t: string) => t.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const opt = (v: string, label: string, cur: string) => `<option value="${v}"${v === cur ? ' selected' : ''}>${label}</option>`;

export const siteStage: Stage = {
  id: 'site', name: 'Site',
  render(side, canvas) {
    const seg = project.seg();
    side.innerHTML = `<h2>1. SITE</h2>
      <form id="sf" class="field"><label for="q">Search address or intersection</label>
        <div class="row" style="margin:0"><input id="q" placeholder="Sunset Blvd and Vermont Ave" style="flex:1 1 180px">
        <select id="geo" class="sel" style="flex:0 1 150px" aria-label="Search provider">${opt('auto', 'Auto (open first)', settings.geocoder)}${opt('nominatim', 'OpenStreetMap', settings.geocoder)}${opt('google', 'Google Places', settings.geocoder)}</select>
        <button class="btn">Search</button></div></form>
      <ul id="res" class="results"></ul>
      <div class="field"><label for="bm">Basemap</label><select id="bm">${BASEMAPS.map(b => opt(b.id, b.label, settings.basemap)).join('')}</select></div>
      <div class="row"><input id="from" class="sel" placeholder="Limit from" value="${esc(seg.limits.from)}" aria-label="Limit from"><input id="to" class="sel" placeholder="Limit to" value="${esc(seg.limits.to)}" aria-label="Limit to"></div>
      <h3 style="margin-top:1rem">SEGMENT</h3>
      <p class="note">Click the map to place points along the corridor.</p>
      <div class="row">
        <select id="snapP" class="sel" style="flex:0 1 150px" aria-label="Snap provider">${opt('osrm', 'Snap: OSRM', settings.snap)}${opt('google', 'Snap: Google Roads', settings.snap)}</select>
        <button class="btn ghost" id="snap">Snap to street</button><button class="btn ghost" id="km">Save key map</button><button class="btn ghost" id="undo">Undo</button><button class="btn ghost" id="clear">Clear</button>
      </div>
      <table><tbody>
        <tr><td>Length</td><td class="num" id="len">—</td></tr>
        <tr><td>Grade (end to end, USGS 3DEP)</td><td class="num" id="grade">—</td></tr>
      </tbody></table>
      <h3 style="margin-top:1rem">STREET-LEVEL VIEW</h3>
      <div class="row">
        <select id="sv" class="sel" aria-label="Street imagery source">${opt('google', 'Google Street View', settings.street)}${opt('panoramax', 'Panoramax (open)', settings.street)}${opt('mapillary', 'Mapillary (token)', settings.street)}</select>
        <button class="btn" id="cap">Capture at start</button>
      </div>
      <div class="field" id="mlyWrap" ${settings.street === 'mapillary' ? '' : 'hidden'}><label for="mly">Mapillary access token</label><input id="mly" type="password" value="${esc(settings.mapillaryToken)}" autocomplete="off"></div>
      <div id="svOut"></div>
      <p id="msg" class="note" role="status"></p>`;

    canvas.innerHTML = `<div class="map" id="map"></div>`;
    let gradeTimer = 0;
    const path = (seg.path ?? []) as LngLat[];
    siteStage.dispose = () => { clearTimeout(gradeTimer); mv.map.remove(); };
    const mv = new MapView(canvas.querySelector('#map') as HTMLElement, seg.location ? [seg.location.lng, seg.location.lat] : undefined, [...path]);
    const $ = <T extends HTMLElement>(s: string) => side.querySelector(s) as T;
    const msg = (t: string) => { $('#msg').textContent = t; };

    const refresh = async (p: LngLat[]) => {
      const len = Math.round(lengthFt(p));
      project.update(() => {
        seg.path = p.map(c => [c[0], c[1]]);
        seg.length_ft = len;
        if (p[0]) seg.location = { lng: p[0][0], lat: p[0][1], heading: p[1] ? bearing(p[0], p[1]) : undefined };
      });
      $('#len').textContent = len ? `${len.toLocaleString()}'` : '—';
      $('#grade').textContent = seg.grade_pct != null && p.length > 1 ? `${seg.grade_pct.toFixed(1)}%` : '—';
    };
    mv.onChange = p => {
      refresh(p);
      clearTimeout(gradeTimer);
      if (p.length > 1) gradeTimer = window.setTimeout(async () => {
        const [a, b] = await Promise.all([elevationFt(p[0]), elevationFt(p[p.length - 1])]);
        const L = lengthFt(p);
        if (a != null && b != null && L > 0) { project.update(() => { seg.grade_pct = ((b - a) / L) * 100; }); $('#grade').textContent = `${seg.grade_pct!.toFixed(1)}% (${Math.round(a)}' → ${Math.round(b)}')`; }
      }, 600);
    };
    refresh(path);

    $('#bm').addEventListener('change', e => mv.setBasemap((e.target as HTMLSelectElement).value));
    $('#geo').addEventListener('change', e => { settings.geocoder = (e.target as HTMLSelectElement).value as typeof settings.geocoder; saveSettings(); });
    $('#snapP').addEventListener('change', e => { settings.snap = (e.target as HTMLSelectElement).value as typeof settings.snap; saveSettings(); });
    $('#sv').addEventListener('change', e => { settings.street = (e.target as HTMLSelectElement).value as typeof settings.street; saveSettings(); $('#mlyWrap').hidden = settings.street !== 'mapillary'; });
    $('#mly').addEventListener('change', e => { settings.mapillaryToken = (e.target as HTMLInputElement).value.trim(); saveSettings(); });
    (['from', 'to'] as const).forEach(k => $('#' + k).addEventListener('change', e => project.update(() => { seg.limits[k] = (e.target as HTMLInputElement).value; })));

    $('#sf').addEventListener('submit', async e => {
      e.preventDefault();
      const q = ($('#q') as HTMLInputElement).value.trim();
      if (!q) return;
      msg('Searching…');
      try {
        const res = await geocode(q);
        $('#res').innerHTML = res.map((r, i) => `<li><button type="button" data-i="${i}">${esc(r.label)}</button></li>`).join('') || '<li class="note">No results</li>';
        $('#res').onclick = ev => { const b = (ev.target as HTMLElement).closest('button[data-i]') as HTMLElement | null; if (b) mv.flyTo(res[+b.dataset.i!].at); };
        if (res[0]) mv.flyTo(res[0].at);
        msg(res[0] ? `Search by ${res[0].by}${res[0].by.startsWith('Open') ? ' © OpenStreetMap contributors' : ''}` : 'No results from any source');
      } catch (err) { msg(String((err as Error).message)); }
    });
    $('#snap').addEventListener('click', async () => {
      msg('Snapping…');
      try { mv.setPath(await snap(mv.getPath())); msg(settings.snap === 'osrm' ? 'Snapped with OSRM (OpenStreetMap)' : 'Snapped with Google Roads'); }
      catch (err) { msg(String((err as Error).message)); }
    });
    $('#undo').addEventListener('click', () => { const p = mv.getPath(); p.pop(); mv.setPath(p); });
    $('#clear').addEventListener('click', () => mv.setPath([]));
    $('#km').addEventListener('click', () => {
      try {
        const p = mv.getPath();
        if (p.length > 1) { const xs = p.map(c => c[0]), ys = p.map(c => c[1]); mv.map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: 60, duration: 0 }); }
        mv.map.once('idle', () => {
          const src = mv.map.getCanvas();
          const c = document.createElement('canvas'); const k = Math.min(1, 1400 / src.width);
          c.width = src.width * k; c.height = src.height * k; c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height);
          project.update(() => { seg.keymap = c.toDataURL('image/jpeg', 0.85); });
          msg('Key map saved for the sheets.');
        });
        mv.map.triggerRepaint();
      } catch (err) { msg('Key map could not be saved: ' + (err as Error).message); }
    });

    $('#cap').addEventListener('click', async () => {
      const p = mv.getPath();
      const center = mv.map.getCenter();
      const at: LngLat = p[0] ?? [center.lng, center.lat];
      const heading = p[1] ? bearing(p[0], p[1]) : 0;
      msg('Finding imagery…');
      try {
        const img = await streetImage(at, heading);
        if (!img) { $('#svOut').innerHTML = ''; msg('No imagery found here from this source. Try another source.'); return; }
        showStreet(img);
        msg('');
      } catch (err) { msg(String((err as Error).message)); }
    });

    function showStreet(img: StreetImage) {
      $('#svOut').innerHTML = `<figure class="sv"><img src="${esc(img.src)}" alt="Street-level view from ${esc(img.source)}">
        <figcaption>${esc(img.source)} · ${esc(img.credit)}${img.link ? ` · <a href="${esc(img.link)}" target="_blank" rel="noopener">open</a>` : ''}</figcaption></figure>
        <button class="btn" id="useSv">Use for Visualize</button>`;
      $('#useSv').addEventListener('click', () => {
        project.update(() => { seg.perspective = { src: img.src, source: img.source, credit: img.credit, link: img.link, heading: img.heading }; });
        location.hash = '#visualize';
      });
    }
    if (seg.perspective && seg.perspective.source !== 'Upload') showStreet({ ...seg.perspective, at: [0, 0] } as StreetImage);
  }
};
