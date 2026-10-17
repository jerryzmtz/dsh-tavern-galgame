import {tmpdir as publicTmpdir} from 'node:os'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises'
import {createModConfigService,validateConfigSchema} from '../tavern-plugin/lib/domain/mods/config.js'
import {builtinConfigSchemas} from '../tavern-plugin/lib/domain/mods/config-builtins.js'
import {createFirstPartyMods} from '../tavern-plugin/lib/fork-mod-builtins.js'
import {createConfigSourceRegistry} from '../tavern-plugin/lib/domain/mods/config-sources.js'
import {createModConfigStore,createModConfigRpc} from '../tavern-plugin/lib/fork-mod-config.js'
import {variableGuessHints} from '../tavern-plugin/lib/domain/variable-bindings/index.js'
const schemas={
  'test.phone':{fields:[{key:'time',label:'时间',valueType:'string',default:'09:41',guessHints:variableGuessHints.time},{key:'battery',valueType:'number',default:80,min:0,max:100},{key:'sound',valueType:'boolean',default:true,scope:'global'}]},
  'test.items':{fields:[{key:'count',valueType:'number',default:0}]},
}
function harness() {
  let revision=0;const data={global:{},card:{}},sources=createConfigSourceRegistry()
  sources.register({id:'mvu',label:'MVU',exports:[{path:'/世界状态',name:'世界状态',type:'object',description:'剧情变量'}],read:ctx=>ctx.sources?.mvu || {available:false}})
  for(const id of ['test.phone','test.items'])sources.register({id:'mod:'+id,label:id,exports:[{path:'/value',name:'当前值',type:'number',description:'自身设置',settingKey:id==='test.phone'?'battery':'count'},...(id==='test.phone'?[{path:'/double',name:'双倍电量',type:'number',description:'自身电量计算',settingsKeys:['battery']}]:[])],read:({settings})=>({double:settings.battery*2})})
  const store={read:async({modId})=>({revision:String(revision),global:data.global[modId] || {},card:data.card[modId] || {}}),write:async args=>{assert.equal(args.expectedRevision,String(revision));data[args.layer][args.modId]=args.values;revision++}}
  return {sources,store,data,service:createModConfigService({schemas,store,sources})}
}
test('per-key layering, explicit auto, inherited global, clear, type checks and CAS',async()=>{
  const h=harness(),ctx={cardId:'card-identity-42',sources:{mvu:{available:true,value:{世界状态:{时间:['下午 1点半','说明']}}}}}
  assert.equal((await h.service.resolve('test.phone','time',ctx)).value,'13:30')
  await h.service.set({modId:'test.phone',key:'time',layer:'global',value:{fixed:'07:15'},expectedRevision:'0',...ctx})
  assert.deepEqual(await h.service.resolve('test.phone','time',ctx),{value:'07:15',layer:'global',kind:'fixed'})
  await h.service.set({modId:'test.phone',key:'time',layer:'card',value:{auto:true},expectedRevision:'1',...ctx})
  assert.equal((await h.service.resolve('test.phone','time',ctx)).value,'13:30')
  await h.service.clear({modId:'test.phone',key:'time',layer:'card',expectedRevision:'2',...ctx})
  assert.equal((await h.service.resolve('test.phone','time',ctx)).layer,'global')
  await assert.rejects(h.service.set({modId:'test.phone',key:'sound',layer:'card',value:{fixed:false},expectedRevision:'3',...ctx}),{code:'UNKNOWN_FIELD'})
  await assert.rejects(h.service.set({modId:'test.phone',key:'battery',layer:'global',value:{fixed:'10'},expectedRevision:'3',...ctx}),{code:'CONFIG_TYPE'})
  await assert.rejects(h.service.clear({modId:'test.phone',key:'time',layer:'global',expectedRevision:'0'}),{code:'REVISION_CONFLICT'})
  assert.equal((await h.service.resolve('test.phone','retired',ctx)).error.code,'UNKNOWN_FIELD')
  h.data.global['test.phone'].time={ref:{source:'mvu',path:'/missing'}}
  assert.equal((await h.service.resolve('test.phone','time',ctx)).error.code,'SOURCE_MISSING')
})
test('cycles through user references/formulas, computed publisher receives only own inputs',async()=>{
  const h=harness()
  h.data.global['test.phone']={battery:{formula:'{mod:test.items:/value} * 2'}}
  h.data.global['test.items']={count:{ref:{source:'mod:test.phone',path:'/value'}}}
  const result=await h.service.resolve('test.phone','battery')
  assert.equal(result.error.code,'CONFIG_CYCLE');assert.match(result.error.message,/test.phone:battery -> test.items:count -> test.phone:battery/)
  h.data.global['test.items']={count:{fixed:75}}
  assert.equal((await h.service.resolve('test.phone','battery')).value,100)
  h.data.global['test.phone']={battery:{fixed:20}}
  h.data.global['test.items']={count:{ref:{source:'mod:test.phone',path:'/double'}}}
  assert.equal((await h.service.resolve('test.items','count')).value,40)
  h.data.global['test.phone']={battery:{ref:{source:'mod:test.phone',path:'/double'}}}
  assert.equal((await h.service.resolve('test.phone','battery')).error.code,'CONFIG_CYCLE')
  h.sources.register({id:'mod:test.computed',label:'Computed',exports:[{path:'/total',name:'总计',type:'number',description:'自身状态总计',settingsKeys:['b']}],read:own=>{assert.deepEqual(Object.keys(own),['state','settings']);return {total:own.state.a+own.settings.b}}})
  assert.equal((await h.sources.snapshot({mods:{'test.computed':{state:{a:2},settings:{b:3}},'test.other':{state:{secret:99}}}}))['mod:test.computed'].value.total,5)
})
test('guess cache is scoped to card/chat revision, not UI renders',async()=>{
  const h=harness();let reads=0
  const world={get 时间(){reads++;return '01:00'}}
  const ctx={cardId:'card-identity-42',sessionId:'chat-72',revision:'r1',sources:{mvu:{available:true,value:{世界状态:world}}}}
  await h.service.resolve('test.phone','time',ctx);const first=reads
  await h.service.resolve('test.phone','time',{...ctx});assert.equal(reads,first)
  await h.service.resolve('test.phone','time',{...ctx,revision:'r2'});assert.ok(reads>first)
})
test('unset inventory guesses static schema and re-resolves when first MVU snapshot arrives',async()=>{
  const builtin=await createFirstPartyMods(),definitions=builtinConfigSchemas(builtin.catalogue().map(row=>builtin.manifest(row.id)))
  const h=harness(),service=createModConfigService({schemas:definitions,sources:h.sources,store:h.store})
  const ctx={cardId:'fresh-card-42',sessionId:'fresh-chat-72',revision:'opening',sources:{}}
  const empty=await service.resolve('dsh.items','inventory',ctx)
  assert.equal(empty.layer,'auto');assert.deepEqual(empty.autoCandidates,[])
  const initialized={...ctx,sources:{mvu:{available:true,value:{背包:[{name:'Book',count:2}]}}}}
  const found=await service.resolve('dsh.items','inventory',initialized)
  assert.equal(found.autoCandidates[0].variable.path,'/背包');assert.equal(found.autoCandidates[0].score,70)
  assert.deepEqual(found.value,[{name:'Book',count:2}])
  const updated=await service.resolve('dsh.items','inventory',{...initialized,revision:'turn-1',sources:{mvu:{available:true,value:{背包:[]}}}})
  assert.deepEqual(updated.value,[]);assert.equal(updated.autoCandidates[0].variable.path,'/背包')
  for(const content of ['背包: []',JSON.stringify({properties:{背包:{type:'array'}}})]) {
    const raw={character_book:{entries:[{comment:'initvar',content}]}}
    const staticResult=await service.resolve('dsh.items','inventory',{...ctx,sessionId:content,raw})
    assert.equal(staticResult.autoCandidates[0].variable.path,'/背包');assert.equal(staticResult.autoCandidates[0].score,70)
    assert.deepEqual(staticResult.value,[])
  }
  assert.deepEqual(h.data,{global:{},card:{}})
})
test('picker uses safe JSON Pointer and live MVU unwrapping',async()=>{
  const h=harness(),listing=await h.service.listSources({sources:{mvu:{available:true,value:{世界状态:{时间:['01:00','说明'],'a/b~c':8,数组:[{名称:'甲'},{名称:'乙'}]}}}}})
  const root=listing.sources[0].tree[0]
  assert.equal(root.children[0].value,'01:00');assert.equal(root.children[0].description,'说明');assert.equal(root.children[1].path,'/世界状态/a~1b~0c')
  assert.equal(Object.hasOwn(root.children[0],'children'),false)
  assert.equal(root.children[2].type,'array');assert.equal(root.children[2].children[0].name,'0')
  const mod=listing.sources.find(row=>row.id==='mod:test.phone')
  assert.equal(mod.tree.find(row=>row.path==='/value').settingKey,'battery')
  assert.equal(mod.tree.find(row=>row.path==='/value').value,80)
  assert.equal(mod.tree.find(row=>row.path==='/double').value,160)
  assert.equal(mod.tree.find(row=>row.path==='/double').settingKey,'battery')
})
test('file store creates sparse global config, delegates only card-owned paths and authenticates RPC',async t=>{
  const root=await mkdtemp(publicTmpdir()+'/mod-config-store-');t.after(()=>rm(root,{recursive:true,force:true}))
  let card={revision:'0',config:null};const writes=[],cardFiles=new Map()
  const cardPacks={read:async()=>card,write:async args=>{writes.push(args);assert.equal(args.expectedRevision,card.revision);card={revision:'1',config:args.config}},upload:async args=>cardFiles.set(args.cardId+'/'+args.modId+'/'+args.file.path,args.bytes),readFile:async args=>cardFiles.get(args.cardId+'/'+args.modId+'/'+args.path)}
  const extended=structuredClone(schemas);extended['test.phone'].fields.push({key:'wallpaper',valueType:'object',default:{},ui:{control:'image'}})
  const store=createModConfigStore({root,cardPacks}),h=harness(),rpc=createModConfigRpc({schemas:extended,store,sources:h.sources,authorize:({context})=>context?.origin==='trusted',context:async args=>({cardId:args.cardId})})
  await assert.rejects(rpc.getModConfig({modId:'test.phone'},{origin:'untrusted'}),{code:'MOD_PERMISSION_DENIED'})
  await assert.rejects(rpc.getModConfig({modId:'test.phone',bindings:{}},{origin:'trusted'}),{code:'UNKNOWN_FIELD'})
  let current=await rpc.getModConfig({modId:'test.phone',cardId:'card-42'},{origin:'trusted'})
  current=await rpc.setModConfig({modId:'test.phone',cardId:'card-42',layer:'global',key:'battery',value:{fixed:70},expectedRevision:current.revision},{origin:'trusted'})
  assert.deepEqual(JSON.parse(await readFile(root+'/test.phone/config.json','utf8')),{version:1,values:{battery:{fixed:70}}})
  current=await rpc.setModConfig({modId:'test.phone',cardId:'card-42',layer:'card',key:'battery',value:{fixed:60},expectedRevision:current.revision},{origin:'trusted'})
  assert.equal(writes.length,1);assert.equal(current.resolved.battery.value,60)
  await assert.rejects(store.upload({modId:'test.phone',layer:'global',expectedRevision:current.revision,mime:'image/png',data:'bm90IHB uZw=='}))
  const upload=await store.upload({modId:'test.phone',cardId:'card-42',layer:'global',expectedRevision:current.revision,mime:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWf0AAAAASUVORK5CYII='})
  assert.match(upload.file.path,/^files\/.+\.png$/);assert.equal((await readdir(root+'/test.phone/files')).length,1)
  const request={modId:'test.phone',layer:'global',path:upload.file.path},image=await rpc.readModConfigFile(request,{origin:'trusted'})
  assert.deepEqual(image.file,upload.file);assert.equal(Buffer.from(image.data,'base64').subarray(0,4).toString('hex'),'89504e47')
  await assert.rejects(rpc.readModConfigFile(request,{origin:'untrusted'}),{code:'MOD_PERMISSION_DENIED'})
  await assert.rejects(rpc.readModConfigFile({...request,path:'../config.json'},{origin:'trusted'}),{code:'UNKNOWN_FIELD'})
  await assert.rejects(rpc.readModConfigFile({...request,modId:'test.items'},{origin:'trusted'}),{code:'SOURCE_MISSING'})
  await assert.rejects(rpc.readModConfigFile({...request,layer:'card',cardId:'card-42'},{origin:'trusted'}),{code:'SOURCE_MISSING'})
  const cardUpload=await store.upload({modId:'test.phone',cardId:'card-42',layer:'card',expectedRevision:upload.revision,mime:'image/png',data:image.data})
  assert.equal((await rpc.readModConfigFile({...request,layer:'card',cardId:'card-42',path:cardUpload.file.path},{origin:'trusted'})).data,image.data)
  await assert.rejects(rpc.readModConfigFile({...request,layer:'card',cardId:'other-card',path:cardUpload.file.path},{origin:'trusted'}),{code:'SOURCE_MISSING'})
  current=await rpc.setModConfig({modId:'test.phone',cardId:'card-42',layer:'global',key:'wallpaper',value:{fixed:{file:upload.file.path}},expectedRevision:upload.revision},{origin:'trusted'})
  assert.deepEqual(current.resolved.wallpaper.value,{file:upload.file.path})
  await assert.rejects(rpc.setModConfig({modId:'test.phone',layer:'global',key:'wallpaper',value:{fixed:{file:'../secret.png'}},expectedRevision:current.revision},{origin:'trusted'}),{code:'CONFIG_TYPE'})
  current=await rpc.clearModConfig({modId:'test.phone',cardId:'card-42',layer:'global',key:'wallpaper',expectedRevision:current.revision},{origin:'trusted'})
  await rpc.clearModConfig({modId:'test.phone',cardId:'card-42',layer:'global',key:'battery',expectedRevision:current.revision},{origin:'trusted'})
  await assert.rejects(readFile(root+'/test.phone/config.json'),{code:'ENOENT'});assert.deepEqual(await readdir(root+'/test.phone/files'),[])
})
test('builtin fields expose typed UI hints and provenance for non-variable auto rules',async()=>{
  const builtin=await createFirstPartyMods(),definitions=builtinConfigSchemas(builtin.catalogue().map(row=>builtin.manifest(row.id))),phone=definitions['dsh.phone']
  for(const schema of Object.values(definitions))validateConfigSchema(schema)
  const field=key=>phone.fields.find(row=>row.key===key)
  assert.equal(field('accentColor').ui.control,'colour');assert.equal(field('clockText').ui.control,'time')
  assert.deepEqual(field('cutout').ui.choices[0],{value:'island',label:'灵动岛'})
  assert.equal(field('wallpaper').ui.control,'images');assert.equal(field('wallpaper').valueType,'array');assert.equal(field('battery').ui.unit,'%')
  const sources=createConfigSourceRegistry();sources.register({id:'stage',label:'舞台',exports:[{path:'/mainCharacterColor',name:'形象色',type:'string',description:'主角形象色'},{path:'/skin',name:'皮肤',type:'object',description:'舞台皮肤'}],read:ctx=>ctx.sources?.stage || {available:false}})
  const service=createModConfigService({schemas:definitions,sources,store:{read:async()=>({revision:'0',global:{},card:{}})}})
  const ctx={sources:{stage:{available:true,value:{mainCharacterColor:'#aabbcc',skin:{surface:'#112233'}},labels:{'/mainCharacterColor':'大肥鱼形象色','/skin/surface':'舞台皮肤'}}}}
  assert.deepEqual((await service.resolve('dsh.phone','accentColor',ctx)).autoSource,{label:'大肥鱼形象色'})
  assert.equal((await service.resolve('dsh.phone','surfaceColor',ctx)).value,'#112233')
  assert.deepEqual((await service.resolve('dsh.phone','surfaceColor',ctx)).autoSource,{label:'舞台皮肤'})
  assert.deepEqual((await service.resolve('dsh.phone','bodyColor')).autoSource,{label:'默认值'})
  assert.throws(()=>validateConfigSchema({fields:[{key:'color',valueType:'string',default:'#ffffff',ui:{control:'colour',mystery:true}}]}),{code:'UNKNOWN_FIELD'})
})
