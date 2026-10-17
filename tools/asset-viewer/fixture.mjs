// private fork: synthetic review project for the asset viewer (preview screenshots + tests).
// Images are drawn in a real browser page and written content-addressed like the CLI
// (images/<sha256>.png); review data mirrors tools/dsh-assets/review-data.mjs (schema v1).
import {createHash} from 'node:crypto'
import {mkdir, writeFile, access} from 'node:fs/promises'
import path from 'node:path'

const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const EMOTIONS = ['calm', 'joy', 'anger', 'sad', 'anxious', 'shy', 'disgust', 'love', 'crying']

// ---- browser-side drawing (runs inside page.evaluate) ----
const DRAW = String.raw`
window.__fx = (() => {
  const rr = (g, x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, r); };
  function figure(g, P, o) {
    // P: palette; o: {cx, top, feet, emotion, eyes:'open'|'closed'|'half', mouth:'base'|frame, plain}
    const H = o.feet - o.top, u = H / 12.5, cx = o.cx, hy = o.top + u * 1.15, hr = u * 1.05;
    const em = o.emotion, outfit = o.plain ? '#9a9aa0' : P.outfit, accent = o.plain ? '#b8b8bd' : P.accent;
    const arm = {calm: 0.1, joy: -0.9, anger: 0.35, sad: 0.02, anxious: 0.45, shy: 0.55, disgust: 0.25, love: 0.5, crying: 0.6}[em] || 0.1;
    g.save(); g.lineJoin = 'round'; g.lineCap = 'round';
    // back hair
    g.fillStyle = P.hairDark; g.beginPath(); g.ellipse(cx, hy + u * 0.6, hr * 1.25, hr * (P.longHair ? 2.1 : 1.25), 0, 0, 7); g.fill();
    // legs
    const legTop = o.top + u * 7.1;
    g.fillStyle = P.skin;
    rr(g, cx - u * 0.62, legTop, u * 0.48, o.feet - legTop - u * 0.35, u * 0.22); g.fill();
    rr(g, cx + u * 0.14, legTop, u * 0.48, o.feet - legTop - u * 0.35, u * 0.22); g.fill();
    g.fillStyle = P.shoe;
    rr(g, cx - u * 0.75, o.feet - u * 0.5, u * 0.72, u * 0.5, u * 0.2); g.fill();
    rr(g, cx + u * 0.05, o.feet - u * 0.5, u * 0.72, u * 0.5, u * 0.2); g.fill();
    // arms (rotate around shoulders)
    const sh = o.top + u * 3.05;
    for (const side of [-1, 1]) {
      g.save(); g.translate(cx + side * u * 1.05, sh); g.rotate(side * (0.18 + (side < 0 ? arm : arm * 0.7)) * (em === 'joy' ? -1 : 1) * (em === 'joy' ? 1.6 : 1));
      g.fillStyle = outfit; rr(g, -u * 0.27, 0, u * 0.54, u * 1.9, u * 0.26); g.fill();
      g.fillStyle = P.skin; g.beginPath(); g.arc(0, u * 2.15, u * 0.3, 0, 7); g.fill();
      g.restore();
    }
    // torso + skirt
    const grd = g.createLinearGradient(cx - u * 1.2, 0, cx + u * 1.2, 0); grd.addColorStop(0, shade(outfit, -18)); grd.addColorStop(.55, outfit); grd.addColorStop(1, shade(outfit, -30));
    g.fillStyle = grd; g.beginPath();
    g.moveTo(cx - u * 0.95, sh - u * 0.15); g.lineTo(cx + u * 0.95, sh - u * 0.15); g.lineTo(cx + u * 0.82, o.top + u * 5.2); g.lineTo(cx - u * 0.82, o.top + u * 5.2); g.closePath(); g.fill();
    g.fillStyle = o.plain ? '#86868c' : P.skirt; g.beginPath();
    g.moveTo(cx - u * 0.85, o.top + u * 5.1); g.lineTo(cx + u * 0.85, o.top + u * 5.1); g.lineTo(cx + u * 1.45, o.top + u * 7.3); g.lineTo(cx - u * 1.45, o.top + u * 7.3); g.closePath(); g.fill();
    g.fillStyle = accent; rr(g, cx - u * 0.9, o.top + u * 4.95, u * 1.8, u * 0.28, u * 0.1); g.fill();
    if (!o.plain) { g.fillStyle = accent; g.beginPath(); g.moveTo(cx, sh + u * 0.1); g.lineTo(cx - u * 0.38, sh + u * 0.75); g.lineTo(cx + u * 0.38, sh + u * 0.75); g.closePath(); g.fill(); }
    // neck + head
    g.fillStyle = shade(P.skin, -14); rr(g, cx - u * 0.22, hy + hr * 0.75, u * 0.44, u * 0.7, u * 0.1); g.fill();
    g.fillStyle = P.skin; g.beginPath(); g.ellipse(cx, hy, hr * 0.9, hr, 0, 0, 7); g.fill();
    // bangs
    g.fillStyle = P.hair; g.beginPath(); g.ellipse(cx, hy - hr * 0.42, hr * 1.02, hr * 0.68, 0, Math.PI, 0); g.fill();
    g.beginPath(); g.moveTo(cx - hr, hy - hr * 0.4); g.quadraticCurveTo(cx - hr * 0.55, hy + hr * 0.15, cx - hr * 0.2, hy - hr * 0.35); g.quadraticCurveTo(cx + hr * 0.15, hy + hr * 0.05, cx + hr * 0.45, hy - hr * 0.35); g.quadraticCurveTo(cx + hr * 0.8, hy + hr * 0.12, cx + hr * 1.02, hy - hr * 0.42); g.fill();
    if (P.ornament) { g.fillStyle = P.ornament; g.beginPath(); g.arc(cx + hr * 0.7, hy - hr * 0.62, hr * 0.17, 0, 7); g.fill(); }
    face(g, P, cx, hy, hr, o);
    g.restore();
  }
  function face(g, P, cx, hy, hr, o) {
    const em = o.emotion, ey = hy + hr * 0.12, ex = hr * 0.38, er = hr * 0.17;
    if (em === 'shy' || em === 'love') { g.fillStyle = 'rgba(240,120,130,.45)'; for (const s of [-1, 1]) { g.beginPath(); g.ellipse(cx + s * hr * 0.5, hy + hr * 0.42, hr * 0.17, hr * 0.08, 0, 0, 7); g.fill(); } }
    for (const s of [-1, 1]) {
      const x = cx + s * ex;
      if (o.eyes === 'closed') { g.strokeStyle = '#3a2a2a'; g.lineWidth = hr * 0.05; g.beginPath(); g.arc(x, ey - er * 0.2, er, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke(); continue; }
      const sy = o.eyes === 'half' ? 0.5 : 1;
      g.fillStyle = '#fff'; g.beginPath(); g.ellipse(x, ey, er * 0.9, er * 1.15 * sy, 0, 0, 7); g.fill();
      g.fillStyle = P.eye; g.beginPath(); g.ellipse(x, ey + er * 0.12 * sy, er * 0.62, er * 0.85 * sy, 0, 0, 7); g.fill();
      g.fillStyle = '#1d1416'; g.beginPath(); g.ellipse(x, ey + er * 0.15 * sy, er * 0.28, er * 0.4 * sy, 0, 0, 7); g.fill();
      g.fillStyle = '#fff'; g.beginPath(); g.arc(x - er * 0.25, ey - er * 0.25 * sy, er * 0.17, 0, 7); g.fill();
      g.strokeStyle = '#2b1f20'; g.lineWidth = hr * 0.045; g.beginPath(); g.ellipse(x, ey, er * 0.95, er * 1.2 * sy, 0, 1.1 * Math.PI, 1.9 * Math.PI); g.stroke();
      if (o.eyes === 'half') { g.fillStyle = P.skin; g.fillRect(x - er, ey - er * 1.3, er * 2, er * 0.75); g.strokeStyle = '#2b1f20'; g.beginPath(); g.moveTo(x - er, ey - er * 0.55); g.lineTo(x + er, ey - er * 0.55); g.stroke(); }
      const brow = {anger: [0.25, -1], sad: [-0.25, 1], anxious: [-0.2, 1], disgust: [0.18, -1]}[em];
      g.strokeStyle = P.hairDark; g.lineWidth = hr * 0.05; g.beginPath();
      const by = ey - er * 1.75, tilt = brow ? brow[0] * s : 0;
      g.moveTo(x - er, by - tilt * er); g.lineTo(x + er, by + tilt * er); g.stroke();
    }
    if (em === 'crying') { g.fillStyle = 'rgba(120,190,255,.85)'; for (const s of [-1, 1]) { g.beginPath(); g.ellipse(cx + s * ex, ey + er * 1.9, er * 0.22, er * 0.7, 0, 0, 7); g.fill(); } }
    if (em === 'anxious') { g.fillStyle = 'rgba(150,200,255,.8)'; g.beginPath(); g.ellipse(cx + hr * 0.82, hy - hr * 0.2, hr * 0.07, hr * 0.13, 0, 0, 7); g.fill(); }
    if (em === 'anger') { g.strokeStyle = '#d33'; g.lineWidth = hr * 0.06; const ax = cx + hr * 0.62, ay = hy - hr * 0.75; g.beginPath(); for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { g.moveTo(ax + a * hr * 0.05, ay + b * hr * 0.05); g.lineTo(ax + a * hr * 0.15, ay + b * hr * 0.15); } g.stroke(); }
    const my = hy + hr * 0.55, m = o.mouth;
    g.strokeStyle = '#7a2c34'; g.fillStyle = '#8a2f3a'; g.lineWidth = hr * 0.045;
    const open = {closed: 0, small: 0.05, mid: 0.1, open: 0.16, a: 0.16, i: 0.05, u: 0.07, e: 0.09, o: 0.13}[m];
    if (open === undefined) {
      g.beginPath();
      if (em === 'joy' || em === 'love') { g.arc(cx, my - hr * 0.06, hr * 0.16, 0.15 * Math.PI, 0.85 * Math.PI); }
      else if (em === 'sad' || em === 'crying' || em === 'disgust') { g.arc(cx, my + hr * 0.1, hr * 0.13, 1.2 * Math.PI, 1.8 * Math.PI); }
      else if (em === 'anger') { g.moveTo(cx - hr * 0.13, my); g.lineTo(cx + hr * 0.13, my); }
      else { g.moveTo(cx - hr * 0.09, my); g.quadraticCurveTo(cx, my + hr * 0.04, cx + hr * 0.09, my); }
      g.stroke(); return;
    }
    if (!open) { g.beginPath(); g.moveTo(cx - hr * 0.1, my); g.lineTo(cx + hr * 0.1, my); g.stroke(); return; }
    const w = m === 'i' || m === 'e' ? hr * 0.2 : m === 'u' || m === 'o' ? hr * 0.1 : hr * 0.15;
    g.beginPath(); g.ellipse(cx, my + hr * 0.03, w, hr * open, 0, 0, 7); g.fill();
    g.fillStyle = '#e88a95'; g.beginPath(); g.ellipse(cx, my + hr * 0.03 + hr * open * 0.45, w * 0.6, hr * open * 0.4, 0, 0, Math.PI); g.fill();
  }
  function shade(hex, d) { const n = parseInt(hex.slice(1), 16), c = k => Math.max(0, Math.min(255, ((n >> k) & 255) + d)); return '#' + [16, 8, 0].map(k => c(k).toString(16).padStart(2, '0')).join(''); }
  function canvas(w, h) { const c = new OffscreenCanvas(w, h); return [c, c.getContext('2d')]; }
  async function png(c) { const b = await c.convertToBlob({type: 'image/png'}); const buf = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000)); return btoa(s); }
  function geom(S) { return {cx: S.cx, top: S.top, feet: S.feet}; }
  function faceGeom(S) { const H = S.feet - S.top, u = H / 12.5, hy = S.top + u * 1.15, hr = u * 1.05; return {hy, hr, cx: S.cx}; }
  // Perf fixtures salt each file with one opaque corner pixel so every slot is a distinct file.
  const salt = (g, spec, x, y) => { if (spec.salt == null) return; g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = 'rgba(' + (spec.salt & 255) + ',' + ((spec.salt >> 8) & 255) + ',' + ((spec.salt >> 16) & 255) + ',1)'; g.fillRect(x, y, 1, 1); g.restore(); };
  async function render(spec) {
    const P = spec.palette;
    if (spec.type === 'sprite' || spec.type === 'patch') {
      const [c, g] = canvas(spec.w, spec.h);
      figure(g, P, {...geom(spec), emotion: spec.emotion, eyes: spec.eyes || 'open', mouth: spec.mouth || 'base'});
      salt(g, spec, spec.rect ? spec.rect[0] : 0, spec.rect ? spec.rect[1] : 0);
      if (spec.type === 'sprite') return png(c);
      const [x, y, w, h] = spec.rect, [p, pg] = canvas(w, h); pg.drawImage(c, x, y, w, h, 0, 0, w, h); return png(p);
    }
    if (spec.type === 'avatar') {
      const [c, g] = canvas(spec.size, spec.size), f = faceGeom(spec), k = spec.size / (f.hr * 3.4);
      g.setTransform(k, 0, 0, k, spec.size / 2 - f.cx * k, spec.size * 0.46 - f.hy * k);
      figure(g, P, {...geom(spec), emotion: spec.emotion, eyes: 'open', mouth: 'base'});
      salt(g, spec, 0, 0);
      return png(c);
    }
    if (spec.type === 'board') {
      const [c, g] = canvas(spec.w, spec.h);
      g.fillStyle = '#f2f0ea'; g.fillRect(0, 0, spec.w, spec.h);
      g.fillStyle = '#3b3833'; g.font = '600 ' + Math.round(spec.h * 0.035) + 'px "Microsoft YaHei", sans-serif';
      g.fillText(spec.title, spec.w * 0.03, spec.h * 0.07);
      const top = spec.h * 0.12, feet = spec.h * 0.94;
      for (const [i, x] of [0.13, 0.31, 0.49].entries()) {
        g.save(); if (i === 1) { g.translate(spec.w * x, 0); g.scale(0.82, 1); g.translate(-spec.w * x, 0); }
        figure(g, P, {cx: spec.w * x, top, feet, emotion: 'calm', eyes: 'open', mouth: 'base', plain: spec.plain});
        if (i === 2) { g.fillStyle = P.hairDark; g.beginPath(); g.ellipse(spec.w * x, top + (feet - top) / 12.5 * 1.2, (feet - top) / 12.5 * 1.15, (feet - top) / 12.5 * 1.15, 0, 0, 7); g.fill(); }
        g.restore();
      }
      g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 2; for (const y of [top, feet]) { g.beginPath(); g.moveTo(spec.w * 0.04, y); g.lineTo(spec.w * 0.6, y); g.stroke(); }
      g.save(); const H = feet - top, fx = spec.w * 0.8, k = 2.4; g.beginPath(); g.rect(spec.w * 0.64, spec.h * 0.1, spec.w * 0.33, spec.h * 0.42); g.clip();
      g.translate(fx, spec.h * 0.3); g.scale(k, k); g.translate(-spec.w * 0.49, -(top + H / 12.5 * 1.15)); figure(g, P, {cx: spec.w * 0.49, top, feet, emotion: 'calm', eyes: 'open', mouth: 'base', plain: spec.plain}); g.restore();
      const sw = spec.w * 0.05, gx = spec.w * 0.64, gy = spec.h * 0.58;
      g.font = Math.round(spec.h * 0.022) + 'px "Microsoft YaHei", sans-serif';
      spec.swatches.forEach((s, i) => { const x = gx + (i % 3) * spec.w * 0.115, y = gy + Math.floor(i / 3) * spec.h * 0.1; g.fillStyle = s.hex; g.fillRect(x, y, sw, sw * 0.8); g.strokeStyle = 'rgba(0,0,0,.25)'; g.strokeRect(x, y, sw, sw * 0.8); g.fillStyle = '#3b3833'; g.fillText(s.zone + ' ' + s.role, x, y + sw * 0.8 + spec.h * 0.028); });
      return png(c);
    }
    if (spec.type === 'scene') {
      const [c, g] = canvas(spec.w, spec.h), grd = g.createLinearGradient(0, 0, 0, spec.h);
      grd.addColorStop(0, spec.sky); grd.addColorStop(1, spec.ground); g.fillStyle = grd; g.fillRect(0, 0, spec.w, spec.h);
      g.fillStyle = 'rgba(255,255,255,.18)'; for (let i = 0; i < 7; i++) g.fillRect(spec.w * (0.06 + i * 0.13), spec.h * 0.2, spec.w * 0.08, spec.h * 0.32);
      g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(0, spec.h * 0.7, spec.w, spec.h * 0.3);
      if (spec.figure) { figure(g, spec.figure, {cx: spec.w * 0.42, top: spec.h * 0.18, feet: spec.h * 0.98, emotion: 'joy', eyes: 'open', mouth: 'base'}); figure(g, spec.figure2, {cx: spec.w * 0.6, top: spec.h * 0.22, feet: spec.h * 0.98, emotion: 'shy', eyes: 'open', mouth: 'base'}); }
      return png(c);
    }
    throw new Error('unknown spec ' + spec.type);
  }
  return {render: async specs => Promise.all(specs.map(render))};
})();
`

const PALETTES = {
  sumi: {hair: '#3b4a7a', hairDark: '#273257', eye: '#4a7fc0', skin: '#f6dccb', outfit: '#e9e4d8', skirt: '#4b5a8c', accent: '#c4453f', shoe: '#5b3a2a', longHair: true},
  kotone: {hair: '#d9b46a', hairDark: '#b18a45', eye: '#5b9a63', skin: '#f8e1d2', outfit: '#d77c8f', skirt: '#f1e6ee', accent: '#7a4a8c', shoe: '#e8e0e6', ornament: '#ffffff'},
  rin: {hair: '#2b2b30', hairDark: '#18181c', eye: '#b0392f', skin: '#f3d6c4', outfit: '#2f3a35', skirt: '#2f3a35', accent: '#d8b54a', shoe: '#1e1e22', longHair: true},
}
const OUTFIT_COLORS = {
  uniform: {outfit: '#f0f0ee', skirt: '#2e3a5c', accent: '#d24b4b'},
  stage: {outfit: '#6a3fb0', skirt: '#f4d35e', accent: '#ffffff', shoe: '#f4d35e'},
}
const swatchesFor = (P, identity) => identity
  ? [{zone: '头发', role: '基色', hex: P.hair}, {zone: '头发', role: '阴影', hex: P.hairDark}, {zone: '眼睛', role: '虹膜', hex: P.eye}, {zone: '皮肤', role: '基色', hex: P.skin}]
  : [{zone: '上衣', role: '基色', hex: P.outfit}, {zone: '下装', role: '基色', hex: P.skirt}, {zone: '配饰', role: '点缀', hex: P.accent}, {zone: '鞋', role: '基色', hex: P.shoe}]

/**
 * Write a synthetic project folder (images/ + review-data.json) and return {data, dir}.
 * scale: 'sample' (3 characters, varied statuses) or 'perf' (13 characters, 56 outfits,
 * 504 sprites/avatars/blinks, 3024 six-frame mouth patches).
 */
export async function buildFixture(page, dir, {scale = 'sample', bounds = false, revision = 7} = {}) {
  await page.evaluate(DRAW)
  await mkdir(path.join(dir, 'images'), {recursive: true})
  const jobs = []   // {spec, resolve}
  let salt = 1
  const image = spec => new Promise(resolve => jobs.push({spec: scale === 'perf' ? {...spec, salt: salt++} : spec, resolve}))
  async function flush() {
    for (let i = 0; i < jobs.length; i += 24) {
      const batch = jobs.slice(i, i + 24)
      const out = await page.evaluate(specs => window.__fx.render(specs), batch.map(j => j.spec))
      await Promise.all(out.map(async (b64, k) => {
        const bytes = Buffer.from(b64, 'base64'), rel = 'images/' + sha(bytes) + '.png', file = path.join(dir, rel)
        try { await access(file) } catch { await writeFile(file, bytes) }
        const s = batch[k].spec, size = s.type === 'patch' ? [s.rect[2], s.rect[3]] : s.type === 'avatar' ? [s.size, s.size] : [s.w, s.h]
        batch[k].resolve({path: rel, native_size: size})
      }))
    }
    jobs.length = 0
  }
  const item = (slot_id, kind, status, extra = {}) => ({slot_id, kind, status, blocked: [], warnings: [], provenance: {}, ...extra})
  const warn = (code, message) => ({code, severity: 'warning', symbol: '\u26a0', message})
  const pending = []
  const later = (obj, field, promise) => pending.push(promise.then(v => { obj[field] = v }))

  const characters = []
  const plan = scale === 'perf' ? perfPlan() : samplePlan()
  for (const c of plan) {
    const P = {...PALETTES[c.palette]}
    const idItem = item(c.key + '/identity-settei', 'identity-settei', c.identityStatus, {palette: swatchesFor(P, true)})
    if (c.identityStatus !== 'missing') later(idItem, 'image', image({type: 'board', w: 2600, h: 1950, palette: P, plain: true, title: c.name + ' 人物色设', swatches: swatchesFor(P, true)}))
    const outfits = []
    for (const o of c.outfits) {
      const OP = {...P, ...(OUTFIT_COLORS[o.colors] || {})}
      const st = item(c.key + '/' + o.key + '/settei', 'settei', o.setteiStatus, {palette: swatchesFor(OP, false), parent_version: 'a'.repeat(64)})
      if (o.setteiStatus === 'blocked') st.blocked = ['IDENTITY_SETTEI_REQUIRED']
      if (o.setteiStatus !== 'missing' && o.setteiStatus !== 'blocked') later(st, 'image', image({type: 'board', w: 2600, h: 1950, palette: OP, title: c.name + ' · ' + o.label, swatches: swatchesFor(OP, false)}))
      if (o.differences) st.settei = {explicit_differences: o.differences}
      const states = []
      const top = 180 + (c.heightOffset || 0), feet = 1440
      for (const emotion of o.emotions) {
        const S = o.states?.[emotion] || {}
        const cx = 512 + ({joy: 6, anger: -8, shy: 10, crying: -4}[emotion] || 0)
        const g = {cx, top: top + (S.raise || 0), feet}
        const H = feet - g.top, u = H / 12.5, hy = g.top + u * 1.15, hr = u * 1.05
        const mouthRect = [Math.round(cx - hr * 0.32), Math.round(hy + hr * 0.36), Math.round(hr * 0.64), Math.round(hr * 0.42)]
        const blinkRect = [Math.round(cx - hr * 0.62), Math.round(hy + hr * 0.12 - hr * 0.42), Math.round(hr * 1.24), Math.round(hr * 0.66)]
        const status = S.sprite || o.spriteStatus || 'changed'
        const sprite = item(c.key + '/' + o.key + '/sprite/' + emotion, 'sprite', status)
        sprite.provenance = {plan_id: 'p-' + emotion, source: 'external-tool', timestamp: '2026-10-10T08:00:00.000Z', registration: {scale: 1, dx: 0, dy: 0, clippedPixels: 0, landmarks: {headTop: g.top, feet, supportX: cx}, anchorLandmarks: {headTop: top, feet, supportX: 512}, warnings: []}}
        if (S.estimated) { delete sprite.provenance.registration.landmarks; delete sprite.provenance.registration.anchorLandmarks; sprite.warnings.push(warn('ESTIMATED_LANDMARKS', 'Alpha bounds are a proxy, not head/feet recognition; use measured landmarks for raised hands, ornaments or bent poses.')) }
        if (S.refused) { sprite.status = 'refused'; sprite.blocked = ['REFUSED']; sprite.refusal = {status: 'refused', message: S.refused, timestamp: '2026-10-10T09:12:00.000Z'} }
        if (status === 'blocked') sprite.blocked = [S.blockedBy || 'SETTEI_REQUIRED']
        const hasSprite = ['changed', 'approved'].includes(sprite.status)
        if (hasSprite) later(sprite, 'image', image({type: 'sprite', w: 1024, h: 1536, palette: OP, emotion, ...g}))
        if (bounds && hasSprite) sprite.bounds_xywh = [Math.round(cx - u * 2.3), Math.round(g.top - u * 0.3), Math.round(u * 4.6), Math.round(feet - g.top + u * 0.3)]
        const avatarStatus = !hasSprite ? (sprite.status === 'missing' ? 'missing' : 'blocked') : S.avatar || o.avatarStatus || sprite.status
        const avatar = item(c.key + '/' + o.key + '/avatar/' + emotion, 'avatar', avatarStatus)
        if (avatarStatus === 'blocked') avatar.blocked = ['EMOTION_SPRITE_REQUIRED']
        if (['changed', 'approved'].includes(avatarStatus)) later(avatar, 'image', image({type: 'avatar', size: 512, palette: OP, emotion, ...g}))
        const state = {id: emotion, sprite, avatar, mouth: {semantics: o.mouth === 'vowels' ? 'vowels' : o.mouth ? 'opening-level' : 'none', composite: 'source-over-native-then-scale', frames: []}}
        if (!(o.eyesClosed || []).includes(emotion)) {
          const bs = !hasSprite ? 'blocked' : S.blink || sprite.status
          const blink = item(c.key + '/' + o.key + '/blink/' + emotion, 'blink', bs)
          if (bs === 'blocked') blink.blocked = ['SPRITE_REQUIRED']
          if (['changed', 'approved'].includes(bs)) {
            blink.rect_xywh = blinkRect; blink.base_native_size = [1024, 1536]
            later(blink, 'image', image({type: 'patch', w: 1024, h: 1536, rect: blinkRect, palette: OP, emotion, eyes: 'closed', ...g}))
            if (S.blinkWarn) blink.warnings.push(warn('BLINK_DIFF', S.blinkWarn))
          }
          state.blink = blink
        }
        if (o.mouth) {
          const frames = o.mouth === 'vowels' ? ['closed', 'a', 'i', 'u', 'e', 'o'] : ['closed', 'small', 'mid', 'open']
          for (const frame of frames) {
            const missingFrame = (S.missingMouth || []).includes(frame)
            const fs = !hasSprite ? 'blocked' : missingFrame ? 'missing' : sprite.status
            const f = item(c.key + '/' + o.key + '/mouth/' + emotion + '/' + frame, 'mouth', fs, {frame})
            if (fs === 'blocked') f.blocked = ['SPRITE_REQUIRED']
            if (['changed', 'approved'].includes(fs)) {
              f.rect_xywh = mouthRect; f.base_native_size = [1024, 1536]
              later(f, 'image', image({type: 'patch', w: 1024, h: 1536, rect: mouthRect, palette: OP, emotion, mouth: frame, ...g}))
            }
            state.mouth.frames.push(f)
          }
        }
        states.push(state)
      }
      outfits.push({key: o.key, label: o.label, settei: st, states})
    }
    characters.push({id: c.id, key: c.key, name: c.name, identity_settei: idItem, outfits})
  }
  const scenes = []
  if (scale === 'sample') {
    const bg = (key, name, sky, ground, status, extra = {}) => { const it = item('background/' + key, 'background', status, {name, ...extra}); if (status === 'changed' || status === 'approved') later(it, 'image', image({type: 'scene', w: 1536, h: 864, sky, ground, ...extra.draw})); delete it.draw; scenes.push(it) }
    bg('classroom', '放学后的教室', '#f2c38b', '#7d5a46', 'changed')
    bg('station', '雨夜车站', '#2c3e5c', '#1b222e', 'approved')
    bg('rooftop', '天台', '#9fd0ef', '#8c96a2', 'changed')
    const cg = item('cg/meeting', 'cg', 'changed', {name: '初次见面'}); later(cg, 'image', image({type: 'scene', w: 1536, h: 864, sky: '#f6d6c7', ground: '#8a6a6e', figure: PALETTES.sumi, figure2: PALETTES.kotone})); scenes.push(cg)
    const lib = item('background/library', 'background', 'refused', {name: '图书馆', blocked: ['REFUSED'], refusal: {status: 'refused', message: 'Request was rejected by the image tool: content policy (reason: unclear; prompt mentioned a real school name).', timestamp: '2026-10-10T09:30:00.000Z'}}); scenes.push(lib)
  }
  await flush()
  await Promise.all(pending)
  const data = {schema_version: 1, project: {id: scale === 'perf' ? '5f0c6d3e-4b1a-4e8e-9a51-0c7d7a7e0765' : '0d7b0b8e-2f4c-4b8f-bb2e-4a8f5b3c9e21', name: scale === 'perf' ? '性能样例 · 765 规模' : '星见学园 · 素材样例', revision}, characters, scenes}
  await writeFile(path.join(dir, 'review-data.json'), JSON.stringify(data, null, 2))
  return {data, dir}
}

function samplePlan() {
  return [
    {key: 'sumi', id: '6a2f6c4e-1d9e-4f3a-9f7b-2d5e8c1a0b01', name: '星野澄', palette: 'sumi', identityStatus: 'approved', outfits: [
      {key: 'daily', label: '日常服', setteiStatus: 'approved', spriteStatus: 'approved', emotions: EMOTIONS, mouth: true, states: {
        joy: {sprite: 'changed', avatar: 'changed'}, crying: {sprite: 'changed', blinkWarn: 'Closed-eye edit also changed 4.2% of pixels outside the eye region'},
        anxious: {estimated: true}}},
      {key: 'uniform', label: '冬季制服', colors: 'uniform', setteiStatus: 'changed', emotions: EMOTIONS, mouth: true, eyesClosed: ['love'], differences: ['发型同人物色设，改为低马尾', '领结为红色，不戴发饰'], states: {
        sad: {missingMouth: ['mid', 'open']}, disgust: {sprite: 'missing'}, love: {raise: -26}}},
    ]},
    {key: 'kotone', id: '7b3e7d5f-2eaf-4a4b-8a8c-3e6f9d2b1c02', name: '白石琴音', palette: 'kotone', identityStatus: 'changed', heightOffset: 90, outfits: [
      {key: 'casual', label: '私服', setteiStatus: 'changed', emotions: EMOTIONS, mouth: true, states: {
        anger: {refused: 'The request was refused by the image tool (safety system). Original message: "I can’t help create that image."'},
        shy: {estimated: true}, love: {estimated: true}}},
      {key: 'stage', label: '演出服', colors: 'stage', setteiStatus: 'changed', emotions: ['calm', 'joy', 'shy', 'love'], mouth: false, states: {
        love: {sprite: 'missing'}, shy: {avatar: 'missing'}}},
    ]},
    {key: 'rin', id: '8c4f8e60-3fb0-4b5c-9b9d-4f70ae3c2d03', name: '雨宫凛', palette: 'rin', identityStatus: 'approved', heightOffset: -40, outfits: [
      {key: 'daily', label: '日常服', setteiStatus: 'changed', spriteStatus: 'blocked', emotions: EMOTIONS, mouth: true},
    ]},
  ]
}

function perfPlan() {
  const names = ['天海春香', '如月千早', '萩原雪步', '高槻弥生', '秋月律子', '三浦梓', '水濑伊织', '菊地真', '双海亚美', '双海真美', '星井美希', '我那霸响', '四条贵音']
  const keys = ['haruka', 'chihaya', 'yukiho', 'yayoi', 'ritsuko', 'azusa', 'iori', 'makoto', 'ami', 'mami', 'miki', 'hibiki', 'takane']
  const pals = Object.keys(PALETTES), labels = ['日常服', '舞台服', '冬季制服', '私服', '泳装']
  let outfits = 0
  return keys.map((key, i) => {
    const n = i < 4 ? 5 : 4   // 4*5 + 9*4 = 56 outfits
    return {key, id: '00000000-0000-4000-8000-' + String(i).padStart(12, '0'), name: names[i], palette: pals[i % pals.length], identityStatus: 'approved', heightOffset: (i % 5) * 25 - 40,
      outfits: Array.from({length: n}, (_, k) => ({key: 'o' + k, label: labels[k], colors: ['', 'stage', 'uniform', '', 'stage'][k], setteiStatus: 'approved', spriteStatus: (outfits++ % 3) ? 'changed' : 'approved', emotions: EMOTIONS, mouth: 'vowels'}))}
  })
}
