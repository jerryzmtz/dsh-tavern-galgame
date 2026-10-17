// private fork: plugins own their tabs; optional TTS service lifetime silences playback.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'
const source = await readFile(new URL('../tavern-plugin/src/client/fork-asset-launcher.js',import.meta.url),'utf8')

test('workbench owns transport and optional TTS service lifetime, not a header slot', () => {
  let started=0, disposed=0, listener, rateListener, ttsOff=0, rateOff=0, invalidated=0
  const effects=[], enabled=[], provided=[], rates=[]
  const transport={start(){started++},dispose(){disposed++},service:{subscribe(fn){listener=fn;return()=>{listener=null}}}}
  const context={React:{},ForkBubbleLibraryPicker(){},ForkPackImage(){},FORK_BUBBLE_MOODS:[],FORK_BUBBLE_PALETTE:[],FORK_CUSTOM_MOOD_MAX:8,forkEmotionUpsert(){},forkCustomMoodColors:ids=>ids.map(()=>'#000000'),createForkAssetPackUI:()=>({}),createForkPackTransport:()=>transport,forkVoicePlayer:{setEnabled(value){enabled.push(value)},setRate(value){rates.push(value)},invalidate(){invalidated++}},forkStageReading:{get:()=>({voiceRate:1.4}),subscribe(fn){rateListener=fn;return()=>rateOff++}}}
  vm.runInNewContext('let forkTtsScope;'+source,context)
  const child={get(name){assert.equal(name,'ttsClient');return {subscribe(){return()=>ttsOff++}}},effect(fn){effects.push(fn())}}
  context.installTavernAssetLaunchers({inject(names,fn){assert.deepEqual([...names],['ttsClient']);fn(child)},provide(name,value){provided.push([name,value])},effect(fn){effects.push(fn())}}, {register(){assert.fail('No header slot')}})
  assert.equal(started,1);assert.deepEqual(enabled,[true]);assert.equal(provided[0][0],'assetPackWorkbench')
  rateListener();assert.deepEqual(rates,[1.4])
  listener({type:'pack'});for(const stop of effects.reverse())stop()
  assert.equal(disposed,1);assert.equal(listener,null);assert.deepEqual(enabled,[true,false]);assert.equal(ttsOff,1);assert.equal(rateOff,1);assert.equal(invalidated,1)
})

test('asset-library client registers exactly one right-side library tab through the workbench port',async()=>{
  const client=await readFile(new URL('../tavern-plugin/packages/dsh-asset-library/src/client.cjs',import.meta.url),'utf8'), exports={},tabs=[],effects=[]
  vm.runInNewContext(client,{exports})
  exports.apply({effect(fn){effects.push(fn())},get(name){return name==='betterSidebar'?{registerTab(tab){tabs.push(tab);return()=>tabs.pop()}}:{render:props=>props}}})
  // private fork (owner 2026-10): the fork's asset library is 「舞台素材」, apart from upstream's 「剧本与素材库」.
  assert.equal(tabs.length,1);assert.equal(tabs[0].title,'舞台素材');assert.equal(tabs[0].id,'dsh-asset-library:library')
  assert.deepEqual(tabs[0].component({scope:{sessionId:'s'}}),{scope:{sessionId:'s'}})
  effects[0]();assert.equal(tabs.length,0)
})

// private fork: the stage owns card context; the independent library gets pack navigation and (owner 2026-10 r4) only the
// open chat's card path, read for pack state — never a card editor or a stage page.
test('stage tab renders one stage panel with global and debug slots; library gets nav and the open card path only', () => {
  const h=(type,props,...children)=>({type,props:props||{},children:children.flat()})
  const forkPackUi={App:'App',StagePanel:'StagePanel',EnginePage:'EnginePage'},bubbles={s:{cardPath:'cards/a.png',cardName:'A',instruction:'FORMAT'}}
  const context={React:{createElement:h,useMemo:fn=>fn(),useEffect(){},useSyncExternalStore:(subscribe,get)=>get(),Fragment:'Fragment'},ForkBubbleLibraryPicker(){},ForkPackImage(){},FORK_BUBBLE_MOODS:[],FORK_BUBBLE_PALETTE:[],FORK_CUSTOM_MOOD_MAX:8,forkEmotionUpsert(){},forkCustomMoodColors:ids=>ids.map(()=>'#000000'),ForkStageDialogueEditor:'DialogueEditor',useForkDirectorPreview:()=>[{loading:false,error:'',result:{sections:[]}},()=>{}],forkResetDialogueInjection:sessionId=>'reset:'+sessionId,ForkHelpTip:'HelpTip',createForkAssetPackUI:()=>forkPackUi,useForkBubbles:sessionId=>bubbles[sessionId],rpc(){},forkTtsScope:undefined,createForkAssetPackBinding:()=>({})}
  vm.runInNewContext('let forkTtsScope;'+source+';this.stage=ForkTavernStageTab;this.library=ForkAssetLibraryTab;this.workbench=ForkPackWorkbench;',context)
  const stage=context.stage({scope:{sessionId:'s'}});assert.equal(stage.props.page,'stage');assert.equal(stage.props.cardPath,'cards/a.png');assert.equal(stage.props.loading,false)
  const tree=context.workbench(stage.props);assert.equal(tree.type,'StagePanel');assert.equal(tree.props.cardName,'A');assert.equal(typeof tree.props.nav.openTab,'function');assert.equal(typeof tree.props.nav.openLibrary,'function')
  // private fork (owner 2026-10 r3): one 提示词 adapter replaces the 全局设置 rows and the 调试 view.
  const prompts=stage.props.prompts,read=prompts.usePrompts();assert.equal(tree.props.prompts,prompts)
  assert.deepEqual(JSON.parse(JSON.stringify(read.story)),{parts:[{key:'format',text:'FORMAT',tokens:null}],custom:false,entries:null,userName:''});assert.equal(read.director.result.sections.length,0) // private fork (prompt view complete): the worldbook's bubble entries ride along
  const editor=prompts.dialogueEditor(()=>{});assert.equal(editor.type,'DialogueEditor');assert.equal(editor.props.sessionId,'s');assert.equal(prompts.resetDialogue(),'reset:s')
  const library=context.library({scope:{sessionId:'s'}});assert.equal(library.props.cardPath,'cards/a.png');assert.equal(library.props.page,undefined);assert.equal(library.props.currentCard,undefined);assert.equal(library.props.cardName,undefined)
  const app=context.workbench(library.props);assert.equal(app.type,'App');assert.equal(typeof app.props.nav.take,'function');assert.equal(app.props.openStage,undefined);assert.equal(app.props.cardPath,'cards/a.png');assert.equal(app.props.sessionId,'s')
  // Without a chat there is no card at all (global state only).
  const none=context.library({scope:{}});assert.equal(none.props.cardPath,undefined);assert.equal(context.workbench(none.props).props.cardPath,undefined)
  assert.equal(context.stage({scope:{sessionId:'other'}}).props.loading,true)
})

test('workbench uses v2 binary port without TTS settings links, global voice switch or duplicate editors',async()=>{
  assert.match(source,/createForkAssetPackBinding/);assert.match(source,/readExport:result => transport.bytes\(result\)/)
  assert.doesNotMatch(source,/conversation\.session\.header|onEnabledChange|assetLibraryClient|renderVoices/)
  const voice=await readFile(new URL('../tavern-plugin/src/client/fork-voice.js',import.meta.url),'utf8')
  const engine=await readFile(new URL('../tavern-plugin/src/client/fork-asset-pack-engine-ui.js',import.meta.url),'utf8')
  assert.doesNotMatch(voice,/forkVoiceGlobal|getDialogueVoicePrefs|saveDialogueVoicePrefs|onEnabledChange/)
  assert.doesNotMatch(engine,/openTts|打开 TTS/);assert.match(engine,/voiceServices/)
})
