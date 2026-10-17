import {stagePageSource} from './helpers/stage-page-source.mjs' // private fork
// private fork: follow protocol extraction paths; behavior assertions unchanged.
import {forkBubbleCharacter} from '../tavern-plugin/src/client/fork-bubble-line.cjs' // private fork
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../tavern-plugin/src/client/fork-gal-stage.js', import.meta.url), 'utf8')
// The staging helper uses the effect vocabulary helpers (beat / emote names) of the scene.
const sceneSource = await readFile(new URL('../tavern-plugin/src/client/fork-gal-scene.js', import.meta.url), 'utf8')
const effectsSource = await readFile(new URL('../tavern-plugin/src/client/fork-gal-effects.js', import.meta.url), 'utf8')
const effectHelpers = await readFile(new URL('../tavern-plugin/packages/dsh-presentation-protocol/src/fork-stage-light.cjs', import.meta.url), 'utf8') + sceneSource.slice(sceneSource.indexOf('// ---------- Scene helpers'), sceneSource.indexOf('// ---------- Scene runtime')) + effectsSource.slice(effectsSource.indexOf('// ---------- Effect helpers'), effectsSource.indexOf('// ---------- Effect runtime'))
const context = {forkBubbleCharacter}
vm.runInNewContext((stagePageSource + '\n' + source.slice(source.indexOf('// Plain reading text'), source.indexOf('// The stage is a full-screen mode'))) + ';this.pages=forkGalPages;this.cast=forkGalCast;this.narration=forkGalNarrationPages;this.plain=forkGalPlain;this.quoted=forkGalQuoted;', context)

test('static talk frames follow the actual base slot, including default fallback and custom moods', () => {
  const model = { images: { default: 'base', joy: 'joy', custom: 'custom' }, talk: { default: 'talk', custom: 'custom-talk' } }
  const frames = mood => JSON.parse(JSON.stringify(context.forkGalStaticFrames(model, mood)))
  assert.deepEqual(frames('calm'), { src: 'base', talkSrc: 'talk' })
  assert.deepEqual(frames('joy'), { src: 'joy', talkSrc: '' })
  assert.deepEqual(frames('custom'), { src: 'custom', talkSrc: 'custom-talk' })
  assert.deepEqual(JSON.parse(JSON.stringify(context.forkGalStaticFrames({ images: { default: 'base' } }, 'joy'))), { src: 'base', talkSrc: '' })
})

test('classic box quotes spoken lines once, keeps bracketed text, closes only when finished', () => {
  assert.equal(context.quoted('早上好！'), '「早上好！」')
  assert.equal(context.quoted('  早上好'), '「早上好」')
  assert.equal(context.quoted('早上', true), '「早上', 'no closing bracket while the line streams')
  assert.equal(context.quoted('「已经有括号」'), '「已经有括号」')
  assert.equal(context.quoted('『书名』里写着'), '『书名』里写着')
  assert.equal(context.quoted('（秘密）'), '（秘密）', 'thoughts keep their parentheses')
  assert.equal(context.quoted('“quoted”'), '“quoted”')
  assert.equal(context.quoted(''), '')
})

test('narration pages per paragraph, long paragraphs split at sentence ends, markdown decorations removed', () => {
  assert.equal(context.plain('**放学后**，她说：*小声地*。\n\n---'), '放学后，她说：小声地。')
  const long = '她站在天台上。'.repeat(30)
  const pages = context.narration('第一段。\n\n' + long)
  assert.equal(pages[0], '第一段。')
  assert.ok(pages.length > 2)
  assert.ok(pages.slice(1).every(page => page.length <= 130 && page.endsWith('。')))
  assert.deepEqual([...context.narration('<div class="status">x</div>\n\n')], [])
})

test('lines become pages with their voice; streaming tail is pending; cast keeps the three most recent speakers', () => {
  const voice = { id: 'v' }
  const parts = [{ streaming: true, voices: { 1: voice }, segments: [
    { kind: 'markdown', text: '旁白一。\n\n旁白二' },
    { kind: 'bubble', alias: 'madoka', name: '鹿目圆', mood: '喜悦', text: '早上好！' },
    { kind: 'bubble', alias: 'homura', name: '晓美焰', mood: '平静', text: '秘密', thought: true },
    { kind: 'bubble', alias: 'sayaka', name: '沙耶香', mood: '愤怒', text: '喂' },
    { kind: 'bubble', alias: 'kyoko', name: '杏子', mood: '平和', text: '吃', streaming: true }
  ] }]
  const pages = context.pages(parts)
  assert.deepEqual([...pages].map(page => page.kind), ['narration', 'narration', 'line', 'line', 'line', 'line'])
  assert.equal(pages[2].voice, voice)
  // private fork: parsed source aliases never equal the canonical figure id.
  const config={characters:[{alias:'f_madoka',aliases:['madoka'],name:'鹿目圆',ref:{packId:'pack',figureId:'madoka'}}]}
  assert.equal(context.forkGalMoodOf(pages,5,'f_madoka',config),'喜悦')
  assert.equal(pages[3].text, '（秘密）')
  assert.equal(pages[5].pending, true)
  assert.equal(pages[1].pending, false)
  assert.deepEqual([...context.cast(pages, 3)].map(item => item.alias), ['madoka', 'homura'])
  assert.deepEqual([...context.cast(pages, 5)].map(item => item.alias), ['homura', 'sayaka', 'kyoko'], 'oldest speaker leaves when a fourth arrives')
})

test('stand-in background: shared place words, then time of day; nothing close stays empty', async () => {
  const src = await readFile(new URL('../tavern-plugin/src/client/fork-gal-stage.js', import.meta.url), 'utf8')
  const ctx = {}
  vm.runInNewContext(src.slice(src.indexOf('const FORK_GAL_TIMES'), src.indexOf('// Face window at the left of the text box')) + ';this.pick=forkGalStandIn;this.time=forkGalTimeOf;', ctx)
  const lib = ['鹿目家·正门·清晨', '见泷原综合医院·后院·傍晚', '上学路·溪边小道', '见泷原中学·教室'].map(name => ({ name }))
  assert.equal(ctx.pick('鹿目家·玄关·夜', lib).name, '鹿目家·正门·清晨')
  assert.equal(ctx.pick('医院对面公园·秋千·夜', lib).name, '见泷原综合医院·后院·傍晚')
  assert.equal(ctx.pick('魔女结界', lib), null)
  assert.equal(ctx.time('住宅区·路灯下·夜'), 'night')
})

test('staging helper: stable sides, arrivals and departures, transient close-ups, protagonist off stage', async () => {
  const ctx = {}
  const live2d = await readFile(new URL('../tavern-plugin/src/client/fork-live2d.js', import.meta.url), 'utf8')
  const slots = live2d.slice(live2d.indexOf('function forkLive2dSlots'), live2d.indexOf('\n', live2d.indexOf('function forkLive2dSlots')))
  vm.runInNewContext(slots + '\n' + effectHelpers + '\n' + (stagePageSource + '\n' + source.slice(source.indexOf('// Plain reading text'), source.indexOf('// The stage is a full-screen mode'))) + ';this.staging=forkGalStaging;this.gaze=forkGalGaze;this.cue=forkGalCue;this.order=forkGalOrder;', ctx)
  const direction = { status: 'done', start: { cast: ['madoka', 'homura'], focus: {}, look: {}, zoom: '' }, entries: [
    { at: 2, cast: ['homura', 'madoka', 'player'], commands: [{ op: 'enter', id: 'player', value: 'right' }, { op: 'pos', id: 'madoka', value: 'right' }, { op: 'look', id: 'madoka', value: 'player' }] },
    { at: 4, commands: [{ op: 'focus', id: 'madoka', value: 'close' }, { op: 'shake', value: 1 }, { op: 'act', id: 'madoka', value: 'nod' }, { op: 'zoom', value: 'in' }] },
    { at: 6, cast: ['madoka', 'player'], commands: [{ op: 'exit', id: 'homura', value: 'left' }, { op: 'flash' }] },
    { at: 8, cast: ['madoka', 'player', 'sayaka'] },
    { at: 9, cast: ['madoka'] }
  ] }
  const plain = value => JSON.parse(JSON.stringify(value))
  const row = (para, hide) => plain(ctx.staging(direction, para, hide)).members.map(member => [member.id, member.x, member.visible, member.enter || member.exit])
  assert.deepEqual(row(1), [['madoka', 0.33, true, ''], ['homura', 0.67, true, '']])
  assert.deepEqual(row(2), [['madoka', 0.2, true, ''], ['homura', 0.5, true, ''], ['player', 0.8, true, 'right']], 'people on stage keep their sides; pos does not move them')
  assert.deepEqual(row(2, 'player'), [['madoka', 0.33, true, ''], ['homura', 0.67, true, '']], 'the protagonist never stands on stage')
  assert.equal(plain(ctx.staging(direction, 2)).members[0].look, 'player')
  assert.equal(row(3)[2][3], '', 'entrance animates only on its paragraph')
  const at4 = plain(ctx.staging(direction, 4))
  assert.deepEqual(at4.effects, [{ op: 'beat', value: 'shake-1' }, { op: 'act', id: 'madoka', value: 'nod' }], 'legacy shake becomes a beat; zoom in becomes a persistent push')
  assert.equal(at4.members[0].focus, 'close')
  assert.deepEqual(at4.camera, { value: 'push' })
  assert.deepEqual(plain(ctx.staging(direction, 5)).effects, [], 'one-shots do not repeat on later paragraphs')
  assert.equal(plain(ctx.staging(direction, 6)).members[0].focus, 'close', 'a close-up holds for two more paragraphs')
  assert.equal(plain(ctx.staging(direction, 7)).members[0].focus, 'normal', 'then the camera steps back')
  assert.deepEqual(row(6), [['madoka', 0.33, true, ''], ['player', 0.67, true, ''], ['homura', 0.5, false, 'left']])
  assert.deepEqual(plain(ctx.staging(direction, 6)).effects, [{ op: 'beat', value: 'flash' }])
  assert.deepEqual(row(7).map(item => item[0]), ['madoka', 'player'], 'after the exit paragraph the member is gone')
  assert.deepEqual(row(8), [['madoka', 0.2, true, ''], ['player', 0.5, true, ''], ['sayaka', 0.8, true, 'soft']], 'a bare cast change still makes an entrance')
  assert.deepEqual(row(9), [['madoka', 0.5, true, ''], ['player', 0.5, false, 'soft'], ['sayaka', 0.8, false, 'soft']], 'and departures')
  assert.deepEqual(plain(ctx.staging(direction, 1)).members.map(member => member.focus), ['normal', 'normal'], 'paging back recomputes state')
  assert.deepEqual(plain(ctx.cue(direction, 4)).cast, ['homura', 'madoka', 'player'], 'command-only entries keep the cast')
  // private fork: loop state belongs to soundscape, not visual staging.
  assert.deepEqual(plain(ctx.staging({ status: 'running' }, 3)), { members: [], effects: [], order: [], light: 'auto', lighting: { time: 'auto', mood: 'none' }, timeFadeMs: 800, weather: '', camera: { value: '' }, dof: '', figureLight: {}, transition: '' })
  // private fork: avatar-only characters no longer stand on stage; the others close up around them.
  const figuresOnly = alias => alias !== 'homura'
  assert.deepEqual(plain(ctx.staging(direction, 2, '', figuresOnly)).members.map(member => [member.id, member.x]), [['madoka', 0.33], ['homura', undefined], ['player', 0.67]])
  assert.deepEqual(plain(ctx.staging(direction, 6, '', figuresOnly)).members.map(member => [member.id, member.x, member.visible]), [['madoka', 0.33, true], ['player', 0.67, true], ['homura', undefined, false]])
  assert.equal(ctx.gaze('player', 0.27, { player: 0.73 }), 1)
  assert.equal(ctx.gaze('madoka', 0.73, { madoka: 0.27 }), -1)
  assert.equal(ctx.gaze('away', 0.27, {}), -1)
  assert.equal(ctx.gaze('away', 0.8, {}), 1)
  assert.equal(ctx.gaze('', 0.5, {}), null)

})

test('stage direction v2: persistent light / weather / cam / dof / figure light, one-shot beat / emote / title / act, legacy aliases', async () => {
  const ctx = {}
  const live2d = await readFile(new URL('../tavern-plugin/src/client/fork-live2d.js', import.meta.url), 'utf8')
  const slots = live2d.slice(live2d.indexOf('function forkLive2dSlots'), live2d.indexOf('\n', live2d.indexOf('function forkLive2dSlots')))
  vm.runInNewContext(slots + '\n' + effectHelpers + '\n' + (stagePageSource + '\n' + source.slice(source.indexOf('// Plain reading text'), source.indexOf('// The stage is a full-screen mode'))) + ';this.staging=forkGalStaging;', ctx)
  const plain = value => JSON.parse(JSON.stringify(value))
  const direction = { status: 'done', start: { cast: ['madoka', 'homura'], light: 'night', weather: 'snow', camera: { value: 'close', id: 'homura' }, dof: 'madoka', figureLight: { homura: 'shadow', ghost: 'glow' } }, entries: [
    { at: 2, commands: [{ op: 'light', value: 'memory' }, { op: 'weather', value: 'rain' }, { op: 'cam', value: 'dutch' }, { op: 'glow', id: 'madoka' }, { op: 'beat', value: 'glitch' }, { op: 'emote', id: 'madoka', value: '!' }, { op: 'sfx', value: 'door' }] },
    { at: 3, commands: [{ op: 'cam', value: 'close', id: 'madoka' }, { op: 'dof', value: 'off' }, { op: 'lit', id: 'homura' }, { op: 'title', value: '第二天 · 见泷原中学 · 午休' }, { op: 'act', id: 'homura', value: 'bow' }, { op: 'light', value: 'Not A Look' }] },
    { at: 4, scene: '学校·屋顶', commands: [{ op: 'trans', value: 'iris' }, { op: 'weather', value: 'none' }, { op: 'cam', value: 'wide' }, { op: 'dof', id: 'homura' }, { op: 'emote', id: 'homura', value: 'sweat' }] },
    { at: 5, commands: [{ op: 'trans', value: 'wipe' }, { op: 'shake', value: 3 }, { op: 'fade', value: 'black' }, { op: 'zoom', value: 'in' }, { op: 'beat', value: 'shake 2' }, { op: 'emote', id: 'madoka', value: 'wave' }] },
    { at: 6, cast: ['madoka'], commands: [{ op: 'cam', value: 'close', id: 'homura' }, { op: 'zoom', value: 'out' }, { op: 'fade', value: 'in' }, { op: 'flash' }] },
    { at: 7, scene: '学校·走廊', cast: ['madoka', 'homura'], commands: [{ op: 'cam', value: 'close', id: 'homura' }, { op: 'dof', id: 'homura' }, { op: 'glow', id: 'homura' }] },
    { at: 8, cast: ['madoka'] }
  ] }
  const at = para => plain(ctx.staging(direction, para))
  // Carried from the previous turn (direction.start); unknown people drop out.
  const s1 = at(1)
  assert.deepEqual([s1.light, s1.weather, s1.camera, s1.dof, s1.figureLight], ['night', 'snow', { value: 'close', id: 'homura' }, 'madoka', { homura: 'shadow' }])
  assert.deepEqual(s1.members.map(member => member.light), ['', 'shadow'])
  assert.deepEqual(s1.effects, [])
  // Persistent commands change the state from their paragraph on; one-shots fire only on their own paragraph.
  const s2 = at(2)
  assert.deepEqual([s2.light, s2.weather, s2.camera, s2.figureLight], ['memory', 'rain', { value: 'dutch' }, { homura: 'shadow', madoka: 'glow' }])
  assert.deepEqual(s2.effects, [{ op: 'beat', value: 'glitch' }, { op: 'emote', id: 'madoka', value: '!' }, { op: 'sfx', value: 'door' }], 'sfx is a one-shot on its paragraph')
  const s3 = at(3)
  assert.deepEqual([s3.light, s3.camera, s3.dof, s3.figureLight], ['memory', { value: 'close', id: 'madoka' }, '', { madoka: 'glow' }], 'invalid light values are dropped; dof off; lit restores')
  assert.deepEqual(s3.effects, [{ op: 'title', value: '第二天 · 见泷原中学 · 午休' }, { op: 'act', id: 'homura', value: 'bow' }])
  const s4 = at(4)
  assert.deepEqual([s4.weather, s4.camera, s4.dof, s4.transition], ['', { value: '' }, 'homura', 'iris'], 'trans only counts on a line with a scene')
  assert.deepEqual(at(5).transition, 'iris', 'a trans on a line without a scene is ignored')
  // Legacy commands become beats / camera shots.
  const s5 = at(5)
  assert.deepEqual(s5.effects, [{ op: 'beat', value: 'shake-3' }, { op: 'beat', value: 'blackout' }, { op: 'beat', value: 'shake-2' }], 'unknown emotes are dropped')
  assert.deepEqual(s5.camera, { value: 'push' })
  const s6 = at(6)
  assert.deepEqual(s6.camera, { value: '' }, 'a close-up on someone who is not on stage does not happen; zoom out resets')
  assert.deepEqual(s6.effects, [{ op: 'beat', value: 'fade-in' }, { op: 'beat', value: 'flash' }])
  assert.deepEqual([s6.dof, s6.figureLight], ['', { madoka: 'glow' }], 'leaving the stage ends dof and figure light on that person')
  const s7 = at(7)
  assert.deepEqual([s7.camera, s7.dof, s7.transition], [{ value: 'close', id: 'homura' }, 'homura', ''], 'a new scene without trans uses the default')
  const s8 = at(8)
  assert.deepEqual([s8.camera, s8.dof, s8.figureLight], [{ value: '' }, '', { madoka: 'glow' }], 'the close-up target leaving returns the camera to wide')
  // Paging back recomputes the persistent state from the turn start.
  assert.deepEqual(at(1).light, 'night')
  // The protagonist is never staged: commands on them are dropped, including carried ones.
  const hidden = plain(ctx.staging(direction, 1, 'homura'))
  assert.deepEqual([hidden.camera, hidden.figureLight], [{ value: '' }, {}])
  // Tolerates missing start fields and the legacy zoom flag.
  assert.deepEqual(plain(ctx.staging({ status: 'done', start: { cast: ['madoka'], zoom: 'in' }, entries: [] }, 1)).camera, { value: 'push' })
  assert.deepEqual(plain(ctx.staging({ status: 'done', start: { cast: ['madoka'], camera: 'dutch', light: 'bogus', weather: 'fog' }, entries: [] }, 1)).camera, { value: 'dutch' })
  // light names any look id (the scene resolves ids it does not know to auto); malformed values are dropped.
  assert.equal(plain(ctx.staging({ status: 'done', start: { cast: [], light: 'labyrinth' }, entries: [{ at: 2, commands: [{ op: 'light', value: 'card-look-2' }] }, { at: 3, commands: [{ op: 'light', value: '../x' }] }] }, 3)).light, 'card-look-2')
  assert.equal(plain(ctx.staging({ status: 'done', start: { cast: [], light: 'Bad Id' }, entries: [] }, 1)).light, 'auto')
  assert.deepEqual([plain(ctx.staging({ status: 'done', entries: [] }, 1)).light, plain(ctx.staging({ status: 'done', entries: [] }, 1)).weather], ['auto', ''])
  // Titles are capped at 24 characters.
  const long = plain(ctx.staging({ status: 'done', start: { cast: [] }, entries: [{ at: 1, commands: [{ op: 'title', value: '一'.repeat(40) }] }] }, 1))
  assert.equal(long.effects[0].value.length, 24)
})

test('backlog: earlier rendered turns read-only, current turn only up to the current page, player input per turn', async () => {
  const backlog = await readFile(new URL('../tavern-plugin/src/client/fork-gal-backlog.js', import.meta.url), 'utf8')
  const ctx = {}
  const history = await readFile(new URL('../tavern-plugin/src/client/fork-gal-history.js', import.meta.url), 'utf8')
  vm.runInNewContext(history + '\n' + (stagePageSource + '\n' + source.slice(source.indexOf('// Plain reading text'), source.indexOf('// The stage is a full-screen mode'))) + '\n' +
    backlog.slice(backlog.indexOf('// ---------- Backlog helpers'), backlog.indexOf('// ---------- Backlog view')) +
    ';this.pages=forkGalPages;this.turns=forkGalBacklogTurns;this.entries=forkGalBacklogEntries;this.inputs=forkGalPlayerInputs;', ctx)
  const plain = value => JSON.parse(JSON.stringify(value))
  const voice = { id: 'v1' }
  const part = (turn, index, segments, voices) => ({ turn, index, text: '', streaming: false, segments, voices: voices || {} })
  const all = [
    part(3, 0, [{ kind: 'markdown', text: '第三轮开场。' }]),
    part(2, 1, [{ kind: 'bubble', alias: 'homura', name: '晓美焰', mood: '平静', text: '后一段' }]),
    part(2, 0, [{ kind: 'markdown', text: '第二轮旁白。' }, { kind: 'bubble', alias: 'madoka', name: '鹿目圆', mood: '喜悦', text: '你好' }], { 1: voice }),
    part(3, 1, [{ kind: 'bubble', alias: 'madoka', name: '鹿目圆', mood: '平和', text: '想', thought: true }, { kind: 'markdown', text: '还没读到。' }])
  ]
  const earlier = ctx.turns(all, 3)
  assert.deepEqual(plain(earlier).map(item => [item.turn, item.pages.map(page => page.text)]), [[2, ['第二轮旁白。', '你好', '后一段']]], 'only turns before the current one, parts in order')
  const current = ctx.pages(all.filter(item => item.turn === 3).sort((a, b) => a.index - b.index))
  const rows = plain(ctx.entries(earlier, 3, current, 1, { 2: '去学校', 3: '  ' }))
  assert.deepEqual(rows.map(row => row.key), ['t2', 'i2', 'p2:0', 'p2:1', 'p2:2', 't3', 'p3:0', 'p3:1'], 'the unread page of the current turn is not listed; blank input skipped')
  assert.deepEqual(rows.filter(row => row.type === 'page').map(row => [row.current, row.here]), [[false, false], [false, false], [false, false], [true, false], [true, true]])
  assert.equal(rows[3].voice.id, 'v1')
  assert.deepEqual([rows[3].kind, rows[3].alias, rows[3].name, rows[2].kind, rows[2].name], ['line', 'madoka', '鹿目圆', 'narration', ''])
  assert.deepEqual([rows[7].thought, rows[7].text], [true, '（想）'])
  assert.equal(rows[1].text, '去学校')
  assert.equal(plain(ctx.entries([], 3, current, 99, {})).filter(row => row.type === 'page').length, 3, 'a page past the end clamps to the last page')
  assert.deepEqual(plain(ctx.entries([], 0, [], 0, {})), [])
  // User messages belong to the next assistant reply's turn; seed trajectories and empty text are skipped.
  const nodes = [
    { kind: 'user', content: [{ type: 'text', text: 'seed' }] }, { kind: 'assistant', turn: 1, messageId: 'tavern-seed-trajectory:v1:x:2' },
    { kind: 'context' },
    { kind: 'user', content: [{ type: 'text', text: '去' }, { type: 'text', text: '学校' }] }, { kind: 'assistant', turn: 2, messageId: 'a' }, { kind: 'assistant', turn: 2, messageId: 'b' },
    { kind: 'user', content: 'raw' }, { kind: 'assistant', turn: 4, messageId: 'c' },
    { kind: 'user', content: [] }, { kind: 'assistant', turn: 5, messageId: 'd' },
    { kind: 'user', content: '还在生成' }
  ]
  assert.deepEqual(plain(ctx.inputs(nodes)), { 2: '去学校', 4: 'raw' })
  assert.deepEqual(plain(ctx.inputs(nodes, turn => turn === 4 ? 3 : turn, turn => turn === 2 ? '/send 编辑后' : null)), { 2: '/send 编辑后', 3: 'raw' }, 'story turn mapping and host input sources apply')
})
