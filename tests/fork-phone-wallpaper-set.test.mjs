// private fork: wallpaper collections are private phone settings and player-picker choices, never director assets.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,mkdtemp,mkdir,rm} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {validateModManifest} from '../tavern-plugin/lib/domain/mods/manifest.js'
import {modCatalogue} from '../tavern-plugin/lib/domain/mods/catalogue.js'
import * as phoneModule from '../fork/mods/phone/runtime.js'
import {configure} from '../fork/mods/phone/runtime.js'
import {wallpaperChoices} from '../fork/mods/phone/logic.js'
import {createBuiltinModRegistry} from '../tavern-plugin/lib/domain/mods/runtime.js'
import {createBuiltinModService} from '../tavern-plugin/lib/fork-mod-service.js'
import {phoneWallpaperSet,withPhoneWallpaperSet} from '../tavern-plugin/lib/domain/mods/phone-presentation.js'
import {selectPhoneWallpaper} from '../tavern-plugin/lib/domain/mods/phone-selection.js'
import {prepareAssetPackDirector,createAssetPackTransaction} from '../tavern-plugin/lib/domain/stage-asset-pack-director.js'
import {validateConfigValue} from '../tavern-plugin/lib/domain/mods/config.js'
import {builtinConfigSchemas} from '../tavern-plugin/lib/domain/mods/config-builtins.js'
import {syntheticPack,cardExtension} from './fixtures/asset-packs/pack.mjs'

const root=new URL('../fork/mods/phone/',import.meta.url)
const manifest=validateModManifest(JSON.parse(await readFile(new URL('manifest.json',root),'utf8')))
assert.deepEqual(manifest.defaultPacks,[])
const A='files/11111111-1111-4111-8111-111111111111.png',B='files/22222222-2222-4222-8222-222222222222.webp',C='files/33333333-3333-4333-8333-333333333333.jpg'
const catalogueOf=()=>modCatalogue(manifest,[],[],'')

test('private set: marked or first wallpaper is the default; player choices need no asset pack and are not director commands',()=>{
  const set=phoneWallpaperSet([{file:A,name:'晴天'},{file:B,default:true}],'card')
  assert.deepEqual(set.rows.map(row=>[row.entryId,row.name,row.default]),[['11111111-1111-4111-8111-111111111111','晴天',false],['22222222-2222-4222-8222-222222222222','壁纸 2',true]])
  assert.equal(phoneWallpaperSet([{file:A},{file:B}],'global').rows[0].default,true)
  assert.deepEqual(phoneWallpaperSet({file:C},'global').rows.map(row=>row.file),[C])
  assert.equal(phoneWallpaperSet([],'global'),null);assert.equal(phoneWallpaperSet([{file:A}],'auto'),null)
  const catalogue=withPhoneWallpaperSet(catalogueOf(),set),choices=wallpaperChoices(catalogue)
  assert.deepEqual(choices.map(row=>[row.ref.packId,row.ref.entryId,row.image]),[['config.card','11111111-1111-4111-8111-111111111111',A],['config.card','22222222-2222-4222-8222-222222222222',B]])
  assert.equal(configure({manifest,catalogue}).commands.some(row=>row.id==='wallpaper'),false)
  assert.deepEqual(catalogue.packs,[])
  assert.deepEqual(catalogue.recalled,[])
})

test('the wallpaper field validates a set of at most 8 distinct uploaded images with at most one default',()=>{
  const field=builtinConfigSchemas([manifest])['dsh.phone'].fields.find(row=>row.key==='wallpaper')
  assert.deepEqual({valueType:field.valueType,default:field.default,control:field.ui.control},{valueType:'array',default:[],control:'images'})
  validateConfigValue({fixed:[{file:A,name:'晴天'},{file:B,default:true}]},field)
  validateConfigValue({fixed:{file:A}},field);validateConfigValue({fixed:{}},field)
  const many=Array.from({length:9},(_,i)=>({file:'files/'+String(i+1).repeat(8)+'-1111-4111-8111-111111111111.png'}))
  for(const bad of [many,[{file:A},{file:A}],[{file:A,default:true},{file:B,default:true}],[{file:'files/x.png'}],[{file:A,default:false}],[{file:A,extra:1}],[{file:'files/11111111-1111-4111-8111-111111111111.mp3'}]])
    assert.throws(()=>validateConfigValue({fixed:bad},field),{code:'CONFIG_TYPE'},JSON.stringify(bad))
})

test('host: wallpapers stay outside director recall; the player picker changes the phone default',{timeout:8000},async t=>{
  await mkdir(new URL('../.tmp/',import.meta.url),{recursive:true})
  const temporary=await mkdtemp(fileURLToPath(new URL('../.tmp/mod-phone-set-',import.meta.url)))
  t.after(()=>rm(temporary,{recursive:true,force:true}))
  const files=new Map(await Promise.all(manifest.files.map(async row=>[row.path,await readFile(new URL(row.path,root))])))
  const builtin=createBuiltinModRegistry([{manifest,files,module:phoneModule}])
  let value={global:{enabledModIds:[],mods:{}},grants:{}},revision=0
  const listeners=new Set(),settings={read:()=>({revision:String(revision),value:structuredClone(value)}),subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},
    async compareAndSwap(input){value=structuredClone(input.value);revision++;for(const fn of listeners)fn();return settings.read()}}
  const cards={list:async()=>[],read:async()=>({revision:'c1',value:null}),compareAndSwap:()=>assert.fail('No card write')}
  // The config host as the service sees it: 本卡 holds a set of two (the second marked default).
  let layers={wallpaper:'card'},wallpaper=[{file:A,name:'晴天'},{file:B,name:'夜景',default:true}]
  const reads=[],config={
    resolved:async()=>({values:{clockText:'09:41',wallpaper},layers}),values:async()=>({clockText:'09:41',wallpaper}),bindings:async()=>({}),
    readFile:async args=>{reads.push([args.layer,args.path]);return {file:{path:args.path,mime:'image/png'},data:Buffer.from(args.layer+':'+args.path).toString('base64')}},
  }
  const service=createBuiltinModService({root:temporary+'/library',settings,cards,variables:{},config,readCard:async()=>({meta:{id:'card'}}),
    builtins:{...builtin,catalogue:()=>[{id:manifest.id}]},stage:{read:async()=>undefined,update:()=>{}},onError:error=>assert.fail(error)})
  t.after(()=>service.dispose())
  const authority={origin:'https://offline.test'}
  let result=await service.call('listMods',{},authority)
  for(const [method,input] of [['authorizeMod',{allowed:true}],['setModScope',{scope:'global'}]])
    result=await service.call(method,{modId:manifest.id,...input,expectedRevision:result.revision},authority)
  const chat={sessionId:'game',cardPath:'card.json',timeline:{branchId:'branch'},messages:[{role:'assistant',turn:1,text:'Original message.'}]}
  const target={sourceKey:'source',branchId:'branch',revision:1,turn:1},units=[{kind:'line',alias:'Speaker',text:'Original message.'}]
  // The source view carries private player choices, not a director command/catalogue.
  const preview=await service.prepare(chat,1,{target,preview:true})
  assert.equal(preview.commands.some(row=>row.modId==='dsh.phone' && row.id==='wallpaper'),false)
  assert.deepEqual(preview.sourceViews.phone.wallpapers.map(row=>[row.ref.packId,row.name]),[['config.card','晴天'],['config.card','夜景']])
  const catalogue=preview.fragments.filter(row=>row.type==='catalogue' && row.modId==='dsh.phone').map(row=>JSON.parse(row.text))
  assert.deepEqual(catalogue.filter(row=>row.ref?.kind==='wallpaper'),[])
  const pack=await syntheticPack(),prepared=prepareAssetPackDirector({snapshots:[{...pack,revision:'r1'}],raw:{extensions:{dsh_tavern:cardExtension()}},cardRevision:'c1',engine:{widgetsEnabled:false},target,units,mods:preview})
  const empty=createAssetPackTransaction({prepared,getCurrentBinding:()=>prepared.binding})
  assert.equal(empty.submit({sequence:1,through:1,done:true,beats:[]}).ok,true)
  // No director switch: the default (夜景, from 本卡) is on the phone and is the picker's selection.
  let view=await service.readPhonePresentation({chat,direction:{record:empty.effect(),through:1},at:1})
  assert.equal(view[0].definition.inlineSettingAssets.wallpaper.url,'data:image/png;base64,'+Buffer.from('card:'+B).toString('base64'))
  assert.equal(view[0].wallpaperSelection,preview.sourceViews.phone.wallpapers[1].id)
  assert.deepEqual(view[0].wallpaperChoices.map(row=>row.name),['晴天','夜景'])
  // The player switches to 晴天 through the production picker reducer.
  const first=preview.sourceViews.phone.wallpapers[0],selected=selectPhoneWallpaper(empty.effect(),view[0].wallpaperChoices,first.id,1,1)
  view=await service.readPhonePresentation({chat,direction:{record:selected,through:1},at:1})
  assert.equal(view[0].definition.inlineSettingAssets.wallpaper.url,'data:image/png;base64,'+Buffer.from('card:'+A).toString('base64'))
  assert.equal(view[0].wallpaperSelection,first.id)
  // The player's picker offers the same candidates.
  assert.deepEqual(selectPhoneWallpaper(empty.effect(),view[0].wallpaperChoices,first.id,1,1).end.modState['dsh.phone'],{wallpaper:first.ref})
  // Whole-set layering: when 全局 supplies the set instead, the 本卡 choice no longer exists and the global default shows.
  layers={wallpaper:'global'};wallpaper=[{file:C}]
  view=await service.readPhonePresentation({chat,direction:{record:selected,through:1},at:1})
  assert.equal(view[0].definition.inlineSettingAssets.wallpaper.url,'data:image/png;base64,'+Buffer.from('global:'+C).toString('base64'))
  assert.deepEqual(view[0].wallpaperChoices,[])
})

test('the production mod service gets the config host’s resolved and readFile (the phone reads layers and their files)',async()=>{
  const source=await readFile(new URL('../tavern-plugin/lib/index.js',import.meta.url),'utf8'),adapter=source.slice(source.indexOf('config:{values:'),source.indexOf('}',source.indexOf('config:{values:'))+1)
  for(const method of ['values','bindings','resolved','readFile'])assert.match(adapter,new RegExp(method+':\\(\\.\\.\\.args\\)=>modConfigHost\\.'+method+'\\('))
})
