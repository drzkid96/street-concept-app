// A sharp Street View frame. Google's Static API returns at most 640 px, far too coarse to render on, so the
// approved view is rebuilt from a 3 x 2 grid of narrower frames of the same panorama, each re-projected into
// the approved view (same camera, same heading, pitch and field of view) and blended where they overlap.
const R = Math.PI / 180;
type V3 = [number, number, number];
const basis = (h: number, p: number): { f: V3; r: V3; u: V3 } => {
  const sh = Math.sin(h * R), ch = Math.cos(h * R), sp = Math.sin(p * R), cp = Math.cos(p * R);
  return { f: [sh * cp, ch * cp, sp], r: [ch, -sh, 0], u: [-sh * sp, -ch * sp, cp] };
};

export const HIRES = { w: 1600, h: 1000 };

export async function hiresStreetView(pano: string, heading: number, pitch: number, fov: number, key: string, onStep?: (done: number, of: number) => void): Promise<string> {
  const W = HIRES.w, H = HIRES.h, T = 640;
  const F = (W / 2) / Math.tan(fov * R / 2), vfov = 2 * Math.atan((H / 2) / F) / R;
  const tf = Math.min(120, Math.max(fov * 0.52, vfov * 0.74)), ft = (T / 2) / Math.tan(tf * R / 2);
  const tiles = [-1, 0, 1].flatMap(i => [-1, 1].map(j => ({ h: heading + i * fov / 3, p: Math.max(-89, Math.min(89, pitch + j * vfov * 0.25)) })));
  let done = 0;
  const data = await Promise.all(tiles.map(async t => {
    const url = `https://maps.googleapis.com/maps/api/streetview?size=${T}x${T}&pano=${pano}&heading=${(((t.h % 360) + 360) % 360).toFixed(2)}&pitch=${t.p.toFixed(2)}&fov=${tf.toFixed(2)}&key=${key}`;
    const r = await fetch(url); if (!r.ok) throw new Error('Street View did not return the photo.');
    const bm = await createImageBitmap(await r.blob());
    const c = document.createElement('canvas'); c.width = T; c.height = T;
    const g = c.getContext('2d', { willReadFrequently: true })!; g.drawImage(bm, 0, 0, T, T);
    onStep?.(++done, tiles.length);
    return { b: basis(t.h, t.p), px: g.getImageData(0, 0, T, T).data };
  }));
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  const og = out.getContext('2d')!, img = og.createImageData(W, H), o = img.data;
  const B = basis(heading, pitch), MARK = 30;   // the bottom strip of every frame carries Google's marks: never sampled where another frame covers
  for (let y = 0; y < H; y++) {
    const dy = H / 2 - y;
    for (let x = 0; x < W; x++) {
      const dx = x - W / 2;
      const X = B.f[0] * F + B.r[0] * dx + B.u[0] * dy, Y = B.f[1] * F + B.r[1] * dx + B.u[1] * dy, Z = B.f[2] * F + B.u[2] * dy;
      let r = 0, g = 0, b = 0, ws = 0, fr = 0, fg = 0, fb = 0, fw = 0;
      for (const t of data) {
        const z = X * t.b.f[0] + Y * t.b.f[1] + Z * t.b.f[2]; if (z <= 0) continue;
        const u = ft * (X * t.b.r[0] + Y * t.b.r[1]) / z + T / 2 - 0.5, v = T / 2 - 0.5 - ft * (X * t.b.u[0] + Y * t.b.u[1] + Z * t.b.u[2]) / z;
        if (u < 0 || v < 0 || u > T - 1.001 || v > T - 1.001) continue;
        const x0 = u | 0, y0 = v | 0, ax = u - x0, ay = v - y0, i = (y0 * T + x0) * 4, k = i + T * 4;
        const w00 = (1 - ax) * (1 - ay), w10 = ax * (1 - ay), w01 = (1 - ax) * ay, w11 = ax * ay, p = t.px;
        const cr = p[i] * w00 + p[i + 4] * w10 + p[k] * w01 + p[k + 4] * w11, cg = p[i + 1] * w00 + p[i + 5] * w10 + p[k + 1] * w01 + p[k + 5] * w11, cb = p[i + 2] * w00 + p[i + 6] * w10 + p[k + 2] * w01 + p[k + 6] * w11;
        const edge = Math.min(u, T - 1 - u, v, T - 1 - MARK - v);
        if (edge <= 0) { const e2 = Math.min(u, T - 1 - u, v, T - 1 - v) + 0.01; if (e2 > fw) { fw = e2; fr = cr; fg = cg; fb = cb; } continue; }
        const w = Math.min(edge, 48) ** 2; r += cr * w; g += cg * w; b += cb * w; ws += w;
      }
      const q = (y * W + x) * 4;
      if (ws > 0) { o[q] = r / ws; o[q + 1] = g / ws; o[q + 2] = b / ws; } else { o[q] = fr; o[q + 1] = fg; o[q + 2] = fb; }
      o[q + 3] = 255;
    }
  }
  og.putImageData(img, 0, 0);
  return out.toDataURL('image/jpeg', 0.88);
}
