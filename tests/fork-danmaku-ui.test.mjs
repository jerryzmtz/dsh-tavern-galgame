import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import vm from 'node:vm'

const require = createRequire(import.meta.url)
const plain = v => v === undefined ? v : JSON.parse(JSON.stringify(v))
const stage = require('../tavern-plugin/src/client/fork-danmaku-stage.cjs')
const source = name => readFile(new URL('../tavern-plugin/src/client/' + name, import.meta.url), 'utf8')
async function scriptExports(name, names) {
  const context = vm.createContext({console})
  vm.runInContext(await source(name) + '\n;globalThis.__x={' + names.join(',') + '}', context)
  // Results cross realms: compare them as plain JSON.
  return Object.fromEntries(Object.entries(context.__x).map(([k, v]) => [k, typeof v === 'function' ? (...args) => plain(v(...args)) : plain(v)]))
}

test('飘屏 lanes avoid every safe region and keep the bottom-fixed rows just above the dialogue box', () => {
  const safeRegions = [{x: 0, y: 0, width: 1280, height: 50}, {x: 410, y: 210, width: 460, height: 150}, {x: 38, y: 586, width: 1204, height: 118}]
  const free = stage.danmakuLanes({width: 1280, height: 720, safeRegions, laneHeight: 34})
  assert.ok(free.length > 6)
  for (const lane of free) for (const r of safeRegions) assert.ok(lane.y + lane.height <= r.y || lane.y >= r.y + r.height, 'lane ' + lane.y + ' clears region ' + r.y)
  const {upper, lower} = stage.danmakuLaneSets(free, {maxLanes: 12})
  assert.ok(upper.length <= 12 && upper[0].y >= 50)
  assert.equal(lower[0], free.at(-1), 'bottom-fixed starts at the lowest free band')
  assert.ok(lower[0].y + lower[0].height <= 586)
  assert.deepEqual(stage.danmakuLanes({width: 0, height: 720, laneHeight: 30}), [])
})

test('scroll lanes never let a comment catch the one ahead; fixed lanes wait for expiry; top-fixed lanes are skipped', () => {
  const opts = {viewWidth: 1000, duration: 6500}
  const lanes = [null, null]
  assert.equal(stage.danmakuScrollLane(lanes, 0, 200, opts), 0)
  lanes[0] = {start: 0, width: 200, duration: 6500}
  assert.equal(stage.danmakuScrollLane(lanes, 100, 200, opts), 1, 'tail not in yet: next lane')
  lanes[1] = {start: 100, width: 800, duration: 6500}
  assert.equal(stage.danmakuScrollLane(lanes, 300, 200, opts), -1)
  assert.equal(stage.danmakuScrollLane([{start: 0, width: 200, duration: 6500}], 2600, 600, opts), 0, 'a later, faster comment that reaches the edge after the first has left')
  assert.equal(stage.danmakuScrollLane([{start: 0, width: 50, duration: 6500}], 900, 50, opts), 0)
  assert.equal(stage.danmakuScrollLane([null, null], 0, 50, {...opts, blocked: i => i === 0}), 1)
  assert.equal(stage.danmakuFixedLane([{until: 10}, null], 5), 1)
  assert.equal(stage.danmakuFixedLane([{until: 10}, {until: 20}], 15), 0)
  assert.equal(stage.danmakuFixedLane([{until: 10}], 5), -1)
})

test('DanmakuView helpers: merged comments, perspective, heat cool-down, colours and counts', () => {
  const c = (id, offsetMs, extra = {}) => ({id, text: id, author: 'a', kind: 'comment', offsetMs, durationMs: 6500, ...extra})
  const view = {silent: false, view: 'overlay', settings: {reducedMotion: false}, heat: 0,
    batches: [{offsetMs: 0, heat: 80, heatExpiresAtMs: 30000, comments: [c('b', 1200), c('a', 0)]}, {offsetMs: 40000, heat: 60, heatExpiresAtMs: 70000, comments: [c('c', 40000)]}],
    sidebar: {items: [c('a', 0)]}, highlights: [c('h', 500, {kind: 'highlight', durationMs: 0})]}
  assert.deepEqual(stage.danmakuComments(view).map(x => x.id), ['a', 'h', 'b', 'c'])
  const h = stage.danmakuComments(view).find(x => x.id === 'h')
  assert.deepEqual([h.durationMs, h.cardMs, h.tier, h.amount], [20000, 8000, 0, null], 'a highlight without an amount: first tier, no price')
  assert.equal(stage.danmakuPerspective(view), 'overlay')
  assert.equal(stage.danmakuPerspective({...view, view: 'sidebar'}), 'sidebar')
  assert.equal(stage.danmakuPerspective({...view, settings: {reducedMotion: true}}), 'sidebar', 'reduced motion = static console')
  assert.equal(stage.danmakuPerspective(view, true), 'sidebar', 'the stage CONFIG 减少动态 alone also means the static console')
  assert.equal(stage.danmakuPerspective({...view, view: 'off'}, true), null, 'reduced motion never turns off into the console')
  assert.equal(stage.danmakuPerspective({...view, silent: true}), null)
  assert.equal(stage.danmakuPerspective({...view, view: 'off'}), null)
  assert.equal(stage.danmakuHeatAt(view, 15000), 40)
  assert.equal(stage.danmakuHeatAt(view, 35000), 0)
  assert.equal(stage.danmakuHeatAt(view, 55000), 30)
  view.batches[0].online = 3214
  assert.equal(stage.danmakuOnlineAt(view, 15000), Math.round(3214 - 40 * 2.4))
  assert.equal(stage.danmakuOnlineAt({batches: [{offsetMs: 0, heat: 100, online: 20, heatExpiresAtMs: 10}]}, 50), 12, 'never below 12')
  assert.equal(stage.danmakuOnlineAt({batches: [], online: 0}, 50), 0)
  assert.deepEqual(stage.danmakuColour('#FE0302'), {colour: '#fe0302', dark: false})
  assert.equal(stage.danmakuColour('#222222').dark, true)
  for (const bad of ['red', '#fff', 'url(x)', null, '#12345g']) assert.equal(stage.danmakuColour(bad), null)
  assert.equal(stage.danmakuCount(3214), '3,214')
  assert.equal(stage.danmakuCount(12345), '1.2万')
  assert.equal(stage.danmakuCount(-3), '0')
  assert.equal(stage.danmakuClock(65000), '01:05'); assert.equal(stage.danmakuClock(3723000), '1:02:03')
})

test('醒目留言 tiers follow bilibili live SC: six amounts, longer pins and stronger effects as the amount grows', () => {
  assert.deepEqual(stage.DANMAKU_SC_TIERS.map(t => t.amount), [30, 50, 100, 500, 1000, 2000])
  for (let i = 1; i < 6; i++) {
    const [a, b] = [stage.DANMAKU_SC_TIERS[i - 1], stage.DANMAKU_SC_TIERS[i]]
    assert.ok(b.pinMs > a.pinMs && b.cardMs > a.cardMs && b.fx >= a.fx, 'tier ' + b.amount)
  }
  assert.equal(stage.danmakuScTier({kind: 'comment', amount: 30}), null)
  assert.deepEqual(plain(stage.danmakuScTier({kind: 'highlight', amount: 500})), {index: 3, amount: 500, pinMs: 60000, cardMs: 12000, fx: 2})
  for (const bad of [null, 0, 31, '30', 3000]) assert.deepEqual([stage.danmakuScTier({kind: 'highlight', amount: bad}).index, stage.danmakuScTier({kind: 'highlight', amount: bad}).amount], [0, null], String(bad))
  assert.equal(stage.danmakuPrice(2000), '¥2,000'); assert.equal(stage.danmakuPrice(30), '¥30'); assert.equal(stage.danmakuPrice(null), '')
  const c = stage.danmakuComments({batches: [{comments: [{id: 'x', text: 't', kind: 'highlight', amount: 1000, offsetMs: 5, durationMs: 9000, color: '#ff0000'}]}]})[0]
  assert.deepEqual([c.tier, c.durationMs, c.cardMs], [4, 90000, 14000], 'the tier sets the pin and card time')
})

test('飘屏: a reply prefers the lane under its parent, so a relay steps down the screen', () => {
  const opts = {viewWidth: 1000, duration: 6500}
  assert.equal(stage.danmakuScrollLane([null, null, null, null], 0, 100, {...opts, prefer: 2}), 2)
  assert.equal(stage.danmakuScrollLane([null, null, {start: 0, width: 600, duration: 6500}, null], 100, 100, {...opts, prefer: 2}), 0, 'preferred lane busy: first free')
  assert.equal(stage.danmakuScrollLane([null, null], 0, 100, {...opts, prefer: 5}), 0, 'out of range: ignored')
})

test('飘屏 viewer prefs (显示区域 / 不透明度 / 字号) and the area-limited lanes', () => {
  assert.deepEqual(stage.danmakuOverlayPrefs({}), {area: 0.75, alpha: 0.9, scale: 1})
  assert.deepEqual(stage.danmakuOverlayPrefs({area: 'quarter', opacity: 40, fontScale: 150}), {area: 0.25, alpha: 0.4, scale: 1.5})
  assert.deepEqual(stage.danmakuOverlayPrefs({area: 'bogus', opacity: 400, fontScale: -3}), {area: 0.75, alpha: 1, scale: 0.5}, 'clamped, unknown area = default')
  const free = stage.danmakuLanes({width: 1280, height: 720, safeRegions: [{x: 0, y: 0, width: 1280, height: 50}, {x: 38, y: 586, width: 1204, height: 118}], laneHeight: 34})
  const n = area => stage.danmakuLaneSets(free, {area, maxLanes: 99}).upper.length
  assert.ok(n(0.25) < n(0.5) && n(0.5) < n(0.75) && n(0.75) < n(1) && n(1) === free.length, [0.25, 0.5, 0.75, 1].map(n).join())
  const quarter = stage.danmakuLaneSets(free, {area: 0.25}).upper
  assert.ok(quarter.at(-1).y + quarter.at(-1).height <= free[0].y + (free.at(-1).y + free.at(-1).height - free[0].y) * 0.25 + 1, 'stays inside its share')
  assert.equal(stage.danmakuLaneSets(free.slice(0, 1), {area: 0.25}).upper.length, 1, 'always one lane')
})

test('直播风格 rows: one username colour, viewers told apart only by stable badges', () => {
  const b = author => stage.danmakuBadges({author}, '小焰')
  assert.deepEqual(b('焰圆是真的'), b('焰圆是真的'), 'the same viewer always wears the same badges')
  const many = Array.from({length: 400}, (_, i) => b('观众' + i))
  const share = f => many.filter(f).length / many.length
  assert.ok(share(x => x.medal) > 0.25 && share(x => x.medal) < 0.55, 'about four in ten wear the medal')
  assert.ok(share(x => x.guard) > 0 && share(x => x.guard) < 0.1 && share(x => x.admin) > 0 && share(x => x.admin) < 0.1)
  assert.ok(many.every(x => !x.medal || (x.medal.name === '小焰' && x.medal.level >= 1 && x.medal.level <= 21)))
  assert.deepEqual(stage.danmakuBadges({author: 'a', badges: {medal: {name: '主播名字很长', level: 99}, guard: '舰长', admin: false}}), {medal: {name: '主播名字', level: 40}, guard: true, admin: false}, 'DTO badges win, bounded')
  assert.equal(stage.danmakuBadges({author: 'x'}).medal?.name ?? '主播', '主播')
  assert.deepEqual([1, 4, 5, 12, 13, 17, 30].map(stage.danmakuMedalTier), [0, 0, 1, 2, 3, 4, 4])
})

test('the stage switch lists the manifest views, adds 关闭 only when declared, and D toggles off and back', async () => {
  const {forkDanmakuViewOptions, forkDanmakuShortcut, forkDanmakuStageFields} = await scriptExports('fork-danmaku-ui.js', ['forkDanmakuViewOptions', 'forkDanmakuShortcut', 'forkDanmakuStageFields'])
  const fields = keys => ({settingsSchema: {fields: keys.map(key => ({key}))}})
  assert.deepEqual(forkDanmakuStageFields(fields(['density', 'view', 'opacity', 'area'])).map(r => r.key), ['area', 'opacity', 'density'], 'stage CONFIG rows: only declared, fixed order, never view')
  assert.deepEqual(forkDanmakuStageFields({}), [])
  const manifest = choices => ({settingsSchema: {fields: [{key: 'view', choices: choices.map(value => ({value}))}]}})
  assert.deepEqual(forkDanmakuViewOptions(manifest(['overlay', 'sidebar'])).map(o => o.label), ['飘屏', '直播风格'])
  const withOff = forkDanmakuViewOptions(manifest(['overlay', 'sidebar', 'off']))
  assert.deepEqual(withOff.map(o => o.value), ['overlay', 'sidebar', 'off'])
  assert.deepEqual(forkDanmakuViewOptions({}), [])
  const key = (k, extra = {}) => ({key: k, target: {closest: () => null}, ...extra})
  assert.equal(forkDanmakuShortcut(key('d'), {current: 'sidebar', last: 'sidebar', options: withOff}), 'off')
  assert.equal(forkDanmakuShortcut(key('D'), {current: 'off', last: 'sidebar', options: withOff}), 'sidebar')
  assert.equal(forkDanmakuShortcut(key('d', {ctrlKey: true}), {current: 'overlay', last: 'overlay', options: withOff}), null)
  assert.equal(forkDanmakuShortcut(key('d', {target: {closest: () => ({})}}), {current: 'overlay', last: 'overlay', options: withOff}), null, 'never while typing')
  assert.equal(forkDanmakuShortcut(key('d'), {current: 'overlay', last: 'overlay', options: forkDanmakuViewOptions(manifest(['overlay', 'sidebar']))}), null, 'no 关闭 choice: no shortcut')
  assert.equal(forkDanmakuShortcut(key('d'), {current: 'off', last: 'off', options: withOff}), 'overlay', 'nothing shown before: 飘屏 (the default)')
})

test('基础设置 › 弹幕 shows the model actually used and the cadence; audience content limits mirror the contract', async () => {
  const x = await scriptExports('fork-danmaku-pages.js', ['forkDanmakuModelInfo', 'forkDanmakuCadenceText', 'forkAudienceProblem', 'FORK_AUDIENCE_LIMITS'])
  const catalog = [{provider: 'deepseek', models: [{id: 'deepseek-chat', name: 'DeepSeek V3.2'}]}]
  assert.deepEqual(x.forkDanmakuModelInfo({selection: null, foreground: {provider: 'deepseek', model: 'deepseek-chat'}, catalog}), {label: 'DeepSeek V3.2', follow: true, available: true})
  assert.deepEqual(x.forkDanmakuModelInfo({selection: {provider: 'deepseek', model: 'gone'}, foreground: null, catalog}), {label: 'gone', follow: false, available: false})
  assert.equal(x.forkDanmakuModelInfo({selection: null, foreground: null, catalog}).label, 'DSH 默认模型')
  assert.equal(x.forkDanmakuCadenceText(), '最多 20 次/分 · 间隔 ≥ 3 秒')
  assert.equal(x.forkAudienceProblem('persona', ' '), '请填写人设')
  assert.equal(x.forkAudienceProblem('persona', '路'.repeat(1200)), '')
  assert.match(x.forkAudienceProblem('persona', '路'.repeat(1201)), /1200/)
  assert.match(x.forkAudienceProblem('tone', ''), /语气与尺度/)
  assert.match(x.forkAudienceProblem('catchphrases', Array(13).fill('草')), /12/)
  assert.match(x.forkAudienceProblem('examples', ['好'.repeat(241)]), /240/)
  assert.equal(x.forkAudienceProblem('examples', ['来了来了']), '')
  assert.equal(x.forkAudienceProblem('nicknamePool', ['晓美焰の眼镜', '圆环边的布丁']), '')
  assert.equal(x.forkAudienceProblem('nicknamePool', ['布'.repeat(24)]), '')
  assert.match(x.forkAudienceProblem('nicknamePool', ['布'.repeat(25)]), /24/)
  assert.match(x.forkAudienceProblem('nicknamePool', Array(33).fill('企鹅')), /32/)
})

test('预设弹幕 / 接话 rules (contract §5) are stored only when complete, within limits, with stable unique ids', async () => {
  const x = await scriptExports('fork-danmaku-pages.js', ['forkAudienceRuleProblem', 'forkAudienceRuleReady', 'forkAudienceRuleId', 'forkAudiencePercent', 'forkAudienceSplitLines', 'forkAudienceLineText', 'forkAudienceMergeLines'])
  const sc = {text: '圆焰一生推', kind: 'highlight', amount: 50}
  assert.deepEqual([x.forkAudienceLineText('圆焰99'), x.forkAudienceLineText(sc)], ['圆焰99', '圆焰一生推'])
  assert.deepEqual(x.forkAudienceMergeLines(['圆焰99', sc], ['圆焰一生推', '新台词']), [sc, '新台词'], 'v4 SC candidates survive a text edit')
  assert.equal(x.forkAudiencePercent({probability: 0.35}, 'triggers'), 35)
  assert.equal(x.forkAudiencePercent({}, 'triggers'), 100, 'trigger default 1')
  assert.equal(x.forkAudiencePercent({}, 'chains'), 50)
  assert.deepEqual(x.forkAudienceSplitLines('你指尖跳跃的电光，是我此生不变的信仰\n 唯我超电磁炮永世长存 \n'), ['你指尖跳跃的电光，是我此生不变的信仰', '唯我超电磁炮永世长存'], 'a line keeps its commas')
  assert.equal(x.forkAudienceRuleReady('triggers', {keywords: ['御坂美琴'], lines: []}), false)
  assert.equal(x.forkAudienceRuleReady('triggers', {keywords: ['御坂美琴'], lines: ['你指尖跳跃的电光……']}), true)
  assert.equal(x.forkAudienceRuleReady('chains', {match: '吃什么', replies: ['是呀，吃什么'], probability: 0.5}), true)
  assert.equal(x.forkAudienceRuleReady('chains', {match: '吃', replies: ['是呀']}), false, 'match needs at least 2 characters')
  assert.match(x.forkAudienceRuleProblem('keywords', Array(13).fill('关键')), /12/)
  assert.match(x.forkAudienceRuleProblem('keywords', ['炮']), /至少 2/)
  assert.match(x.forkAudienceRuleProblem('replies', ['啊'.repeat(161)]), /160/)
  assert.match(x.forkAudienceRuleProblem('match', '吃'.repeat(161)), /160/)
  assert.equal(x.forkAudienceRuleProblem('lines', ['你指尖跳跃的电光，是我此生不变的信仰']), '')
  const id = x.forkAudienceRuleId('triggers', [], 1000)
  assert.match(id, /^[A-Za-z0-9._-]{1,64}$/)
  assert.notEqual(x.forkAudienceRuleId('triggers', [{id}], 1000), id, 'unique within the list')
  assert.match(x.forkAudienceRuleId('chains', [], 1000), /^c-/)
})
test('both renderers play one DanmakuView in the audience band: lanes, budget, passthrough, console, pause, replay, silence and dispose', async t => {
  const {chromium} = await import('playwright')
  const browser = await chromium.launch({headless: true, args: ['--mute-audio']}); t.after(() => browser.close())
  const page = await browser.newPage({viewport: {width: 1280, height: 720}})
  await page.setContent('<div class="fork-gal-stage" id="stage"><button id="advance">Advance</button><div class="fork-gal-topbar" id="top"></div><div class="fork-gal-choices" id="choices"></div><div class="fork-gal-box" id="box"></div></div>')
  await page.addStyleTag({content: await readFile(new URL('../tavern-plugin/lib/client-assets/fork-theme.css', import.meta.url), 'utf8')})
  await page.addStyleTag({content: 'body{margin:0}#stage{position:relative;width:100vw;height:100vh;cursor:default}#advance{position:absolute;inset:0;width:100%;height:100%;opacity:0}#top{position:absolute;top:0;left:0;right:0;height:50px}#choices{position:absolute;left:30%;width:40%;top:35%;height:22%}#box{position:absolute;left:3%;right:3%;bottom:16px;height:118px}'})
  for (const name of ['fork-mod-stage-surface.cjs', 'fork-danmaku-stage.cjs']) await page.addScriptTag({content: await source(name)})
  await page.evaluate(() => {
    const st = document.getElementById('stage'), views = {}
    window.clicks = 0; document.getElementById('advance').onclick = () => clicks++
    window.wheels = 0; st.addEventListener('wheel', () => wheels++)
    const renderers = Object.fromEntries(Object.entries(FORK_DANMAKU_RENDERERS).map(([k, make]) => [k, args => (views[k] = make(args))]))
    window.host = createModUiLayerHost({root: st, renderers})
    window.layers = [
      {modId: 'dsh.danmaku', id: 'overlay', entry: 'view/overlay.js', band: 'audience', order: 0, input: 'passthrough', playback: 'recorded', budget: {maxNodes: 200, maxVisible: 32}},
      {modId: 'dsh.danmaku', id: 'sidebar', entry: 'view/sidebar.js', band: 'audience', order: 1, input: 'regions', playback: 'recorded', budget: {maxNodes: 200, maxVisible: 32}}]
    const group = id => ({packId: 'p', kind: 'audience', assetId: id})
    const comment = (i, extra = {}) => ({id: 'c' + i, group: group(i % 2 ? 'cp' : 'road'), author: '观众' + i, text: '弹幕测试第' + i + '条 来了来了', kind: 'comment', mode: 'scroll', color: null, size: 'standard', offsetMs: i * 120, durationMs: 6500, ...extra})
    window.makeView = (over = {}) => {
      const comments = Array.from({length: 60}, (_, i) => comment(i, i === 3 ? {kind: 'highlight', durationMs: 9000, amount: 2000} : i === 4 ? {mode: 'top', color: '#fe0302', size: 'large'} : i === 5 ? {mode: 'bottom', color: '#222222'} : i >= 50 && i <= 53 ? {replyTo: 'c' + (i - 1), depth: i - 49, source: 'chain'} : {}))
      const batches = []; for (let i = 0; i < comments.length; i += 6) batches.push({id: 'b' + i, offsetMs: comments[i].offsetMs, comments: comments.slice(i, i + 6), heat: 80, online: 3214, heatExpiresAtMs: comments[i].offsetMs + 30000})
      const vp = modStageViewport(st)
      return {version: 1, modId: 'dsh.danmaku', mode: 'live', active: true, silent: false, view: 'overlay', anchor: {sourceKey: 's', part: 'body', paragraph: 1, charOffset: 0}, activeTimeMs: 2000,
        batches, highlights: [], heat: 80, online: 3214, viewport: {width: vp.width, height: vp.height}, safeRegions: vp.safeRegions, sidebar: {title: '模拟观众', items: [], limit: 40},
        settings: {view: 'overlay', density: 'standard', reducedMotion: false, model: {available: true}}, status: 'ready', error: null, ...over}
    }
    window.push = view => { host.sync(layers, {}); for (const v of Object.values(views)) v.update(view) }
    window.views = views
  })
  const probe = () => page.evaluate(() => {
    const layer = [...document.querySelectorAll('.fork-mod-ui-layer')]
    const items = [...document.querySelectorAll('.fork-dm-item')].map(n => { const r = n.getBoundingClientRect(); return {top: r.top, bottom: r.bottom, mode: n.dataset.mode, dark: n.dataset.dark} })
    const box = document.getElementById('box').getBoundingClientRect(), top = document.getElementById('top').getBoundingClientRect(), choices = document.getElementById('choices').getBoundingClientRect()
    return {bands: layer.map(n => n.dataset.band), z: layer.map(n => getComputedStyle(n).zIndex), nodes: layer.map(n => n.querySelectorAll('*').length), items, box: {top: box.top}, topBottom: top.bottom, choices: {top: choices.top, bottom: choices.bottom},
      overlayHidden: document.querySelector('.fork-dm[data-layer="overlay"]').hidden, sidebarHidden: document.querySelector('.fork-dm[data-layer="sidebar"]').hidden,
      rows: document.querySelectorAll('.fork-dm-row').length, cards: document.querySelectorAll('.fork-dm-sc').length, live: document.querySelector('.fork-dm:not([hidden]) .fork-dm-live, .fork-mod-dock .fork-dm-live')?.textContent,
      online: document.querySelector('.fork-dm:not([hidden]) .fork-dm-online, .fork-mod-dock .fork-dm-online')?.textContent, scrollW: document.documentElement.scrollWidth,
      running: document.getAnimations().filter(a => a.playState === 'running' && a.effect?.target?.classList?.contains('fork-dm-item')).length}
  })
  for (const width of [1280, 375]) {
    await page.setViewportSize({width, height: 720})
    await page.evaluate(() => { push(makeView({silent: true})); push(makeView()) })
    await page.waitForTimeout(300)
    const s = await probe()
    assert.deepEqual(s.bands, ['audience', 'audience']); assert.deepEqual(s.z, ['5', '5'])
    assert.equal(s.overlayHidden, false); assert.equal(s.sidebarHidden, true, 'only the chosen perspective draws')
    assert.ok(s.items.length > 4 && s.items.length + s.cards <= 32, 'bounded visible comments: ' + s.items.length + ' ' + JSON.stringify(await page.evaluate(() => Object.values(views).map(v => v.stats()))))
    assert.ok(s.nodes.every(n => n <= 200))
    for (const it of s.items) {
      assert.ok(it.top >= s.topBottom - 1, 'below the top bar'); assert.ok(it.bottom <= s.box.top + 1, 'above the dialogue box')
      assert.ok(it.bottom <= s.choices.top + 1 || it.top >= s.choices.bottom - 1, 'clear of the choices')
    }
    assert.ok(s.items.some(it => it.mode === 'top') && s.items.some(it => it.mode === 'bottom' && it.dark === 'true'), width + ' ' + JSON.stringify(s.items.map(it => it.mode + it.dark)) + JSON.stringify(await page.evaluate(() => Object.values(views).map(v => v.stats()))))
    assert.equal(s.cards, 1, 'the current 醒目留言 card')
    assert.deepEqual(await page.evaluate(() => { const c = document.querySelector('.fork-dm-cards .fork-dm-sc'); return [c.dataset.tier, c.dataset.fx, c.querySelector('.fork-dm-sc-price').textContent, getComputedStyle(c).backgroundColor, c.querySelector('.fork-dm-sc-gem')?.dataset.n] }), ['5', '4', '¥2,000', 'rgb(171, 26, 50)', '2'], '¥2000 card in its tier colour')
    assert.match(s.online, /^3,2\d\d 模拟观众$/, 'online interpolated with the heat (contract formula)'); assert.equal(s.live, '直播中')
    assert.equal(s.scrollW, width, 'no horizontal scroll')
    await page.mouse.click(width / 2, 120); assert.ok(await page.evaluate(() => clicks) >= 1, 'the overlay passes clicks through to the stage')
  }
  // Pause: animations stop and no timer stays armed; resume continues.
  await page.evaluate(() => push(makeView({active: false, status: 'paused'})))
  assert.equal((await probe()).running, 0)
  assert.ok(Object.values(await page.evaluate(() => Object.values(views).map(v => v.stats().timer))).every(t => !t))
  await page.evaluate(() => push(makeView({activeTimeMs: 2100})))
  assert.ok((await probe()).running > 0)
  // The host re-applies the view it holds on every sync (resize, stage facts): the same snapshot must not rewind time.
  const rewind = await page.evaluate(async () => {
    const v = makeView({activeTimeMs: 2200}); push(v); await new Promise(r => setTimeout(r, 250))
    const at = () => Math.max(...document.getAnimations().filter(x => x.effect?.target?.classList?.contains('fork-dm-item')).map(x => x.currentTime))
    const before = at(); for (const r of Object.values(views)) r.update(v); return [before, at()]
  })
  assert.ok(rewind[1] >= rewind[0] - 1, 'same snapshot re-applied: ' + rewind)
  // 直播风格: the console, newest at the bottom, scrolls without turning the page.
  await page.setViewportSize({width: 1280, height: 720})
  await page.evaluate(() => push(makeView({view: 'sidebar', settings: {view: 'sidebar', density: 'standard', reducedMotion: false, model: {available: false}}, activeTimeMs: 7300})))
  let s = await probe()
  assert.equal(s.overlayHidden, true); assert.equal(s.sidebarHidden, false); assert.equal(s.items.length, 0, 'switching does not leave flying comments ' + await page.evaluate(() => JSON.stringify(Object.values(views).map(v => v.stats())) + document.querySelectorAll('.fork-dm').length))
  assert.equal(s.rows, 31, 'the console keeps the newest 32 including the pinned 醒目留言'); assert.equal(s.cards, 0, 'the 醒目留言 row has scrolled out of the list; its pill stays pinned')
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.fork-dm-pinned .fork-dm-sc-pill')].map(p => [p.dataset.tier, p.textContent, p.getAttribute('aria-expanded')])), [['5', '观¥2,000', 'false']], 'one pinned pill')
  // A 4-step relay reads flat, each reply naming whom it answers.
  const relay = await page.evaluate(() => [50, 51, 52, 53].map(i => { const li = document.querySelector('.fork-dm-row[data-id="c' + i + '"]'); return [li.querySelector('.fork-dm-reply')?.textContent, Math.round(li.getBoundingClientRect().left)] }))
  assert.deepEqual(relay.map(r => r[0]), ['回复 @观众49 ', '回复 @观众50 ', '回复 @观众51 ', '回复 @观众52 '])
  assert.equal(new Set(relay.map(r => r[1])).size, 1, 'no indentation')
  // The pill opens the full card under the strip; Esc closes it.
  const clicked = await page.evaluate(() => clicks)
  await page.locator('.fork-dm-sc-pill').click()
  assert.equal(await page.locator('.fork-dm-pin-detail .fork-dm-sc').count(), 1)
  assert.equal(await page.evaluate(() => clicks), clicked, 'opening a pill does not turn the page')
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('.fork-dm-pin-detail').isVisible(), false)
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.fork-dm-row .fork-dm-user')).color === getComputedStyle(document.querySelectorAll('.fork-dm-row .fork-dm-user')[5]).color), true, 'one username colour')
  assert.ok(await page.locator('.fork-dm-row .fork-dm-medal').count() > 0, 'fan medals')
  assert.equal(await page.evaluate(() => document.querySelector('.fork-dm-row:last-child .fork-dm-text').textContent), '弹幕测试第59条 来了来了')
  assert.equal(await page.evaluate(() => document.querySelector('.fork-dm-warn').hidden), false, 'model unavailable: ⚠ in the console head')
  const before = await page.evaluate(() => [clicks, wheels])
  const list = page.locator('.fork-dm-list'); await list.hover(); await page.mouse.wheel(0, -200); await list.click({position: {x: 40, y: 40}})
  assert.deepEqual(await page.evaluate(() => [clicks, wheels]), before, 'chat scroll and click stay in the console')
  await page.waitForTimeout(100)
  assert.equal(await page.locator('.fork-dm-latest').isVisible(), true, 'scrolled up: 回到最新')
  await page.locator('.fork-dm-latest').click(); assert.equal(await page.locator('.fork-dm-latest').isVisible(), false)
  // Reduced motion shows the static console even when 飘屏 is chosen; history replays the records as 回放.
  await page.evaluate(() => push(makeView({mode: 'history', status: 'history', settings: {view: 'overlay', density: 'standard', reducedMotion: true}, anchor: {sourceKey: 's', part: 'body', paragraph: 2, charOffset: 0}})))
  s = await probe(); assert.equal(s.sidebarHidden, false); assert.equal(s.live, '回放'); assert.equal(s.rows, 17)
  assert.equal(await page.evaluate(() => document.querySelectorAll('.fork-dm-sc, .fork-dm-sc-pill').length), 2)
  assert.equal(await page.evaluate(() => document.getAnimations().filter(a => a.effect?.target?.closest?.('.fork-dm-sc, .fork-dm-sc-pill')).length), 0, 'reduced motion: no 醒目留言 effects')
  // 375: the console fits without horizontal scroll.
  await page.setViewportSize({width: 375, height: 720}); await page.evaluate(() => push(makeView({view: 'sidebar', settings: {view: 'sidebar'}})))
  assert.equal((await probe()).scrollW, 375)
  // Node budget (the host drops a layer over maxNodes): a console of 醒目留言 rows gives up its oldest rows instead.
  await page.evaluate(() => { const v = makeView({view: 'sidebar', settings: {view: 'sidebar'}, activeTimeMs: 7300, anchor: {sourceKey: 's', part: 'body', paragraph: 3, charOffset: 0}}); for (const b of v.batches) b.comments = b.comments.map(c => ({...c, kind: 'highlight', amount: 500})); push(v) })
  s = await probe(); assert.equal(s.sidebarHidden, false); assert.ok(s.nodes.every(n => n <= 200), 'within maxNodes: ' + s.nodes); assert.ok(s.rows >= 12, 'still a full console: ' + s.rows)
  // No recalled audience: silent clears both layers.
  await page.evaluate(() => push(makeView({silent: true, status: 'silent', batches: [], heat: 0, online: 0})))
  s = await probe(); assert.equal(s.overlayHidden && s.sidebarHidden, true); assert.equal(s.rows + s.items.length + s.cards, 0)
  await page.evaluate(() => host.dispose()); assert.equal(await page.locator('.fork-dm').count(), 0)
})

test('直播风格 docks in the host column with the 直播信息栏 below, floats without a dock, and releases it on switch / dispose', async t => {
  const {chromium} = await import('playwright')
  const browser = await chromium.launch({headless: true, args: ['--mute-audio']}); t.after(() => browser.close())
  const page = await browser.newPage({viewport: {width: 1280, height: 720}})
  await page.setContent('<div id="shell" style="position:relative;width:1280px;height:720px"><div class="fork-gal-stage" id="stage" style="position:absolute;left:0;top:0;width:960px;height:540px"><div class="fork-gal-box" id="box" style="position:absolute;left:3%;right:3%;bottom:16px;height:110px"></div></div><aside id="col" style="position:absolute;right:0;top:0;bottom:0;width:320px"></aside><section id="below" style="position:absolute;left:0;top:540px;width:960px;bottom:0"></section></div>')
  await page.addStyleTag({content: await readFile(new URL('../tavern-plugin/lib/client-assets/fork-theme.css', import.meta.url), 'utf8')})
  for (const name of ['fork-mod-stage-surface.cjs', 'fork-danmaku-stage.cjs']) await page.addScriptTag({content: await source(name)})
  const run = await page.evaluate(() => {
    const st = document.getElementById('stage'), views = {}, calls = []
    window.offer = true
    const dock = request => { calls.push(request ? 'request' : 'release'); return request && offer ? {column: document.getElementById('col'), below: document.getElementById('below')} : null }
    const renderers = Object.fromEntries(Object.entries(FORK_DANMAKU_RENDERERS).map(([k, make]) => [k, args => (views[k] = make({...args, dock}))]))
    const host = createModUiLayerHost({root: st, renderers})
    const layers = [{modId: 'dsh.danmaku', id: 'overlay', entry: 'view/overlay.js', band: 'audience', order: 0, input: 'passthrough', playback: 'recorded', budget: {maxNodes: 200, maxVisible: 32}},
      {modId: 'dsh.danmaku', id: 'sidebar', entry: 'view/sidebar.js', band: 'audience', order: 1, input: 'regions', playback: 'recorded', budget: {maxNodes: 200, maxVisible: 32}}]
    const context = {stage: {title: '魔法少女小圆', turn: 12, latestTurn: 12, scene: '屋顶', bgm: 'Sis puella magica!'}}
    const c = (i, extra = {}) => ({id: 'c' + i, group: {packId: 'p', kind: 'audience', assetId: 'g'}, author: '观众' + i, text: '弹幕' + i, kind: 'comment', mode: 'scroll', color: null, size: 'standard', offsetMs: i * 200, durationMs: 6500, ...extra})
    const comments = Array.from({length: 12}, (_, i) => c(i, i === 2 ? {kind: 'highlight', durationMs: 9000} : {}))
    window.view = (over = {}) => ({version: 1, modId: 'dsh.danmaku', mode: 'live', active: true, silent: false, view: 'sidebar', anchor: {sourceKey: 's', part: 'body', paragraph: 1, charOffset: 0}, activeTimeMs: 3000,
      batches: [{id: 'b', offsetMs: 0, comments, heat: 80, online: 3214, heatExpiresAtMs: 30000}], highlights: [], heat: 80, online: 3214, viewport: {width: 960, height: 540}, safeRegions: [], sidebar: {title: '模拟观众', items: [], limit: 32},
      settings: {view: 'sidebar', density: 'standard', reducedMotion: false}, status: 'ready', error: null, ...over})
    window.push = v => { host.sync(layers, context); for (const r of Object.values(views)) r.update(v) }
    window.probe = () => ({inCol: !!document.querySelector('#col .fork-dm-console[data-dock="right"]'), band: document.querySelector('#below .fork-dm-band')?.innerText || '', floating: !!document.querySelector('#stage .fork-dm-console:not([data-dock])'), calls: [...calls]})
    window.host = host
    push(view())
    return probe()
  })
  assert.equal(run.inCol, true, 'docked in the host column')
  for (const want of ['直播中', '魔法少女小圆', '第 12 / 12 轮 · 屋顶', '3,', '模拟观众', '醒目留言', '♪ Sis puella magica!']) assert.ok(run.band.includes(want), want + ' in ' + JSON.stringify(run.band))
  assert.equal(await page.locator('#col .fork-dm-pinned .fork-dm-sc-pill').count(), 1, 'the pinned strip stays on the chat; the band keeps the tally')
  assert.equal(await page.evaluate(() => document.querySelector('#col .fork-dm-console').closest('.fork-mod-ui-layer')), null)
  // No dock (narrow host): the same console floats over the stage.
  let s = await page.evaluate(() => { offer = false; push(view({activeTimeMs: 3100})); return probe() })
  assert.equal(s.inCol, false); assert.equal(s.floating, true); assert.equal(s.band, '')
  // Switching to 飘屏 releases the column; dispose too.
  s = await page.evaluate(() => { offer = true; push(view({activeTimeMs: 3200})); push(view({view: 'overlay', activeTimeMs: 3300})); return probe() })
  assert.equal(s.inCol, false); assert.equal(s.calls.at(-1), 'release')
  s = await page.evaluate(() => { push(view({activeTimeMs: 3400})); host.dispose(); return probe() })
  assert.equal(s.inCol, false); assert.equal(s.band, ''); assert.equal(s.calls.at(-1), 'release')
})
