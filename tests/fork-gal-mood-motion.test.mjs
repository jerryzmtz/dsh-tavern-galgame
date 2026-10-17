import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../tavern-plugin/src/client/fork-gal-scene.js', import.meta.url), 'utf8')
const helpers = source.slice(source.indexOf('// ---------- Scene helpers'), source.indexOf('// ---------- Scene runtime'))
const ctx = { console }
vm.runInNewContext(helpers + ';Object.assign(this, { forkGalMoodMotionPlan, forkGalPlayMoodMotion, forkGalLipSyncIds, forkGalApplyLipSync })', ctx)
const groups = { Mood_joy: [{}, {}], Mood_sad: [{}], Mood_custom_spark: [{}] }
const line = (mood, token) => ({ mood, moodLine: token, speaking: true, visible: true })
const plan = (state, figure, now, random = 0) => ctx.forkGalMoodMotionPlan(state, figure, groups, now, random)

test('mood changes trigger NORMAL random motions, regardless of expression mapping', () => {
  const first = plan(null, line('joy', '1:0'), 100, 0.99)
  assert.equal(first.motion.group, 'Mood_joy')
  assert.equal(first.motion.index, 1)
  assert.equal(first.motion.priority, 2)
  const next = plan(first.state, line('sad', '1:1'), 200)
  assert.equal(next.motion.group, 'Mood_sad')
})

test('voiced lines wait for playback, then consume the gesture without delaying expressions', () => {
  const figure = { ...line('joy', '1:0'), voiced: true, voiceStarted: false }
  const waiting = plan(null, figure, 100)
  assert.equal(waiting.motion, null)
  assert.equal(waiting.state.lastAt, -Infinity)
  const stillWaiting = plan(waiting.state, figure, 900)
  assert.equal(stillWaiting.motion, null)
  assert.equal(stillWaiting.state.lineAt, 100)
  const started = plan(stillWaiting.state, { ...figure, voiceStarted: true }, 950)
  assert.equal(started.motion.group, 'Mood_joy')
  assert.equal(started.state.lastAt, 950)
  assert.equal(plan(started.state, figure, 3000).motion, null, 'pausing or replaying audio cannot replay the gesture')
  const changed = plan(started.state, { ...figure, ...line('sad', '1:1') }, 1000)
  assert.equal(changed.motion, null)
  assert.equal(plan(changed.state, { ...figure, ...line('sad', '1:1'), voiceStarted: true }, 1100).motion.group, 'Mood_sad', 'pending changed mood is not throttled as a repeat')
})

test('voice wait falls back at 1200ms, resets on paging, and silent lines start immediately', () => {
  const figure = { ...line('joy', '1:0'), voiced: true }
  const first = plan(null, figure, 100)
  assert.equal(plan(first.state, figure, 1299).motion, null)
  const timeout = plan(first.state, figure, 1300)
  assert.equal(timeout.motion.group, 'Mood_joy')
  assert.equal(plan(timeout.state, { ...figure, voiceStarted: true }, 2000).motion, null)
  const nextLine = { ...figure, moodLine: '1:1' }
  const next = plan(first.state, nextLine, 800)
  assert.equal(plan(next.state, nextLine, 1300).motion, null)
  assert.equal(plan(next.state, nextLine, 2000).motion.group, 'Mood_joy')
  assert.equal(plan(null, { ...figure, voiced: false }, 100).motion.group, 'Mood_joy')
  const hidden = plan(first.state, { ...figure, visible: false }, 800)
  assert.equal(hidden.state.waiting, false)
  assert.equal(plan(hidden.state, figure, 1300).motion, null, 'returning gets a fresh voice deadline')
})

test('repeats are throttled for 8s and never replay mid-line or during rerenders', () => {
  const first = plan(null, line('joy', '1:0'), 100)
  assert.equal(plan(first.state, line('joy', '1:0'), 10000).motion, null)
  const repeat = plan(first.state, line('joy', '1:1'), 8099)
  assert.equal(repeat.motion, null)
  assert.equal(plan(repeat.state, line('joy', '1:1'), 20000).motion, null)
  assert.equal(plan(repeat.state, line('joy', '1:2'), 8100).motion.group, 'Mood_joy')
})

test('missing/empty groups are no-ops, custom mood ids opt in unchanged', () => {
  const absent = plan(null, line('calm', '1:0'), 100)
  assert.equal(absent.motion, null)
  assert.equal(absent.state.mood, 'calm')
  assert.equal(ctx.forkGalMoodMotionPlan(null, line('joy', '1:0'), { Mood_joy: [] }, 100).motion, null)
  assert.equal(plan(absent.state, line('custom_spark', '1:1'), 200).motion.group, 'Mood_custom_spark')
})

test('listeners, retired figures and previews do not trigger; a return to a line can replay', () => {
  const first = plan(null, line('joy', '1:0'), 100)
  for (const figure of [{ ...line('joy', '1:1'), speaking: false }, { ...line('joy', '1:1'), visible: false }, { mood: 'joy', speaking: true }]) {
    const inactive = plan(first.state, figure, 9000)
    assert.equal(inactive.motion, null)
    assert.equal(plan(inactive.state, line('joy', '1:0'), 9000).motion.group, 'Mood_joy')
  }
})

test('runtime rejection is consumed, not retried later on the same line', async () => {
  const calls = []
  const entry = { model: { internalModel: { settings: { motions: groups } }, motion(...args) { calls.push(args); return Promise.resolve(false) } } }
  ctx.forkGalPlayMoodMotion(entry, line('sad', '1:0'), 100)
  await Promise.resolve()
  ctx.forkGalPlayMoodMotion(entry, line('sad', '1:0'), 10000)
  assert.deepEqual(calls, [['Mood_sad', 0, 2]])
})

test('LipSync declared parameters win even at zero; idle mouth curves remain available', () => {
  const ids = ctx.forkGalLipSyncIds({ json: { Groups: [{ Target: 'Parameter', Name: 'LipSync', Ids: ['CustomMouth', 'OtherMouth'] }] } })
  assert.deepEqual(Array.from(ids), ['CustomMouth', 'OtherMouth'])
  assert.deepEqual(Array.from(ctx.forkGalLipSyncIds({})), ['ParamMouthOpenY'])
  const values = { CustomMouth: 1, OtherMouth: 0.8 }
  const core = { setParameterValueById(id, value) { values[id] = value } }
  ctx.forkGalApplyLipSync(core, ids, { mouthActive: true, mouth: 0 })
  assert.deepEqual(values, { CustomMouth: 0, OtherMouth: 0 })
  ctx.forkGalApplyLipSync(core, ids, { mouthActive: true, mouth: 0.7 })
  assert.deepEqual(values, { CustomMouth: 0.7, OtherMouth: 0.7 })
  ctx.forkGalApplyLipSync(core, ids, { mouthActive: false, mouth: 0 })
  assert.equal(values.CustomMouth, 0.7)
})

test('stage connects stable page tokens to the same expression hook and post-motion lip sync', async () => {
  const stage = await readFile(new URL('../tavern-plugin/src/client/fork-gal-stage.js', import.meta.url), 'utf8')
  // private fork: pack render inputs own the Live2D expression/audio projection.
  const {default:{packFigureRenderInputs}} = await import('../tavern-plugin/src/client/fork-pack-playback.cjs')
  const figure = {alias:'actor',form:'live2d',modelUrl:'/model',media:{model:{identity:'model-hash'}},geometry:{}}
  const audio = {paused:false,ended:false}
  const active = packFigureRenderInputs(figure,{speaking:true,audio,voiceKey:'4:2'}).stage
  assert.equal(active.moodLine,'4:2'); assert.equal(active.audio,audio)
  assert.equal(active.voiced,true); assert.equal(active.voiceStarted,true)
  assert.equal(packFigureRenderInputs(figure,{speaking:false,audio,voiceKey:'4:2'}).stage.moodLine,null)
  assert.equal(packFigureRenderInputs(figure,{speaking:true,skipping:true,audio,voiceKey:'4:2'}).stage.audio,null)
  assert.ok(stage.includes("voiceKey:turn+':'+page"))
  // private fork: suppress one-shots during history/skip without suppressing the expression.
  assert.match(source, /forkGalPlayMoodMotion\(entry, figure, now, desc\.snap \|\| desc\.skipping\);\s+forkLive2dExpress\(entry, figure\)/)
  assert.match(source, /on\("beforeModelUpdate"[\s\S]*?forkGalApplyLipSync\(core, lipSyncIds, entry\)/)
  assert.match(source, /entry\.mouth = figure\.audio \? voiced :/)
})

// private fork: pack outfit emotionMap {expression, motion} -> stage expression name + explicit gesture group.
test('pack Live2D emotion entries project an expression name and an explicit gesture played once per change', async () => {
  const {default:{packFigureRenderInputs}} = await import('../tavern-plugin/src/client/fork-pack-playback.cjs')
  const base = {alias:'actor',form:'live2d',modelUrl:'/model',media:{model:{identity:'model-hash'}},geometry:{}}
  // fork-gal-stage.js adds speaking/visible to each render input.
  const stage = (live2dEmotion, voiceKey = '1:0') => ({...packFigureRenderInputs({...base, live2dEmotion}, {speaking:true, voiceKey}).stage, speaking:true})
  const joy = stage({expression:'joy', motion:'Mood_joy'}), calm = stage({expression:'calm'}), none = stage(null)
  assert.equal(joy.moods[joy.mood], 'joy'); assert.equal(joy.moodMotion, 'Mood_joy')
  assert.equal(calm.moods[calm.mood], 'calm'); assert.equal(calm.moodMotion, null)
  assert.equal(none.moods[none.mood], ''); assert.equal(none.moodMotion, null)
  assert.notEqual(joy.mood, calm.mood)
  assert.equal(stage({expression:'joy', motion:'Mood_joy'}, '1:1').mood, joy.mood, 'same entry, same token across pages')
  const packGroups = { Mood_joy: [{}], Mood_sad: [{}], Mood_selected: [{}] }
  const plan = (state, figure, now) => ctx.forkGalMoodMotionPlan(state, figure, packGroups, now, 0)
  const first = plan(null, joy, 100)
  assert.equal(first.motion.group, 'Mood_joy'); assert.equal(first.motion.priority, 2, 'NORMAL: above Idle, below FORCE director acts')
  assert.equal(plan(first.state, stage({expression:'joy', motion:'Mood_joy'}, '1:1'), 60000).motion, null, 'no repeat without an emotion change')
  const toCalm = plan(first.state, {...calm, moodLine:'1:2'}, 60100)
  assert.equal(toCalm.motion, null, 'an entry without motion plays nothing, not Mood_<token> or Mood_selected')
  assert.equal(plan(toCalm.state, {...joy, moodLine:'1:3'}, 60200).motion.group, 'Mood_joy', 'changing back plays again')
  assert.equal(plan(null, stage({expression:'joy', motion:'Mood_missing'}), 100).motion, null, 'missing group is a no-op')
})

// private fork: history/skip folds persistent expressions but never replays mood one-shots.
test('history and skip consume pack mood gestures without a delayed replay', async () => {
  const {default:{packFigureRenderInputs}} = await import('../tavern-plugin/src/client/fork-pack-playback.cjs')
  const figure = {...packFigureRenderInputs({alias:'actor',form:'live2d',modelUrl:'/model',media:{model:{identity:'model-hash'}},geometry:{},live2dEmotion:{expression:'joy',motion:'Mood_joy'}}, {speaking:true,voiceKey:'2:1'}).stage,speaking:true}
  const groups = {Mood_joy:[{}]}
  const skipped = ctx.forkGalMoodMotionPlan(null, figure, groups, 0, 0, true)
  assert.equal(skipped.motion, null)
  assert.equal(figure.moods[figure.mood], 'joy', 'persistent expression remains selected')
  assert.equal(ctx.forkGalMoodMotionPlan(skipped.state, figure, groups, 1500, 0).motion, null)
  assert.equal(ctx.forkGalMoodMotionPlan(skipped.state, {...figure,moodLine:'2:2'}, groups, 9000, 0).motion, null)
  assert.match(source, /forkGalPlayMoodMotion\(entry, figure, now, desc\.snap \|\| desc\.skipping\)/)
})

test('Live2D expression hook accepts an emotionMap object and a plain name', async () => {
  const live2d = await readFile(new URL('../tavern-plugin/src/client/fork-live2d.js', import.meta.url), 'utf8')
  const fn = live2d.slice(live2d.indexOf('function forkLive2dExpress'), live2d.indexOf('\n}\n', live2d.indexOf('function forkLive2dExpress')) + 3)
  const box = {}
  vm.runInNewContext(fn + ';this.express = forkLive2dExpress', box)
  const calls = []
  const entry = { mood: null, model: { expression: name => calls.push(name), internalModel: { settings: { expressions: [{ Name: 'neutral' }, { Name: 'joy' }] }, motionManager: {} } } }
  box.express(entry, { mood: 'm', moods: { m: { expression: 'joy', motion: 'Mood_joy' } } })
  box.express(entry, { mood: 'n', moods: { n: 'joy' } })
  box.express(entry, { mood: 'o', moods: { o: { motion: 'Mood_joy' } } })
  assert.deepEqual(calls, ['joy', 'neutral'])
})
