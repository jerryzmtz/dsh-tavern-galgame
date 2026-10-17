// private fork: 配音 panel task flow (docs/fork/panel-ui-design.md §三, docs/fork/tts-plugins.md).
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { voicePreset, hash } from '../src/core.js'
import { PROVIDER_KINDS } from '../src/providers/params.js'
import { qwenVoices, QWEN_MODELS } from '../src/providers/qwen.js'

const sources = await Promise.all(['../src/client.js','../../dsh-tts-local/src/client.js'].map(path => readFile(new URL(path,import.meta.url),'utf8')))
const keyed = {azure:'DSH_AZ',qwen:'DSH_QW',volcengine:'DSH_VO'}
export function fixture({sidebar = true, local = true, configured: initial, external = true, returnIntent, failNavigation = false, blockedStorage = false, readingsEditor, modelStatus = () => ({issues:[],modelInstructions:null})} = {}) {
  const services = new Map(), tabs = new Map(), slots = new Map(), effects = [], calls = [], opened = []
  // The panel remembers its basic/advanced mode in localStorage.
  const storage = new Map(), localStorage = {getItem:key => storage.get(key) ?? null,setItem:(key,value) => storage.set(key,String(value))}
  const session = new Map(returnIntent === undefined ? [] : [['dsh:settings-return',typeof returnIntent === 'string' ? returnIntent : JSON.stringify(returnIntent)]])
  const window = {sessionStorage:{getItem:key => {if (blockedStorage) throw Error('storage unavailable');return session.get(key) ?? null},setItem:(key,value) => session.set(key,value)}}
  let events, enabled = true, autoStart = false, bytes = 42, presets = [], cacheSettings = {cacheMaxGB:1,cacheMaxAgeDays:30}
  const keys = new Set(['azure-main','qwen-main','volc-main'])
  let configured = initial ?? [{id:'azure-main',kind:'azure',label:'Test Azure',config:{region:'eastasia'}},{id:'qwen-main',kind:'qwen',label:'Test Qwen',config:{region:'cn'}},{id:'volc-main',kind:'volcengine',label:'Test Volcengine',config:{appId:'test',resourceId:'seed-tts-2.0'}}]
  const checks = new Map()
  const listed = () => configured.map(p => ({...p,revision:hash(p),...(checks.has(p.id) ? {check:checks.get(p.id)} : {}),secrets:{[p.kind === 'volcengine' ? 'accessKey' : 'key']:{configured:keys.has(p.id),writable:true}}}))
  const voicesOf = kind => kind === 'fish-audio' ? {status:'ok',source:'manual',voices:[],models:[]} : kind === 'openai-compatible' ? {status:'ok',source:'live',voices:[{id:'alloy',label:'Alloy',languages:['en']}],models:[{id:'tts-1',label:'TTS 1'}]} : kind === 'qwen' ? {status:'ok',source:'builtin',voices:qwenVoices(),models:structuredClone(QWEN_MODELS)} :
    kind === 'azure' ? {status:'ok',source:'live',models:[],voices:[{id:'en-US-AshleyNeural',label:'Ashley',languages:['en'],gender:'Female'},{id:'ja-JP-NanamiNeural',label:'七海',languages:['ja'],gender:'Female'}]} :
    {status:'ok',source:'builtin',models:[],voices:[{id:'zh_female_cancan_mars_bigtts',label:'灿灿',languages:['zh','en'],gender:'Female'}]}
  class EventSource { constructor() { events = this } close() {} }
  const fail = code => ({ok:false,json:async () => ({error:code})})
  const fetch = async (url, options) => {
    if (url.includes('/synthesis')) {
      calls.push({url,method:'synthesis',options})
      return {ok:true,json:async () => options.method === 'POST' ? {requestId:'preview'} : {state:'ready',result:{ticket:'offline-ticket'}}}
    }
    const {method,args} = JSON.parse(options.body); calls.push({url,method,args})
    let result
    if (url.includes('dsh-tts-local')) {
      if (method === 'settings') result = {installationId:'default',installPath:'',pythonExecutable:'',workerScript:'',modelConfigPath:'',port:9883,readinessTimeoutMs:120000,autoStart}
      else if (method === 'saveSettings') {autoStart = args.autoStart; result = args}
      else result = {state:external ? 'ready' : 'stopped',voiceCount:external ? 17 : 0,configRevision:'revision',error:''}
    } else {
      if (method === 'services') result = {configured:listed(),running:[...configured.map(p => ({id:p.id,kind:p.kind,revision:'r',capabilities:{},status:{state:keys.has(p.id) ? 'configured' : 'credentials-required'}})),
        ...(external ? [{id:'local:default',kind:'reference',revision:'r',capabilities:{serviceVoiceEngines:['gpt-sovits']},status:{state:'ready',voiceCount:17,voiceTotal:17}}] : [])]}
      else if (method === 'providerKinds') result = PROVIDER_KINDS.filter(k => k.kind !== 'reference')
      else if (method === 'probeService') result = args.secrets?.key || keys.has(args.id) ? {...voicesOf(args.kind),status:'connected'} : {...voicesOf(args.kind),status:'credentials-required'}
      else if (method === 'saveService') {
        const next = {id:args.id,kind:args.kind,label:args.label,config:args.config}
        configured = [...configured.filter(p => p.id !== args.id),next]; if (args.secrets?.key) keys.add(args.id); result = listed().find(p => p.id === args.id)
      }
      else if (method === 'testService') { const p = configured.find(p => p.id === args.id); checks.set(args.id,{status:'connected',voiceCount:voicesOf(p.kind).voices.length}); result = {reachable:true} }
      else if (method === 'deleteService') {configured = configured.filter(p => p.id !== args.id); result = {deleted:true}}
      else if (method === 'providerVoices') result = args.serviceId === 'local:default' ? {status:'ok',source:'live',models:[],voices:[{id:'madoka/madoka',label:'鹿目圆',engine:'gpt-sovits',revision:'v1',languages:['ja'],state:'ready'}]} : voicesOf(configured.find(p => p.id === args.serviceId).kind)
      else if (method === 'voiceModelStatus') result = modelStatus(args)
      else if (method === 'voicePresets') result = presets.map(preset => ({preset,revision:hash(preset)}))
      else if (method === 'saveVoicePreset') {
        try {
          const preset = voicePreset(JSON.parse(JSON.stringify(args.preset))), old = presets.find(v => v.id === preset.id)
          if (old ? args.expectedRevision !== hash(old) : args.expectedRevision != null) throw Object.assign(Error(),{code:'REVISION_CONFLICT'})
          presets = [...presets.filter(v => v.id !== preset.id),preset]; result = {preset,revision:hash(preset)}
        } catch(e) {return fail(e.code || e.message)}
      }
      else if (method === 'deleteVoicePreset') {presets = presets.filter(v => v.id !== args.id); result = {deleted:true}}
      else if (method === 'importVoicePresets') {const added = args.presets.filter(p => !presets.some(v => v.id === p.id)); presets.push(...added.map(voicePreset)); result = {added:added.map(p => p.id),unchanged:[],conflicts:[]}}
      else if (method === 'editReading') result = {id:args.id,revision:args.expectedRevision + 1,op:args.op,index:0,count:1}
      else if (method === 'cache') result = {bytes,count:bytes ? 1 : 0,maxBytes:cacheSettings.cacheMaxGB * 1024 ** 3,maxAgeDays:cacheSettings.cacheMaxAgeDays}
      else if (method === 'saveCacheSettings') {cacheSettings = args; result = {saved:true}}
      else if (method === 'clearCache') {bytes = 0; result = {cleared:true}}
      else if (method === 'setEnabled') {enabled = args.enabled; events.onmessage({data:JSON.stringify({enabled})}); result = {enabled}}
      else result = {}
    }
    return {ok:true,json:async () => result}
  }
  // private fork (docs/fork/reading-dictionary.md): the Tavern plugin provides the 读音词典 editor.
  if (readingsEditor) services.set('ttsReadingsEditor',readingsEditor)
  if (sidebar) services.set('betterSidebar',{registerTab(tab) {assert.equal(tabs.has(tab.id),false);tabs.set(tab.id,tab);return () => tabs.delete(tab.id)},openTab(seed) {if (failNavigation) throw Error('navigation unavailable');opened.push(seed)}})
  const ctx = {
    provide(key,value) {assert.equal(services.has(key),false);services.set(key,value);return () => services.delete(key)},
    get:key => services.get(key), effect(fn) {const off = fn();effects.push(off);return off},
    inject(keys,fn) {if (keys.every(key => services.has(key))) fn(ctx)},
    slots:{inject(name,fn) {effects.push(fn())},register(descriptor,Panel) {assert.equal(slots.has(descriptor.id),false);slots.set(descriptor.id,Panel);return () => slots.delete(descriptor.id)}},
  }
  function load(source) {const exports = {}; vm.runInNewContext(source,{exports,require:() => React,fetch,EventSource,Set,Date,setTimeout,clearTimeout,setInterval,clearInterval,AbortController,localStorage,window,URL,Blob,document:globalThis.document});exports.apply(ctx)}
  if (local) load(sources[1])
  load(sources[0]); events.onmessage({data:JSON.stringify({enabled})})
  return {tabs,slots,calls,services,opened,storage,session,presets:() => presets,dispose:() => {for (const off of effects.reverse()) off?.()}}
}

export async function withDom(fn) {
  const dom = new JSDOM('<div id="root"></div>'), previous = {window:globalThis.window,document:globalThis.document,IS_REACT_ACT_ENVIRONMENT:globalThis.IS_REACT_ACT_ENVIRONMENT}
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true})
  const root = createRoot(document.getElementById('root'))
  try { await fn(root) } finally { await act(async () => root.unmount()); dom.window.close(); Object.assign(globalThis,previous) }
}
const button = text => [...document.querySelectorAll('button')].find(b => b.textContent === text)
const byLabel = label => document.querySelector('[aria-label="' + label + '"]')
// jsdom does not implement native text editing; invoke the rendered React handler.
const change = async (label,value) => { const input = typeof label === 'string' ? byLabel(label) : label; await act(async () => input[Object.keys(input).find(k => k.startsWith('__reactProps'))].onChange({target:{value}})) }
const click = async target => act(async () => (typeof target === 'string' ? button(target) : target).click())
const settle = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve,0)) })

// private fork (voice settings r3): rows are click-to-edit, problems are ⚠ chips, actions are icons / ⋯, a dashed ＋ adds.
const radio = (group,text) => [...(document.querySelector('[role=radiogroup][aria-label="' + group + '"]')?.querySelectorAll('[role=radio]') || [])].find(b => b.textContent === text)
const checked = group => document.querySelector('[role=radiogroup][aria-label="' + group + '"] [aria-checked=true]')?.textContent
const row = title => [...document.querySelectorAll('.dtts-line-main')].find(b => b.querySelector('.dtts-line-title')?.textContent === title)
const menuItem = text => [...document.querySelectorAll('[role=menuitem]')].find(b => b.textContent === text)
const openFold = async () => { const t = document.querySelector('.dtts-fold-toggle'); if (t.getAttribute('aria-expanded') !== 'true') await click(t) }

test('basic view: rows without grey subtitles, ⚠ only for problems, one local action; advanced reveals settings',async () => {
  const f = fixture()
  await withDom(async root => {
    assert.equal(f.tabs.size,1)
    const tab = f.tabs.get('dsh-tts:voice'); assert.equal(tab.title,'配音'); assert.equal(tab.single,true)
    assert.equal(tab.component,f.slots.get('tts'))
    await act(async () => {root.render(React.createElement(tab.component))}); await settle()
    const text = () => document.body.textContent
    assert.equal(byLabel('启用配音').checked,true)
    assert.ok(row('Test Azure')); assert.doesNotMatch(text(),/密钥已保存|尚未测试|configured|不计费|Azure 语音/)
    assert.equal(document.querySelectorAll('.dtts-list .dtts-warn').length,0,'nothing is wrong, so no chip')
    // The local connection registered as an id reads as 本地引擎; its raw id only in 高级.
    assert.ok(row('本地引擎')); assert.doesNotMatch(text(),/local:default/)
    // One action that fits the state; 重启 lives in ⋯.
    assert.ok(button('停止')); assert.ok(button('启动') === undefined); assert.ok(button('重启') === undefined)
    await click(byLabel('本地引擎 更多操作')); assert.ok(menuItem('重启')); await click(byLabel('本地引擎 更多操作'))
    assert.match(byLabel('本地引擎状态').textContent,/运行中 · 17 个音色/)
    // No text buttons on rows: ⋯ only (删除… inside it, UI standard R13); dashed ＋ without a label.
    for (const word of ['测试连接','编辑','复制','删除','添加服务','新建预设','指定给角色 ›']) assert.ok(button(word) === undefined, word)
    assert.ok(byLabel('Test Azure 更多操作')); assert.ok(byLabel('删除服务 Test Azure') === null, 'no resident delete'); assert.equal(byLabel('添加语音服务').textContent,''); assert.equal(byLabel('新建声音预设').textContent,'')
    assert.ok(document.querySelector('select,details') === null, 'no native select / disclosure')
    assert.equal(document.querySelectorAll('.dtts-hint, .dtts-head p, .dtts-toggle-text small, .dtts-item-meta').length,0)
    assert.match(document.querySelector('[role=tooltip]').textContent,/点一行修改/)
    assert.ok(byLabel('声音预设 更多操作') === null)
    assert.ok(document.querySelector('input[name="cacheMaxGB"]') === null)
    await click('高级'); await settle()
    assert.match(text(),/local:default/); assert.ok(document.querySelector('input[name="modelConfigPath"]'))
    await click(byLabel('声音预设 更多操作')); assert.ok(menuItem('导入…')); assert.ok(menuItem('导出')); await click(byLabel('声音预设 更多操作'))
    assert.match(byLabel('缓存用量').textContent,/42 B · 1 条/)
    const maxGB = document.querySelector('input[name="cacheMaxGB"]'), maxAge = document.querySelector('input[name="cacheMaxAgeDays"]')
    assert.equal(maxGB.value,'1'); assert.equal(maxAge.value,'30')
    await change(maxGB,'0.5'); await change(maxAge,'7'); await click('保存缓存设置')
    assert.deepEqual(f.calls.find(call => call.method === 'saveCacheSettings').args,{cacheMaxGB:0.5,cacheMaxAgeDays:7})
    const auto = byLabel('随 DSH Tavern 自动启动'); assert.equal(auto.checked,false)
    await click(auto); await click('保存设置')
    assert.ok(f.calls.some(call => call.url.includes('dsh-tts-local') && call.method === 'saveSettings' && call.args.autoStart === true))
    assert.equal(f.calls.some(call => ['start','stop','restart','testService','probeService'].includes(call.method)),false)
    const master = byLabel('启用配音')
    await click(master); assert.equal(master.checked,false); assert.equal(f.services.has('ttsClient'),false)
    await click(master); assert.equal(f.services.get('ttsClient').available(),true)
    await click('清空'); assert.match(byLabel('缓存用量').textContent,/0 B · 0 条/)
    assert.equal(f.calls.some(call => call.method === 'synthesis'),false)
  })
  f.dispose(); assert.equal(f.tabs.size,0); assert.equal(f.slots.size,0)
})

test('a missing key or a failed test is a ⚠ chip on the row; the stylesheet has no accent bars',async () => {
  const f = fixture({local:false,external:false,configured:[{id:'azure-x',kind:'azure',label:'No Key',config:{region:'eastasia'}},{id:'qwen-main',kind:'qwen',label:'Test Qwen',config:{region:'cn'}}]})
  await withDom(async root => {
    await act(async () => root.render(React.createElement(f.tabs.get('dsh-tts:voice').component))); await settle()
    const chips = [...document.querySelectorAll('.dtts-list .dtts-warn')]
    assert.deepEqual(chips.map(c => c.textContent),['未设置密钥'])
    assert.ok(row('No Key').closest('.dtts-line').contains(chips[0]))
  })
  f.dispose()
  const css = await readFile(new URL('../src/client.css',import.meta.url),'utf8')
  assert.doesNotMatch(css,/h3::before|border-left: 2px solid var\(--dtts-accent\)/)
})

test('reading dictionary: the page places the provided editor (advanced only) and preset edits invalidate voice clips',async () => {
  const props=[],f=fixture({readingsEditor:{render:p => {props.push(p);return p.advanced ? React.createElement('section',{'aria-label':'读音词典'},'editor') : null}}}),events=[]
  try {
    await withDom(async root => {
      await act(async()=>root.render(React.createElement(f.tabs.get('dsh-tts:voice').component)));await settle()
      assert.ok(!document.querySelector('[aria-label="读音词典"]'),'basic mode has no dictionary')
      await click('高级');await settle()
      assert.ok(document.querySelector('[aria-label="读音词典"]'));assert.equal(typeof props.at(-1).call,'function')
      assert.ok(!document.querySelector('.dtts-readings, [aria-label="全局读音"]'),'no second dictionary')
      f.services.get('ttsClient').subscribe(event => events.push(event.type))
      await props.at(-1).call('editReading',{id:'default',expectedRevision:0,op:'add',entry:{forms:'名',reading:'な'}})
      assert.deepEqual(events,['readingsChanged'])
      assert.equal(f.calls.some(call=>call.method==='synthesis'),false)
    })
  } finally {f.dispose()}
})

test('without optional sidebar or local plugin only the settings fallback is registered',async () => {
  const f = fixture({sidebar:false,local:false})
  await Promise.resolve()
  assert.equal(f.tabs.size,0);assert.equal(f.slots.size,1);assert.ok(f.slots.has('tts'))
  assert.equal(f.services.get('ttsClient').apiVersion,1)
  f.dispose();assert.equal(f.slots.size,0)
})

test('add service: dashed ＋ → type → name / region / key; explicit test shows the result; save never tests; two instances of one type',async () => {
  const f = fixture({configured:[],external:false})
  await withDom(async root => {
    await act(async () => root.render(React.createElement(f.tabs.get('dsh-tts:voice').component))); await settle()
    await click(byLabel('添加语音服务'))
    assert.deepEqual([...document.querySelectorAll('.dtts-kind')].map(b => b.textContent),['通义千问','Azure','Fish Audio','火山引擎','OpenAI 兼容','GPT-SoVITS','参考音频 API'])
    await click(radio('服务类型','通义千问'))
    assert.equal(byLabel('服务名称').value,'通义千问'); assert.equal(checked('区域'),'中国内地')
    assert.ok(byLabel('服务 ID') === null) // ids are advanced-only
    const key = byLabel('API Key'); assert.equal(key.type,'password'); assert.equal(key.autocomplete,'new-password')
    await click('测试连接'); await settle()
    assert.match(byLabel('测试结果').textContent,/还没有填写密钥/)
    await change('API Key','sk-test'); await click('测试连接'); await settle()
    assert.deepEqual(f.calls.filter(c => c.method === 'probeService').at(-1).args,{id:'qwen',kind:'qwen',config:{region:'cn'},secrets:{key:'sk-test'}})
    assert.match(byLabel('测试结果').textContent,/连接成功 · \d+ 个音色/)
    await change('服务名称','我的千问'); await click('保存'); await settle()
    assert.deepEqual(f.calls.find(c => c.method === 'saveService').args,{id:'qwen',kind:'qwen',label:'我的千问',config:{region:'cn'},secrets:{key:'sk-test'}})
    assert.equal(f.calls.some(c => c.method === 'testService'),false,'saving never makes a request to the provider')
    assert.ok(byLabel('API Key') === null); assert.ok(row('我的千问'))
    assert.equal(document.body.innerHTML.includes('sk-test'),false)
    // Click the row: the form opens right under it, key write-only.
    await click(row('我的千问'))
    assert.ok(row('我的千问').closest('li').querySelector('[aria-label="API Key"]') === byLabel('API Key'))
    assert.equal(byLabel('API Key').value,''); assert.equal(byLabel('API Key').placeholder,'已保存')
    await click('保存'); await settle()
    const resave = f.calls.filter(c => c.method === 'saveService').at(-1).args
    assert.equal('secrets' in resave,false); assert.ok(resave.expectedRevision)
    // A second 通义千问 gets its own id and credential.
    await click(byLabel('添加语音服务')); await click(radio('服务类型','通义千问'))
    assert.equal(byLabel('服务名称').value,'通义千问')
    await change('API Key','sk-two'); await click('保存'); await settle()
    assert.deepEqual(f.calls.filter(c => c.method === 'saveService').at(-1).args,{id:'qwen-2',kind:'qwen',label:'通义千问',config:{region:'cn'},secrets:{key:'sk-two'}})
    assert.ok(row('通义千问')); assert.ok(row('我的千问'))
    // ⋯ → 删除… → inline confirm → delete.
    await click(byLabel('我的千问 更多操作')); await click(menuItem('删除…')); assert.match(document.querySelector('.dtts-confirm').textContent,/删除「我的千问」？/)
    await click('删除'); await settle()
    assert.deepEqual(f.calls.find(c => c.method === 'deleteService').args.id,'qwen'); assert.ok(row('我的千问') === undefined)
    assert.equal(f.calls.some(c => c.method === 'synthesis'),false)
  })
  f.dispose()
})

test('new Bella preset defaults to available Flash: searchable voices, mood tweaks, explicit preview, copy/delete',async () => {
  const f = fixture({local:false})
  await withDom(async root => {
    await act(async () => root.render(React.createElement(f.tabs.get('dsh-tts:voice').component))); await settle()
    await click(byLabel('新建声音预设'))
    await click(radio('语音服务','Test Qwen')); await settle()
    assert.ok(f.calls.some(c => c.method === 'providerVoices' && c.args.serviceId === 'qwen-main'))
    assert.ok(byLabel('音色').querySelectorAll('[role=option]').length > 40)
    await change('搜索音色','萌宝')
    const options = [...byLabel('音色').querySelectorAll('[role=option]')]
    assert.equal(options.length,1); assert.match(options[0].textContent,/萌宝Bella/); assert.doesNotMatch(options[0].textContent,/支持风格指令/)
    await click(options[0])
    assert.equal(options[0].getAttribute('aria-selected'),'true'); assert.equal(byLabel('音色 ID').value,'Bella')
    assert.equal(byLabel('预设名称').value,'萌宝')
    assert.equal(checked('模型'),'Qwen3-TTS Flash')
    assert.doesNotMatch(byLabel('模型').textContent,/instruct/i)
    assert.ok(byLabel('风格说明') === null)
    assert.ok(byLabel('预设 ID') === null)
    await click('高级')
    await change('预设名称','大肥鱼'); await change('预设 ID','DeepSeek/Bad')
    await click('保存'); assert.match(byLabel('预设状态').textContent,/作品\/名称/)
    await change('预设 ID','deepseek-whale/dafeiyu')
    await openFold()
    await change('情绪 开心','语气雀跃'); await click([...document.querySelectorAll('.dtts-mood')].find(r => /难过/.test(r.textContent)).querySelector('button'))
    assert.equal(byLabel('情绪 难过').disabled,true)
    assert.ok(byLabel('情绪 平静') === null) // Qwen never instructs calm
    assert.equal(button('试听（付费）').className,'dtts-button is-paid')
    await click('保存'); await settle()
    const qwen = f.calls.filter(c => c.method === 'saveVoicePreset').at(-1).args
    assert.equal(qwen.expectedRevision,null)
    assert.deepEqual(qwen.preset,{schemaVersion:1,id:'deepseek-whale/dafeiyu',label:'大肥鱼',kind:'qwen',enabled:true,providerId:'qwen-main',languages:['zh','en','fr','de','ru','it','es','pt','ja','ko'],
      params:{voice:'Bella',model:'qwen3-tts-flash',moods:{joy:'语气雀跃',sad:null}}})
    await click('基础')
    const li = row('大肥鱼').closest('li')
    assert.equal(li.querySelector('.dtts-tag').textContent,'Test Qwen'); assert.doesNotMatch(li.querySelector('.dtts-line').textContent,/deepseek-whale|Bella/)
    assert.equal(f.calls.some(c => c.method === 'synthesis'),false)
    await click('试听（付费）'); await settle()
    const body = JSON.parse(f.calls.find(c => c.method === 'synthesis' && c.options.method === 'POST').options.body)
    assert.equal(body.scope,'voice-preset-preview'); assert.equal(body.input.voiceId,'deepseek-whale/dafeiyu'); assert.equal(body.input.text,'你好，这是声音预设试听。')
    assert.match(document.querySelector('audio').src,/offline-ticket/)
    // ⋯ → 复制 keeps parameters under a new id; clicking a row edits it and sends the revision.
    await click('高级')
    await click(byLabel('更多操作 大肥鱼')); await click(menuItem('复制'))
    assert.equal(byLabel('预设 ID').value,'deepseek-whale/dafeiyu-copy'); assert.equal(byLabel('预设名称').value,'大肥鱼（副本）')
    await click('保存'); await settle()
    assert.equal(f.presets().length,2); assert.equal(f.presets()[1].params.model,'qwen3-tts-flash')
    await click(row('大肥鱼')); await settle()
    assert.equal(byLabel('预设 ID').disabled,true); assert.ok(byLabel('风格说明') === null)
    await click('保存'); await settle()
    const edited = f.calls.filter(c => c.method === 'saveVoicePreset').at(-1).args
    assert.ok(edited.expectedRevision); assert.equal(edited.preset.params.model,'qwen3-tts-flash'); assert.equal('instructions' in edited.preset.params,false)
    await click(byLabel('更多操作 大肥鱼（副本）')); await click(menuItem('删除')); await click('删除'); await settle()
    assert.equal(f.presets().length,1)
    assert.equal(f.calls.filter(c => c.method === 'synthesis' && c.options.method === 'POST').length,1)
  })
  f.dispose()
})

test('single Qwen service also defaults to Flash; existing instruct presets are preserved until explicitly changed',async () => {
  const f = fixture({local:false,external:false,configured:[{id:'qwen-main',kind:'qwen',label:'Test Qwen',config:{region:'cn'}}]})
  f.presets().push({schemaVersion:1,id:'legacy/bella',label:'Legacy Bella',kind:'qwen',enabled:true,providerId:'qwen-main',languages:['zh'],params:{voice:'Bella',model:'qwen3-tts-instruct-flash',instructions:'声音软糯'}})
  await withDom(async root => {
    await act(async () => root.render(React.createElement(f.tabs.get('dsh-tts:voice').component))); await settle()
    await click(byLabel('新建声音预设')); await settle()
    assert.equal(checked('模型'),'Qwen3-TTS Flash')
    assert.doesNotMatch(byLabel('模型').textContent,/instruct/i)
    await click('取消')
    await click('高级'); await click(row('Legacy Bella')); await settle()
    assert.equal(checked('模型'),'qwen3-tts-instruct-flash')
    assert.equal(byLabel('风格说明').value,'声音软糯')
    await click('保存'); await settle()
    assert.equal(f.presets()[0].params.model,'qwen3-tts-instruct-flash')
    assert.equal(f.presets()[0].params.instructions,'声音软糯')
    await click(radio('模型','Qwen3-TTS Flash')); assert.ok(byLabel('风格说明') === null)
    await click('保存'); await settle()
    const edited = f.calls.filter(c => c.method === 'saveVoicePreset').at(-1).args
    assert.ok(edited.expectedRevision)
    assert.equal(edited.preset.params.model,'qwen3-tts-flash')
    assert.equal('instructions' in edited.preset.params,false)
    assert.equal(f.calls.some(c => c.method === 'synthesis'),false)
  })
  f.dispose()
})

test('Azure, Volcengine and local service presets map their own parameters; import/export are advanced',async () => {
  const f = fixture({local:false})
  await withDom(async root => {
    await act(async () => root.render(React.createElement(f.tabs.get('dsh-tts:voice').component))); await settle()
    await click('高级'); await click(byLabel('新建声音预设'))
    await click(radio('语音服务','Test Azure')); await settle()
    await click([...byLabel('音色').querySelectorAll('[role=option]')].find(o => /Ashley/.test(o.textContent)))
    await change('预设 ID','neuro-sama/neuro'); await change('预设名称','Neuro'); await change('音高（%）','25'); await change('语速（%）','8')
    assert.equal(byLabel('语言').value,'en')
    await openFold(); await change('其他情绪（JSON）','{"smug":"cheerful"}')
    await click('保存'); await settle()
    assert.deepEqual(f.calls.filter(c => c.method === 'saveVoicePreset').at(-1).args.preset.params,{voiceName:'en-US-AshleyNeural',pitch:25,rate:8,moods:{smug:'cheerful'}})
    await click('取消'); await click(row('Neuro')); await settle(); await change('音高（%）','999'); await click('保存'); await settle()
    assert.match(byLabel('预设状态').textContent,/INVALID_PARAMS/)
    await click('取消')
    await click(byLabel('新建声音预设')); await click(radio('语音服务','Test Volcengine')); await settle()
    await click(byLabel('音色').querySelector('[role=option]'))
    await change('预设 ID','work/volc'); await change('语速','10'); await click('保存'); await settle()
    assert.deepEqual(f.calls.filter(c => c.method === 'saveVoicePreset').at(-1).args.preset.params,{speaker:'zh_female_cancan_mars_bigtts',speechRate:10})
    await click('取消')
    await click(byLabel('新建声音预设')); await click(radio('语音服务','本地引擎')); await settle()
    assert.ok(document.querySelector('.dtts-fold') === null); assert.ok(byLabel('音色 ID') === null)
    assert.ok(button('试听')); assert.ok(button('试听（付费）') === undefined) // local engines are not billed
    await click(byLabel('音色').querySelector('[role=option]'))
    await change('预设 ID','madoka/madoka-soft')
    await click('保存'); await settle()
    const service = f.calls.filter(c => c.method === 'saveVoicePreset').at(-1).args.preset
    assert.deepEqual([service.kind,service.voiceId,service.engine,service.revision,service.providerId,service.label],['service','madoka/madoka','gpt-sovits','v1','local:default','鹿目圆'])
    const input = document.querySelector('input[type=file]')
    const file = {text:async () => JSON.stringify({version:1,presets:[{schemaVersion:1,id:'other/voice',label:'Other',enabled:true,kind:'qwen',languages:['zh'],params:{voice:'Cherry'}}]})}
    await act(async () => input[Object.keys(input).find(k => k.startsWith('__reactProps'))].onChange({target:{files:[file],value:''}})); await settle()
    assert.deepEqual(f.calls.find(c => c.method === 'importVoicePresets').args.presets.map(p => p.id),['other/voice'])
    assert.match(byLabel('预设状态').textContent,/导入 1 个/)
    assert.equal(f.calls.some(c => c.method === 'synthesis'),false)
  })
  f.dispose()
})

// private fork: G14-G15, basic presets need no hand-written IDs.
test('basic custom preset selects a listed model, auto-generates a unique ID and keeps it stable on edit',async () => {
  const f = fixture({local:false,external:false,configured:[{id:'custom',kind:'openai-compatible',label:'Custom',config:{url:'https://speech.invalid'}}]})
  await withDom(async root => {
    await act(async () => root.render(React.createElement(f.tabs.get('dsh-tts:voice').component))); await settle()
    await click(byLabel('新建声音预设')); await settle()
    await click(byLabel('音色').querySelector('[role=option]'))
    assert.ok(byLabel('预设 ID') === null)
    await click(radio('模型','TTS 1')); await change('语速倍率','1.2'); await change('风格说明','Calm')
    await click('保存'); await settle()
    assert.equal(f.presets()[0].id,'custom-presets/alloy')
    assert.deepEqual(f.presets()[0].params,{voice:'alloy',model:'tts-1',speed:1.2,instructions:'Calm'})
    await change('预设名称','New name'); await click('保存'); await settle()
    assert.equal(f.presets()[0].id,'custom-presets/alloy')
    await click('取消'); await click(byLabel('新建声音预设')); await settle()
    await click(byLabel('音色').querySelector('[role=option]')); await click(radio('模型','TTS 1'))
    await click('保存'); await settle()
    assert.equal(f.presets()[1].id,'custom-presets/alloy-2')
    for (let i = 0; i < 2; i++) { await click(byLabel('更多操作 New name')); await click(menuItem('复制')); await click('保存'); await settle() }
    assert.deepEqual(f.presets().slice(2).map(p => p.id),['custom-presets/alloy-copy','custom-presets/alloy-copy-2'])
    assert.equal(f.calls.some(c => c.method === 'synthesis'),false)
  })
  f.dispose()
})

// private fork (settings polish, owner 2026-10): the return is the header's ‹ icon button, named by the intent label.
test('generic return intent keeps payload for destination and marks consumption only on click',async () => {
  const intent = {toTab:'example:characters',label:'返回舞台设置',payload:{characterId:'character-7'},createdAt:Date.now()}
  const f = fixture({returnIntent:intent,local:false})
  await withDom(async root => {
    await act(async () => root.render(React.createElement(f.tabs.get('dsh-tts:voice').component))); await settle()
    assert.ok(byLabel('返回舞台设置'))
    assert.deepEqual(JSON.parse(f.session.get('dsh:settings-return')),intent)
    await click(byLabel('返回舞台设置'))
    assert.deepEqual(JSON.parse(JSON.stringify(f.opened)),[{type:'example:characters'}])
    assert.deepEqual(JSON.parse(f.session.get('dsh:settings-return')),{...intent,consumedBy:'dsh-tts'})
    assert.ok(byLabel('返回舞台设置') === null)
  })
  f.dispose()
})

test('return intent rejects malformed, expired, future and consumed values; unmount does not consume',async () => {
  const fresh = {toTab:'example:characters',label:'Return',payload:{characterId:'c'},createdAt:Date.now()}
  for (const intent of ['invalid',{}, {...fresh,createdAt:Date.now()-600001},{...fresh,createdAt:Date.now()+600001},{...fresh,consumedBy:'dsh-tts'},{...fresh,toTab:'javascript:alert(1)'}]) {
    const f = fixture({returnIntent:intent,local:false})
    await withDom(async root => {
      await act(async () => root.render(React.createElement(f.tabs.get('dsh-tts:voice').component))); await settle()
      assert.ok(byLabel('Return') === null)
    })
    assert.equal(f.opened.length,0); f.dispose()
  }
  const f = fixture({returnIntent:fresh,local:false})
  await withDom(async root => { await act(async () => root.render(React.createElement(f.tabs.get('dsh-tts:voice').component))); await settle(); assert.ok(byLabel('Return')) })
  assert.deepEqual(JSON.parse(f.session.get('dsh:settings-return')),fresh); f.dispose()
})

// private fork: failure paths remain recoverable and never consume a newer opener's intent.
test('return intent survives failed navigation, ignores replacement and tolerates unavailable storage',async () => {
  const intent = {toTab:'example:characters',label:'Return',payload:{characterId:'c'},createdAt:Date.now()}
  const f = fixture({returnIntent:intent,failNavigation:true,local:false})
  await withDom(async root => {
    await act(async () => root.render(React.createElement(f.tabs.get('dsh-tts:voice').component))); await settle()
    await click(byLabel('Return'))
    assert.deepEqual(JSON.parse(f.session.get('dsh:settings-return')),intent)
    assert.ok(byLabel('Return'));assert.match(byLabel('配音状态').textContent,/暂时无法返回/)
    const replacement = {...intent,payload:{characterId:'other'}}
    f.session.set('dsh:settings-return',JSON.stringify(replacement));await click(byLabel('Return'))
    assert.ok(byLabel('Return') === null)
    assert.deepEqual(JSON.parse(f.session.get('dsh:settings-return')),replacement)
  })
  f.dispose()
  const blocked = fixture({returnIntent:intent,blockedStorage:true,local:false})
  await withDom(async root => {
    await act(async () => root.render(React.createElement(blocked.tabs.get('dsh-tts:voice').component)));await settle()
    assert.ok(byLabel('Return') === null)
  })
  blocked.dispose()
})

test('GPT-SoVITS basic preset uses reference audio rather than an invented voice list',async () => {
  const f = fixture({local:false,external:false,configured:[{id:'gpt-sovits',kind:'gpt-sovits-api',label:'GPT-SoVITS',config:{url:'http://127.0.0.1:9880'}}]})
  await withDom(async root => {
    await act(async () => root.render(React.createElement(f.tabs.get('dsh-tts:voice').component)));await settle()
    await click(byLabel('新建声音预设'));await settle()
    assert.ok(byLabel('音色') === null);assert.ok(byLabel('预设 ID') === null)
    await change('预设名称','Reference');await change('参考音频路径','reference.wav');await change('参考原文','Hello');await click(radio('参考语言','en'))
    await click('保存');await settle()
    assert.deepEqual(f.presets()[0],{schemaVersion:1,id:'gpt-sovits-presets/reference',label:'Reference',kind:'gpt-sovits-api',enabled:true,providerId:'gpt-sovits',languages:['en'],params:{refAudioPath:'reference.wav',promptText:'Hello',promptLang:'en',speedFactor:1,textSplitMethod:'cut5'}})
    assert.equal(f.calls.some(c => c.method === 'synthesis'),false)
  })
  f.dispose()
})

// private fork: Fish setup never synthesizes until explicit preview, and the free default is visible.
test('Fish service defaults to free; manual voice ID preset saves and previews without paid label',async () => {
  const f = fixture({configured:[],external:false,local:false})
  await withDom(async root => {
    await act(async () => root.render(React.createElement(f.tabs.get('dsh-tts:voice').component))); await settle()
    await click(byLabel('添加语音服务'))
    await click(radio('服务类型','Fish Audio'))
    assert.ok(byLabel('Base URL') === null, 'the default base URL is an advanced field')
    assert.deepEqual([...document.querySelectorAll('[role=radiogroup][aria-label="模型"] [role=radio]')].map(o => o.textContent),['S2.1 Pro Free（免费）','S2.1 Pro（计费）'])
    assert.equal(checked('模型'),'S2.1 Pro Free（免费）')
    await change('API Key','fake-fish-key'); await click('保存'); await settle()
    const service = f.calls.find(c => c.method === 'saveService').args
    assert.equal(service.kind,'fish-audio');assert.deepEqual(service.config,{url:'https://api.fish.audio',model:'s2.1-pro-free'})
    assert.equal(f.calls.some(c => c.method === 'synthesis'),false)
    await click(byLabel('新建声音预设')); await settle()
    await change('音色 ID','public-voice'); await change('预设名称','My Fish')
    await change('语速倍率','1.2'); await click('保存'); await settle()
    assert.equal(f.presets()[0].params.referenceId,'public-voice')
    assert.equal(f.presets()[0].params.speed,1.2)
    assert.equal(f.presets()[0].params.model,undefined)
    assert.ok(button('试听'));assert.ok(button('试听（付费）') === undefined)
    await click('试听'); await settle()
    assert.ok(f.calls.some(c => c.method === 'synthesis'))
    assert.equal(document.body.innerHTML.includes('fake-fish-key'),false)
  })
  f.dispose()
})

test('confirmed model and voice warnings survive save; known non-instruct moods are unused',async () => {
  const f=fixture({local:false,modelStatus:({model,voiceName})=>({modelInstructions:model==='qwen3-tts-flash'?false:true,
    issues:voiceName==='Bella'?[{code:model==='qwen3-tts-flash'?'QWEN_VOICE_UNSUPPORTED':'QWEN_MODEL_NOT_FOUND',field:model==='qwen3-tts-flash'?'voice':'model'}]:[]})})
  f.presets().push({schemaVersion:1,id:'legacy/confirmed',label:'Confirmed',kind:'qwen',enabled:true,providerId:'qwen-main',languages:['zh'],params:{voice:'Cherry',model:'qwen3-tts-instruct-flash'}})
  await withDom(async root=>{
    await act(async()=>root.render(React.createElement(f.tabs.get('dsh-tts:voice').component)));await settle()
    await click(row('Confirmed'));await settle()
    assert.ok(byLabel('模型警告说明') === null, 'no synthesis evidence means no warning')
    await change('音色 ID','Bella');await settle()
    assert.ok(byLabel('模型警告说明'))
    assert.ok([...document.querySelectorAll('.dtts-field')].find(el=>el.textContent.includes('模型')&&el.textContent.includes('⚠')))
    assert.ok(byLabel('音色警告说明') === null)
    await click('保存');await settle()
    assert.equal(f.presets().length,1);assert.ok(byLabel('模型警告说明'),'saving keeps evidence visible')
    await click(radio('模型','Qwen3-TTS Flash'));await settle()
    assert.ok(byLabel('模型警告说明') === null);assert.ok(byLabel('音色警告说明'))
    assert.match(document.querySelector('.dtts-fold-head').textContent,/未使用/)
    assert.ok(document.querySelector('select') === null)
    assert.equal(f.calls.some(c=>c.method==='synthesis'),false)
  })
  f.dispose()
})
