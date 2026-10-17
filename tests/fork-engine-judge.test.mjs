// private fork: all provider IO is fake; no credentials or live endpoints are contacted.
import test from 'node:test'
import assert from 'node:assert/strict'
import {defaultJudgeConfig,validateJudgeConfig,judgeRequests,createEngineJudge} from '../tavern-plugin/lib/domain/engine-judge.js'
import {createJudgeRpc} from '../tavern-plugin/lib/fork-engine-judge.js'
import {defaultAssetEngineSettings,patchAssetEngineSettings} from '../tavern-plugin/lib/domain/asset-engine-settings.js'
const input = {material:'正文\n\n最新一轮。',questions:[{id:'a',text:'这条素材适合本轮剧情吗？【音效】雨；使用情景：下雨'}]}
function fixture(config = validateJudgeConfig({provider:'jev'}),transport) {
  const calls = [], logs = [], credentials = []
  const service = createEngineJudge({getConfig:() => config,credentials:() => ({resolve:async name => {credentials.push(name);return {value:'fake-secret'}},describe:async () => ({configured:true,source:'env',value:'never-return-this',path:'never-return-this'})}),
    log:event => logs.push(event),fetch:async (url,options) => {
      calls.push({url,...options})
      if (transport) return transport(url,options)
      const body = JSON.parse(options.body)
      return {ok:true,json:async () => ({answers:body.questions instanceof Array ? body.questions.map(q => ({type:'predicate',name:q.name,probability:.7})) : Object.fromEntries(Object.keys(body.questions).map(id => [id,{type:'noul',noul:.7}])),usage:{input_tokens:100,output_tokens:0}})}
    }})
  return {service,calls,logs,credentials}
}
test('unset and disabled are zero calls, credential reads and request bytes', async () => {
  for (const config of [defaultJudgeConfig(),validateJudgeConfig({provider:'jev',enabled:false})]) {
    const f = fixture(config)
    assert.deepEqual(f.service.preview(input).requests,[])
    assert.equal(await f.service.judge(input),null)
    assert.deepEqual([f.calls,f.credentials,f.logs],[[],[],[]])
  }
})
test('strict config, defaults and reference-only credentials', async () => {
  assert.deepEqual(validateJudgeConfig({}),defaultJudgeConfig())
  assert.equal(validateJudgeConfig({provider:'jev'}).keyName,'TYPESAFE_API_KEY')
  assert.equal(validateJudgeConfig({provider:'openai'}).model,'gpt-6-luna')
  assert.throws(() => validateJudgeConfig({apiKey:'not-allowed'}),{code:'UNKNOWN_FIELD'})
  for (const patch of [{threshold:1.1},{threshold:-1},{timeoutMs:0},{capPerKind:1.1},{provider:'bad'},{keyName:'a-b'},{baseUrl:'https://example.org'},{provider:'openai-compatible',baseUrl:'https://secret@host'},{provider:'openai-compatible',baseUrl:'https://host?key=secret'}]) assert.throws(() => validateJudgeConfig(patch))
  // private fork (judge key, owner 2026-10): status is per provider (its stored key first, then the keyName reference).
  assert.deepEqual(await fixture().service.credentialStatus('jev','TYPESAFE_API_KEY'),{configured:true,source:'env'})
})
test('draft judge tests cannot retarget stored credentials and remote HTTP is rejected', async () => {
  const saved = validateJudgeConfig({provider:'openai-compatible',baseUrl:'https://saved.example/v1',keyName:'SAVED_KEY'})
  const f = fixture(saved)
  const rpc = createJudgeRpc({read:() => ({values:{judge:saved}})},f.service)
  const result = await rpc.testJudgeConnection({config:{...saved,baseUrl:'https://foreign.example/v1'}})
  assert.equal(result.error.code,'JUDGE_KEY_URL_MISMATCH')
  assert.equal((await rpc.testJudgeConnection({config:{...saved,keyName:'OTHER_KEY'}})).error.code,'JUDGE_KEY_URL_MISMATCH')
  assert.deepEqual([f.calls,f.credentials],[[],[]])
  for (const baseUrl of ['http://foreign.example/v1','http://192.168.1.2/v1']) {
    assert.throws(() => rpc.testJudgeConnection({config:{...saved,baseUrl}}))
  }
  for (const baseUrl of ['http://localhost:9876/v1','http://127.0.0.1:9876/v1','http://[::1]:9876/v1']) assert.equal(validateJudgeConfig({...saved,baseUrl}).baseUrl,baseUrl)
  assert.equal((await rpc.testJudgeConnection({config:{...saved,model:'draft-model'}})).ok,true)
  assert.equal((await rpc.testJudgeConnection({config:{provider:'openai'}})).ok,true)
  assert.equal((await rpc.testJudgeConnection({config:{provider:'openai-compatible',baseUrl:'https://api.openai.com/v1'}})).ok,true)
})

test('Jev uses the experiment Noul shape and preview is the exact sent UTF-8 body', async () => {
  const f = fixture(),preview = f.service.preview(input)
  assert.equal(f.calls.length,0)
  assert.deepEqual(JSON.parse(preview.requests[0].body),{model:'jev-1.13.0',state:input.material,questions:{a:{type:'noul',instructions:input.questions[0].text}}})
  assert.deepEqual(await f.service.judge(input),new Map([['a',.7]]))
  assert.equal(f.calls[0].url,'https://api.typesafe.ai/v1/systemone')
  assert.equal(f.calls[0].body,preview.requests[0].body)
  assert.equal(Buffer.byteLength(f.calls[0].body),preview.requests[0].bytes)
  assert.equal(f.logs[0].costEstimateUSD,100*.042/1e6)
  assert.ok(!JSON.stringify(f.logs).includes('fake-secret'))
})
test('Decisions official and compatible use predicate questions and parse probability', async () => {
  for (const [provider,baseUrl,url] of [['openai','','https://api.openai.com/v1/decisions'],['openai-compatible','http://localhost:9876/v1/','http://localhost:9876/v1/decisions']]) {
    const f = fixture(validateJudgeConfig({provider,baseUrl}))
    assert.deepEqual(await f.service.judge(input),new Map([['a',.7]]))
    assert.equal(f.calls[0].url,url)
    assert.deepEqual(JSON.parse(f.calls[0].body),{model:'gpt-6-luna',input:input.material,questions:[{type:'predicate',name:'a',instructions:input.questions[0].text}]})
  }
})
test('601 questions batch 300/300/1 in parallel; failure discards every batch', async () => {
  let releases = []
  const f = fixture(undefined,async (_url,options) => {await new Promise(resolve => releases.push(resolve));return {ok:true,json:async () => ({answers:Object.fromEntries(Object.keys(JSON.parse(options.body).questions).map(id => [id,{type:'noul',noul:.8}]))})}})
  const big = {material:'body',questions:Array.from({length:601},(_,i) => ({id:'q'+i,text:'Question?'}))}
  const pending = f.service.judge(big)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(releases.length,3)
  assert.deepEqual(f.calls.map(c => Object.keys(JSON.parse(c.body).questions).length),[300,300,1])
  releases.forEach(resolve => resolve())
  assert.equal((await pending).size,601)
  let call = 0
  const broken = fixture(undefined,async () => ++call === 1 ? {ok:false} : {ok:true,json:async () => ({answers:{}})})
  assert.equal(await broken.service.judge(big),null)
  assert.equal(broken.logs.length,1)
})
test('deadline covers credential resolution and providers ignoring abort; errors never expose secrets', async () => {
  const f = fixture(validateJudgeConfig({provider:'jev',timeoutMs:15}),async () => new Promise(() => {}))
  const result = await f.service.test()
  assert.equal(result.error.code,'JUDGE_TIMEOUT')
  assert.ok(result.latencyMs < 500)
  assert.equal(f.calls[0].signal.aborted,true)
  const slowKey = createEngineJudge({getConfig:() => validateJudgeConfig({provider:'jev',timeoutMs:10}),credentials:() => ({resolve:() => new Promise(() => {})})})
  assert.equal((await slowKey.test()).error.code,'JUDGE_TIMEOUT')
  const broken = fixture(undefined,async () => {throw new Error('fake-secret in provider error')})
  assert.equal((await broken.service.test()).error.code,'JUDGE_ERROR')
  assert.ok(!JSON.stringify(broken.logs).includes('fake-secret'))
  const noKey = createEngineJudge({getConfig:() => validateJudgeConfig({provider:'jev'}),credentials:() => ({resolve:async () => null}),fetch:() => assert.fail('no call without key')})
  assert.equal((await noKey.test()).error.code,'JUDGE_NO_KEY')
})
test('invalid/missing/refused probabilities reject rather than silently filling gaps', async () => {
  for (const answers of [{},{a:{type:'noul',noul:2}},{a:{type:'noul',noul:'0.8'}},{a:{type:'refusal'}}]) {
    const f = fixture(undefined,async () => ({ok:true,json:async () => ({answers})}))
    assert.equal(await f.service.judge(input),null)
    assert.equal(f.logs[0].code,'JUDGE_INVALID_RESPONSE')
  }
})
// private fork (judge key, owner 2026-10): 「API Key」 takes the key itself or a variable name. A pasted key is stored under the
// provider's fixed name and only its status comes back; an existing variable name becomes the judge's keyName reference.
test('API Key: a pasted key is stored and never returned; an existing variable name becomes a reference', async () => {
  const env = {MY_JUDGE_KEY:'env-secret'}, stored = new Map(), logs = [], sent = []
  const store = {
    resolve:async ref => env[ref] !== undefined ? {value:env[ref],source:'env'} : stored.has(ref) ? {value:stored.get(ref),source:'file'} : undefined,
    describe:async ref => env[ref] !== undefined ? {configured:true,source:'env'} : stored.has(ref) ? {configured:true,source:'file'} : {configured:false},
    set:async (ref,value) => {stored.set(ref,value)}, unset:async ref => {stored.delete(ref)}}
  let values = patchAssetEngineSettings(defaultAssetEngineSettings(),{judge:{provider:'jev'}}), revision = '1'
  const settings = {read:() => ({values,revision,writable:true}),async save({patch,expectedRevision}) {assert.equal(expectedRevision,revision);values = patchAssetEngineSettings(values,patch);revision = String(+revision + 1);return this.read()}}
  const service = createEngineJudge({getConfig:() => values.judge,credentials:() => store,log:event => logs.push(event),
    fetch:async (_url,options) => {sent.push(options.headers.Authorization);return {ok:true,json:async () => ({answers:{test:{type:'noul',noul:.5}}})}}})
  const rpc = createJudgeRpc(settings,service), secret = 'fake-test-value'
  const replies = [await rpc.setJudgeKey({provider:'jev',value:secret,expectedRevision:revision})]
  assert.equal(stored.get('DSH_TAVERN_JUDGE_JEV_KEY'),secret)
  assert.deepEqual(replies[0],{status:{configured:true,source:'stored'}})
  replies.push(await rpc.getJudgeCredentialStatus({provider:'jev',keyName:values.judge.keyName}),rpc.getJudgeConfig({}))
  assert.equal((await rpc.testJudgeConnection({})).ok,true);assert.equal(sent.at(-1),'Bearer ' + secret)
  assert.ok(!JSON.stringify([replies,values,logs]).includes(secret),'the key is never sent back, kept in settings or logged')
  // An existing variable name is a reference: the judge's keyName (CAS), the stored key dropped.
  const reference = await rpc.setJudgeKey({provider:'jev',value:'MY_JUDGE_KEY',expectedRevision:revision})
  assert.deepEqual(reference.status,{configured:true,source:'env',keyName:'MY_JUDGE_KEY'})
  assert.equal(reference.settings.values.judge.keyName,'MY_JUDGE_KEY');assert.equal(stored.size,0)
  assert.equal((await rpc.testJudgeConnection({})).ok,true);assert.equal(sent.at(-1),'Bearer env-secret')
  // A name that resolves nowhere is the key itself; bad values are refused once, at entry.
  await rpc.setJudgeKey({provider:'jev',value:'NOT_SET_ANYWHERE',expectedRevision:revision})
  assert.equal(stored.get('DSH_TAVERN_JUDGE_JEV_KEY'),'NOT_SET_ANYWHERE')
  for (const value of ['','has space','x'.repeat(4097),42]) await assert.rejects(rpc.setJudgeKey({provider:'jev',value,expectedRevision:revision}))
  await rpc.setJudgeKey({provider:'jev',value:null,expectedRevision:revision});assert.equal(stored.size,0)
})
test('RPC save is CAS, rejects unknown args/config, and only test action makes a request', async () => {
  const f = fixture();let values = defaultAssetEngineSettings(), revision = '1'
  const settings = {read:() => ({values,revision,writable:true}),async save({patch,expectedRevision}) {assert.equal(expectedRevision,revision);values = patchAssetEngineSettings(values,patch);revision = '2';return this.read()}}
  const rpc = createJudgeRpc(settings,f.service)
  assert.equal(rpc.getJudgeConfig({}).config.provider,'unset')
  await rpc.saveJudgeConfig({config:{provider:'jev'},expectedRevision:'1'})
  assert.equal(rpc.getJudgeConfig({}).config.model,'jev-1.13.0')
  await assert.rejects(rpc.saveJudgeConfig({config:{unknown:1},expectedRevision:'2'}),{code:'UNKNOWN_FIELD'})
  await assert.rejects(rpc.saveJudgeConfig({config:{},expectedRevision:'2',apiKey:'bad'}),{code:'UNKNOWN_FIELD'})
  assert.throws(() => rpc.testJudgeConnection({silent:true}),{code:'UNKNOWN_FIELD'})
  assert.equal(f.calls.length,0)
  assert.equal((await rpc.testJudgeConnection({})).ok,true)
  assert.equal(f.calls.length,1)
})
