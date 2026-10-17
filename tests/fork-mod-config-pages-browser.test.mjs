// private fork (mod-pages, owner 2026-10; docs/fork/mod-config.md, design output/mod-plan/config-proposal): the phone
// settings page in a real browser against the real config service (built-in schemas, layered store, RPC validation):
// real clicks on the preview edit 本卡 / 全局, a formula, an upload, a contact's 备注名, and 恢复为全局.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'
import { modConfigCss, HOST } from './fixtures/fork-mod-config-page.mjs'
import { browserReactScript } from './fixtures/browser-react.mjs'
import { createFirstPartyMods } from '../tavern-plugin/lib/fork-mod-builtins.js'
import { builtinConfigSchemas, stageConfigExports } from '../tavern-plugin/lib/domain/mods/config-builtins.js'
import { stateSourceSchema } from '../tavern-plugin/lib/domain/mods/state-source.js'
import { createConfigSourceRegistry } from '../tavern-plugin/lib/domain/mods/config-sources.js'
import { createModConfigStore, createModConfigRpc } from '../tavern-plugin/lib/fork-mod-config.js'
import { stageSource } from './harness/card-centric-stage.mjs'
import { createModRegistry } from '../tavern-plugin/lib/domain/mods/registry.js'
import { createModRpc } from '../tavern-plugin/lib/fork-mod-rpc.js'
import { createLibraryModMedia, withModMedia } from '../tavern-plugin/lib/fork-mod-media.js'

const root = new URL('../', import.meta.url), client = name => readFile(new URL('tavern-plugin/src/client/' + name, root), 'utf8')
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

async function service(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'mod-pages-')); t.after(() => rm(dir, { recursive: true, force: true }))
  const builtin = await createFirstPartyMods(), manifests = builtin.catalogue().map(row => builtin.manifest(row.id)), schemas = {...builtinConfigSchemas(manifests), 'dsh.state': stateSourceSchema}
  let card = { revision: '0', config: null }; const cardFiles = new Map()
  const cardPacks = { read: async () => card, write: async args => { card = { revision: String(Number(card.revision) + 1), config: args.config } },
    upload: async args => { cardFiles.set(args.file.path, Buffer.from(args.bytes)); card = { ...card, revision: String(Number(card.revision) + 1) } }, readFile: async args => cardFiles.get(args.path) || null }
  const sources = createConfigSourceRegistry()
  sources.register({ id: 'mvu', label: 'MVU', exports: [], read: ctx => ctx.sources?.mvu || { available: false } })
  sources.register({ id: 'stage', label: '舞台', exports: stageConfigExports, read: ctx => ctx.sources?.stage || { available: false } })
  for (const [id, schema] of Object.entries(schemas)) sources.register({ id: 'mod:' + id, label: id, exports: schema.fields.map(f => ({ path: '/' + f.key, name: f.label, type: f.valueType, description: f.label, settingKey: f.key })), read: ({ settings }) => settings })
  const vars = { 世界状态: { 时间: ['08:10', '当前时间'] }, 主角: { 电量: 60 } }
  const rpc = createModConfigRpc({ schemas, store: createModConfigStore({ root: dir, cardPacks }), sources, authorize: () => true,
    context: async args => args.cardId ? { cardId: args.cardId, raw: { data: { extensions: {} } }, sources: { mvu: { available: true, value: vars }, stage: { available: true, value: { mainCharacterColor: '#f19ec2' }, labels: { '/mainCharacterColor': '鹿目圆形象色' } } } } : {} })
  return { rpc, dir, card: () => card.config?.values || {}, cardFile: file => cardFiles.get(file), global: async () => JSON.parse(await readFile(path.join(dir, 'dsh.phone', 'config.json'), 'utf8')).values }
}

test('phone settings page: compact list + preview hotspots edit 本卡 and 全局 inline (no mode layer), upload, contact 备注名 and 恢复为全局', async t => {
  const host = await service(t)
  // An old stored formula (信号) must keep working.
  const before = await host.rpc.getModConfig({ modId: 'dsh.phone', cardId: 'card-a' }, { origin: 'test' })
  await host.rpc.setModConfig({ modId: 'dsh.phone', cardId: 'card-a', key: 'signal', layer: 'card', value: { formula: '1 + 1' }, expectedRevision: before.revision }, { origin: 'test' })
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }), errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.exposeFunction('hostRpc', async (method, args) => { try { return { ok: await host.rpc[method](args, { origin: 'test' }) } } catch (e) { return { error: { code: e.code, message: e.message } } } })
  await page.setContent(`<!doctype html><html lang="zh-CN"><head><style>${await modConfigCss()}</style></head><body data-fk-context="chat-dark" style="${HOST.dark}"><div id="root" class="ap-ui"></div></body></html>`)
  await page.addScriptTag({ content: [await browserReactScript(), 'const React=modules.react,ReactDOM=modules["react-dom"];',
    '(()=>{' + await readFile(new URL('tavern-plugin/shared/figure-auto-color.cjs', root), 'utf8') + ';window.figureColorShades=figureColorShades;})();',
    await client('fork-spinner.js'), await client('fork-inline-field.js'), await client('fork-data-picker.js'), await client('fork-mod-config-ui.js'),
    // Host page pieces the page sits in (panel section, row, error box, item packs, the stage's characters).
    `const h=React.createElement;function StageSection(p){return h('section',{'data-title':p.title},h('h3',null,p.title),p.children)}
     function ForkInlineRow(p){return h('div',null,p.label,' ',p.children)} function ErrorBox(p){return p.error?h('p',{role:'alert'},String(p.error)):null} function ModAssets(){return null} function Help(p){return h('button',{type:'button','aria-label':p.label},'?')}
     function useForkBubbles(){return {cardName:'小圆',config:{characters:[{alias:'madoka',name:'鹿目圆',color:'#f19ec2'}]}}}`,
    // private fork (settings-ux r2): the page includes the phone battery levels shared with the stage phone, as the build does.
    (await client('fork-mod-config-pages.js')).replace(/^\/\/ @include-mod phone\/view\/battery\.js$/m, () => readFileSync(new URL('fork/mods/phone/view/battery.js', root), 'utf8')),
    `const rpc=async(m,a)=>{const r=await window.hostRpc(m,a);if(r.error)throw Object.assign(new Error(r.error.message),r.error);return r.ok};
     modules['react-dom/client'].createRoot(document.getElementById('root')).render(h(ForkPhoneConfigPage,{rpc,cardId:'card-a',cardName:'小圆',sessionId:'s1',manifest:{version:'1.0.0'}}))`].join('\n;\n') })
  const spot = label => page.locator('.fork-cfg-hotspot[aria-label="' + label + '"]'), pop = page.locator('.fork-cfg-pop')
  await spot('运营商').waitFor(); await page.locator('.fork-phone').waitFor()
  assert.equal(await page.locator('.fork-cfg-scope [aria-checked="true"], .fork-cfg-scope [aria-pressed="true"]').first().innerText(), '本卡 · 小圆')
  // Auto: the guessed clock variable and the protagonist colour.
  assert.equal(await page.locator('.fork-phone-clock').innerText(), '08:10')
  // private fork (mod-settings-simple): 状态来源 is one row (no section repeating it); what the phone cannot show is listed.
  assert.equal(await page.locator('section[data-title="状态来源"]').count(), 0)
  assert.match(await page.getByRole('button', { name: /^状态来源：/ }).innerText(), /自动/)
  assert.deepEqual(await page.locator('.fork-cfg-list .fork-inline-label-text').allInnerTexts(), ['状态来源', '日期', '星期'])
  assert.match(await page.getByRole('button', { name: /^日期：/ }).innerText(), /自动（跟随状态）/)
  // 本卡: carrier is plain text — its popover is the text field itself, no 自动 / 固定 layer; the hotspot gets the card dot.
  await spot('运营商').click(); await pop.waitFor(); assert.equal(await pop.getByRole('radio').count(), 0)
  await pop.locator('.fork-inline-field').click(); await page.keyboard.type('见泷原通信'); await page.keyboard.press('Enter')
  await page.waitForFunction(() => document.querySelector('.fork-phone-carrier')?.textContent === '见泷原通信')
  // private fork (settings-ux r2, owner 2026-10): no 「保存在」 footer (the scope switch says where); the layer's reset icon says it.
  assert.equal(await pop.locator('.fork-cfg-pop-foot').count(), 0)
  assert.equal(await pop.locator('button.fork-reset-button').getAttribute('aria-label'), '恢复为全局')
  assert.deepEqual(host.card().carrier, { fixed: '见泷原通信' })
  assert.equal(await spot('运营商').getAttribute('data-dot'), 'card')
  // 电量: one menu 固定 · 选择变量… · 公式… (no 自动: it has no automatic source) with the slider after 固定; End writes 100.
  await page.keyboard.press('Escape'); await spot('电量').click(); await pop.getByRole('slider').focus(); await page.keyboard.press('End')
  await page.waitForFunction(() => document.querySelector('.fork-phone-batt b')?.textContent === '100', null, { timeout: 5000 })
  assert.deepEqual(host.card().battery, { fixed: 100 })
  await pop.locator('button.fork-inline-trigger').first().click()
  assert.deepEqual(await page.getByRole('menuitemradio').allInnerTexts(), ['固定', '选择变量…', '公式…'])
  // 选择变量… follows a variable (a reference); the phone reads it, the menu names it.
  await page.getByRole('menuitemradio', { name: '选择变量…', exact: true }).click()
  await pop.getByRole('combobox').fill('主角电量'); await page.keyboard.press('Enter')
  await page.waitForFunction(() => document.querySelector('.fork-phone-batt b')?.textContent === '60', null, { timeout: 5000 })
  assert.deepEqual(host.card().battery, { ref: { source: 'mvu', path: '/主角/电量' } })
  assert.match(await pop.locator('button.fork-inline-trigger').first().innerText(), /跟随 MVU \/主角\/电量/)
  if (process.env.DSH_PHONE_SCREENSHOTS) { await page.screenshot({ path: path.join(process.env.DSH_PHONE_SCREENSHOTS, 'battery-bound-1280.png') }); await page.setViewportSize({ width: 375, height: 812 }); await page.waitForTimeout(300); await page.screenshot({ path: path.join(process.env.DSH_PHONE_SCREENSHOTS, 'battery-bound-375.png') }); await page.setViewportSize({ width: 1280, height: 900 }) }
  // A stored formula keeps working and reads as 公式.
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('.fork-phone-bars i[data-on]').count(), 2, 'the stored formula 1 + 1 paints two bars')
  await spot('信号').click(); await pop.waitFor()
  assert.equal(await pop.locator('button.fork-inline-trigger').first().innerText(), '公式')
  await page.keyboard.press('Escape')
  // 恢复为全局 removes the card key.
  await page.keyboard.press('Escape'); await spot('运营商').click(); await pop.getByRole('button', { name: '恢复为全局' }).click()
  await page.waitForFunction(() => document.querySelector('.fork-phone-carrier')?.textContent === '')
  assert.equal(Object.hasOwn(host.card(), 'carrier'), false)
  // 全局: the wallpaper set — two uploads at once from the add tile land in the global layer's files/, named by file.
  await page.keyboard.press('Escape'); await page.locator('.fork-cfg-scope').getByText('全局', { exact: true }).click()
  await spot('壁纸').click()
  const png = name => ({ name, mimeType: 'image/png', buffer: Buffer.from(PNG, 'base64') })
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), pop.getByRole('button', { name: '添加壁纸' }).click()])
  await chooser.setFiles([png('晴天.png'), png('夜景.png')])
  await page.waitForFunction(() => document.querySelectorAll('.fork-phone-wall-item').length === 2, null, { timeout: 5000 })
  await page.waitForFunction(() => /data:image\/png/.test(document.querySelector('.fork-phone-wall')?.style.backgroundImage || ''), null, { timeout: 5000 })
  let walls = (await host.global()).wallpaper.fixed
  assert.deepEqual(walls.map(w => w.name), ['晴天', '夜景'])
  for (const w of walls) { assert.match(w.file, /^files\/[0-9a-f-]{36}\.png$/); await readFile(path.join(host.dir, 'dsh.phone', w.file)) }
  assert.equal(await pop.locator('button.fork-reset-button').getAttribute('aria-label'), '恢复默认')
  // 「设为默认」 on the second, then remove the first: the set keeps 夜景 as its default.
  await pop.getByRole('button', { name: '设为默认 夜景' }).click()
  await page.waitForFunction(() => document.querySelectorAll('.fork-phone-wall-item')[1]?.hasAttribute('data-default'))
  assert.deepEqual((await host.global()).wallpaper.fixed.map(w => [w.name, !!w.default]), [['晴天', false], ['夜景', true]])
  await pop.getByRole('button', { name: '移除 晴天' }).click()
  await page.waitForFunction(() => document.querySelectorAll('.fork-phone-wall-item').length === 1)
  walls = (await host.global()).wallpaper.fixed
  assert.deepEqual(walls.map(w => [w.name, !!w.default]), [['夜景', true]])
  // 本卡 (the editor stays open across the switch): inherits the global set until 本卡 adds its own, which replaces it whole.
  await page.locator('.fork-cfg-scope').getByText('本卡 · 小圆').click()
  await page.waitForFunction(() => /沿用全局的 1 张/.test(document.querySelector('.fork-phone-walls')?.textContent || ''))
  await pop.locator('input[type=file]').setInputFiles(png('教室.png'))
  await page.waitForFunction(() => document.querySelector('.fork-phone-walls button.fork-reset-button')?.getAttribute('aria-label') === '恢复为全局' && document.querySelectorAll('.fork-phone-wall-item:not([data-inherited])').length === 1, null, { timeout: 5000 })
  const cardWalls = host.card().wallpaper.fixed
  assert.deepEqual(cardWalls.map(w => w.name), ['教室']); assert.ok(host.cardFile(cardWalls[0].file), 'saved in the card pack')
  assert.equal((await host.global()).wallpaper.fixed[0].file, walls[0].file)
  await pop.getByRole('button', { name: '恢复为全局' }).click()
  await page.waitForFunction(() => /沿用全局的 1 张/.test(document.querySelector('.fork-phone-walls')?.textContent || ''))
  assert.equal(Object.hasOwn(host.card(), 'wallpaper'), false)
  // 本卡: a contact's 备注名 (one map keyed by the stage alias).
  await page.keyboard.press('Escape')
  await spot('联系人').click(); await page.locator('.fork-phone-contacts .fork-inline-field').first().click(); await page.keyboard.type('小圆'); await page.keyboard.press('Enter')
  await page.waitForFunction(() => document.querySelector('.fork-phone-appbar strong')?.textContent === '小圆')
  assert.deepEqual(host.card().contacts, { fixed: { madoka: { name: '小圆' } } })
  assert.deepEqual(errors, [])
})

test('items categories: config-only mod editor without retired packs, layer copy/upload/reset and mobile layout', async t => {
  const host=await service(t),builtin=await createFirstPartyMods(),manifest=builtin.manifest('dsh.items');
  assert.deepEqual(manifest.defaultPacks,[]);
  const library=createModRegistry({capabilities:['stage.place','stage.reviseAfterSettlement']});
  await library.install({manifest,packs:[],expectedRevision:library.snapshot().revision});
  const media=createLibraryModMedia({root:host.dir,library,builtins:builtin}),api=createModRpc({library:withModMedia(library,media),authorize:()=>true});
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1280,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.exposeFunction('hostRpc',async(method,args)=>{try{return {ok:await (host.rpc[method] || api[method])(args,{origin:'test'})}}catch(e){return {error:{code:e.code,message:e.message}}}});
  await page.setContent(`<!doctype html><html lang="zh-CN"><head><style>${await modConfigCss()} body{margin:0;padding:16px;box-sizing:border-box}</style></head><body data-fk-context="chat-dark" style="${HOST.dark}"><div id="root" class="ap-ui"></div></body></html>`);
  const source=(await stageSource()).source;
  await page.addScriptTag({content:[await browserReactScript(),'const React=modules.react,ReactDOM=modules["react-dom"];',await client('fork-data-picker.js'),await client('fork-mod-config-ui.js'),source,
    `const rpc=async(m,a)=>{const r=await window.hostRpc(m,a);if(r.error)throw Object.assign(new Error(r.error.message),r.error);return r.ok};const ui=createForkAssetPackUI(React);modules['react-dom/client'].createRoot(document.getElementById('root')).render(React.createElement(ui.ModDetail,{rpc,cardId:'card-a',cardName:'大肥鱼',modId:'dsh.items',onBack(){}}));/* private fork (one mod entry, owner 2026-10): no 模组库 — the page itself */`].join('\n;\n')});
  const sourceRow=page.getByRole('button',{name:/^状态来源：/});
  await sourceRow.waitFor({timeout:5000});
  assert.equal(await page.getByText('状态来源',{exact:true}).count(),1,'one label, no section repeating it');
  const help=page.getByRole('button',{name:'状态来源 说明',exact:true});
  await help.click();
  await page.getByText('全局共用。自动：卡里有 MVU 变量时读 MVU，没有时读游玩台账；也可手动指定其中一个。',{exact:true}).waitFor();
  assert.ok(!(await help.getAttribute('title') || '').includes('自动：'));
  await page.keyboard.press('Escape');
  await sourceRow.click();
  assert.deepEqual(await page.getByRole('menuitemradio').allInnerTexts(),['自动','MVU','游玩台账'],'the choices themselves, no 自动 / 固定 layer');
  await page.getByRole('menuitemradio',{name:'游玩台账',exact:true}).click();
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('button[aria-haspopup="menu"]')).some(b=>/^状态来源：游玩台账/.test(b.getAttribute('aria-label'))));
  const shared=await host.rpc.getModConfig({modId:'dsh.state'},{origin:'test'});
  assert.deepEqual(shared.global.source,{fixed:'ledger'});
  assert.deepEqual(shared.card,{});
  const categories=page.getByRole('group',{name:'物品分类',exact:true});
  await categories.getByRole('button',{name:'药品',exact:true}).waitFor({timeout:5000});
  assert.equal(await categories.locator('button').count(),9);
  assert.equal(await page.locator('.ap-mod-pack').count(),0);
  assert.equal(await page.getByRole('button',{name:'新建素材包',exact:true}).count(),0);
  await categories.getByRole('button',{name:'药品',exact:true}).click();
  await page.getByLabel('换图',{exact:true}).setInputFiles({name:'bad.txt',mimeType:'text/plain',buffer:Buffer.from('invalid')});
  await page.getByRole('alert').filter({hasText:'请选择 PNG、WebP 或 JPEG 图片'}).waitFor();
  assert.equal((await host.rpc.getModConfig({modId:'dsh.items',cardId:'card-a'},{origin:'test'})).card.categories,undefined);
  await categories.getByRole('button',{name:'药品',exact:true}).click();
  await page.getByRole('radio',{name:'全局',exact:true}).click();
  await categories.getByRole('button',{name:'药品',exact:true}).click();
  await page.getByRole('group',{name:'药品',exact:true}).locator('.fork-inline-field').first().click();
  await page.getByRole('textbox',{name:'名称',exact:true}).fill('医药');await page.getByRole('textbox',{name:'名称',exact:true}).press('Enter');
  await categories.getByRole('button',{name:'医药',exact:true}).waitFor();
  await page.getByLabel('换图',{exact:true}).setInputFiles({name:'icon.png',mimeType:'image/png',buffer:Buffer.from(PNG,'base64')});
  await page.waitForFunction(()=>!document.querySelector('[aria-label="物品分类"] button')?.disabled);
  const get=()=>host.rpc.getModConfig({modId:'dsh.items',cardId:'card-a'},{origin:'test'});
  let current=await get();assert.ok(current.global.categories.fixed.find(row=>row.id==='medicine').icon.file);
  const originalFile=current.global.categories.fixed.find(row=>row.id==='medicine').icon.file;
  await page.getByRole('radio',{name:'本卡 · 大肥鱼',exact:true}).click();
  await categories.getByRole('button',{name:'添加分类',exact:true}).click();
  await categories.getByRole('button',{name:'新分类',exact:true}).waitFor();
  current=await get();assert.equal(current.card.categories.fixed.length,9);assert.notEqual(current.card.categories.fixed.find(row=>row.id==='medicine').icon.file,originalFile);
  assert.equal(current.global.categories.fixed.length,8);
  await page.getByRole('button',{name:'恢复为全局',exact:true}).click();
  await page.waitForFunction(()=>!Array.from(document.querySelectorAll('[aria-label="物品分类"] button')).some(node=>node.textContent==='新分类'));
  assert.equal((await get()).card.categories,undefined);
  await page.getByRole('radio',{name:'全局',exact:true}).click();
  await page.locator('.ap-section',{has:categories}).last().getByRole('button',{name:'恢复默认',exact:true}).click();
  await categories.getByRole('button',{name:'药品',exact:true}).waitFor();
  await page.getByRole('radio',{name:'本卡 · 大肥鱼',exact:true}).click();
  for(const width of [1280,375]) {
    await page.setViewportSize({width,height:1000});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    if(process.env.DSH_CATEGORIES_SCREENSHOTS){const {mkdir}=await import('node:fs/promises');await mkdir(process.env.DSH_CATEGORIES_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.DSH_CATEGORIES_SCREENSHOTS,'after-'+width+'.png'),fullPage:true})}
  }
  assert.deepEqual(errors,[]);
});