// private fork: exercise the real voice panel against the configured/running service contract.
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFile} from 'node:fs/promises'
import {assetRenderer,walk,text} from './fixtures/asset-editor-renderer.mjs'
import {voicePreset} from '../tavern-plugin/packages/dsh-tts/src/core.js'
const source = await readFile(new URL('../tavern-plugin/packages/dsh-tts/src/client.js',import.meta.url),'utf8')

test('externally registered local service is listed and creates a portable preset from its catalogue',async t => {
  const r=assetRenderer(),exports={},effects=[],calls=[];let Panel,saved
  t.after(()=>{r.dispose();effects.forEach(fn=>fn?.())})
  const voice={id:'madoka/test',label:'Test voice',engine:'gpt-sovits',revision:'r1',languages:['ja'],serviceId:'local-service',modelSetId:'model-set',modelVersion:'v1',params:{speed_factor:1},state:'ready'}
  const services={configured:[],running:[{id:'local-service',kind:'reference',capabilities:{serviceVoiceEngines:['gpt-sovits']},status:{state:'ready',voiceCount:1,voiceTotal:1}}]}
  const fetch=async (_url,options)=>{
    const {method,args}=JSON.parse(options.body);calls.push({method,args})
    const values={services,providerKinds:[],providerVoices:{status:'ok',source:'live',models:[],voices:[voice]},voicePresets:[],voices:[voice],cache:{maxBytes:1024**3,maxAgeDays:30,bytes:0,count:0}}
    if(method==='saveVoicePreset'){saved=voicePreset(args.preset);return {ok:true,json:async()=>({preset:saved,revision:'saved'})}}
    assert.ok(Object.hasOwn(values,method),'unexpected request: '+method)
    return {ok:true,json:async()=>values[method]}
  }
  // private fork: shared Button forwards children through props, as real React supports.
  const React={...r.React,createElement:(type,props,...children)=>r.React.createElement(type,props,...(children.length ? children : [props?.children])),useSyncExternalStore:(_subscribe,get)=>get()}
  // private fork: service editing lives in the persisted advanced panel mode.
  const localStorage={getItem:()=> 'advanced',setItem:()=>{}}
  vm.runInNewContext(source,{exports,require:()=>React,fetch,EventSource:class{close(){}},AbortController,Date,Set,setTimeout,localStorage})
  const slots={inject:(_name,fn)=>fn(),register:(_options,view)=>{Panel=view}}
  exports.apply({slots,effect:fn=>effects.push(fn()),inject:()=>{}})
  r.render(Panel);let tree=await r.settle()
  // private fork: localized service copy and an explicitly opened preset editor.
  assert.match(text(tree),/local-service/)
  // private fork: the external server is a service row with its live status, not a raw id (docs/fork/tts-plugins.md).
  assert.match(text(tree),/本地引擎/); assert.doesNotMatch(text(tree),/运行中 · 1 个音色/) // private fork (voice settings r3): no status subtitles
  walk(tree).find(n=>n.type==='button'&&n.props['aria-label']==='新建声音预设').props.onClick();tree=await r.settle() // private fork: dashed ＋
  const field=label=>walk(tree).find(n=>n.props['aria-label']===label)
  // private fork (voice settings r3): the provider is a chip in a radiogroup, not a native select.
  const chip=walk(field('语音服务')).find(n=>n.props.role==='radio'&&text(n)==='本地引擎')
  assert.ok(chip); chip.props.onClick();tree=await r.settle()
  const option=walk(field('音色')).find(n=>n.props.role==='option'&&/madoka\/test/.test(text(n)))
  option.props.onClick();tree=await r.settle()
  field('预设 ID').props.onChange({target:{value:'work/test'}})
  field('预设名称').props.onChange({target:{value:'Saved fixture'}});tree=await r.settle()
  await walk(tree).find(n=>n.type==='button'&&text(n)==='保存').props.onClick();tree=await r.settle()
  assert.equal(saved.providerId,'local-service');assert.equal(saved.kind,'service')
  assert.equal(saved.voiceId,voice.id);assert.equal(saved.engine,voice.engine);assert.equal(saved.revision,voice.revision)
  assert.equal(saved.modelSetId,voice.modelSetId);assert.deepEqual(saved.languages,['ja'])
  assert.deepEqual(saved.params,{speed_factor:1})
  assert.ok(calls.every(c=>!['saveService','deleteService','testService','synthesize'].includes(c.method)))
})
