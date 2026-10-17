// private fork: include source literally, without String.replace replacement-token expansion.
// private fork: standalone offline harness for 舞台设置 (docs/fork/card-centric-ux.md). Chromium renders the real
// factory source with an in-page mocked RPC/pack service (synthetic canvas art, no live data) and writes
// screenshots for light/dark × 375px/desktop. Usage: node tests/harness/card-centric-stage.mjs [outDir]
import { readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { browserReactScript } from '../fixtures/browser-react.mjs'
import { forkThemeCss } from '../helpers/fork-theme-css.mjs'
import {withSpriteEmotionSource} from '../helpers/sprite-emotion-source.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const outDir = process.argv[2] || path.join(root, '.tmp/card-centric-stage')
const client = file => readFile(path.join(root, 'tavern-plugin/src/client', file), 'utf8')

export async function stageSource() {
  // private fork: main.js bundles the shared ForkSpinner and ForkInlineField before the asset views.
  let source = await client('fork-spinner.js') + '\n' + await client('fork-inline-field.js') + '\n' + await client('fork-asset-pack-ui.js')
  source = source.split('// @include-protocol director-commands.cjs').join( await readFile(path.join(root, 'tavern-plugin/packages/dsh-presentation-protocol/src/director-commands.cjs'), 'utf8'))
  // private fork (wizard v3): the one figure resolver sits in the same client scope (main.js bundles it via fork-bubbles.js).
  source = await readFile(path.join(root, 'tavern-plugin/packages/dsh-presentation-protocol/src/figure-resolution.cjs'), 'utf8') + '\n' + source
  // private fork: match the production shared colour include.
  source = source.split('// @include-shared figure-auto-color.cjs').join(await readFile(path.join(root, 'tavern-plugin/shared/figure-auto-color.cjs'), 'utf8'))
  source = source.split('// @include-shared asset-image-publication.cjs').join(await readFile(path.join(root, 'tavern-plugin/shared/asset-image-publication.cjs'), 'utf8'))
  source = source.split('// @include-domain pack-avatar.cjs').join(await readFile(path.join(root, 'tavern-plugin/lib/domain/pack-avatar.cjs'), 'utf8'))
  // private fork (voice v4 P1): the figure voice page is its own included module.
  for (const name of ['figure','spine','import', 'voice', 'card', 'opening', 'character', 'engine', 'entry','cg','gen','catalogue','setup']) source = source.split('// @include fork-asset-pack-' + name + '-ui.js').join(await client('fork-asset-pack-' + name + '-ui.js'))
  // private fork: declaration-driven settings share the production contract.
  for (const name of ['fork-widget-contracts.cjs','fork-widget-settings-ui.js','fork-mod-library.js','fork-mod-config-pages.js','fork-mod-settings.js','fork-mod-assets.js']) { const included = await client(name); source = source.replace('// @include ' + name, () => included) }
  // private fork (settings-ux r2): first-party mod files the client includes (the phone battery levels), as the build does.
  for (const [line, file] of [...source.matchAll(/^[\t ]*\/\/ @include-mod ([a-zA-Z0-9._/-]+)[\t ]*$/gm)]) { const included = await readFile(path.join(root, 'fork/mods', file), 'utf8'); source = source.replace(line, () => included) }
  for (const [line, file] of [...source.matchAll(/^[\t ]*\/\/ @include-protocol ([a-zA-Z0-9._/-]+)[\t ]*$/gm)]) { const included = await readFile(path.join(root, 'tavern-plugin/packages/dsh-presentation-protocol/src', file), 'utf8'); source = source.replace(line, () => included) }
  const bubbles = await client('fork-bubbles.js')
  const picker = bubbles.slice(bubbles.indexOf('function ForkBubbleLibraryPicker'), bubbles.indexOf('// Portrait chip:'))
  return { source:withSpriteEmotionSource(source), picker, playback: await client('fork-pack-playback.cjs') }
}

export const THEMES = {
  light: 'color-scheme:light;--fork-ink:#20252d;--fork-ink-2:#5f6776;--fork-ink-3:#959caa;--fork-hairline:#e1e5eb;--fork-surface:#fbfcfe;--fork-accent:#3f6ddd;--fork-accent-soft:#e9effc;--fork-hover:#eef1f5;--page:#e9ecf1;',
  dark: 'color-scheme:dark;--fork-ink:#e4e7ec;--fork-ink-2:#aab1bd;--fork-ink-3:#7c8391;--fork-hairline:#2d3139;--fork-surface:#1a1c21;--fork-accent:#7f9dff;--fork-accent-soft:#263152;--fork-hover:#262a31;--page:#101114;'
}

// In-page mock: card store, packs with canvas-drawn art, TTS voices, navigation log.
export function pageSetup() {
  const art = (hue, {w = 600, h = 1200, kind = 'figure', label = ''} = {}) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d')
    if (kind === 'bg') {
      const grad = g.createLinearGradient(0, 0, 0, h); grad.addColorStop(0, `hsl(${hue} 55% 72%)`); grad.addColorStop(1, `hsl(${hue + 30} 45% 38%)`)
      g.fillStyle = grad; g.fillRect(0, 0, w, h); g.fillStyle = `hsl(${hue} 30% 22% / .55)`; g.fillRect(0, h * .72, w, h * .28)
      return c.toDataURL('image/png')
    }
    const skin = '#f3d7c6', hair = `hsl(${hue} 55% 42%)`, cloth = `hsl(${hue + 180} 35% 45%)`
    g.fillStyle = hair; g.beginPath(); g.ellipse(w / 2, h * .17, w * .2, h * .13, 0, 0, Math.PI * 2); g.fill()
    g.fillRect(w * .3, h * .17, w * .4, h * .2)
    g.fillStyle = skin; g.beginPath(); g.ellipse(w / 2, h * .19, w * .14, h * .085, 0, 0, Math.PI * 2); g.fill()
    g.fillStyle = '#2b2b33'; g.fillRect(w * .44, h * .19, w * .025, h * .012); g.fillRect(w * .535, h * .19, w * .025, h * .012)
    g.fillStyle = cloth; g.beginPath(); g.moveTo(w * .32, h * .3); g.lineTo(w * .68, h * .3); g.lineTo(w * .78, h * .98); g.lineTo(w * .22, h * .98); g.closePath(); g.fill()
    g.fillStyle = skin; g.fillRect(w * .46, h * .27, w * .08, h * .04)
    if (label) { g.fillStyle = 'rgba(255,255,255,.85)'; g.font = `600 ${w * .09}px sans-serif`; g.textAlign = 'center'; g.fillText(label, w / 2, h * .62) }
    return c.toDataURL('image/png')
  }
  const square = hue => { const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'); g.fillStyle = `hsl(${hue} 50% 86%)`; g.fillRect(0, 0, 256, 256); g.fillStyle = `hsl(${hue} 55% 42%)`; g.beginPath(); g.arc(128, 120, 92, Math.PI, 0); g.fill(); g.fillStyle = '#f3d7c6'; g.beginPath(); g.ellipse(128, 140, 64, 72, 0, 0, Math.PI * 2); g.fill(); g.fillStyle = '#2b2b33'; g.fillRect(98, 140, 12, 7); g.fillRect(146, 140, 12, 7); return c.toDataURL('image/png') }
  const media = new Map(); let n = 0, ids = 0
  const uuid = () => 'b0b0b0b0-0000-4000-8000-' + String(++ids).padStart(12, '0')
  const put = url => { const hash = 'h' + (++n).toString(16).padStart(63, '0'); media.set(hash, url); return hash }
  window.mediaUrl = hash => media.get(hash)
  const PACK = '11111111-1111-4111-8111-111111111111', GENERAL = '22222222-2222-4222-8222-222222222222', KOSAKA = '33333333-3333-4333-8333-333333333333', SFX = '44444444-4444-4444-8444-444444444444'
  const simpleFigure = (id, name, hue, {height = 158, avatar = true, emotions = [], live2d = false} = {}) => {
    const key = 's-' + id.slice(0, 6), states = [{id: 'default', stage: {src: 'assets/default.png', width: 600, height: 1200}}], assets = {'assets/default.png': put(art(hue))}
    for (const [emotion, shift] of emotions) { states.push({id: emotion, emotion, stage: {src: `assets/${emotion}.png`, width: 600, height: 1200}}); assets[`assets/${emotion}.png`] = put(art(hue + shift)) }
    const outfit = {key: 'default', label: '默认', enabled: true, sprite: {manifestKey: key, assets}, ...(avatar ? {avatars: {calm: put(square(hue))}} : {}), ...(live2d ? {live2d: {bundleKey: 'l2d-' + id.slice(0, 4)}} : {})}
    return {figure: {schemaVersion: 1, id, name, enabled: true, heightCm: height, outfits: [outfit]}, sprite: [key, {version: 2, kind: 'layered-static-sprites', character: {id: 'figure', name}, closedBehavior: 'restore-base', defaultState: 'default', states}]}
  }
  const pack = (id, name, figures, kinds = {}) => {
    const assets = []; for (const [kind, count] of Object.entries(kinds)) for (let i = 0; i < count; i++) assets.push({kind, id: kind + i, name: kind + ' ' + i, enabled: true, ...(kind === 'backgrounds' ? {media: put(art(200 + i * 13, {w: 640, h: 360, kind: 'bg'}))} : {})})
    return {manifest: {id, name, assets, figures: figures.map(f => f.figure.id)}, figures: Object.fromEntries(figures.map(f => [f.figure.id, f.figure])), sprites: Object.fromEntries(figures.map(f => f.sprite)), revision: 'r1'}
  }
  const madoka = simpleFigure('a1a1a1a1-0000-4000-8000-000000000001', '鹿目圆', 330, {height: 150, emotions: [['joy', 25], ['shy', 10], ['c1a2b3', 50]]})
  const girl = simpleFigure('a1a1a1a1-0000-4000-8000-000000000002', '少女 A', 205, {height: 158})
  const boy = simpleFigure('a1a1a1a1-0000-4000-8000-000000000003', '少年 B', 25, {height: 172, avatar: false})
  const clerk = simpleFigure('a1a1a1a1-0000-4000-8000-000000000004', '店员 C', 140, {height: 162})
  const kosaka = simpleFigure('a1a1a1a1-0000-4000-8000-000000000005', '高坂月', 265, {height: 160, live2d: true})
  const basePacks = () => [pack(PACK, '鹿目圆素材', [madoka], {backgrounds: 2}), pack(GENERAL, '通用素材', [girl, boy, clerk], {backgrounds: 6, music: 20, sfx: 12}), pack(KOSAKA, '高坂月角色包', [kosaka], {backgrounds: 1}), pack(SFX, '通用音效', [], {sfx: 30, ambience: 8})]
  // private fork: card/scene identities differ from display names and source aliases.
  const baseCard = () => ({schemaVersion: 1,
    characters: {f_madoka: {aliases:['madoka'],name: '鹿目圆', speakerNames: ['鹿目圆', '小圆'], appearance: 'live2d'}, f_clerk: {aliases:['clerk'],name: '店员', speakerNames: ['店员'], appearance: 'sprite'}, f_passer: {aliases:['passer'],name: '路人', speakerNames: ['路人'], appearance: 'sprite'}, f_me: {aliases:['me'],name: '我', speakerNames: ['我'], appearance: 'avatar'}},
    assetBindings: {boundPackIds: [PACK, GENERAL], characters: {f_madoka: {figure: {packId: PACK, figureId: madoka.figure.id}}, f_clerk: {figure: {packId: GENERAL, figureId: girl.figure.id}}, f_passer: {figure: null}, f_me: {figure: null}}},
    stage: {dialogue: true, voice: true, stage: true}, readings: {version: 2, entries: [
      {forms: ['上条'], reading: 'カミジョウ', inferredLanguage: 'ja', warnings: [], language: 'ja', languageOverride: 'ja'},
      {forms: ['見滝原', '见泷原'], reading: 'みたきはら', inferredLanguage: 'ja', warnings: [], language: 'ja'},
      {forms: ['QB'], reading: 'kyubei', inferredLanguage: 'en', warnings: ['LATIN_ASSUMED_EN'], language: 'en'}]}})
  const engine = {values: {dialogue: {textLanguage: 'zh', emotions: []}, directionStyle: 'galgame', directionStyles: [{id: 'galgame', name: 'Galgame 演出'}, {id: 'film', name: '电影感'}], dimensions: {}, widgetExecutionEnabled: false, dialogueThemes: [], catalogueCaps: {}, actionCaps: {}, limits: {}, widgetAuthorizations: {}, voiceServices: {}}, revision: 'e1', writable: true}
  let state, rev = 0
  const effective = ext => ext
  window.scenario = name => {
    const card = baseCard()
    if (name === 'first-run') state = {card: null, packs: basePacks()}
    else state = {card, packs: basePacks()}
    if (name === 'voice-off') card.stage = {dialogue: true, voice: false, voiceLanguage: false, stage: true}
    if (name === 'dialogue-off') card.stage = {dialogue: false, voice: true, voiceLanguage: true, stage: true}
    if (name === 'crop') for (const p of state.packs) for (const fig of Object.values(p.figures)) for (const o of fig.outfits) delete o.avatars
    rev++
  }
  const clone = v => JSON.parse(JSON.stringify(v))
  const packById = id => state.packs.find(p => p.manifest.id === id)
  const bump = p => { p.revision = 'r' + (++rev); return {status: 'ok', snapshot: clone(p), widgetRisks: []} }
  window.calls = []
  window.binding = {
    service: {apiVersion: 2, capabilities: ['packs', 'figures'], subscribe: () => () => {},
      listPackSummaries: async () => clone(state.packs), getPackSnapshot: async ({packId}) => clone(packById(packId)),
      putBlob: async ({packId, bytes, descriptor}) => { const url = URL.createObjectURL(new Blob([bytes], {type: descriptor.mime})); const hash = put(url); return {...bump(packById(packId)), hash, descriptor} },
      createSimpleSprite: async ({packId, spriteKey, name, images}) => { const p = packById(packId), assets = {}, states = []
        for (const [id, image] of Object.entries(images)) { const src = 'assets/' + id + '.png'; assets[src] = image.hash; states.push({id, ...(id === 'default' ? {} : {emotion: id}), stage: {src, width: image.width, height: image.height}}) }
        p.sprites[spriteKey] = {version: 2, kind: 'layered-static-sprites', character: {id: 'figure', name}, closedBehavior: 'restore-base', defaultState: 'default', states}
        return {...bump(p), sprite: {manifestKey: spriteKey, assets}} },
      createFigure: async ({packId, figure}) => { const p = packById(packId), id = uuid(); p.figures[id] = {...figure, id}; p.manifest.figures.push(id); return {...bump(p), figureId: id} },
      setFigureAvatarCrop: async ({packId, figureId, outfitKey, scope, stateId, crop}) => { const p = packById(packId), o = p.figures[figureId].outfits.find(x => x.key === outfitKey), manual = {...(o.sprite.avatarCrop || {})}
        if (scope === 'outfit') { if (crop) o.avatarCrop = crop; else delete o.avatarCrop; for (const k of Object.keys(manual)) delete manual[k] } else if (crop) manual[stateId] = crop; else delete manual[stateId]
        if (Object.keys(manual).length) o.sprite.avatarCrop = manual; else delete o.sprite.avatarCrop; return bump(p) },
      patchFigure: async ({packId, figureId, patch}) => { const p = packById(packId); p.figures[figureId] = {...p.figures[figureId], ...patch}; return bump(p) },
      exportCardBundle: async () => ({bytes: new Uint8Array(), filename: 'card.zip'}), createSimpleSpriteAvailable: true},
    rpc: async (method, args) => {
      window.calls.push([method, clone(args || {})])
      await new Promise(r => setTimeout(r, 30))
      const card = () => ({path: 'cards/madoka.json', revision: 'c' + rev, extension: clone(state.card), effectiveStage: {}})
      if (method === 'getCardAssetBindings') return card()
      // private fork: offline browser transport mirrors the scoped search/create contracts, not the old local picker.
      if (method === 'searchCardFigures') return {available:true,groups:state.packs.map(p=>({packId:p.manifest.id,name:p.manifest.name,revision:p.revision,state:state.card.assetBindings.boundPackIds.includes(p.manifest.id)?'bound':'off',figures:Object.values(p.figures).filter(f=>!args.query||f.name.includes(args.query)).map(f=>({ref:{packId:p.manifest.id,figureId:f.id},name:f.name,enabled:f.enabled,current:args.current?.packId===p.manifest.id&&args.current?.figureId===f.id}))})),diagnostics:[]}
      if (method === 'createCardFigure') {
        if(args.expectedRevision!=='c'+rev)throw Error('REVISION_CONFLICT');
        const p=packById(args.target.packId);if(!p||p.revision!==args.target.expectedRevision)throw Error('REVISION_CONFLICT');
        const id=uuid();p.figures[id]={schemaVersion:1,id,name:args.name,enabled:true,outfits:[{key:'daily',label:'日常',enabled:true}]};p.manifest.figures.push(id);bump(p);
        state.card.assetBindings.characters[args.alias]={figure:{packId:p.manifest.id,figureId:id}};
        if(!state.card.assetBindings.boundPackIds.includes(p.manifest.id))state.card.assetBindings.boundPackIds.push(p.manifest.id);
        return {...card(),figure:{packId:p.manifest.id,figureId:id},packRevision:p.revision};
      }
      if (method === 'saveCardAssetBindings') { state.card = {schemaVersion: 1, ...(state.card || {}), ...clone(args.patch)}; rev++; return card() }
      if (method === 'getAssetEngineSettings') return clone(engine)
      if (method === 'getAssetVoiceServices') return {services:[{id:'local',kind:'reference-api',capabilities:{voiceKinds:['reference'],paid:false}}]}
      if (method === 'getCardOpeningScenes') { const bg = (packId, i) => ({packId, kind: 'backgrounds', assetId: 'backgrounds' + i}), scenes = state.card.openings?.scenes || {}
        const scene = (id, fallback) => scenes[id] ? {configured: true, ...scenes[id]} : {configured: false, ...fallback}
        return {lead: 'f_madoka', greetings: [{id: 'primary', key: '0123456789abcdef', preview: '放学后的教室里，夕阳斜斜地照进来。'}, {id: 'alternate:0', key: 'fedcba9876543210', preview: '「早上好！」小圆在校门口挥着手。'}],
          scenes: {primary: scene('primary', {background: bg(PACK, 0), timeOfDay: null, music: null, cast: [{alias: 'f_madoka', outfitKey: null, emotion: 'calm'}]}), 'alternate:0': scene('alternate:0', {background: bg(GENERAL, 2), timeOfDay: 'night', music: {packId: GENERAL, kind: 'music', assetId: 'music3'}, cast: [{alias: 'f_clerk', outfitKey: null, emotion: 'joy'}, {alias: 'f_madoka', outfitKey: null, emotion: 'shy'}]})}} }
      if (method === 'getAssetPackDependencies') return {available: true, packId: args.packId, count: 3, cards: [{path: 'cards/madoka.json', name: '鹿目圆的日常'}, {path: 'cards/a.json', name: '放学后'}, {path: 'cards/b.json', name: '见泷原'}]}
      throw new Error('mock: ' + method)
    },
    previewMedia: async ({hash}) => ({url: window.mediaUrl(hash), release() {}}),
    globalEnabledPackIds: [SFX],
    tts: {listVoices: async () => [{id: 'qwen/madoka', label: '小圆', serviceId: '通义千问', state: 'ready', languages: ['ja', 'zh']}, {id: 'azure/xiaoxiao', label: '晓晓', serviceId: 'Azure 语音', state: 'ready', languages: ['zh']}],
      subscribe: () => () => {}, synthesize: async () => ({ticket: 't'}), audioUrl: () => 'data:audio/wav;base64,'},
    download() {}
  }
  window.opened = []
  const nav = {openTab: async type => window.opened.push(['tab', type]), openLibrary: async target => window.opened.push(['library', target])}
  const h = React.createElement
  const globalRows = () => h('div', null,
    h('label', {className: 'ap-field'}, h('span', null, '默认对话气泡'), h('span', {className: 'ap-control'}, h('input', {type: 'checkbox', defaultChecked: true}))),
    h('div', {className: 'ap-field'}, h('span', null, '对白提示词'), h('span', {className: 'ap-control'}, '默认 ', h('button', {type: 'button', className: 'ap-link'}, '编辑'))),
    h('label', {className: 'ap-field'}, h('span', null, '正文语言'), h('span', {className: 'ap-control'}, h('select', null, h('option', null, '中文')))))
  window.views = createForkAssetPackUI(React, {VoicePicker: ForkBubbleLibraryPicker, AvatarImage: ForkPackImage,
    emotions: {moods: [['joy', '喜悦', '#e0932a'], ['anger', '愤怒', '#e0524c'], ['sad', '悲伤', '#4a86e0'], ['anxious', '紧张', '#c9a012'], ['calm', '平和', '#3fa36b'], ['shy', '害羞', '#1fa5b8'], ['disgust', '嫌弃', '#8b67d6'], ['love', '爱恋', '#e0609a'], ['crying', '哭泣', '#659bc4']].map(([id, label, color]) => ({id, label, color})),
      palette: ['#e0707c', '#2fae9a', '#b56be0', '#d9942a', '#4a8fe0', '#e0689f', '#6aa84f', '#8a7fe0'], max: 8}})
  window.root = ReactDOM.createRoot(document.getElementById('panel'))
  window.show = (key) => window.root.render(h(window.views.StagePanel, {key, binding: window.binding, sessionId: 's', cardPath: 'cards/madoka.json', cardName: '鹿目圆的日常', nav,
    renderGlobal: globalRows, renderDebug: () => h('p', {className: 'ap-empty'}, '本轮输入（离线截图不读取导演预览）')}))
}

export async function run() {
  const { chromium } = await import('playwright')
  const { source, picker, playback } = await stageSource()
  const css = await forkThemeCss()
  await mkdir(outDir, { recursive: true })
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const shots = [], errors = []
  try {
    for (const [theme, tokens] of Object.entries(THEMES)) for (const [size, viewport] of [['desktop', { width: 1280, height: 900 }], ['375', { width: 375, height: 812 }]]) {
      const page = await browser.newPage({ viewport, deviceScaleFactor: size === '375' ? 2 : 1 })
      page.on('pageerror', e => errors.push(theme + '/' + size + ': ' + e.message))
      // A real origin so localStorage / sessionStorage behave as in the host.
      await page.route('http://stage.test/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body><div class="host"><main class="chat"></main><aside id="panel"></aside></div></body></html>' }))
      await page.goto('http://stage.test/')
      await page.addStyleTag({ content: css + `
        html, body { margin: 0; } body { ${tokens} background: var(--page); font-family: "Microsoft YaHei UI", "PingFang SC", sans-serif; }
        .host { display: flex; min-height: 100vh; } .chat { flex: 1; background: var(--page); }
        #panel { width: ${size === '375' ? '100%' : '560px'}; flex: none; border-left: 1px solid var(--fork-hairline); }
        ${size === '375' ? '.chat { display: none; }' : ''}` })
      await page.evaluate(context => { document.body.dataset.fkContext = context }, 'chat-' + theme)
      await page.addScriptTag({ content: await browserReactScript() + ';window.React=modules.react;window.ReactDOM=modules["react-dom/client"];' + playback + source + picker })
      await page.evaluate(pageSetup)
      // Dialogs are viewport-fixed, so their shots are viewport-sized; pages are captured in full.
      const shot = async name => { const file = path.join(outDir, `${name}-${theme}-${size}.png`); await page.waitForTimeout(250); await page.screenshot({ path: file, fullPage: !(await page.getByRole('dialog').count()) }); shots.push(file) }
      const start = async (scenario, mode = 'basic') => { await page.evaluate(([s, m]) => { window.scenario(s); window.show(s + m + Math.random()) }, [scenario, mode]); await page.locator('.ap-stage-page, .ap-first-run').first().waitFor() }
      const openCharacter = async name => { await page.getByRole('button', { name: '打开角色 ' + name }).click(); await page.getByRole('dialog').waitFor() }
      const closeDialogs = async () => {
        for (let i = 0; i < 6 && await page.getByRole('dialog').count(); i++) {
          await page.getByRole('dialog').last().locator('button').first().focus(); await page.keyboard.press('Escape'); await page.waitForTimeout(80)
        }
        if (await page.getByRole('dialog').count()) throw new Error('dialog did not close')
      }

      // private fork: v3 cast binding, appearance fallback, atomic creation and unique library editor.
      await start('first-run'); await shot('01-first-run')
      await page.getByRole('button', { name: '启用舞台（对话气泡）' }).click(); await page.getByText('已保存',{exact:true}).waitFor()
      await start('main'); await page.getByRole('heading',{name:'当前素材包'}).waitFor(); await shot('02-cast')
      await openCharacter('鹿目圆'); await page.getByLabel('搜索人物').waitFor(); await shot('03-cast-entry')
      if(await page.getByLabel('角色备注').count()||await page.getByLabel('为这个角色配音').count())throw Error('retired card authoring')
      await page.getByRole('radio',{name:'头像',exact:true}).click();await page.getByText('头像只在对话栏显示，不进入舞台。').waitFor()
      await page.getByRole('radio',{name:'Live2D',exact:true}).click();await page.getByText('已保存',{exact:true}).waitFor()
      await page.getByRole('button',{name:'在素材库编辑'}).click();await page.getByLabel('人物名称').waitFor();await shot('04-figure-editor')
      await page.locator('.ap-face[aria-label="平和"]').click();const guidance=page.getByLabel('平和使用情景');await guidance.fill('轻声');await guidance.blur() // private fork (figure-editor r7): 使用情景
      await page.getByRole('button',{name:'调整头像裁切',exact:true}).click();const cropBox=page.getByRole('slider',{name:/头像裁切框/});await cropBox.waitFor();await shot('05-crop')
      await cropBox.focus();await page.keyboard.press('ArrowRight');await page.getByRole('button',{name:'保存裁切',exact:true}).click()
      await page.getByRole('dialog',{name:'头像裁切',exact:true}).waitFor({state:'detached'})
      await closeDialogs();await start('main');await openCharacter('路人');await page.getByRole('button',{name:'新建人物并绑定'}).click()
      await page.getByRole('button',{name:'保存到：未选择'}).click();await page.getByRole('menuitem',{name:'鹿目圆素材',exact:true}).click()
      await page.getByRole('button',{name:'创建并编辑'}).click();await page.getByLabel('人物名称').waitFor();await shot('06-created-figure')
      if(await page.getByRole('button',{name:/保存到：/}).count())throw Error('repeated target prompt')
      if(await page.evaluate(()=>calls.filter(([method])=>method==='createCardFigure').length)!==1)throw Error('not one compound RPC')
      const png=Buffer.from((await page.evaluate(()=>{const c=document.createElement('canvas');c.width=500;c.height=1000;const g=c.getContext('2d');g.fillStyle='#bb7755';g.fillRect(100,100,300,800);return c.toDataURL('image/png')})).split(',')[1],'base64')
      await page.getByLabel('上传平和立绘',{exact:true}).setInputFiles({name:'figure.png',mimeType:'image/png',buffer:png})
      await page.waitForFunction(()=>!document.querySelector('.ap-loading'))
      await page.waitForFunction(()=>document.querySelector('input[aria-label="形象色"]')?.value==='#bb7755')
      await shot('07-first-image')
      await closeDialogs();await start('main','advanced');await page.getByRole('button',{name:'开场画面 备选 1'}).click();await shot('08-opening')
      await closeDialogs(); await page.close()
    }
  } finally { await browser.close() }
  return { shots, errors }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { shots, errors } = await run()
  console.log(shots.length + ' screenshots → ' + outDir)
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1 }
}
