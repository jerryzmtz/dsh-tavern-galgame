// private fork: include source literally, without String.replace replacement-token expansion.
// private fork (asset-gen; gen-ui r12, owner 2026-10-15 — output/gen-ui-mock): offline screenshot harness for the 生图 UI
// (docs/fork/asset-gen-ui.md). Chromium renders the real factory source and the live stylesheet. Pack data is read
// read-only from the live 無能なナナ pack and rewritten in page memory into a half-made figure (a simple 立绘 with 平和 /
// 喜悦 and two 头像, no 设定图, 外貌 and 服装描述 written). The generation backend is a page-memory fake of
// docs/fork/asset-gen-contract.md: a job stays running until the harness finishes (or fails) it, and candidate pixels are
// composed with canvas from the pack's own pictures. No network, no paid call, no write outside page memory.
// Covers: the tile menus by state, the one generation dialog (生成 / 重画 / 改图 / 设定图), requests in the tiles (ring and
// time, 排队中, 待采用, ⚠), 「生成缺失立绘」 with 「生成中 a/b · 停止」 and 「N 张待采用 · 全部采用」, 设置回退, the 生图 page (设定 +
// 生成 records) and a background.
// Usage: node tests/harness/asset-gen-ui.mjs [outDir] [--size=1600x900,375] [--theme=light|dark]
import { readFile, readdir, mkdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { browserReactScript } from '../fixtures/browser-react.mjs'
import { forkThemeCss } from '../helpers/fork-theme-css.mjs'
import { stageSource, THEMES } from './card-centric-stage.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const args = process.argv.slice(2), option = name => args.find(a => a.startsWith('--' + name + '='))?.split('=').slice(1).join('=')
const outDir = args.find(a => !a.startsWith('--')) || path.join(root, '.tmp/asset-gen-ui')
const PACK = process.env.DSH_TEST_PACK_ROOT
const client = file => readFile(path.join(root, 'tavern-plugin/src/client', file), 'utf8')
const readJson = async file => JSON.parse(await readFile(file, 'utf8'))
const exists = file => stat(file).then(() => true, () => false)

// The live pack, read only; the figure 柊娜娜 is rewritten in memory into the state a new author would be in.
async function demoPack() {
  const manifest = await readJson(PACK + '/manifest.json'), figures = {}
  for (const id of manifest.figures) figures[id] = await readJson(PACK + '/figures/' + id + '.json')
  const id = manifest.figures.find(f => figures[f].name === '柊娜娜'), nana = figures[id], [first, second] = nana.outfits
  const layered = await readJson(PACK + '/' + manifest.sprites[first.sprite.manifestKey])
  const art = emotion => { const s = layered.emotions[emotion]; return { hash: first.sprite.assets[s.stage.src], width: s.stage.width, height: s.stage.height } }
  const calm = art('calm'), joy = art('joy'), still = a => ({ stage: { src: 'emotions/' + a + '/stage.png', width: art(a).width, height: art(a).height } })
  const sprites = { 'gen-demo': { version: 2, kind: 'layered-static-sprites', character: { id: 'figure', name: nana.name }, closedBehavior: 'restore-base', emotions: { calm: still('calm'), joy: still('joy') } } }
  const demo = { ...nana, appearance: 'sprite', identityAppearance: '粉色双马尾，发尾渐白，绿色眼睛，头戴白色小花发饰，身材娇小',
    outfits: [
      { key: first.key, label: first.label, enabled: true, defaultEmotion: 'calm', recall: first.recall, outfitAppearance: '粉白水手连衣裙，红色领巾，白色长筒袜配粉色花边，棕色乐福鞋',
        sprite: { manifestKey: 'gen-demo', assets: { 'emotions/calm/stage.png': calm.hash, 'emotions/joy/stage.png': joy.hash } },
        avatars: { calm: first.avatars.calm, joy: first.avatars.joy } },
      { key: second.key, label: second.label, enabled: true, defaultEmotion: 'calm', recall: second.recall }] }
  delete demo.voice; delete demo.identitySettei
  // Pictures the fake backend composes candidates from (all from the same pack).
  const sources = { calm: calm.hash, sad: art('sad').hash, avatars: Object.fromEntries(['joy', 'anger', 'sad', 'anxious', 'calm', 'shy', 'disgust', 'love'].map(e => [e, first.avatars[e]])),
    background: manifest.assets.filter(a => a.kind === 'backgrounds' && a.media).at(-1)?.media }
  const backgrounds = manifest.assets.filter(a => a.kind === 'backgrounds').slice(0, 6)
  delete manifest.files
  return { manifest: { ...manifest, figures: [id], assets: backgrounds, sprites: { 'gen-demo': 'sprites/gen-demo/manifest.json' }, bundles: {} }, figures: { [id]: demo }, sprites, revision: 'r1', figureId: id, sources }
}

function pageSetup({ pack, moods }) {
  const h = React.createElement, clone = v => JSON.parse(JSON.stringify(v)), wait = ms => new Promise(r => setTimeout(r, ms))
  let rev = 1, blobs = 0
  const bump = () => { pack.revision = 'r' + (++rev); return { status: 'ok', snapshot: view() } }
  const view = () => { const { sources, figureId, ...rest } = pack; return clone(rest) }
  const objectUrls = new Map(), packId = pack.manifest.id
  const put = (bytes, mime) => { const hash = 'e'.repeat(56) + String(++blobs).padStart(8, '0'); objectUrls.set(hash, URL.createObjectURL(new Blob([bytes], { type: mime }))); pack.manifest.blobs = { ...pack.manifest.blobs, [hash]: { ext: 'png', mime, size: bytes.length } }; return hash }
  const mediaUrl = hash => objectUrls.get(hash) || '/media/' + packId + '/' + hash
  // ---- candidate pixels, composed from the pack's own pictures ----
  const image = async hash => { const i = new Image(); i.src = mediaUrl(hash); await i.decode(); return i }
  const canvas = (w, hgt) => { const c = document.createElement('canvas'); c.width = w; c.height = hgt; return c }
  const base64 = c => c.toDataURL('image/png').split(',')[1]
  const fit = (g, img, x, y, w, hgt, { cover = false, flip = false, shade = 0 } = {}) => {
    const s = cover ? Math.max(w / img.width, hgt / img.height) : Math.min(w / img.width, hgt / img.height), dw = img.width * s, dh = img.height * s
    const layer = canvas(w, hgt), l = layer.getContext('2d')
    if (flip) { l.translate(w, 0); l.scale(-1, 1) }
    l.drawImage(img, (w - dw) / 2, cover ? (hgt - dh) / 2 : hgt - dh, dw, dh)
    if (shade) { l.setTransform(1, 0, 0, 1, 0, 0); l.globalCompositeOperation = 'source-atop'; l.fillStyle = 'rgb(52,56,74)'; l.globalAlpha = shade; l.fillRect(0, 0, w, hgt) }
    g.drawImage(layer, x, y)
  }
  async function compose(job) {
    const t = job.target, s = pack.sources
    if (t.kind === 'settei') {
      const c = canvas(1536, 1024), g = c.getContext('2d'), calm = await image(s.calm)
      g.fillStyle = '#f7f4ee'; g.fillRect(0, 0, 1536, 1024); g.fillStyle = '#d9d3c7'; g.fillRect(0, 930, 1536, 2)
      fit(g, calm, 80, 70, 440, 860); fit(g, calm, 548, 70, 440, 860, { flip: true }); fit(g, calm, 1016, 70, 440, 860, { shade: .78 })
      ;['#1d2440', '#f1ede4', '#b3262e', '#2a2a30', '#3a2d4d'].forEach((color, i) => { g.fillStyle = color; g.fillRect(96 + i * 64, 954, 44, 44) })
      return { base64: base64(c), width: 1536, height: 1024 }
    }
    if (t.kind === 'sprite') { const c = canvas(1024, 1536), g = c.getContext('2d'); fit(g, await image(['sad', 'anxious', 'crying'].includes(t.emotionId) ? s.sad : s.calm), 0, 0, 1024, 1536, { flip: ['anger', 'shy'].includes(t.emotionId) }); return { base64: base64(c), width: 1024, height: 1536 } }
    if (t.kind === 'avatar') { const c = canvas(1024, 1024), g = c.getContext('2d'); fit(g, await image(s.avatars[t.emotionId] || s.avatars.calm), 0, 0, 1024, 1024, { cover: true }); return { base64: base64(c), width: 1024, height: 1024 } }
    if (t.kind === 'avatar-sheet') {
      const c = canvas(1536, 1024), g = c.getContext('2d'), slices = {}
      for (const [i, id] of t.emotionIds.entries()) {
        const img = await image(s.avatars[id] || s.avatars.calm), x = (i % 4) * 384, y = Math.floor(i / 4) * 512
        fit(g, img, x + 12, y + 70, 360, 430, { cover: true })
        const cell = canvas(512, 512); cell.getContext('2d').drawImage(c, x, y, 384, 512, 64, 0, 384, 512); slices[id] = base64(cell)
      }
      return { base64: base64(c), width: 1536, height: 1024, slices }
    }
    const c = canvas(1536, 1024), g = c.getContext('2d'); fit(g, await image(s.background), 0, 0, 1536, 1024, { cover: true }); return { base64: base64(c), width: 1536, height: 1024 }
  }
  // ---- the fake backend (contract shapes; jobs wait for the harness) ----
  const plans = new Map(), jobs = [], pixels = new Map(); let seq = 0
  const SHEET = ['joy', 'anger', 'sad', 'anxious', 'calm', 'shy', 'disgust', 'love']
  const bytes = b64 => Uint8Array.from(atob(b64), ch => ch.charCodeAt(0))
  const publicJob = job => clone(job)
  const record = (job) => { const t = job.target, f = pack.figures[t.figureId]
    f.outfits = f.outfits.map(o => o.key === t.outfitKey ? { ...o, genRecords: [...(o.genRecords || []), { kind: t.kind, ...(t.emotionId ? { emotionId: t.emotionId } : {}), at: Date.now() - 60000 * (o.genRecords?.length || 0) * 7, ...(job.userPrompt ? { prompt: job.userPrompt } : {}) }].slice(-24) } : o) }
  window.genFinish = async (filter = () => true, warnings = () => []) => {
    for (const job of jobs.filter(j => j.status === 'running' && filter(j))) {
      const made = await compose(job); pixels.set(job.jobId, made)
      job.status = 'candidate'; job.outcome = 'received'
      job.candidate = { hash: 'c'.repeat(56) + String(++seq).padStart(8, '0'), mediaType: 'image/png', width: made.width, height: made.height, checks: { warnings: warnings(job) } }
      if (made.slices) job.candidate.slices = Object.fromEntries(Object.keys(made.slices).map(id => [id, { hash: 'd'.repeat(63) + id.length, checks: { warnings: [] } }]))
    }
    window.dispatchEvent(new Event('focus'))
  }
  window.genFail = (filter = () => true) => {
    for (const job of jobs.filter(j => j.status === 'running' && filter(j))) { job.status = 'failed'; job.outcome = 'unconfirmed'; job.error = { code: 'GENERATION_FAILED', message: '没有拿到结果，不会自动重试', retryable: false } }
    window.dispatchEvent(new Event('focus'))
  }
  window.genJobs = () => clone(jobs)
  const decode = b => JSON.parse(new TextDecoder().decode(b))
  const service = {
    apiVersion: 2, capabilities: ['packs', 'figures'], subscribe: () => () => {},
    listPackSummaries: async () => [view()], getPackSnapshot: async () => { await wait(15); return view() },
    // The full resource write: manifest fields, media bytes, figure documents and sprite manifests (page memory only).
    patchPack: async ({ patch, fileUpdates }) => {
      Object.assign(pack.manifest, clone(patch || {}))
      for (const [name, data] of fileUpdates || []) {
        if (data === null) continue
        const media = name.match(/^media\/([0-9a-f]{64})\./); if (media) { objectUrls.set(media[1], URL.createObjectURL(new Blob([data], { type: 'image/png' }))); continue }
        const figure = name.match(/^figures\/(.+)\.json$/); if (figure) { pack.figures[figure[1]] = decode(data); continue }
        const key = Object.entries(pack.manifest.sprites || {}).find(([, p]) => p === name)?.[0]; if (key) pack.sprites[key] = decode(data)
      }
      return bump()
    },
    patchFigure: async ({ figureId, patch }) => { pack.figures[figureId] = { ...pack.figures[figureId], ...clone(patch) }; for (const [key, value] of Object.entries(patch)) if (value === null) delete pack.figures[figureId][key]; return bump() },
    setFigureEmotionFallback: async ({ figureId, outfitKey, emotionId, enabled, use }) => {
      const f = pack.figures[figureId]; f.outfits = f.outfits.map(o => { if (o.key !== outfitKey) return o; const marks = new Set(o.fallbackEmotions || []), to = { ...(o.fallbackTo || {}) }
        if (enabled) marks.add(emotionId); else marks.delete(emotionId); if (enabled && use) to[emotionId] = use; else delete to[emotionId]
        const next = { ...o }; if (marks.size) next.fallbackEmotions = [...marks]; else delete next.fallbackEmotions; if (Object.keys(to).length) next.fallbackTo = to; else delete next.fallbackTo; return next })
      return bump()
    },
    setFigureAvatarCrop: async () => bump()
  }
  window.binding = {
    service,
    rpc: async (method, a) => {
      await wait(40)
      if (method === 'prepareAssetGeneration') {
        const target = { ...a.target, ...(a.target.kind === 'avatar-sheet' ? { emotionIds: a.target.emotionIds || SHEET } : {}) }, outfit = target.figureId && pack.figures[target.figureId].outfits.find(o => o.key === target.outfitKey)
        const omit = new Set(a.omit || []), refs = []
        if (outfit?.settei && !['settei'].includes(target.kind) && !omit.has('settei')) refs.push({ hash: outfit.settei, role: 'Approved settei', purpose: 'user' })
        for (const ref of a.references || []) refs.push(ref.hash ? { hash: ref.hash, role: ref.role, purpose: 'user' } : { role: ref.role, purpose: 'user' })
        if (a.preview) return { ok: true, data: { prompt: (a.userPrompt ? a.userPrompt + '\n\n' : '') + 'Full-body standing character sprite on a transparent background. Draw the character exactly as the approved settei / appearance text describes: same face, hair, eyes, outfit and art style.\nNo text, no watermark, no frame.', references: refs } }
        const plan = { planId: 'plan-' + (++seq), consentToken: 'consent', target, expectedRevision: a.expectedRevision, references: refs, userPrompt: a.userPrompt || '', provider: { provider: 'openai', model: 'gpt-image-1', protocol: 'responses-image-tool' }, imageCount: 1 }
        plans.set(plan.planId, plan); return { ok: true, data: clone(plan) }
      }
      if (method === 'generateAssetCandidate') {
        const plan = plans.get(a.planId)
        if (jobs.filter(j => j.status === 'running').length >= 4) throw Object.assign(new Error('已有素材生图任务在途（最多四张）'), { code: 'BUSY' })
        const job = { jobId: 'job-' + (++seq), requestId: 'job-' + seq, groupId: plan.planId, target: plan.target, status: 'running', outcome: 'unconfirmed', createdAt: Date.now() - (window.genElapsed || 0), expiresAt: Date.now() + 864e5, references: plan.references, userPrompt: plan.userPrompt }
        jobs.push(job); return { ok: true, data: { jobs: [publicJob(job)] } }
      }
      if (method === 'listAssetCandidates') return { ok: true, data: jobs.filter(j => j.target.packId === a.packId && !['rejected', 'cancelled', 'accepted'].includes(j.status)).map(publicJob) }
      const job = jobs.find(j => j.jobId === a.jobId)
      if (method === 'readAssetCandidate') { const made = pixels.get(a.jobId); return { ok: true, data: { base64: a.emotionId ? made.slices[a.emotionId] : made.base64, mediaType: 'image/png', target: clone(job.target) } } }
      if (method === 'rejectAssetCandidate') { job.status = 'rejected'; delete job.candidate; return { ok: true, data: publicJob(job) } }
      if (method === 'cancelAssetGenerationJob') { job.status = 'cancelled'; return { ok: true, data: publicJob(job) } }
      if (method === 'retryAssetCandidateSave') { job.status = 'candidate'; return { ok: true, data: publicJob(job) } }
      if (method === 'acceptAssetCandidate') {
        const t = job.target
        if (t.kind === 'settei') { const hash = put(bytes(pixels.get(job.jobId).base64), 'image/png'), f = pack.figures[t.figureId]; f.outfits = f.outfits.map(o => o.key === t.outfitKey ? { ...o, settei: hash } : o) }
        if (t.kind === 'background') { const hash = put(bytes(pixels.get(job.jobId).base64), 'image/png'); pack.manifest.assets = pack.manifest.assets.map(x => x.kind === 'backgrounds' && x.id === t.assetId ? { ...x, media: hash, pendingMedia: false } : x) }
        if (t.kind !== 'background') record(job)
        bump(); job.status = 'accepted'; return { ok: true, data: publicJob(job) }
      }
      if (method === 'getAssetPackDependencies') return { available: true, packId: a.packId, count: 1, cards: [] }
      if (method === 'getAssetVoiceServices') return { services: [] }
      if (method === 'listFigureVoiceChoices') return { voices: [] }
      throw new Error('mock: ' + method)
    },
    previewMedia: async ({ hash }) => ({ url: mediaUrl(hash), release() {} }),
    globalEnabledPackIds: [], loadSettings: async () => {}, onSettings: () => () => {}, download() {}
  }
  window.views = createForkAssetPackUI(React, { VoicePicker: ForkBubbleLibraryPicker, AvatarImage: ForkPackImage, HelpTip: ForkHelpTip, emotions: { moods, palette: ['#e0707c', '#2fae9a'], max: 8 } })
  window.root = ReactDOM.createRoot(document.getElementById('panel'))
  window.openFigure = () => window.root.render(h(window.views.PackModal, { key: 'gen' + Math.random(), binding: window.binding, packId, initial: { kind: 'figures', figureId: pack.figureId }, packs: [view()], onClose() {} }))
}

export async function run() {
  const { chromium } = await import('playwright')
  let { source, picker, playback } = await stageSource()
  source = await client('fork-settings-ui.js') + '\n' + source.split('// @include fork-asset-pack-cg-ui.js').join(await client('fork-asset-pack-cg-ui.js'))
  const css = await forkThemeCss(), empty = await client('fork-stage-empty.js')
  const pack = await demoPack()
  const moods = JSON.parse(await readFile(path.join(root, 'tests/fixtures/legacy-dialogue-moods.json'), 'utf8')).map(({ id, label, color }) => ({ id, label, color }))
  await mkdir(outDir, { recursive: true })
  const sizes = option('size') ? option('size').split(',') : ['1600x900', '375'], themes = option('theme') ? [option('theme')] : Object.keys(THEMES)
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const shots = [], errors = [], metrics = []
  const listing = readdir(PACK + '/media').then(names => new Map(names.map(n => [n.split('.')[0], n])))
  try {
    for (const theme of themes) for (const size of sizes) {
      const custom = size.match(/^(\d+)x(\d+)$/), narrow = size === '375', viewport = narrow ? { width: 375, height: 812 } : { width: +custom[1], height: +custom[2] }
      const page = await browser.newPage({ viewport, deviceScaleFactor: narrow ? 2 : 1, reducedMotion: 'reduce' })
      const tag = theme + '/' + size
      page.on('pageerror', e => errors.push(tag + ': ' + e.message))
      page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(tag + ' console: ' + m.text()) })
      await page.route('https://gen.test/**', async route => {
        const p = decodeURIComponent(new URL(route.request().url()).pathname), media = p.match(/^\/media\/([0-9a-f-]{36})\/([0-9a-f]{64})$/)
        if (media) { const name = (await listing).get(media[2]); return name ? route.fulfill({ contentType: name.endsWith('.webp') ? 'image/webp' : 'image/png', body: await readFile(PACK + '/media/' + name) }) : route.fulfill({ status: 404, body: 'nf' }) }
        return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body><div id="panel"></div></body></html>' })
      })
      await page.goto('https://gen.test/')
      await page.addStyleTag({ content: css + `html, body { margin: 0; } body { ${THEMES[theme]} background: var(--page); font-family: "Microsoft YaHei UI", "PingFang SC", sans-serif; } #panel { min-height: 100vh; }` })
      await page.evaluate(context => { document.body.dataset.fkContext = context }, 'chat-' + theme)
      await page.addScriptTag({ content: await browserReactScript() + ';window.React=modules.react;window.ReactDOM={...modules["react-dom"],...modules["react-dom/client"]};' + playback + source + picker + '\n' + empty })
      await page.evaluate(pageSetup, { pack: structuredClone(pack), moods })
      const sheet = () => page.locator('.ap-gen-sheet'), gd = () => page.locator('.ap-gen-dialog')
      const name = n => `${n}-${theme}-${narrow ? '375' : size}.png`
      const shot = async (n, wait = 500) => { const file = path.join(outDir, name(n)); await page.mouse.move(viewport.width - 1, 0); await page.waitForTimeout(wait); await page.screenshot({ path: file }); shots.push(file) }
      // A shot that keeps the pointer where it is (an open menu stays open, hover states stay).
      const still = async (n, wait = 400) => { const file = path.join(outDir, name(n)); await page.waitForTimeout(wait); await page.screenshot({ path: file }); shots.push(file) }
      const settled = () => page.waitForFunction(() => [...document.querySelectorAll('.ap-gen-sheet img, .ap-gen-dialog img, .ap-gen-tab img, .ap-stand img, .ap-emotion-roster img')].every(img => img.complete && img.naturalWidth > 0), null, { timeout: 15000 }).catch(() => errors.push(tag + ': images still loading'))
      const guard = async where => {
        const text = await page.locator('body').innerText()
        if (/[0-9a-f]{8}-[0-9a-f]{4}-|job-\d|plan-\d|[A-Z]{3,}_[A-Z_]{3,}/.test(text)) errors.push(tag + ' ' + where + ': internal id or code visible')
        if (/c1-standard|gen-demo/.test(text)) errors.push(tag + ' ' + where + ': internal key visible')
        if (/计费|费用|按次|收费/.test(text)) errors.push(tag + ' ' + where + ': money talk')
        const natives = await page.locator('.ap-ui select:not([aria-label="默认外观"]), .ap-ui input[type=color], .ap-ui input[type=radio], .ap-ui input[type=range]').count()
        if (natives) errors.push(tag + ' ' + where + ': ' + natives + ' native controls')
        if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) errors.push(tag + ' ' + where + ': horizontal scroll')
      }
      const frame = async (where, selector) => {
        const m = await page.evaluate(sel => { const s = document.querySelector(sel)?.getBoundingClientRect(), f = document.querySelector(sel + ' .ap-gen-foot')?.getBoundingClientRect(); return s && f ? { box: [Math.round(s.width), Math.round(s.height)], footBottom: Math.round(innerHeight - f.bottom) } : null }, selector)
        metrics.push({ tag, name: where + '-frame', ...m })
        if (narrow && m && (m.box[0] !== viewport.width || m.box[1] !== viewport.height || m.footBottom !== 0)) errors.push(tag + ' ' + where + ': phone dialog is not full screen with pinned actions ' + JSON.stringify(m))
      }
      const tileOf = label => page.locator('.ap-emotion-roster .ap-face[aria-label="' + label + '"]')
      const menu = label => page.getByRole('menu', { name: new RegExp('^' + label + '(立绘|头像) 操作$') })
      const roster = () => page.locator('[aria-label="人物差分"]').scrollIntoViewIfNeeded()
      const running = n => page.waitForFunction(k => window.genJobs().filter(j => j.status === 'running').length >= k, n, { timeout: 10000 })

      try {
      await page.evaluate(() => window.openFigure()); await page.locator('.ap-figure-pane').waitFor()
      await page.getByRole('radio', { name: '立绘', exact: true }).click(); await settled()
      const labels = await page.locator('.ap-emotion-roster .ap-face').evaluateAll(n => n.map(b => b.getAttribute('aria-label')))
      const empty = await page.locator('.ap-emotion-roster .ap-face[data-missing]').evaluateAll(n => n.map(b => b.getAttribute('aria-label')))
      metrics.push({ tag, name: 'roster', labels, empty })
      // Names on screen, ids in the jobs: the figure's own resolver (built-in keys carry the shared names).
      const ids = Object.fromEntries([...moods, ...(pack.figures[pack.figureId].emotions || [])].filter(r => r.label).map(r => [r.label, r.id]))
      const [e1, e2, e3] = empty, [i1, i2, i3] = [e1, e2, e3].map(l => ids[l] || l), filled = labels.find(l => !empty.includes(l))
      // 01 the roster with 「✦ 生成缺失立绘」; 02 an empty tile's menu.
      await roster(); await guard('roster'); await shot('01-edit-roster')
      await tileOf(e1).click({ button: 'right' }); await menu(e1).waitFor(); await guard('menu-empty'); await still('02-menu-empty')
      // 03 生成… → the dialog: the slot left, the request right (设定文字 card, pre-filled prompt, 存为默认).
      await menu(e1).getByRole('menuitem', { name: /^生成…/ }).click(); await gd().waitFor(); await settled(); await frame('dialog', '.ap-gen-dialog'); await guard('dialog'); await shot('03-dialog-generate')
      await gd().getByRole('button', { name: '查看全文' }).click(); await gd().locator('pre').waitFor(); await shot('04-dialog-full-prompt')
      await gd().locator('textarea').fill('双手比耶，眨一只眼，笑得很开心'); await gd().getByRole('checkbox', { name: /存为默认/ }).click(); await shot('05-dialog-edited')
      // Ctrl+Enter sends; the request runs in the tile.
      await page.evaluate(() => { window.genElapsed = 23000 }); await gd().locator('textarea').press('Control+Enter'); await gd().waitFor({ state: 'detached' }); await running(1)
      await roster(); await shot('06-tile-running', 900)
      // 「生成缺失立绘」: one request per empty 差分, four in flight, the rest 排队中; the heading counts 「生成中 a/b · 停止」.
      await page.evaluate(() => { window.genElapsed = 8000 })
      await page.locator('.ap-gen-fill').click(); await running(4); await page.waitForTimeout(600)
      await roster(); await guard('batch'); await shot('07-batch-progress', 900)
      // Some come back (one with ⚠), one fails; the picked candidate shows large with the 设定 in the corner.
      await page.evaluate(([a, b]) => window.genFinish(j => [a, b].includes(j.target.emotionId), j => j.target.emotionId === b ? [{ code: 'EDGE_CONTACT', severity: 'warning', message: '人物轮廓接触画布边缘，可能截断；采用前请检查' }] : []), [i1, i2])
      await page.evaluate(e => window.genFail(j => j.target.emotionId === e), i3)
      await page.waitForFunction(e => document.querySelector('.ap-face[aria-label="' + e + '"]')?.dataset.gen === 'candidate', e2, { timeout: 10000 })
      await tileOf(e2).click({ button: 'right' }); await menu(e2).waitFor(); await settled(); await still('08-menu-candidate', 900)
      await page.keyboard.press('Escape'); await page.waitForTimeout(200); await page.mouse.move(viewport.width - 1, 0)
      await page.locator('.ap-figure-stage').scrollIntoViewIfNeeded(); await settled(); await shot('09-candidate-preview', 900)
      await page.locator('.ap-gen-status').scrollIntoViewIfNeeded(); await shot('10-candidate-detail', 600)
      // 重画… on the candidate: quick notes, 「现在这张」.
      await tileOf(e2).click({ button: 'right' }); await menu(e2).getByRole('menuitem', { name: /^重画…/ }).click(); await gd().waitFor(); await settled()
      await gd().getByRole('button', { name: '再夸张一点' }).click(); await shot('11-dialog-redraw')
      await gd().getByRole('button', { name: '取消', exact: true }).click(); await gd().waitFor({ state: 'detached' })
      // A failure: ⚠ on the tile; its menu says why.
      await page.waitForFunction(e => document.querySelector('.ap-face[aria-label="' + e + '"]')?.dataset.gen === 'failed', e3, { timeout: 10000 })
      await tileOf(e3).click({ button: 'right' }); await menu(e3).waitFor(); await guard('menu-failed'); await still('12-menu-failed')
      // 设置回退 ›: the choices, then the stand-in tile (↩ and its name).
      await menu(e3).getByRole('menuitem', { name: /^设置回退/ }).click(); await still('13-menu-stand-in')
      await menu(e3).getByRole('menuitemradio', { name: '回退为「' + filled + '」' }).click(); await page.waitForFunction(e => document.querySelector('.ap-face[aria-label="' + e + '"]')?.closest('.ap-emotion-cell')?.dataset.fallbackState === 'fallback', e3, { timeout: 10000 }).catch(() => errors.push(tag + ': stand-in not recorded'))
      // 清除这条提示: the ⚠ goes, the tile shows the stand-in (dimmed, ↩ and its name).
      await tileOf(e3).click({ button: 'right' }); await menu(e3).getByRole('menuitem', { name: '清除这条提示' }).click()
      await page.waitForFunction(e => document.querySelector('.ap-face[aria-label="' + e + '"]')?.dataset.fallback !== undefined, e3, { timeout: 10000 }).catch(() => errors.push(tag + ': stand-in not shown'))
      // Finish the rest; 「N 张待采用 · 全部采用」.
      for (let i = 0; i < 30 && (await page.evaluate(() => window.genJobs().some(j => j.status === 'running'))); i++) { await page.evaluate(() => window.genFinish()); await page.waitForTimeout(250) }
      await page.locator('.ap-gen-waiting').waitFor({ timeout: 10000 }); await roster(); await shot('14-waiting-accept-all', 900)
      // 生图: 设定 (人物 · 服装) and this outfit's 生成 records (待采用 / 生图失败 / 已采用).
      await page.locator('[role=tab][data-tab=gen]').click(); await page.locator('.ap-gen-tab').waitFor(); await settled(); await guard('gen-tab'); await shot('15-gen-page')
      // 设定图: the empty tile opens the same dialog (设定图 mode); adopted from its tile.
      await page.getByRole('button', { name: /^生成「.+」的设定图$/ }).click(); await gd().waitFor(); await settled(); await shot('16-dialog-settei')
      await gd().getByRole('button', { name: '生成', exact: true }).click(); await gd().waitFor({ state: 'detached' }); await running(1)
      await page.evaluate(() => window.genFinish(j => j.target.kind === 'settei')); await page.waitForFunction(() => document.querySelector('[data-gen-slot=settei] .ap-gen-tile')?.dataset.state === 'candidate', null, { timeout: 10000 })
      await page.locator('[data-gen-slot=settei] .ap-gen-tile').click({ button: 'right' }); await page.getByRole('menuitem', { name: '采用', exact: true }).click()
      await page.waitForFunction(() => document.querySelector('[data-gen-slot=settei] .ap-gen-tile')?.dataset.state === 'filled', null, { timeout: 10000 }); await settled(); await shot('17-gen-page-settei')
      // Back in 编辑: 全部采用.
      await page.locator('[role=tab][data-tab=edit]').click(); await page.locator('.ap-emotion-roster').waitFor()
      await page.locator('.ap-gen-waiting').getByRole('button', { name: '全部采用' }).click()
      await page.waitForFunction(() => !document.querySelector('.ap-gen-waiting'), null, { timeout: 20000 }).catch(async () => errors.push(tag + ': 全部采用 did not finish ' + JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('[role=alert], .ap-field-error, .ap-cell-menu-warn')].map(e => e.innerText).concat([...document.querySelectorAll('.ap-gen-flag')].map(e => e.title), [document.querySelector('.ap-gen-waiting')?.innerText])))))
      await roster(); await settled(); await shot('18-adopted', 900)
      // An adopted tile's menu (重画… / 改图… / 替换为本地图片… / 删除立绘…).
      await tileOf(e1).click({ button: 'right' }); await menu(e1).waitFor(); await still('19-menu-filled')
      await menu(e1).getByRole('menuitem', { name: /^改图…/ }).click(); await gd().waitFor(); await settled(); await shot('20-dialog-edit')
      await gd().getByRole('button', { name: '取消', exact: true }).click(); await gd().waitFor({ state: 'detached' })
      // 背景: 添加 → 生成背景 → the description → one request into this pack (the sheet).
      if (narrow) await page.getByRole('button', { name: /^返回/ }).first().click()
      await page.getByRole('tab', { name: /^背景/ }).click().catch(() => errors.push(tag + ': backgrounds tab'))
      await page.getByRole('button', { name: '添加文件', exact: true }).first().click(); await page.getByRole('menuitem', { name: '生成背景' }).click(); await sheet().waitFor()
      await sheet().locator('textarea').fill('黄昏的教室，夕阳从窗外照进来，课桌整齐，没有人')
      await page.evaluate(() => { window.genElapsed = 9000 }); await sheet().getByRole('button', { name: '生成', exact: true }).click(); await sheet().locator('.ap-gen-wait').waitFor(); await page.waitForFunction(() => window.genJobs().some(j => j.target.kind === 'background' && j.status === 'running'), null, { timeout: 10000 })
      await page.evaluate(() => window.genFinish(j => j.target.kind === 'background')); await sheet().getByRole('button', { name: '采用', exact: true }).waitFor(); await settled(); await guard('background'); await shot('21-background-candidate')
      } catch (error) { errors.push(tag + ': ' + error.message.split('\n')[0]); await page.screenshot({ path: path.join(outDir, `debug-${theme}-${narrow ? '375' : size}.png`) }); metrics.push({ tag, jobs: await page.evaluate(() => window.genJobs().map(j => j.target.kind + ':' + (j.target.emotionId || '') + ':' + j.status)) }) }
      await page.close()
    }
  } finally { await browser.close() }
  return { shots, errors, metrics }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (!(await exists(PACK + '/manifest.json'))) { console.error('live pack missing: ' + PACK); process.exit(1) }
  const { shots, errors, metrics } = await run()
  console.log(shots.length + ' screenshots → ' + outDir)
  for (const m of metrics) console.log(JSON.stringify(m))
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1 }
}
