// private fork (voice settings r3): screenshots of the global 配音 tab, every HTTP/RPC mocked in the page.
// No DSH process, no network, no synthesis, no paid call. Seeds the services the owner's machine has
// (通义千问 / Azure / Fish + the local engine registered as 「default」) plus two presets.
//   node tavern-plugin/packages/dsh-tts/tests/harness/settings-r3.mjs <before|after> [outputDir]
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { PROVIDER_KINDS } from '../../src/providers/params.js'
import { createRequire } from 'node:module'
import { readFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url)), pkg = join(here, '../..')
const phase = process.argv[2] || 'after'
const out = join(process.argv[3] || './output/voice-settings-r3', phase)
mkdirSync(out, { recursive: true })
const require = createRequire(import.meta.url)
const roots = [process.env.TTS_HARNESS_DEPS, join(process.cwd(), 'node_modules')].filter(Boolean)
const dir = name => { const found = [() => dirname(require.resolve(name + '/package.json')), ...roots.map(root => () => join(root, name))].map(f => { try { return f() } catch {} }).find(d => d && existsSync(join(d, 'cjs', (name === 'react-dom' ? 'react-dom-client' : name) + '.production.js'))); if (!found) throw new Error('React 19 ' + name + ' not found; set TTS_HARNESS_DEPS'); return found }
const read = path => readFileSync(path, 'utf8')
const modules = { react: join(dir('react'), 'cjs/react.production.js'), scheduler: join(dir('scheduler'), 'cjs/scheduler.production.js'),
  'react-dom': join(dir('react-dom'), 'cjs/react-dom.production.js'), 'react-dom/client': join(dir('react-dom'), 'cjs/react-dom-client.production.js') }
const runtime = 'var process={env:{NODE_ENV:"production"}};var __defs={},__cache={};function __require(n){if(__cache[n])return __cache[n].exports;var m=__cache[n]={exports:{}};__defs[n](m,m.exports,__require);return m.exports}\n' +
  Object.entries(modules).map(([name, path]) => '__defs[' + JSON.stringify(name) + ']=function(module,exports,require){' + read(path) + '\n};').join('\n')
const qwenVoices = JSON.parse(read(join(pkg, 'src/shared/qwen-voices.json')))

const page$ = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #141414; font-family: "Segoe UI", "Microsoft YaHei UI", "PingFang SC", sans-serif; }
  .host { width: var(--w, 640px); height: 100vh; margin: 0 0 0 auto; background: #1b1b1b; border-left: 1px solid #2a2a2a;
    --dsw-alias-label-primary: #ececec; --dsw-alias-label-secondary: #b4b4b4; --dsw-alias-label-tertiary: #858585;
    --dsw-alias-border-l2: #ffffff17; --dsw-alias-border-l3: #ffffff2b; --dsw-alias-brand-primary: #6b9bf2;
    --dsw-alias-bg-layer-1: #232323; --dsw-alias-bg-base: #2b2b2b; --dsw-alias-interactive-bg-hover: #ffffff0f;
    --dsw-alias-button-primary-fill: #ececec; --dsw-alias-label-primary-foreground: #141414;
    --dsw-alias-state-success-primary: #5bbf86; --dsw-alias-state-error-primary: #f2706a; --dsw-alias-state-warning-primary: #e2a64a; }
</style></head><body><div class="host" id="host"></div><script>${runtime}</script><script>
  var React = __require('react'), ReactDOMClient = __require('react-dom/client')
  window.__QWEN__ = ${JSON.stringify(qwenVoices)}
  window.__modules = []
  window.__ModuleLoader__ = { load: function (m) { window.__modules.push(m.factory(function () { return React })) } }
</script><script src="/mock.js"></script><script src="/tts-local.js"></script><script src="/tts.js"></script><script src="/boot.js"></script></body></html>`

const mock = `(() => {
  const langs = ['zh','en','fr','de','ru','it','es','pt','ja','ko']
  const qwen = () => ({status:'ok',source:'builtin',voices:window.__QWEN__.map(v => ({...v,languages:langs})),
    models:[{id:'qwen3-tts-instruct-flash',label:'Qwen3-TTS Instruct Flash',instruct:true},{id:'qwen3-tts-flash',label:'Qwen3-TTS Flash',instruct:false}]})
  const azure = () => ({status:'ok',source:'live',models:[],voices:[['en-US-AshleyNeural','Ashley','en','Female'],['en-US-AriaNeural','Aria','en','Female'],['ja-JP-NanamiNeural','七海','ja','Female'],['ja-JP-KeitaNeural','圭太','ja','Male'],['zh-CN-XiaoxiaoNeural','晓晓','zh','Female'],['zh-CN-YunxiNeural','云希','zh','Male']].map(([id,label,l,gender]) => ({id,label,languages:[l],gender}))})
  const fish = () => ({status:'ok',source:'builtin',search:true,models:[{id:'s2.1-pro-free',label:'S2.1 Pro Free'},{id:'s2.1-pro',label:'S2.1 Pro'}],voices:[['822da156d6474fca904d3f326a5b0794','xiang830'],['54a5170264694bfc8e9ad98df7bd89c3','丁真'],['e58b0d7efca34eb38d5c4985e378abcb','王琨']].map(([id,label]) => ({id,label,languages:['zh']}))})
  const kinds = ${JSON.stringify(PROVIDER_KINDS)}
  const custom = () => ({status:'ok',source:'live',models:[{id:'tts-1',label:'tts-1'},{id:'gpt-4o-mini-tts',label:'gpt-4o-mini-tts'}],voices:[{id:'alloy',label:'Alloy',languages:['en']},{id:'nova',label:'Nova',languages:['en','zh','ja']}]})
  const local = Array.from({length:17},(_,i) => ({id:'madoka/voice-' + i,label:['鹿目圆','晓美焰','美树沙耶加','巴麻美','佐仓杏子','大肥鱼'][i % 6] + (i > 5 ? ' ' + i : ''),engine:'gpt-sovits',revision:'r' + i,languages:['ja'],state:'ready'}))
  const state = window.__harness = {configured:[
      {id:'qwen',kind:'qwen',label:'通义千问',config:{region:'cn'},rev:1},
      {id:'azure',kind:'azure',label:'Azure Speech',config:{region:'eastus'},rev:1},
      {id:'fish',kind:'fish-audio',label:'Fish Audio',config:{url:'https://api.fish.audio',model:'s2.1-pro-free'},rev:1}],
    keys:new Set(['qwen','azure','fish']),checks:{},presets:[
      {schemaVersion:1,id:'deepseek-whale/dafeiyu',label:'大肥鱼（萌宝）',kind:'qwen',enabled:true,providerId:'qwen',languages:['zh'],params:{voice:'Bella',model:'qwen3-tts-instruct-flash',instructions:'声音软糯'}},
      {schemaVersion:1,id:'neuro-sama/neuro',label:'Neuro (Ashley)',kind:'azure',enabled:true,providerId:'azure',languages:['en'],params:{voiceName:'en-US-AshleyNeural',pitch:25,rate:8}}],
    calls:[],enabled:true,rev:1,local:{state:'stopped',voiceCount:0}}
  const listed = () => state.configured.map(p => ({...p,revision:'rev-' + p.id + '-' + p.rev,...(state.checks[p.id] ? {check:state.checks[p.id]} : {}),secrets:{[p.kind === 'volcengine' ? 'accessKey' : 'key']:{configured:state.keys.has(p.id),writable:true}}}))
  const voicesOf = id => { const p = state.configured.find(p => p.id === id); return !p ? {status:'ok',source:'live',models:[],voices:local} : p.kind === 'azure' ? azure() : p.kind === 'fish-audio' ? fish() : p.kind === 'openai-compatible' ? custom() : qwen() }
  const ok = value => ({ok:true,json:async () => structuredClone(value)})
  const slow = (ms, value) => new Promise(r => setTimeout(() => r(ok(value)), ms))
  window.fetch = async (url, options = {}) => {
    if (url.includes('/synthesis')) { state.calls.push('synthesis'); return ok(options.method === 'POST' ? {requestId:'preview'} : {state:'ready',result:{ticket:'harness'}}) }
    const {method,args} = JSON.parse(options.body || '{}'); state.calls.push(method)
    if (url.includes('dsh-tts-local')) {
      if (method === 'settings') return ok({providerId:'default',installPath:'./tts-worker',pythonExecutable:'',workerScript:'',modelConfigPath:'./tts-worker/tavern-voice.json',arguments:'[]',environment:'{}',readinessTimeoutMs:120000,autoStart:false})
      if (method === 'start' || method === 'restart') { state.local = {state:'ready',voiceCount:17}; return slow(300,{...state.local,configRevision:'x'}) }
      if (method === 'stop') { state.local = {state:'stopped',voiceCount:0}; return slow(200,{...state.local,configRevision:'x'}) }
      return ok({...state.local,configRevision:'x',stale:false,error:''})
    }
    switch (method) {
      case 'services': return ok({configured:listed(),running:[...state.configured.map(p => ({id:p.id,kind:p.kind,revision:'r',capabilities:p.kind === 'qwen' ? {serviceVoiceEngines:['qwen'],paid:true} : {paid:p.kind !== 'fish-audio'},status:{state:'configured'}})),
        {id:'default',kind:'reference-api',revision:'r',capabilities:{voiceKinds:['reference'],catalogue:true,paid:false,localEngine:'gpt-sovits',serviceVoiceEngines:['gpt-sovits']},status:{state:'configured'}}]})
      case 'providerKinds': return ok(kinds)
      case 'probeService': {
        if (args.kind === 'azure') { state.checks[args.id] = {status:'error',message:'Azure 密钥或区域无效'}; return slow(400,{status:'error',message:'Azure 密钥或区域无效',voices:[],models:[],source:'none'}) }
        if (args.kind === 'volcengine' && args.secrets?.accessKey === 'bad') return slow(400,{status:'error',message:'火山引擎凭据无效，请检查 App ID 和 Access Key',voices:[],models:[],source:'none'})
        if (!Object.values(args.secrets || {}).some(Boolean) && !state.keys.has(args.id)) return ok({status:'credentials-required',voices:[],models:[],source:'none'})
        return slow(400,{...(args.kind === 'openai-compatible' ? custom() : args.kind === 'azure' ? azure() : qwen()),status:'connected'})
      }
      case 'saveService': {
        const old = state.configured.find(p => p.id === args.id)
        state.configured = old ? state.configured.map(p => p.id === args.id ? {...p,label:args.label,config:args.config,rev:p.rev + 1} : p) : [...state.configured,{id:args.id,kind:args.kind,label:args.label,config:args.config,rev:1}]
        if (Object.values(args.secrets || {}).some(Boolean)) state.keys.add(args.id)
        return ok(listed().find(p => p.id === args.id))
      }
      case 'deleteService': state.configured = state.configured.filter(p => p.id !== args.id); return ok({deleted:true})
      case 'testService': { const p = state.configured.find(p => p.id === args.id); const r = p.kind === 'azure' ? {ok:false,status:'error',message:'Azure 密钥或区域无效'} : {ok:true,status:'connected',voiceCount:voicesOf(p.id).voices.length}; state.checks[p.id] = {...r,at:Date.now()}; return slow(400,{reachable:r.ok,...r}) }
      case 'providerVoices': return slow(250,voicesOf(args.serviceId))
      case 'searchFishVoices': return slow(250,{voices:[{voiceId:'aa11bb22cc33dd44ee55ff6677889900',name:'元气少女 ' + args.query,languages:['zh']},{voiceId:'bb11bb22cc33dd44ee55ff6677889900',name:args.query + '（温柔）',languages:['zh','ja']}],page:1,pageSize:20,total:2,hasMore:false})
      case 'voicePresets': return ok(state.presets.map(preset => ({preset,revision:'p-' + preset.id + '-' + state.rev})))
      case 'saveVoicePreset': state.rev++; state.presets = [...state.presets.filter(p => p.id !== args.preset.id),args.preset]; return ok({preset:args.preset,revision:'p-' + args.preset.id + '-' + state.rev})
      case 'deleteVoicePreset': state.presets = state.presets.filter(p => p.id !== args.id); return ok({deleted:true})
      case 'cache': return ok({bytes:38 * 1024 ** 2,count:412,maxBytes:1024 ** 3,maxAgeDays:30})
      case 'getReadings': return ok({entries:[],revision:'r0'})
      case 'setEnabled': state.enabled = args.enabled; window.__events.onmessage({data:JSON.stringify({enabled:args.enabled})}); return ok({enabled:args.enabled})
      default: return ok({})
    }
  }
  window.EventSource = class { constructor() { window.__events = this; setTimeout(() => this.onmessage?.({data:JSON.stringify({enabled:true})}),0) } close() {} }
})()`

const boot = `(() => {
  const services = new Map(), tabs = new Map(), slots = new Map()
  services.set('betterSidebar',{registerTab(tab) { tabs.set(tab.id,tab); return () => tabs.delete(tab.id) },openTab(seed) { window.__opened = seed }})
  const ctx = { provide(key,value) { services.set(key,value); return () => services.delete(key) }, get: key => services.get(key), effect(fn) { return fn() },
    inject(keys,fn) { if (keys.every(key => services.has(key))) fn(ctx) },
    slots:{inject(_,fn) { fn() },register(d,Panel) { slots.set(d.id,Panel); return () => slots.delete(d.id) }} }
  for (const m of window.__modules) m.apply(ctx)
  const Panel = tabs.get('dsh-tts:voice').component
  setTimeout(() => ReactDOMClient.createRoot(document.getElementById('host')).render(React.createElement(Panel)),10)
})()`

const bundle = name => read(join(pkg, '..', name, 'lib/client.js'))
const files = { '/': [page$, 'text/html'], '/mock.js': [mock, 'text/javascript'], '/boot.js': [boot, 'text/javascript'],
  '/tts.js': [bundle('dsh-tts'), 'text/javascript'], '/tts-local.js': [bundle('dsh-tts-local'), 'text/javascript'] }

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' })
const shots = [], errors = []
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 1100 }, deviceScaleFactor: 1 })
  page.on('pageerror', e => errors.push(e.message))
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.origin !== 'http://harness.local') return route.abort()
    const [body,type] = files[url.pathname] || ['', 'text/plain']
    return route.fulfill({body,contentType:type + '; charset=utf-8'})
  })
  await page.goto('http://harness.local/')
  await page.getByText('合成缓存').waitFor()
  await page.waitForTimeout(400)
  const shot = async (name, full = false) => {
    await page.waitForTimeout(150)
    assert.equal(await page.evaluate(() => document.querySelector('.dtts').scrollWidth > document.querySelector('.dtts').clientWidth + 1),false,'horizontal overflow: ' + name)
    const path = join(out,name + '.png')
    if (full) { const h = await page.evaluate(() => document.querySelector('.dtts').scrollHeight); const vp = page.viewportSize(); await page.setViewportSize({width:vp.width,height:Math.max(vp.height,h + 4)}); await page.screenshot({path}); await page.setViewportSize(vp) }
    else await page.screenshot({path})
    shots.push(path)
  }
  const mobile = async on => { await page.setViewportSize(on ? {width:375,height:812} : {width:1000,height:1100}); await page.evaluate(w => document.getElementById('host').style.setProperty('--w',w),on ? '375px' : '640px') }
  const mode = async m => { await page.getByRole('button',{name:m,exact:true}).click(); await page.waitForTimeout(200) }
  const scrollTo = text => page.getByText(text,{exact:true}).first().evaluate(el => el.scrollIntoView({block:'start'}))
  if (phase === 'before') {
    await shot('desktop-basic',true)
    await mode('高级'); await shot('desktop-advanced',true)
    await page.getByRole('button',{name:/编辑服务 通义千问/}).click(); await page.getByText('编辑服务',{exact:true}).evaluate(el => el.scrollIntoView({block:'center'})); await shot('desktop-edit-at-bottom')
    await mode('基础'); await mobile(true); await page.evaluate(() => document.querySelector('.dtts').scrollTo(0,0)); await shot('mobile-basic',true)
    await mode('高级'); await shot('mobile-advanced',true)
  } else {
    await shot('01-desktop-basic',true)
    await mode('高级'); await shot('02-desktop-advanced',true)
    await mode('基础')
    // Inline edit right under its row; 测试连接 inside the form (mocked, no network).
    await page.getByRole('button',{name:'Azure Speech',exact:true}).click()
    await page.getByRole('button',{name:'测试连接',exact:true}).click()
    await page.getByText(/密钥或区域无效/).first().waitFor()
    await scrollTo('语音服务'); await shot('03-inline-edit-test-error')
    await page.getByRole('button',{name:'取消',exact:true}).click()
    await page.getByRole('button',{name:'通义千问',exact:true}).click()
    await page.getByRole('button',{name:'测试连接',exact:true}).click()
    await page.getByText(/连接成功/).first().waitFor()
    await scrollTo('语音服务'); await shot('04-inline-edit-test-ok')
    await page.getByRole('button',{name:'取消',exact:true}).click()
    // Add flow: dashed ＋ → type → name / region or base URL / key. A second 通义千问 instance.
    await page.getByRole('button',{name:'添加语音服务',exact:true}).click()
    await scrollTo('语音服务'); await shot('05-add-choose-type')
    await page.getByRole('radio',{name:/OpenAI 兼容/}).click()
    await page.getByLabel('服务名称').fill('我的 TTS 中转')
    await page.getByLabel('服务地址',{exact:true}).fill('https://tts.example.invalid')
    await page.getByLabel('API Key',{exact:true}).fill('fake-key-for-harness')
    await page.getByRole('button',{name:'测试连接',exact:true}).click()
    await page.getByText(/连接成功/).first().waitFor()
    await scrollTo('语音服务'); await shot('06-add-openai-compatible')
    await page.getByRole('button',{name:'保存',exact:true}).click()
    await page.getByText('我的 TTS 中转',{exact:true}).waitFor()
    await page.getByRole('button',{name:'添加语音服务',exact:true}).click()
    await page.getByRole('radio',{name:/通义千问/}).click()
    assert.equal(await page.getByLabel('服务名称').inputValue(),'通义千问 2')
    await page.getByLabel('API Key',{exact:true}).fill('fake-key-2')
    await page.getByRole('button',{name:'保存',exact:true}).click()
    await page.getByText('通义千问 2',{exact:true}).waitFor()
    assert.ok(await page.evaluate(() => window.__harness.configured.some(p => p.id === 'qwen-2')))
    await scrollTo('语音服务'); await shot('07-two-qwen-instances')
    // Presets: click a row → inline editor with provider chips + fetched voice picker (search).
    await page.getByRole('button',{name:'大肥鱼（萌宝）',exact:true}).click()
    await page.getByRole('option').first().waitFor()
    await page.getByLabel('搜索音色').fill('萌')
    await scrollTo('声音预设'); await shot('08-preset-edit-fetched-voices')
    await page.getByRole('button',{name:'取消',exact:true}).click()
    await page.getByRole('button',{name:'新建声音预设',exact:true}).click()
    await page.getByRole('radio',{name:'Fish Audio',exact:true}).click()
    await page.getByLabel('搜索音色').fill('少女')
    await page.getByText(/元气少女/).first().waitFor()
    await scrollTo('声音预设'); await shot('09-new-preset-fish-search')
    await page.getByRole('button',{name:'取消',exact:true}).click()
    await page.getByRole('button',{name:/更多操作 Neuro/}).click()
    await scrollTo('声音预设'); await shot('10-preset-more-menu')
    await page.keyboard.press('Escape')
    // Local engine: stopped → 启动 → running (⋯ holds 重启).
    await scrollTo('本地引擎'); await shot('11-local-stopped')
    await page.getByRole('button',{name:'启动',exact:true}).click()
    await page.getByRole('button',{name:'停止',exact:true}).waitFor()
    await page.waitForTimeout(2200)
    await page.getByRole('button',{name:'本地引擎 更多操作'}).click()
    await scrollTo('本地引擎'); await shot('12-local-running-menu')
    await page.keyboard.press('Escape')
    await mobile(true); await page.evaluate(() => document.querySelector('.dtts').scrollTo(0,0)); await shot('13-mobile-basic',true)
    await mode('高级'); await shot('14-mobile-advanced',true)
    await mode('基础')
    await page.getByRole('button',{name:'通义千问',exact:true}).click(); await scrollTo('语音服务'); await shot('15-mobile-inline-edit')
    await page.getByRole('button',{name:'取消',exact:true}).click()
    await page.getByRole('button',{name:'大肥鱼（萌宝）',exact:true}).click(); await page.getByRole('option').first().waitFor(); await scrollTo('声音预设'); await shot('16-mobile-preset-picker')
    assert.equal(await page.evaluate(() => window.__harness.calls.includes('synthesis')),false)
  }
  assert.deepEqual(errors,[])
} finally { await browser.close() }
console.log(shots.join('\n'))
