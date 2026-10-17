// private fork: sprite/avatar variant labels use the owner term chafen.
// private fork (voice v4 P1): the figure voice page in real Chromium with the production client and stylesheet, against
// the in-page fake backend of tests/helpers/voice-p1-fake.mjs (docs/fork/voice-contract.md 「P1 RPC」). Scenario matrix
// A–H of the approved design (output/voice-gui-design/audit-and-proposal.md §5), the billing gate, ⚠ fallbacks, templates,
// keyboard, spinner delay / reduced motion, phone layout, and the UI rules (no native pickers, no internal ids).
// Never live data, never a real TTS call: synthesis only exists as a logged fake job.
import test from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { openVoicePage, guardVoiceUi } from './helpers/voice-p1-fake.mjs'

const FISH_SERVICE = { id: 'fish-main', kind: 'fish-audio', revision: 'f1', capabilities: { paid: false } }
const QWEN_SERVICE = { id: 'qwen-main', kind: 'qwen', revision: 'q1', capabilities: { paid: true } }
const LOCAL_OTHER_MODEL = { id: 'local-gsv', kind: 'reference-api', revision: 'l1', capabilities: { paid: false, localEngine: 'gpt-sovits', referenceLimits: { count: 1, bytes: 8 * 1024 * 1024 },
  modelRequirements: [{ engine: 'gpt-sovits', modelVersion: 'v2ProPlus', gpt: { sha256: '3'.repeat(64) }, sovits: { sha256: '4'.repeat(64) } }] } }
const WRITES = ['patchFigure', 'savePackVoice', 'saveFigureVoiceBinding', 'createAndAssignPackVoice', 'savePackVoiceVariant', 'deletePackVoiceVariant', 'assignVoiceTemplate', 'assignFigureVoice', 'putBlob', 'saveVoiceTemplate', 'deleteVoiceTemplate']

// A silent PCM16 WAV, the same shape the fake library uses.
function wav(seconds) {
  const rate = 8000, n = Math.round(rate * seconds), b = Buffer.alloc(44 + n * 2)
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22)
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40); return b
}

let browser
test.before(async () => { browser = await chromium.launch({ headless: true }) })
test.after(async () => { await browser?.close() })

async function open(t, world = {}, options = {}) {
  const narrow = options.narrow, viewport = narrow ? { width: 375, height: 812 } : { width: 1600, height: 900 }
  const { page, errors } = await openVoicePage(browser, { viewport, world, theme: options.theme || 'light', reducedMotion: options.reducedMotion || 'no-preference' })
  t.after(() => page.close())
  const ui = []
  const f = {
    page, errors, ui,
    calls: method => page.evaluate(m => window.voiceCalls.filter(c => c[0] === m).map(c => c[1]), method),
    writes: () => page.evaluate(list => window.voiceCalls.filter(c => list.includes(c[0])).map(c => c[0]), WRITES),
    voice: key => page.evaluate(k => window.voicePack().figures[window.voiceIds[k]].voice ?? null, key),
    library: () => page.evaluate(() => JSON.parse(JSON.stringify(window.voicePack().manifest.voiceLibrary.voices))),
    waitCall: (method, count = 1) => page.waitForFunction(([m, n]) => window.voiceCalls.filter(c => c[0] === m).length >= n, [method, count]),
    async figure(key, name) {
      await page.evaluate(k => window.openFigure(k), key); await page.getByRole('dialog').first().waitFor(); await page.waitForTimeout(200)
      if (narrow && !(await page.locator('.ap-figure-pane').isVisible())) await page.getByRole('option', { name: new RegExp(name) }).first().click()
      await page.locator('.ap-voice-pill').waitFor()
    },
    async voicePage(key, name) { await f.figure(key, name); await page.locator('.ap-voice-pill').click(); await page.getByRole('region', { name: name + '的声音' }).waitFor() },
    way: title => page.locator('.ap-voice-way-head', { hasText: title }).first(),
    async openWay(title) { const head = f.way(title); if (await head.getAttribute('aria-expanded') !== 'true') await head.click(); await page.waitForTimeout(80) },
    hero: () => page.locator('.ap-voice-hero'),
    async idle() { await page.waitForFunction(() => !document.querySelector('.ap-voice-saving')); await page.waitForTimeout(60) },
    guard: tag => guardVoiceUi(page, tag, ui),
    async done() { assert.deepEqual(ui, [], 'UI rules'); assert.deepEqual(errors, [], 'page errors') },
  }
  return f
}

test('A: a new figure opens on Fish 声音 (recommended picks); ▶ previews the candidate without writing; a click gives it its own pack voice', async t => {
  const f = await open(t), { page } = f
  await f.figure('mei', '芽衣')
  assert.equal(await page.locator('.ap-voice-pill').getAttribute('aria-label'), '声音：选择声音')
  assert.equal(await page.getByRole('button', { name: '试听人物声音' }).count(), 0, 'no ▶ beside an empty voice')
  await page.locator('.ap-voice-pill').click(); await page.getByRole('region', { name: '芽衣的声音' }).waitFor()
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), '声音', 'focus moves to the page heading')
  assert.equal(await f.way('Fish 声音').getAttribute('aria-expanded'), 'true')
  assert.match(await f.hero().innerText(), /还没有声音/)
  await page.locator('.ap-voice-tile').nth(3).waitFor()
  assert.deepEqual((await page.locator('.ap-voice-tile-name').allInnerTexts()), ['晴空少女', '月下学姐', '少年侦探', '旁白大叔'])
  assert.match(await page.locator('.ap-voice-tile').nth(0).innerText(), /女声 · 日语 \/ 中文\s+明亮 · 元气/)
  assert.match(await page.locator('.ap-voice-tile').nth(3).innerText(), /⚠?\s*试合成失败/, 'a failed verification is a real ⚠')
  assert.equal(await page.locator('.ap-voice-tile .ap-voice-warn').count(), 1, '⚠ only where something is wrong')
  assert.deepEqual(await f.calls('synthesis'), [], 'opening never synthesizes'); await f.guard('A empty')
  // private fork (voice page r2): 推荐声音 and the Fish ID box are one 「Fish 声音」 section; its (?) holds the licence note.
  await page.getByRole('button', { name: 'Fish 声音 说明' }).hover()
  await page.locator('.fork-help-tip-body').filter({ hasText: '推荐的是 Fish 上公开的声音，用前请确认作者允许的用途。' }).waitFor()
  assert.equal(await page.getByLabel('Fish 声音编号或名字').count(), 1, 'the paste-an-ID box sits in the same section')
  await page.locator('.ap-voice-tile').first().hover()

  await page.getByRole('button', { name: '试听「晴空少女」' }).click()
  await page.waitForFunction(() => window.audioPlays.length === 1)
  const [asked] = await f.calls('previewFigureVoice')
  assert.deepEqual(asked.voiceSpec, { name: '晴空少女', language: 'ja', defaultSource: 'fish', sources: { fish: { kind: 'voice-id', provider: 'fish-audio', voiceId: 'b1c2d3e4f5a60718293a4b5c6d7e8f90' } } })
  assert.equal(asked.confirmToken, undefined); assert.equal(await page.getByRole('dialog', { name: '付费试听' }).count(), 0, 'Fish free model: no billing confirm')
  assert.equal((await f.calls('synthesis')).length, 1); assert.deepEqual(await f.writes(), [], 'a candidate preview never writes the pack')
  await page.waitForFunction(() => window.voiceCalls.some(c => c[0] === 'closeFigureVoicePreview'))

  await page.getByRole('button', { name: '使用 月下学姐' }).click(); await page.getByText('已换成「月下学姐」').waitFor()
  const [made] = await f.calls('createAndAssignPackVoice')
  assert.deepEqual(made.voiceSpec, { name: '月下学姐', language: 'ja', defaultSource: 'fish', sources: { fish: { kind: 'voice-id', provider: 'fish-audio', voiceId: 'c2d3e4f5a6b70718293a4b5c6d7e8f91' } } })
  const bound = await f.voice('mei'); assert.deepEqual(Object.keys(bound), ['voice']); assert.match(bound.voice, /^v-/)
  assert.equal((await f.calls('synthesis')).length, 1, 'choosing never synthesizes')
  await page.locator('.ap-voice-tile[data-current]').waitFor(); assert.match(await page.locator('.ap-voice-tile[data-current]').innerText(), /月下学姐[\s\S]*使用中/)
  assert.match(await page.locator('.ap-voice-way-heading', { hasText: 'Fish 声音' }).innerText(), /使用中/); await f.guard('A chosen')
  await page.keyboard.press('Escape'); await page.locator('.ap-voice-pill').waitFor()
  assert.equal(await page.locator('.ap-voice-pill').getAttribute('aria-label'), '声音：月下学姐')
  await page.waitForFunction(() => document.activeElement?.classList.contains('ap-voice-pill'), null, { timeout: 2000 }) // Escape returns focus to the 声音 property
  await f.done()
})

test('A ⚠: without a Fish key the choice is kept, the figure is silent and says so (pill, page, preview)', async t => {
  const f = await open(t, { missingKeys: ['fish-audio'] }), { page } = f
  await f.voicePage('mei', '芽衣'); await page.locator('.ap-voice-tile').first().waitFor()
  await page.getByRole('button', { name: '试听「晴空少女」' }).click()
  await page.getByRole('alert').filter({ hasText: '试听失败：语音服务缺少密钥' }).waitFor()
  assert.equal(await page.getByRole('button', { name: /试听「晴空少女」/ }).getAttribute('data-state'), 'error')
  assert.deepEqual(await f.calls('synthesis'), [])
  await page.getByRole('button', { name: '使用 晴空少女' }).click(); await page.getByText('已换成「晴空少女」').waitFor()
  await f.hero().locator('.ap-voice-warn').waitFor()
  assert.equal(await f.hero().locator('.ap-voice-warn').innerText(), '缺少 Fish Audio 密钥，暂不配音')
  assert.equal(await page.locator('.ap-voice-go').isDisabled(), true, 'the saved voice cannot be previewed')
  assert.match((await f.voice('mei')).voice, /^v-/, 'the choice is saved, not swapped for something else'); await f.guard('A missing key')
  await page.getByRole('button', { name: '返回人物' }).click()
  const pill = page.locator('.ap-voice-pill'); await pill.locator('.ap-hint-mark').waitFor()
  assert.equal(await pill.getAttribute('aria-label'), '声音：晴空少女，缺少 Fish Audio 密钥，暂不配音')
  assert.equal(await page.getByRole('button', { name: '试听人物声音' }).count(), 0) // private fork (figure-editor r6): no ▷ beside 声音
  await f.done()
})

test('B: a second figure shares a pack voice and picks another tuning; shared edits ask (everyone / only this figure)', async t => {
  const f = await open(t), { page } = f, before = await f.library()
  await f.voicePage('mei', '芽衣'); await f.openWay('声音预设')
  // private fork (voice page r2): 声音预设 lists every voice × preset flat; a pick is one binding write.
  await page.getByRole('radio', { name: '温柔少女 · 原声' }).click(); await f.waitCall('saveFigureVoiceBinding'); await f.idle()
  assert.deepEqual(await f.voice('mei'), { voice: 'actor' }); assert.deepEqual(await f.library(), before, 'sharing never copies the voice')
  await f.hero().getByText('朝雾葵 也在用').waitFor()
  await page.getByRole('radio', { name: '温柔少女 · 轻快' }).click(); await f.waitCall('saveFigureVoiceBinding', 2); await f.idle()
  assert.deepEqual(await f.voice('mei'), { voice: 'actor', variant: 'quick' }); assert.deepEqual(await f.voice('aoi'), { voice: 'actor' })
  assert.equal(await page.getByRole('dialog').count(), 1, 'choosing a tuning is the figure\'s own: no shared-voice dialog')
  await f.guard('B tuning')
  await page.getByRole('button', { name: '预设操作 温柔少女 · 轻快' }).click(); await page.getByRole('menuitem', { name: '调整参数' }).click()

  const speed = page.getByRole('slider', { name: '轻快语速' })
  assert.equal(await speed.getAttribute('aria-valuetext'), '1.15×')
  await speed.focus(); await page.keyboard.press('ArrowRight')
  const ask = page.getByRole('dialog', { name: '这个声音还有别的人物在用' }); await ask.waitFor()
  assert.match(await ask.innerText(), /「朝雾葵」也在用这个声音/)
  await ask.getByRole('button', { name: '取消' }).click(); await ask.waitFor({ state: 'detached' })
  assert.deepEqual(await f.calls('savePackVoiceVariant'), [], 'cancel writes nothing')
  await speed.focus(); await page.keyboard.press('ArrowRight'); await ask.waitFor(); await ask.getByRole('button', { name: '一起修改' }).click()
  await f.waitCall('savePackVoiceVariant'); await f.idle()
  assert.deepEqual((await f.calls('savePackVoiceVariant'))[0], { figureId: 'f1f1f1f1-0000-4000-8000-000000000003', voiceId: 'actor', variantId: 'quick', variant: { name: '轻快', tuning: { fish: { speed: 1.2 } } }, confirmShared: true })
  await speed.focus(); await page.keyboard.press('ArrowRight'); await f.waitCall('savePackVoiceVariant', 2); await f.idle()
  assert.equal(await ask.count(), 0, '一起修改 is remembered for this voice while the page is open')
  assert.equal((await f.calls('savePackVoiceVariant'))[1].variant.tuning.fish.speed, 1.25)
  assert.deepEqual(await f.voice('aoi'), { voice: 'actor' })

  // Renaming for this figure only copies the voice (old one stays with 朝雾葵).
  await page.getByRole('button', { name: '声音操作' }).click(); await page.getByRole('menuitem', { name: '重命名' }).click()
  await page.getByLabel('声音名称').fill('芽衣的声线'); await page.getByLabel('声音名称').press('Enter')
  await f.waitCall('savePackVoice'); await f.idle()
  assert.equal((await f.calls('savePackVoice'))[0].voiceSpec.name, '芽衣的声线', 'the 一起修改 choice still applies: the shared voice is renamed')
  await f.done()
})

test('B copy: 只改「芽衣」 copies the shared voice for this figure and keeps its tuning choice', async t => {
  const f = await open(t), { page } = f
  await f.voicePage('mei', '芽衣'); await f.openWay('声音预设')
  await page.getByRole('radio', { name: '温柔少女 · 原声' }).click(); await f.waitCall('saveFigureVoiceBinding'); await f.idle()
  await page.getByRole('button', { name: '声音操作' }).click(); await page.getByRole('menuitem', { name: '重命名' }).click()
  await page.getByLabel('声音名称').fill('芽衣的声线'); await page.getByLabel('声音名称').press('Enter')
  const ask = page.getByRole('dialog', { name: '这个声音还有别的人物在用' }); await ask.waitFor(); await ask.getByRole('button', { name: '只改「芽衣」' }).click()
  await f.waitCall('saveFigureVoiceBinding', 2); await f.idle()
  const [copy] = await f.calls('createAndAssignPackVoice'), lib = await f.library(), mine = (await f.voice('mei')).voice
  assert.equal(copy.voiceSpec.name, '芽衣的声线'); assert.deepEqual(copy.voiceSpec.sources, lib.actor.sources); assert.deepEqual(copy.voiceSpec.variants, lib.actor.variants)
  assert.notEqual(mine, 'actor'); assert.equal(lib.actor.name, '温柔少女'); assert.deepEqual(await f.voice('aoi'), { voice: 'actor' })
  assert.deepEqual(await f.calls('savePackVoice'), [], 'the shared voice is untouched')
  assert.equal(await f.hero().locator('.ap-voice-name').innerText(), '芽衣的声线')
  await f.done()
})

test('C: per-emotion tuning maps emotions to named tunings; Azure tunes pitch, Fish says it cannot', async t => {
  const f = await open(t), { page } = f
  await f.voicePage('sora', '空'); await f.openWay('声音预设')
  await page.getByRole('list', { name: '按差分调音' }).waitFor()
  assert.equal(await page.getByRole('button', { name: '喜悦调音：开心' }).count(), 1)
  await page.getByRole('button', { name: '悲伤调音：跟随默认' }).click(); await page.getByRole('menuitemradio', { name: '低缓' }).click()
  await f.waitCall('saveFigureVoiceBinding'); await f.idle()
  assert.deepEqual(await f.voice('sora'), { voice: 'cast', emotionVariants: { joy: 'joyful', sad: 'soft' } })
  await page.getByRole('button', { name: '预设操作 店员（Azure） · 原声' }).click(); await page.getByRole('menuitem', { name: '调整参数' }).click()
  assert.deepEqual(await page.getByRole('slider').evaluateAll(n => n.map(x => x.getAttribute('aria-label'))), ['原声语速', '原声音高'])
  await page.getByRole('radio', { name: '店员（Azure） · 开心' }).click(); await f.waitCall('saveFigureVoiceBinding', 2); await f.idle()
  await page.getByRole('button', { name: '预设操作 店员（Azure） · 开心' }).click(); await page.getByRole('menuitem', { name: '调整参数' }).click()
  const pitch = page.getByRole('slider', { name: '开心音高' }); assert.equal(await pitch.getAttribute('aria-valuetext'), '+5%')
  await pitch.focus(); await page.keyboard.press('ArrowRight'); await f.waitCall('savePackVoiceVariant'); await f.idle()
  assert.deepEqual((await f.calls('savePackVoiceVariant'))[0].variant, { name: '开心', tuning: { azure: { rate: 15, pitch: 10 } } })
  await page.getByRole('button', { name: '风格：默认' }).click(); await page.getByRole('menuitemradio', { name: 'cheerful' }).click(); await f.waitCall('savePackVoiceVariant', 2); await f.idle()
  assert.equal((await f.calls('savePackVoiceVariant'))[1].variant.tuning.azure.style, 'cheerful')
  await f.guard('C azure')
  const fish = await open(t); await fish.voicePage('aoi', '朝雾葵'); await fish.openWay('声音预设')
  await fish.page.getByRole('button', { name: '预设操作 温柔少女 · 原声' }).click(); await fish.page.getByRole('menuitem', { name: '调整参数' }).click()
  assert.equal(await fish.page.getByRole('slider').count(), 1, 'Fish has only 语速')
  assert.match(await fish.page.locator('.ap-voice-tune-props').innerText(), /音高\s*这种发声方式不支持/)
  // Adding a preset: the dashed ＋ tile (no text) saves the current settings as 预设 N and selects it.
  await fish.page.getByRole('button', { name: '把当前设置存为新预设' }).click(); await fish.waitCall('saveFigureVoiceBinding'); await fish.idle()
  const added = (await fish.calls('savePackVoiceVariant'))[0]
  assert.equal(added.variant.name, '预设 2'); assert.equal((await fish.voice('aoi')).variant, added.variantId)
  await fish.page.getByLabel('预设名称').waitFor()
  await f.done(); await fish.done()
})

test('D + billing gate: online voices preview only after an explicit paid confirmation; cancel never synthesizes', async t => {
  const f = await open(t), { page } = f
  await f.voicePage('aoi', '朝雾葵'); await f.openWay('在线 TTS')
  await page.locator('.ap-voice-online .ap-voice-row').first().waitFor()
  assert.equal(await page.getByRole('radio', { name: '通义千问' }).getAttribute('aria-checked'), 'true')
  await page.getByRole('button', { name: '试听「萌宝」' }).click()
  const bill = page.getByRole('dialog', { name: '付费试听' }); await bill.waitFor()
  assert.equal(await bill.locator('p').innerText(), '试听「萌宝」会用通义千问合成一句短句，按服务价格计费一次。')
  await f.guard('D billing')
  await bill.getByRole('button', { name: '取消' }).click(); await bill.waitFor({ state: 'detached' })
  assert.equal((await f.calls('previewFigureVoice')).length, 1, 'cancel never resends'); assert.deepEqual(await f.calls('synthesis'), [])
  assert.equal(await page.getByRole('button', { name: '试听「萌宝」' }).getAttribute('aria-pressed'), 'false')
  await page.getByRole('button', { name: '试听「萌宝」' }).click(); await bill.waitFor(); await bill.getByRole('button', { name: '确认试听' }).click()
  await page.waitForFunction(() => window.audioPlays.length === 1)
  const asks = await f.calls('previewFigureVoice')
  assert.equal(asks.length, 3); assert.equal(asks[1].confirmToken, undefined); assert.equal(asks[2].confirmToken, 'confirm-2')
  assert.deepEqual({ ...asks[2], confirmToken: undefined }, { ...asks[1], confirmToken: undefined }, 'the confirmed request is the same request')
  const [job] = await f.calls('synthesis'); assert.deepEqual(job.source, { kind: 'preset', provider: 'qwen', voiceName: 'Bella' })
  await page.waitForFunction(() => window.voiceCalls.some(c => c[0] === 'closeFigureVoicePreview'))
  await page.getByRole('button', { name: '试听「萌宝」' }).click(); await bill.waitFor()
  await page.keyboard.press('Escape'); await bill.waitFor({ state: 'detached' })
  assert.equal((await f.calls('synthesis')).length, 1, 'every paid preview asks again; Escape cancels')
  assert.deepEqual(await f.writes(), [])

  await page.getByRole('button', { name: '使用 苏瑶' }).click(); await page.getByText('已换成「苏瑶」').waitFor()
  assert.deepEqual((await f.calls('createAndAssignPackVoice'))[0].voiceSpec, { name: '苏瑶', language: 'zh', defaultSource: 'qwen', sources: { qwen: { kind: 'preset', provider: 'qwen', voiceName: 'Serena' } } })
  assert.ok((await f.library()).actor, 'the previous voice stays in the pack'); assert.equal(await f.hero().getByRole('radiogroup', { name: '发声方式' }).getByRole('radio', { name: '通义千问' }).getAttribute('aria-checked'), 'true')
  await page.locator('.ap-voice-go').click(); await bill.waitFor(); await bill.getByRole('button', { name: '取消' }).click()
  assert.equal((await f.calls('synthesis')).length, 1, 'the saved paid voice asks too')
  await page.getByRole('radio', { name: 'Azure' }).click(); await page.getByRole('button', { name: '试听「Nanami」' }).waitFor()
  await f.guard('D azure list'); await f.done()
})

test('Fish 声音编号: paste and check an ID, search by name; a missing ID is a warning, not a voice', async t => {
  const f = await open(t), { page } = f
  await f.voicePage('aoi', '朝雾葵'); await f.openWay('Fish 声音')
  const box = page.getByLabel('Fish 声音编号或名字')
  await box.fill('ffffffffffffffffffffffffffffffff'); await page.getByRole('button', { name: '查找编号' }).click()
  await page.getByRole('alert').filter({ hasText: '没有找到这个编号，请检查是否复制完整' }).waitFor()
  assert.equal(await page.locator('.ap-voice-finder .ap-voice-use').count(), 0)
  const id = '7777777777777777777777777777f000'
  await box.fill(id); await box.press('Enter'); await page.locator('.ap-voice-finder .ap-voice-row').first().waitFor()
  assert.deepEqual((await f.calls('tts.validateFishVoice')).at(-1), { serviceId: 'fish-main', voiceId: id })
  assert.match(await page.locator('.ap-voice-finder .ap-voice-row').innerText(), /猫耳女仆 1/)
  await box.fill('女仆'); await page.getByRole('button', { name: '搜索' }).click(); await page.locator('.ap-voice-finder .ap-voice-row').nth(1).waitFor()
  assert.deepEqual((await f.calls('tts.searchFishVoices')).at(-1), { serviceId: 'fish-main', query: '女仆', page: 1 })
  assert.equal(await page.locator('.ap-voice-finder .ap-voice-row').count(), 7)
  await f.guard('fish search')
  await page.getByRole('button', { name: '使用 猫耳女仆 5' }).click(); await page.getByText('已换成「猫耳女仆 5」').waitFor()
  assert.equal((await f.calls('createAndAssignPackVoice'))[0].voiceSpec.sources.fish.voiceId, (0xf004).toString(16).padStart(32, '7'))
  await f.done()
})

test('E: one voice keeps a Fish reference list and local emotion pools; edits keep the other source and the model', async t => {
  const f = await open(t), { page } = f, original = (await f.library()).heroine
  await f.voicePage('rin', '雨宫凛'); await f.openWay('参考音频')
  const list = page.getByRole('list', { name: '参考音频' }); await list.locator('.ap-clip').nth(2).waitFor()
  await page.waitForFunction(() => /13\.8 秒/.test(document.querySelector('.ap-clips-sum')?.textContent || ''))
  assert.match(await page.locator('.ap-clips-sum').innerText(), /^3 段 · 13\.8 秒 · \d+ KB$/)
  await f.guard('E references')
  await page.getByRole('button', { name: '第 2 段操作' }).click(); await page.getByRole('menuitem', { name: '上移' }).click()
  await f.waitCall('savePackVoice'); await f.idle()
  let saved = (await f.calls('savePackVoice'))[0]
  assert.deepEqual(saved.voiceSpec.sources.fish.references.map(r => r.text), ['そんなの、わたしだって分かってるよ。', 'おはよう。今日も一緒に帰ろうね。', 'ありがとう、助かった。'])
  assert.deepEqual(saved.voiceSpec.sources.local, original.sources.local, 'the local pools and model are kept'); assert.equal(saved.confirmShared, undefined)
  // Alt+↓ on a row moves it too.
  await page.getByLabel('第 1 段原文').focus(); await page.keyboard.press('Alt+ArrowDown'); await f.waitCall('savePackVoice', 2); await f.idle()
  assert.equal((await f.calls('savePackVoice'))[1].voiceSpec.sources.fish.references[0].text, 'おはよう。今日も一緒に帰ろうね。')
  await page.getByLabel('第 3 段原文').fill('ありがとう。'); await page.getByLabel('第 3 段原文').press('Enter'); await f.waitCall('savePackVoice', 3); await f.idle()
  assert.equal((await f.calls('savePackVoice'))[2].voiceSpec.sources.fish.references[2].text, 'ありがとう。')
  await page.getByRole('button', { name: '第 1 段语言：日语' }).click(); await page.getByRole('menuitemradio', { name: '中文' }).click(); await f.waitCall('savePackVoice', 4); await f.idle()
  assert.equal((await f.calls('savePackVoice'))[3].voiceSpec.sources.fish.references[0].language, 'zh')
  // Upload: WAV / MP3 only, appended with an empty transcript; a text file is refused before any write.
  await page.getByLabel('添加参考音频').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') })
  await page.getByRole('alert').filter({ hasText: '参考音频只能是 WAV 或 MP3' }).waitFor(); assert.deepEqual(await f.calls('putBlob'), [])
  await page.getByLabel('添加参考音频').setInputFiles({ name: 'line.wav', mimeType: 'audio/wav', buffer: wav(2) }); await f.waitCall('savePackVoice', 5); await f.idle()
  saved = (await f.calls('savePackVoice'))[4]
  assert.equal((await f.calls('putBlob'))[0].descriptor.ext, 'wav'); assert.equal(saved.voiceSpec.sources.fish.references.length, 4)
  assert.deepEqual({ ...saved.voiceSpec.sources.fish.references[3], media: 'x' }, { media: 'x', text: '', language: 'ja' })
  await list.locator('.ap-clip').nth(3).waitFor()
  await page.getByRole('button', { name: '第 4 段操作' }).click(); await page.getByRole('menuitem', { name: '删除' }).click(); await f.waitCall('savePackVoice', 6); await f.idle()
  assert.equal((await f.calls('savePackVoice'))[5].voiceSpec.sources.fish.references.length, 3)
  await page.getByRole('button', { name: '播放第 1 段原音' }).click(); await page.waitForFunction(() => window.audioPlays.length === 1)
  assert.deepEqual(await f.calls('synthesis'), [], 'playing an original clip is not a synthesis')

  await f.openWay('本地引擎'); await page.getByRole('radiogroup', { name: '参考音频分组' }).waitFor()
  assert.match(await page.locator('.ap-voice-local .ap-voice-tools').innerText(), /GPT-SoVITS v2ProPlus[\s\S]*已安装/)
  assert.deepEqual(await page.getByRole('radio', { name: /^(默认|喜悦|悲伤|平和)/ }).evaluateAll(n => n.map(x => x.getAttribute('aria-label'))), ['默认 1 段', '喜悦 2 段', '悲伤 1 段', '平和 用默认'])
  await page.getByRole('radio', { name: '喜悦 2 段' }).click()
  const pool = page.getByRole('list', { name: '喜悦参考音频' }); await pool.locator('.ap-clip').nth(1).waitFor()
  assert.equal(await pool.getByRole('button', { name: /^第 1 段操作$/ }).count(), 1)
  await pool.getByRole('button', { name: '第 1 段操作' }).click(); assert.equal(await page.getByRole('menuitem', { name: '上移' }).count(), 0, 'a pool has no order'); await page.keyboard.press('Escape')
  await page.getByLabel('添加喜悦参考音频').setInputFiles({ name: 'joy.wav', mimeType: 'audio/wav', buffer: wav(1.5) }); await f.waitCall('savePackVoice', 7); await f.idle()
  saved = (await f.calls('savePackVoice'))[6]
  assert.equal(saved.voiceSpec.sources.local.emotions.joy.length, 3); assert.deepEqual(saved.voiceSpec.sources.local.model, original.sources.local.model)
  assert.equal(saved.voiceSpec.sources.local.selection, 'stable-random'); assert.equal(saved.voiceSpec.sources.fish.references.length, 3)
  await f.guard('E local'); await f.done()
})

test('F: 发声方式 switches only the figure binding (Fish ↔ local ↔ 不配音); both sources stay', async t => {
  const f = await open(t), { page } = f, before = await f.library()
  await f.voicePage('rin', '雨宫凛')
  const ways = page.getByRole('radiogroup', { name: '发声方式' })
  assert.deepEqual(await ways.getByRole('radio').allInnerTexts(), ['参考音频', '本地引擎', '不配音'])
  await ways.getByRole('radio', { name: '本地引擎' }).click(); await f.waitCall('saveFigureVoiceBinding'); await f.idle()
  assert.deepEqual(await f.voice('rin'), { voice: 'heroine', source: 'local' })
  await ways.getByRole('radio', { name: '不配音' }).click(); await f.waitCall('saveFigureVoiceBinding', 2); await f.idle()
  assert.deepEqual(await f.voice('rin'), { voice: 'heroine', source: null }); assert.equal(await page.locator('.ap-voice-go').isDisabled(), true)
  assert.match(await f.hero().innerText(), /不配音/); assert.equal(await f.hero().locator('.ap-voice-warn').count(), 0, '不配音 by choice is not a warning')
  await ways.getByRole('radio', { name: '参考音频' }).click(); await f.waitCall('saveFigureVoiceBinding', 3); await f.idle()
  assert.deepEqual(await f.voice('rin'), { voice: 'heroine' }, 'the default source is not written out')
  assert.deepEqual(await f.library(), before, 'switching never edits the voice')
  await ways.getByRole('radio', { name: '不配音' }).click(); await f.waitCall('saveFigureVoiceBinding', 4); await f.idle()
  await page.getByRole('button', { name: '返回人物' }).click()
  assert.equal(await page.locator('.ap-voice-pill').getAttribute('aria-label'), '声音：凛的声线，不配音')
  assert.equal(await page.getByRole('button', { name: '试听人物声音' }).count(), 0)
  await f.done()
})

test('G: no service / key / local model → ⚠ and 不配音, never a silent switch', async t => {
  const none = await open(t, { services: [] })
  await none.figure('aoi', '朝雾葵'); await none.page.locator('.ap-voice-pill .ap-hint-mark').waitFor()
  assert.equal(await none.page.locator('.ap-voice-pill').getAttribute('aria-label'), '声音：温柔少女，还没有配置 Fish Audio 服务，暂不配音')
  await none.page.locator('.ap-voice-pill').click(); await none.hero().locator('.ap-voice-warn').waitFor()
  assert.equal(await none.hero().locator('.ap-voice-warn').innerText(), '还没有配置 Fish Audio 服务，暂不配音')
  await none.openWay('Fish 声音'); await none.page.getByText('还没有配置 Fish Audio 服务：编号可以直接使用，但不能查找').waitFor()
  await none.openWay('在线 TTS'); await none.page.getByText('还没有配置通义千问服务；选中的声音暂不配音').waitFor()
  await none.guard('G no service'); assert.deepEqual(await none.writes(), [])

  const model = await open(t, { rinSource: 'local', services: [FISH_SERVICE, LOCAL_OTHER_MODEL] })
  await model.voicePage('rin', '雨宫凛'); await model.hero().locator('.ap-voice-warn').waitFor()
  assert.equal(await model.hero().locator('.ap-voice-warn').innerText(), '这台电脑没有这个本地模型，暂不配音')
  assert.equal(await model.page.locator('.ap-voice-go').isDisabled(), true)
  await model.openWay('本地引擎'); await model.page.locator('.ap-voice-local .ap-voice-warn', { hasText: '这台电脑没有这个模型' }).waitFor()
  assert.deepEqual(await model.voice('rin'), { voice: 'heroine', source: 'local' }); assert.deepEqual(await model.writes(), [], 'no automatic source switch')

  const engine = await open(t, { rinSource: 'local', services: [FISH_SERVICE, QWEN_SERVICE] })
  await engine.voicePage('rin', '雨宫凛'); await engine.hero().locator('.ap-voice-warn').waitFor()
  assert.equal(await engine.hero().locator('.ap-voice-warn').innerText(), '这台电脑没有本地引擎，暂不配音')
  await engine.openWay('本地引擎'); await engine.page.locator('.ap-voice-local .ap-tag', { hasText: '已安装' }).waitFor({ state: 'detached' })
  await engine.guard('G no engine')
  await none.done(); await model.done(); await engine.done()
})

test('H: one voice, two figures, two providers — each figure keeps its own 发声方式', async t => {
  const f = await open(t, { meiHeroine: true }), { page } = f, before = await f.library()
  await f.voicePage('mei', '芽衣')
  assert.equal(await page.getByRole('radio', { name: '本地引擎' }).getAttribute('aria-checked'), 'true'); await f.hero().getByText('雨宫凛 也在用').waitFor()
  await page.getByRole('radio', { name: '参考音频' }).click(); await f.waitCall('saveFigureVoiceBinding'); await f.idle()
  assert.equal(await page.getByRole('dialog').count(), 1, 'a binding change never asks about sharing')
  assert.deepEqual(await f.voice('mei'), { voice: 'heroine' }); assert.deepEqual(await f.voice('rin'), { voice: 'heroine' })
  await page.getByRole('radio', { name: '本地引擎' }).click(); await f.waitCall('saveFigureVoiceBinding', 2); await f.idle()
  await f.voicePage('rin', '雨宫凛')
  assert.equal(await page.getByRole('radio', { name: '参考音频' }).getAttribute('aria-checked'), 'true')
  assert.deepEqual(await f.voice('mei'), { voice: 'heroine', source: 'local' }); assert.deepEqual(await f.library(), before)
  await f.done()
})

test('templates: 我的模板 are copied into the pack when used; save and delete go through the template CAS', async t => {
  const template = { templateId: 'tpl-1', revision: 'tr1', name: '夜雀', voiceSpec: { name: '夜雀', language: 'ja', defaultSource: 'fish', sources: { fish: { kind: 'voice-id', provider: 'fish-audio', voiceId: '9'.repeat(32) } } }, binding: { voice: 'x', variant: 'normal' } }
  const f = await open(t, { templates: [template] }), { page } = f
  await f.voicePage('mei', '芽衣'); await f.openWay('声音预设')
  await page.getByRole('button', { name: '复制使用 夜雀' }).waitFor(); await f.guard('templates')
  assert.equal(await page.getByRole('button', { name: '复制使用 夜雀' }).count(), 1)
  assert.deepEqual(await f.calls('listFigureVoiceChoices'), [], 'P1 personal templates have only one listing API')
  await page.getByRole('button', { name: '复制使用 夜雀' }).click(); await f.waitCall('assignVoiceTemplate'); await f.idle()
  const [used] = await f.calls('assignVoiceTemplate'), mine = (await f.voice('mei')).voice
  assert.equal(used.templateId, 'tpl-1'); assert.equal(used.templateRevision, 'tr1'); assert.equal(typeof used.figureId, 'string')
  assert.deepEqual((await f.library())[mine], template.voiceSpec, 'a full copy lives in the pack')
  await page.getByRole('button', { name: '声音操作' }).click(); await page.getByRole('menuitem', { name: '另存为我的模板' }).click()
  await page.getByText('已存为我的模板「夜雀」').waitFor()
  const [saved] = await f.calls('saveVoiceTemplate'); assert.equal(saved.expectedRevision, null); assert.equal(saved.voiceId, mine)
  await page.getByRole('button', { name: '模板操作 夜雀' }).first().click(); await page.getByRole('menuitem', { name: '删除模板' }).click()
  const confirm = page.getByRole('dialog', { name: '删除模板「夜雀」？' }); await confirm.waitFor()
  assert.match(await confirm.innerText(), /已经用过它的素材包不受影响/)
  await confirm.getByRole('button', { name: '删除' }).click(); await f.waitCall('deleteVoiceTemplate')
  assert.deepEqual((await f.calls('deleteVoiceTemplate'))[0], { templateId: 'tpl-1', expectedRevision: 'tr1' })
  assert.deepEqual((await f.library())[mine], template.voiceSpec, 'deleting a template never touches the pack')
  await f.done()
})

test('spinner waits 150 ms, the waveform respects reduced motion, and the phone gets a full-screen sub-page', async t => {
  const f = await open(t, { previewDelayMs: 700 }), { page } = f
  // private fork: keep fake playback observable across locator polling, as in the reduced-motion check below.
  await page.evaluate(() => { window.audioEndMs = 3000 })
  await f.voicePage('aoi', '朝雾葵'); await page.locator('.ap-voice-go').click()
  await page.waitForTimeout(60)
  assert.equal(await page.locator('.ap-voice-go .fork-spinner').count(), 1); assert.equal(await page.locator('.ap-voice-go .fork-spinner-wheel').count(), 0, 'nothing drawn before 150 ms')
  await page.waitForTimeout(250); assert.equal(await page.locator('.ap-voice-go .fork-spinner-wheel').count(), 1)
  await page.locator('.ap-voice-disc[data-playing]').waitFor()
  assert.equal(await page.locator('.ap-voice-disc[data-playing] > i').first().evaluate(n => getComputedStyle(n).animationName), 'ap-voice-wave')
  assert.equal(await page.locator('.ap-voice-go').innerText(), '停止')

  const calm = await open(t, { previewDelayMs: 0 }, { reducedMotion: 'reduce' })
  await calm.page.evaluate(() => { window.audioEndMs = 3000 })
  await calm.voicePage('aoi', '朝雾葵'); await calm.page.locator('.ap-voice-go').click(); await calm.page.locator('.ap-voice-disc[data-playing]').waitFor()
  assert.equal(await calm.page.locator('.ap-voice-disc[data-playing] > i').first().evaluate(n => getComputedStyle(n).animationName), 'none')

  for (const theme of ['light', 'dark']) {
    const phone = await open(t, {}, { narrow: true, theme }), p = phone.page
    await phone.figure('rin', '雨宫凛'); await phone.guard('phone field ' + theme)
    const pill = await p.locator('.ap-voice-pill').boundingBox(); assert.ok(pill.height >= 36, 'phone controls are 36 px')
    await p.locator('.ap-voice-pill').click(); await p.getByRole('region', { name: '雨宫凛的声音' }).waitFor()
    const bar = await p.locator('.ap-voice-head').boundingBox(), back = await p.getByRole('button', { name: '返回人物' }).boundingBox()
    // private fork (settings polish, owner 2026-10): the shared sub-page header (‹ beside 声音 at the top), not a separate full-width bar.
    const title = await p.locator('.ap-voice-head .ap-subhead-title').boundingBox()
    assert.ok(bar.y <= 24 && back.x <= 16 && back.x + back.width <= title.x + 1 && Math.abs((back.y + back.height / 2) - (title.y + title.height / 2)) < 3, 'the ‹ sits right before the title at the top: ' + JSON.stringify({ bar, back, title })); assert.ok(back.width >= 36 && back.y < 40, 'its back button is a 36 px target')
    assert.equal(await p.locator('.ap-figure-editor > .ap-figure-stage').isVisible(), false, 'the figure page is replaced, not stacked under it')
    await phone.openWay('参考音频'); await p.locator('.ap-clip').nth(2).waitFor(); await phone.guard('phone references ' + theme)
    await phone.openWay('本地引擎'); await p.getByRole('radiogroup', { name: '参考音频分组' }).waitFor(); await phone.guard('phone local ' + theme)
    await p.getByRole('button', { name: '返回人物' }).click(); await p.locator('.ap-voice-pill').waitFor()
    await phone.done()
  }
  await f.done(); await calm.done()
})

// private fork (voice language, owner 2026-10): 「配音语言」 beside the chosen voice — label + (?) (the explanation lives only
// in the tooltip) + the app's own menu; the voice's language is the default and is never written out; ⚠ only when this
// voice cannot speak the language (Azure en-US Ashley → 日语). Screenshots: DSH_VOICE_LANGUAGE_SHOTS=<dir>.
test('配音语言: shows the effective language, writes a per-figure override, ⚠ when the voice cannot speak it', async t => {
  const shots = process.env.DSH_VOICE_LANGUAGE_SHOTS
  for (const narrow of [false, true]) {
    const f = await open(t, {}, { narrow }), { page } = f
    await f.voicePage('sora', '空')
    const row = f.hero().locator('.ap-prop.is-language')
    assert.match(await row.locator('.ap-prop-key').innerText(), /^配音语言\s*\?/)
    const tip = page.getByText('和正文语言不同时，AI 会额外写一句这门语言的台词用来配音，画面上仍显示正文。')
    await page.mouse.move(1, 1); await page.waitForTimeout(100)
    assert.equal(await tip.count(), 1)
    assert.ok(await tip.evaluate(e => !!e.closest('.fork-help-tip, .ap-help-anchor')), 'the explanation lives only in the (?) tooltip')
    const pick = page.getByRole('button', { name: '配音语言：英语' })
    await pick.waitFor(); assert.equal(await row.locator('.ap-voice-warn').count(), 0, 'Ashley speaks English')
    await pick.click(); await page.getByRole('menuitemradio', { name: /英语/ }).waitFor()
    assert.match(await page.getByRole('menuitemradio', { name: /英语/ }).innerText(), /声音默认/)
    if (shots && !narrow) await page.screenshot({ path: shots + '/desktop-menu.png' })
    await page.getByRole('menuitemradio', { name: /^日语/ }).click(); await f.waitCall('saveFigureVoiceBinding'); await f.idle()
    assert.deepEqual(await f.voice('sora'), { voice: 'cast', emotionVariants: { joy: 'joyful' }, language: 'ja' })
    assert.equal(await row.locator('.ap-voice-warn').innerText(), '这个声音不会说日语')
    await f.guard('voice language ' + (narrow ? 'phone' : 'desktop'))
    if (shots) await row.screenshot({ path: shots + (narrow ? '/phone-warning.png' : '/desktop-warning.png') })
    if (shots) await page.screenshot({ path: shots + (narrow ? '/phone-page.png' : '/desktop-page.png') })
    await page.getByRole('button', { name: '配音语言 说明' }).hover(); await page.waitForTimeout(400)
    if (shots && !narrow) await page.screenshot({ path: shots + '/desktop-help.png' })
    await page.getByRole('button', { name: '配音语言：日语' }).click(); await page.getByRole('menuitemradio', { name: /英语/ }).click()
    await f.waitCall('saveFigureVoiceBinding', 2); await f.idle()
    assert.deepEqual(await f.voice('sora'), { voice: 'cast', emotionVariants: { joy: 'joyful' } }, 'the voice\'s own language is not written out')
    assert.equal(await row.locator('.ap-voice-warn').count(), 0)
    assert.deepEqual(await f.calls('synthesis'), [], 'never synthesizes')
    await f.done()
  }
})

// private fork (voice page r2, owner 2026-10): the head is ‹ · 声音 only (no figure name), the hero is disc · name · ⋯ (no
// source subtitle); 推荐声音 + Fish 编号 are one 「Fish 声音」 section; 在线 TTS; 已有声音 + 调音 are one flat 「声音预设」
// list (every pack voice × preset; pick = done; ⋯ on the figure's own; dashed ＋ saves a new one). Never synthesizes.
// Screenshots: DSH_VOICE_PAGE_SHOTS=<dir>.
test('voice page r2: plain head, one Fish section, one flat 声音预设 list', async t => {
  const shots = process.env.DSH_VOICE_PAGE_SHOTS
  for (const narrow of [false, true]) {
    const f = await open(t, {}, { narrow }), { page } = f, tag = narrow ? 'phone' : 'desktop'
    await f.voicePage('sora', '空')
    assert.equal((await page.locator('.ap-voice-head').innerText()).trim(), '声音', 'no figure name beside 声音')
    assert.equal((await f.hero().locator('.ap-voice-id').innerText()).trim(), '店员（Azure）', 'no 在线声音 · Azure subtitle under the name')
    assert.deepEqual((await page.locator('.ap-voice-way-head').allInnerTexts()).map(s => s.split('\n')[0].trim()), ['声音预设', 'Fish 声音', '在线 TTS', '参考音频', '本地引擎'])
    assert.equal(await page.locator('.ap-voice-tuning').count(), 0, 'no separate 调音 section')
    assert.match(await f.way('声音预设').innerText(), /原声 · 6 个预设/)
    await f.guard('r2 page ' + tag)
    if (shots) await page.screenshot({ path: `${shots}/${tag}-page.png`, fullPage: true })

    await f.openWay('声音预设')
    const names = await page.getByRole('radiogroup', { name: '声音预设' }).getByRole('radio').evaluateAll(n => n.map(x => x.getAttribute('aria-label')))
    assert.deepEqual(names.slice(0, 3), ['店员（Azure） · 原声', '店员（Azure） · 开心', '店员（Azure） · 低缓'], 'the figure\'s own voice first: ' + names.join('|'))
    assert.ok(names.includes('温柔少女 · 轻快'), 'other pack voices\' presets sit in the same list')
    assert.equal(await page.getByRole('radio', { name: '店员（Azure） · 原声' }).getAttribute('aria-checked'), 'true')
    assert.match(await page.locator('.ap-voice-preset[data-current]').innerText(), /使用中/)
    assert.equal(await page.locator('.ap-voice-preset .ap-voice-tile-menu').count(), 1, '⋯ only on the figure\'s own preset')
    assert.equal(await page.getByRole('button', { name: '把当前设置存为新预设' }).count(), 1)
    await f.guard('r2 presets ' + tag)
    if (shots) await page.locator('.ap-voice-way[aria-label="声音预设"]').screenshot({ path: `${shots}/${tag}-presets.png` })
    await page.getByRole('button', { name: '预设操作 店员（Azure） · 原声' }).click()
    assert.deepEqual(await page.getByRole('menuitem').allInnerTexts(), ['调整参数', '重命名', '删除'])
    if (shots && !narrow) await page.screenshot({ path: `${shots}/${tag}-preset-menu.png` })
    await page.getByRole('menuitem', { name: '调整参数' }).click(); await page.getByRole('slider', { name: '原声语速' }).waitFor()
    if (shots) await page.locator('.ap-voice-way[aria-label="声音预设"]').screenshot({ path: `${shots}/${tag}-preset-params.png` })

    await f.openWay('Fish 声音')
    await page.locator('.ap-voice-tile-name', { hasText: '晴空少女' }).waitFor(); await page.getByLabel('Fish 声音编号或名字').waitFor()
    assert.match(await page.locator('.ap-voice-way-heading.has-help').innerText(), /推荐 4 个/)
    await page.getByRole('button', { name: 'Fish 声音 说明' }).click(); await page.waitForTimeout(150)
    assert.equal(await f.way('Fish 声音').getAttribute('aria-expanded'), 'true', 'the (?) never folds the section')
    await page.getByRole('button', { name: 'Fish 声音 说明' }).click(); await page.mouse.move(1, 1); await page.waitForTimeout(150)
    await f.guard('r2 fish ' + tag)
    if (shots) await page.locator('.ap-voice-way[aria-label="Fish 声音"]').screenshot({ path: `${shots}/${tag}-fish.png` })
    assert.deepEqual(await f.calls('synthesis'), [], 'never synthesizes'); assert.deepEqual(await f.writes(), [])
    await f.done()
  }
})