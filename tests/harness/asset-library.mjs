// private fork: standalone offline harness for 素材库 (docs/fork/panel-ui-design.md §四). Chromium renders the real
// factory source with an in-page mocked pack service / RPC (synthetic data, no live packs) and writes screenshots of
// the compact pack list and the pack detail for light/dark × 375px/desktop.
// Usage: node tests/harness/asset-library.mjs [outDir]
import { readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { browserReactScript } from '../fixtures/browser-react.mjs'
import { forkThemeCss } from '../helpers/fork-theme-css.mjs'
import { stageSource } from './card-centric-stage.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const outDir = process.argv[2] || path.join(root, '.tmp/asset-library')

const THEMES = {
  light: 'color-scheme:light;--fork-ink:#20252d;--fork-ink-2:#5f6776;--fork-ink-3:#959caa;--fork-hairline:#e1e5eb;--fork-surface:#fbfcfe;--fork-accent:#3f6ddd;--fork-accent-soft:#e9effc;--fork-hover:#eef1f5;--page:#e9ecf1;',
  dark: 'color-scheme:dark;--fork-ink:#e4e7ec;--fork-ink-2:#aab1bd;--fork-ink-3:#7c8391;--fork-hairline:#2d3139;--fork-surface:#1a1c21;--fork-accent:#7f9dff;--fork-accent-soft:#263152;--fork-hover:#262a31;--page:#101114;'
}

function pageSetup() {
  const PACK = '11111111-1111-4111-8111-111111111111', GENERAL = '22222222-2222-4222-8222-222222222222', OTHER = '33333333-3333-4333-8333-333333333333', SFX = '44444444-4444-4444-8444-444444444444', EMPTY = '55555555-5555-4555-8555-555555555555'
  const names = { backgrounds: ['见泷原中学 教室', '见泷原中学 屋顶', '河堤 黄昏', '鹿目家 客厅', '商店街', '车站月台', '公园 夜'], music: ['日常', '紧张', '悲伤的旋律', '战斗'], sfx: ['开门', '脚步声', '铃声'], ambience: ['雨声', '蝉鸣'], looks: ['回忆滤镜'], widgets: [] }
  const assets = counts => Object.entries(counts).flatMap(([kind, n]) => Array.from({ length: n }, (_, i) => ({ kind, id: kind + i, name: (names[kind] || [])[i] || kind + ' ' + (i + 1), enabled: i !== 2, media: 'h' + kind + i,
    recall: { mode: i % 3 === 0 ? 'constant' : 'keyword', keywords: i % 2 ? ['教室', '课间'] : [] }, directorNote: '' })))
  const figure = (id, name) => ({ schemaVersion: 1, id, name, enabled: true, outfits: [{ key: 'default', label: '默认', enabled: true }] })
  const pack = (id, name, counts, figures = [], description) => ({ manifest: { id, name, ...(description ? { description } : {}), assets: assets(counts), figures: figures.map(f => f.id), bundles: {}, blobs: {} }, figures: Object.fromEntries(figures.map(f => [f.id, f])), sprites: {}, revision: 'r1' })
  const packs = [
    pack(PACK, '见泷原的奇妙冒险素材', { backgrounds: 7, music: 4, sfx: 3, ambience: 2, looks: 1 }, [figure('f1', '鹿目圆'), figure('f2', '晓美焰')], '见泷原市的学校、街道与鹿目家；附带两位主角的立绘。'),
    pack(GENERAL, '通用素材', { backgrounds: 34, music: 61, sfx: 12, ambience: 8 }, [figure('f3', '少女 A'), figure('f4', '少年 B')]),
    pack(OTHER, '高坂月角色包', { backgrounds: 1 }, [figure('f5', '高坂月')]),
    pack(SFX, '通用音效', { sfx: 30, ambience: 8 }),
    pack(EMPTY, '新建素材包', {})
  ]
  const bindings = { [PACK]: { path: 'cards/mitakihara.json', name: '见泷原的奇妙冒险V3.6' }, [OTHER]: { path: 'cards/kosaka.json', name: '高坂月的日常' } }
  const clone = v => JSON.parse(JSON.stringify(v))
  window.calls = []
  window.binding = {
    service: { apiVersion: 2, capabilities: ['packs', 'figures'], subscribe: () => () => {},
      listPackSummaries: async () => clone(packs), getPackSnapshot: async ({ packId }) => clone(packs.find(p => p.manifest.id === packId)),
      exportPack: async () => ({ bytes: new Uint8Array(), filename: 'pack.zip' }), patchPack: async () => ({ snapshot: clone(packs[0]) }) },
    rpc: async (method, args) => {
      window.calls.push([method, clone(args || {})]); await new Promise(r => setTimeout(r, 20))
      if (method === 'getAssetPackDependencies') { const binding = bindings[args.packId]; const cards = [...(binding ? [binding] : []), { path: 'cards/x.json', name: '放学后' }]; return { available: true, packId: args.packId, count: cards.length, cards } }
      throw new Error('mock: ' + method)
    },
    settings: {}, globalEnabledPackIds: [SFX, GENERAL], setGlobalEnabled: async () => {}, loadSettings: async () => {},
    previewMedia: async () => ({ url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', release() {} }), download() {}
  }
  const h = React.createElement
  window.views = createForkAssetPackUI(React, { VoicePicker: ForkBubbleLibraryPicker, AvatarImage: ForkPackImage })
  window.root = ReactDOM.createRoot(document.getElementById('panel'))
  let pending = null; const listeners = new Set()
  window.nav = { take: () => { const next = pending; pending = null; return next }, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) } }
  window.openPack = target => { pending = target; listeners.forEach(fn => fn()) }
  window.show = key => window.root.render(h(window.views.App, { key, enabled: true, binding: window.binding, nav: window.nav }))
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
      await page.route('http://library.test/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body><div class="host"><main class="chat"></main><aside id="panel"></aside></div></body></html>' }))
      await page.goto('http://library.test/')
      await page.addStyleTag({ content: css + `
        html, body { margin: 0; } body { ${tokens} background: var(--page); font-family: "Microsoft YaHei UI", "PingFang SC", sans-serif; }
        .host { display: flex; min-height: 100vh; } .chat { flex: 1; background: var(--page); }
        #panel { width: ${size === '375' ? '100%' : '560px'}; flex: none; border-left: 1px solid var(--fork-hairline); }
        ${size === '375' ? '.chat { display: none; }' : ''}` })
      await page.evaluate(context => { document.body.dataset.fkContext = context }, 'chat-' + theme)
      await page.addScriptTag({ content: await browserReactScript() + ';window.React=modules.react;window.ReactDOM=modules["react-dom/client"];' + playback + source + picker })
      await page.evaluate(pageSetup)
      const shot = async name => { const file = path.join(outDir, `${name}-${theme}-${size}.png`); await page.waitForTimeout(250); await page.screenshot({ path: file, fullPage: !(await page.getByRole('dialog').count()) }); shots.push(file) }

      await page.evaluate(() => window.show('list'))
      await page.getByRole('button', { name: '打开 通用素材' }).waitFor()
      if (await page.locator('.ap-owner-chip').count()) errors.push('obsolete owner chip')
      if (await page.getByText('基础', { exact: true }).count()) errors.push('mode switch still rendered')
      if (await page.locator('code').count()) errors.push('UUID line still rendered in list')
      await shot('01-list')
      await page.getByRole('button', { name: '删除 通用音效' }).click(); await page.getByRole('dialog').waitFor(); await shot('02-delete-confirm')
      await page.getByRole('dialog').getByRole('button', { name: '取消' }).click()
      await page.getByRole('button', { name: '打开 见泷原的奇妙冒险素材' }).click()
      await page.getByLabel('条目列表').waitFor()
      if (await page.getByText(/修改此包会影响|背景 7/).count()) errors.push('helper text still rendered in detail')
      await shot('03-detail')
      await page.getByRole('button', { name: '更多操作 见泷原的奇妙冒险素材' }).click(); await page.getByRole('menu').waitFor(); await shot('04-detail-menu')
      if (await page.getByRole('menuitem', {name: /本卡素材包|独立素材包/}).count()) errors.push('obsolete ownership menu')
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: '人物' }).click(); await page.getByRole('button', { name: '编辑 鹿目圆' }).waitFor(); await shot('06-detail-figures')
      await page.getByRole('button', { name: '返回素材包列表' }).click(); await page.getByRole('button', { name: '打开 通用音效' }).click()
      await page.getByRole('button', { name: '更多操作 通用音效' }).waitFor()
      if (await page.locator('.ap-owner-chip').count()) errors.push('independent pack shows an owner chip')
      await page.getByRole('button', { name: '更多操作 通用音效' }).click(); await page.getByRole('menuitem', { name: '导出', exact: true }).waitFor(); await shot('07-independent-menu')
      await page.close()
    }
  } finally { await browser.close() }
  return { shots, errors }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { shots, errors } = await run()
  console.log(shots.length + ' screenshots → ' + outDir)
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1 }
}
