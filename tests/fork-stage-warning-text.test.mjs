// private fork: normal stage warnings are prose; debug formatting retains diagnostic identity.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
const require = createRequire(import.meta.url)
const { stageDiagnosticText, stageRuntimeErrorText, stageRuntimeIndicators, createStageRuntimeState } = require('../tavern-plugin/src/client/fork-stage-runtime.cjs')

test('mixed structured and legacy diagnostics join as readable messages, never internal codes', () => {
  const diagnostics = [
    { code: 'time-look-missing', message: 'Missing time looks for dusk / night' },
    'legacy-media-reconstructed: original media versions unknown'
  ]
  assert.equal(diagnostics.map(item => stageDiagnosticText(item)).join('; '),
    '缺少对应时段的灯光预设; 旧存档未记录素材版本，已按当前素材重建')
  assert.equal(diagnostics.map(item => stageDiagnosticText(item, true)).join('; '),
    'time-look-missing: Missing time looks for dusk / night; legacy-media-reconstructed: original media versions unknown')
  assert.equal(diagnostics[0].code, 'time-look-missing', 'source diagnostics remain intact for debug UI')
})

test('code-only objects get readable fallback text and invalid messages never stringify objects', () => {
  assert.equal(stageDiagnosticText({ code: 'time-look-missing', timeOfDay: 'dusk' }), '缺少对应时段的灯光预设')
  assert.equal(stageDiagnosticText({ code: 'time-look-ambiguous', timeOfDay: 'night' }), '对应时段存在多个灯光预设')
  assert.equal(stageDiagnosticText({ code: 'background-variant-missing', timeOfDay: 'night' }), '没有可用的背景变体')
  assert.equal(stageDiagnosticText({ code: 'UNKNOWN', message: { nested: true } }), '本轮演出没能套用，正文不受影响；可以重新生成这一轮再试')
  assert.equal(stageDiagnosticText('legacy-media-reconstructed'), '旧存档未记录素材版本，已按当前素材重建')
  assert.equal(stageDiagnosticText('UNKNOWN_CODE'), '本轮演出没能套用，正文不受影响；可以重新生成这一轮再试')
  assert.equal(stageDiagnosticText(null), '')
  assert.equal(stageDiagnosticText('Ordinary warning'), '本轮演出没能套用，正文不受影响；可以重新生成这一轮再试')
  assert.doesNotMatch(stageDiagnosticText(stageRuntimeErrorText({ code: 'PROJECTION_FAILED', message: 'offline' })), /PROJECTION_FAILED|object Object/)
})

test('the stage warning renders through the prose formatter, not Array.join on objects', async () => {
  const stage = await readFile(new URL('../tavern-plugin/src/client/fork-gal-stage.js', import.meta.url), 'utf8')
  // private fork: the redesigned notice component formats both prose and debug details.
  assert.match(stage, /notes\.map\(note => stageDiagnosticText\(note, true\)\)\.filter\(Boolean\)\.join\('\\n'\)/)
  assert.match(stage, /\|\| stageDiagnosticText\(note\)/)
  assert.doesNotMatch(stage, /diagnostics\?\.join/)
})

// private fork: structured warnings must survive the new localized notice UI.
test('runtime notices render mixed diagnostics without object coercion', async () => {
  const source = await readFile(new URL('../tavern-plugin/src/client/fork-gal-stage.js', import.meta.url), 'utf8')
  const context = { stageDiagnosticText, stageRuntimeErrorText, React: { createElement: (type, props, ...children) => ({type, props, children}) } }
  vm.runInNewContext(source.slice(source.indexOf('const FORK_GAL_DIAGNOSTIC_TEXT'), source.indexOf('// Name plate of the text box')), context)
  const tree = context.ForkGalRuntimeStatus({ error: {code:'FAILED', message:'offline'}, diagnostics: [{code:'time-look-missing', message:'Missing dusk lighting'}, 'legacy-media-reconstructed: original media versions unknown'] })
  const rendered = JSON.stringify(tree)
  assert.match(rendered, /fork-gal-notices/)
  assert.match(rendered, /Missing dusk lighting/)
  assert.match(rendered, /time-look-missing: Missing dusk lighting/)
  assert.doesNotMatch(rendered, /offline/)
  assert.doesNotMatch(rendered, /\[object Object\]/)
})

// private fork: partial direction exposes only the affected capability, not a whole-stage failure.
test('partial notices name only missing capabilities with their real reason', async () => {
  const source = await readFile(new URL('../tavern-plugin/src/client/fork-gal-stage.js', import.meta.url), 'utf8')
  const context = { stageDiagnosticText, stageRuntimeErrorText,
    directorCommands: require('../tavern-plugin/packages/dsh-presentation-protocol/src/director-commands.cjs'),
    React: { createElement: (type, props, ...children) => ({type, props, children}) } }
  vm.runInNewContext(source.slice(source.indexOf('const FORK_GAL_DIAGNOSTIC_TEXT'), source.indexOf('// Name plate of the text box')), context)
  const rendered = JSON.stringify(context.ForkGalRuntimeStatus({drops:[{capability:'music',code:'REF_UNAVAILABLE',at:70,message:'Choose a recalled reference'}]}))
  assert.match(rendered, /音乐部分演出未应用/)
  assert.match(rendered, /第 70 段/)
  assert.match(rendered, /所需素材不存在或当前不可用/)
  assert.doesNotMatch(rendered, /Choose a recalled reference/)
  assert.doesNotMatch(rendered, /演出暂不可用|场景部分演出未应用/)
  assert.doesNotMatch(JSON.stringify(context.ForkGalRuntimeStatus({drops:[]})), /部分演出未应用/)
  // private fork: exercise the selector-to-renderer path for old stored diagnostics.
  const state = createStageRuntimeState()
  state.director.record = {diagnostics:[
    {dropped:true,code:'PACING',capability:'music',at:20,message:'Keep the current music'},
    {dropped:true,code:'PRECONDITION',command:'actor.act.play',capability:'acts',at:12,message:'Enter this actor first or choose a current cast actor.'},
    {dropped:true,code:'REF_UNAVAILABLE',capability:'scene',at:15,message:'Choose a recalled reference'}
  ]}
  const mixed = JSON.stringify(context.ForkGalRuntimeStatus({...stageRuntimeIndicators(state), sceneError:'Failed to fetch'}))
  assert.match(mixed, /场景部分演出未应用/)
  assert.match(mixed, /所需素材不存在或当前不可用/)
  assert.match(mixed, /网络连接失败/)
  assert.doesNotMatch(mixed, /动作部分演出未应用|音乐部分演出未应用|Keep the current music|Enter this actor|Failed to fetch/)
})

// private fork: automatic corrections never become player failures; audit data is unchanged.
test('pacing and offstage presentation are silent; other preconditions and hard failures remain visible', () => {
  const state = createStageRuntimeState()
  const pacing = {dropped:true,code:'PACING',capability:'music',at:20,message:'Keep the current music'}
  const hard = {dropped:true,code:'PRECONDITION',capability:'acts',at:12,message:'Enter this actor first or choose a current cast actor.'}
  state.director.record = {diagnostics:[pacing,{code:'REF_ANNOTATION_IGNORED'},{code:'VARIANT_FALLBACK'}],stats:{droppedOps:1}}
  assert.deepEqual(stageRuntimeIndicators(state).drops,[])
  assert.equal(state.director.record.stats.droppedOps,1)
  assert.equal(state.director.record.diagnostics[0],pacing)
  const offstage = ['actor.act.play','actor.emote.play','closeup.play','dof.set'].map(command => ({...hard,command}))
  const otherPrecondition = {...hard,command:'actor.act.play',message:'Another precondition failed'}
  state.director.record = {diagnostics:[pacing,...offstage,otherPrecondition]}
  assert.deepEqual(stageRuntimeIndicators(state).drops,[otherPrecondition])
  assert.equal(state.director.record.diagnostics.length,6,'private fork: remaining soft drops stay in the audit record')
  state.director.record = {diagnostics:[pacing,hard]}
  assert.deepEqual(stageRuntimeIndicators(state).drops,[hard])
  assert.equal(stageDiagnosticText(hard),'目标人物尚未入场，无法执行此演出')
  for (const code of ['ARG_INVALID','REF_UNAVAILABLE','PRECONDITION','CAP_EXCEEDED','DISABLED','INTERNAL','FUTURE_FAILURE']) {
    assert.doesNotMatch(stageDiagnosticText({code,message:'Raw English validator text'}),/[a-zA-Z]/)
  }
  assert.equal(stageDiagnosticText(hard,true),'PRECONDITION: Enter this actor first or choose a current cast actor.')
})
