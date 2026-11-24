import { live, repaintNav, type Stage } from './index';
import { project } from '../lib/project';
import { MapView } from '../lib/mapView';
import { BASEMAPS, settings, saveSettings, geocode, snap, elevationFt, lengthFt, bearing, reverseAddress, type LngLat } from '../lib/providers';
import { head, task, more, esc } from './ui';
import { SCENES } from '../lib/scenes';

const opt = (v: string, label: string, cur: string) => `<option value="${v}"${v === cur ? ' selected' : ''}>${label}</option>`;

export const siteStage: Stage = {
  id: 'site', name: 'Site',
  done: () => (project.seg().path?.length ?? 0) > 1,
  render(side, canvas) {
    const gen = live.gen;
    const seg = project.seg();
    const path = (seg.path ?? []) as LngLat[];
    let clicks: LngLat[] = (seg.clicks as LngLat[] | undefined) ?? (path.length > 1 ? [path[0], path[path.length - 1]] : [...path]);
    const has = path.length > 1;
    side.innerHTML = `${head(1, 'Site', 'Find the street and mark the stretch you are studying.')}
      ${task(1, 'Find the street', has ? 'done' : 'now', `
        <form id="sf" class="row"><input id="q" class="sel" placeholder="Address, intersection or place, any format" aria-label="Search"><button class="btn">Search</button></form>
        <ul id="res" class="results"></ul>`)}
      ${task(2, 'Mark the segment', has ? 'done' : 'now', `
        <p class="note">Click on the map where the segment <b>starts</b>, then where it <b>ends</b>. The line follows the street. Click again to extend it.</p>
        <div class="row"><button class="btn ghost" id="undo">Undo last click</button><button class="btn ghost" id="clear">Start over</button></div>
        <dl class="facts"><div><dt>Length</dt><dd id="len">—</dd></div><div><dt>Grade</dt><dd id="grade">—</dd></div></dl>`)}
      ${task(3, 'Describe the setting', has ? 'now' : 'later', `
        <div class="field"><label for="city">City (from the address; sets the regional prices)</label><input id="city" value="${esc(seg.city ?? 'Los Angeles')}"></div>
        <div class="field"><label for="scene">Frontage (what lines the street)</label><select id="scene">
          <option value=""${seg.settingPinned ? '' : ' selected'}>Automatic: read OpenStreetMap land use nearby</option>
          ${SCENES.map(([v, l]) => `<option value="${v}"${seg.settingPinned && v === seg.setting ? ' selected' : ''}>${l}</option>`).join('')}</select>
          <span class="note">Sets the buildings, sidewalks and scenery in the drawings, and the cost complexity. With no clear land use it is LA residential with sidewalks.</span></div>`)}
      ${more(`
        <div class="field"><label for="from">Street name (for sheet titles)</label><input id="from" value="${esc(seg.limits.from)}"></div>
        <div class="field"><label for="to">Limits (for example "Los Feliz Blvd to Riverside Dr")</label><input id="to" value="${esc(seg.limits.to)}"></div>
        <div class="field"><label for="bm">Map style</label><select id="bm">${BASEMAPS.map(b => opt(b.id, b.label, settings.basemap)).join('')}</select></div>
        <div class="field"><label for="geo">Search with</label><select id="geo">${opt('auto', 'Google, then OpenStreetMap', settings.geocoder)}${opt('google', 'Google only', settings.geocoder)}${opt('nominatim', 'OpenStreetMap only', settings.geocoder)}</select></div>
        <div class="field"><label for="snapP">Follow streets with</label><select id="snapP">${opt('osrm', 'OpenStreetMap routing', settings.snap)}${opt('google', 'Google Roads', settings.snap)}</select></div>`)}
      <p id="msg" class="note" role="status"></p>`;

    canvas.innerHTML = `<div class="map" id="map"></div><div class="maphint" id="hint"${has ? ' hidden' : ''}>Click the start of the segment</div>`;
    let gradeTimer = 0, busy = 0;
    const mv = new MapView(canvas.querySelector('#map') as HTMLElement, seg.location ? [seg.location.lng, seg.location.lat] : undefined, [...path]);
    siteStage.dispose = () => { clearTimeout(gradeTimer); mv.map.remove(); };
    const $ = <T extends HTMLElement>(s: string) => side.querySelector(s) as T;
    const msg = (t: string) => { $('#msg').textContent = t; };
    const hint = (t: string) => { const h = canvas.querySelector('#hint') as HTMLElement; h.hidden = !t; h.textContent = t; };

    const keymap = () => {
      // Snapshot of the current map view for the sheets, taken once the tiles have drawn.
      let done = false;
      const grab = () => {
        if (done || gen !== live.gen) return; done = true;
        try {
          const src = mv.map.getCanvas(), c = document.createElement('canvas'), k = Math.min(1, 1400 / src.width);
          c.width = src.width * k; c.height = src.height * k; c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height);
          // section cut across the street at the segment midpoint, in key map pixels
          const pp = mv.getPath(), mid = pp[Math.floor(pp.length / 2)], nxt = pp[Math.min(pp.length - 1, Math.floor(pp.length / 2) + 1)] ?? mid;
          const r = src.width / src.clientWidth * k, a = mv.map.project(mid as [number, number]), b2 = mv.map.project(nxt as [number, number]);
          const L = Math.hypot(b2.x - a.x, b2.y - a.y) || 1, nx = -(b2.y - a.y) / L, ny = (b2.x - a.x) / L, h = 26;
          project.update(() => { seg.keymap = c.toDataURL('image/jpeg', 0.85); seg.keymapCut = [[(a.x - nx * h) * r, (a.y - ny * h) * r], [(a.x + nx * h) * r, (a.y + ny * h) * r]]; });
          (window as any).__paintAddr?.();
        } catch { /* keymap is optional */ }
      };
      const pp = mv.getPath(); if (pp.length > 1) { const xs = pp.map(q => q[0]), ys = pp.map(q => q[1]); mv.map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: 90, maxZoom: 18.5, duration: 0 }); }
      mv.map.once('idle', grab); setTimeout(grab, 3500);
    };
    const show = (p: LngLat[]) => {
      const len = Math.round(lengthFt(p));
      project.update(() => {
        seg.path = p.map(c => [c[0], c[1]]); seg.clicks = clicks.map(c => [c[0], c[1]]); seg.length_ft = len;
        if (p[0]) seg.location = { lng: p[0][0], lat: p[0][1], heading: p[1] ? bearing(p[0], p[1]) : undefined };
      });
      $('#len').textContent = len ? `${len.toLocaleString()} ft` : '—';
      $('#grade').textContent = seg.grade_pct != null && p.length > 1 ? `${seg.grade_pct.toFixed(1)}%` : '—';
      repaintNav();
    };
    mv.onChange = p => {
      show(p);
      clearTimeout(gradeTimer);
      if (p.length > 1) gradeTimer = window.setTimeout(async () => {
        const [a, b] = await Promise.all([elevationFt(p[0]), elevationFt(p[p.length - 1])]);
        const L = lengthFt(p);
        if (gen === live.gen && a != null && b != null && L > 0) { project.update(() => { seg.grade_pct = ((b - a) / L) * 100; }); $('#grade').textContent = `${seg.grade_pct!.toFixed(1)}%`; }
      }, 600);
    };
    const resnap = async () => {
      const mine = ++busy;
      mv.setMarks(clicks);
      if (clicks.length < 2) { mv.setPath([...clicks]); hint(clicks.length ? 'Now click the end of the segment' : 'Click the start of the segment'); return; }
      hint(''); msg('Following the street…');
      try { const p = await snap(clicks); if (mine === busy && gen === live.gen) { mv.setPath(p); msg(''); keymap(); locate(p); } }
      catch (err) { if (mine === busy) { mv.setPath([...clicks]); msg('Could not follow the street, so the line is straight: ' + (err as Error).message); } }
    };
    const locate = async (p: LngLat[]) => {
      const a = await reverseAddress(p[Math.floor(p.length / 2)]);
      if (!a || gen !== live.gen) return;
      project.update(() => { seg.address = a.address; if (a.city && (!seg.city || seg.cityAuto)) { seg.city = a.city; seg.cityAuto = true; } });
      const c = side.querySelector('#city') as HTMLInputElement | null; if (c && seg.cityAuto) c.value = seg.city ?? '';
      (window as any).__paintAddr?.();
    };
    mv.onPick = at => { clicks.push(at); resnap(); };
    if (path.length > 1 && !seg.address) locate(path);   // segments drawn before the address lookup existed
    mv.setMarks(clicks);
    show(path);

    $('#undo').addEventListener('click', () => { clicks.pop(); resnap(); });
    $('#clear').addEventListener('click', () => { clicks = []; resnap(); });
    $('#bm').addEventListener('change', e => mv.setBasemap((e.target as HTMLSelectElement).value));
    $('#geo').addEventListener('change', e => { settings.geocoder = (e.target as HTMLSelectElement).value as typeof settings.geocoder; saveSettings(); });
    $('#snapP').addEventListener('change', e => { settings.snap = (e.target as HTMLSelectElement).value as typeof settings.snap; saveSettings(); if (clicks.length > 1) resnap(); });
    $('#city').addEventListener('change', e => project.update(() => { seg.city = (e.target as HTMLInputElement).value.trim() || 'Los Angeles'; seg.cityAuto = false; }));
    $('#scene').addEventListener('change', e => project.update(() => {
      const v = (e.target as HTMLSelectElement).value;
      seg.settingPinned = !!v;
      if (v) seg.setting = v; else delete seg.existingAuto;   // automatic: the next Existing fill reads land use again
    }));
    (['from', 'to'] as const).forEach(k => $('#' + k).addEventListener('change', e => project.update(() => { seg.limits[k] = (e.target as HTMLInputElement).value; })));

    $('#sf').addEventListener('submit', async e => {
      e.preventDefault();
      const q = ($('#q') as HTMLInputElement).value.trim();
      if (!q) return;
      msg('Searching…');
      try {
        const res = await geocode(q);
        if (gen !== live.gen) return;
        $('#res').innerHTML = res.slice(0, 5).map((r, i) => `<li><button type="button" data-i="${i}">${esc(r.label)}</button></li>`).join('') || '<li class="note">Nothing found. Try a cross street or a full address.</li>';
        $('#res').onclick = ev => { const b = (ev.target as HTMLElement).closest('button[data-i]') as HTMLElement | null; if (b) mv.flyTo(res[+b.dataset.i!].at); };
        if (res[0]) mv.flyTo(res[0].at);
        msg(res[0] ? `Found with ${res[0].by}. Pick another result if this is the wrong place.` : '');
      } catch (err) { msg(String((err as Error).message)); }
    });
  }
};
