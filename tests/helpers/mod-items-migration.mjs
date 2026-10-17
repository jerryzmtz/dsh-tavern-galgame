import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {Context} from '@deepseek-ai/cordis'
import {SettingsProvider} from '@deepseek-ai/dsh-settings'
import {createAssetPackSettings} from '../../tavern-plugin/packages/dsh-asset-library/src/pack-v2/native-settings.js'
import {createAssetPackService} from '../../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import {sealPack,jsonBytes} from '../../tavern-plugin/packages/dsh-asset-library/src/pack-v2/validation.js'
import {writeZip} from '../../tavern-plugin/packages/dsh-asset-library/src/zip.js'
import {createModSettingsOwner,createModCardOwner} from '../../tavern-plugin/lib/fork-mod-owners.js'
import {createCardPreparation} from '../../tavern-plugin/lib/domain/card-preparation.js'
import {createCardStorage} from '../../tavern-plugin/lib/fork-card-storage.js'
import {cardAssetWorkspaceRevision} from '../../tavern-plugin/lib/fork-card-asset-bindings.js'
import {createFirstPartyMods} from '../../tavern-plugin/lib/fork-mod-builtins.js'
import {createBuiltinModService} from '../../tavern-plugin/lib/fork-mod-service.js'
import {createItemsMigrationController,createItemsCardMigrationOwner} from '../../tavern-plugin/lib/fork-mod-items-migration.js'
import {ITEMS_SOURCE_IDS} from '../../fork/mods/items/migration.js'

// All publication goes through the production owner APIs, against disposable files/providers.
export async function nativeItemsMigrationFixture(t,{input,copyRoot}={}) {
  const parent=fileURLToPath(new URL('../../.tmp/',import.meta.url));await fs.mkdir(parent,{recursive:true})
  const root=await fs.mkdtemp(path.join(parent,'native-items-')),ctx=new Context(),events=[]
  let packs,mods
  t.after(async()=>{mods?.dispose();await packs?.dispose();await ctx.fiber.dispose();await fs.rm(root,{recursive:true,force:true})})
  class MemorySettings extends SettingsProvider {
    get writable(){return true}
    async load(){return this.saved || {}}
    async persist(ns,value){this.saved={...this.saved,[ns]:structuredClone(value)};events.push('settings:'+ns)}
  }
  ctx.plugin(MemorySettings)
  ctx.plugin({name:'migration-test-owners',apply(owner){owner.provide('migrationTest',{settings:createModSettingsOwner(owner),assetSettings:createAssetPackSettings(owner)})}})
  await new Promise(resolve=>setTimeout(resolve,40))
  const {settings,assetSettings}=ctx.get('migrationTest'),currentBuiltin=await createFirstPartyMods(),assetRoot=path.join(root,'assets')
  const legacy=input?.modState.mods['dsh.items'],legacyFiles=new Map(legacy?Object.values(legacy.packs).map(pack=>['packs/'+pack.id+'.json',Buffer.from(JSON.stringify(pack))]):[])
  // Archived migration inputs are explicit fixtures, no longer current release files.
  for(const pack of Object.values(legacy?.packs || {}))for(const file of pack.files) {
    const name='packs/'+file.path
    legacyFiles.set(name,await fs.readFile(new URL('../../fork/mods/items/'+name,import.meta.url)))
  }
  const builtin=legacy?{...currentBuiltin,manifest:id=>id==='dsh.items'?legacy.manifest:currentBuiltin.manifest(id),file:(id,name)=>id==='dsh.items'&&legacyFiles.has(name)?legacyFiles.get(name):currentBuiltin.file(id,name),files:id=>id==='dsh.items'?new Map([...currentBuiltin.files(id),...legacyFiles]):currentBuiltin.files(id)}:currentBuiltin
  const filesRoot=path.join(root,'resources/cards');await fs.mkdir(filesRoot,{recursive:true})
  const prep=createCardPreparation(),storage=createCardStorage({dataRoot:root}),keys=[]
  if(copyRoot) {
    await fs.cp(path.join(copyRoot,'asset-packs'),assetRoot,{recursive:true})
    for(const name of await fs.readdir(path.join(copyRoot,'data/resources/cards')))if(name.endsWith('.json')) {
      keys.push(name);await fs.copyFile(path.join(copyRoot,'data/resources/cards',name),path.join(filesRoot,name))
    }
    for(const id of ITEMS_SOURCE_IDS) {
      const base=path.join(assetRoot,'packs',id),manifest=JSON.parse(await fs.readFile(path.join(base,'manifest.json'),'utf8'))
      for(const file of manifest.files) {
        try{await fs.access(path.join(base,file.path));continue}catch(error){if(error.code!=='ENOENT')throw error}
        const bytes=builtin.file('dsh.items','packs/'+id+'/'+file.path) || (file.path==='bundles/items/index.html'?await fs.readFile(new URL('../../fork/widgets/items/index.html',import.meta.url)):null)
        assert.ok(bytes,'Approved source file unavailable: '+file.path)
        await fs.mkdir(path.dirname(path.join(base,file.path)),{recursive:true});await fs.writeFile(path.join(base,file.path),bytes)
      }
    }
  } else {
    for(const card of input.cards) {
      const value=structuredClone(card.value)
      value.assetBindings.boundPackIds=value.assetBindings.boundPackIds.map(id=>id==='phone-pack'?'da95db75-cad8-43a9-92e2-ad15cb290b83':id)
      const name=card.key+'.json';keys.push(name)
      const workspace=prep.create({kind:'import',payload:{name:card.key,extensions:{dsh_tavern:value,foreign:{preserved:true}}}})
      await fs.writeFile(path.join(filesRoot,name),JSON.stringify(workspace))
    }
  }
  packs=createAssetPackService({assetRoot})
  if(!copyRoot)for(const source of input.packs) {
    const manifest=structuredClone(source.manifest),files=new Map()
    Object.assign(manifest,{format:'dsh-asset-pack',schemaVersion:1,name:'Migration fixture',description:'',credits:[],contentHash:'0'.repeat(64),bundles:{},files:[]})
    for(const [hash,blob] of Object.entries(manifest.blobs)) {blob.mime='image/png';files.set('media/'+hash+'.png',builtin.file('dsh.items','packs/'+manifest.id+'/media/'+hash+'.png'))}
    for(const asset of manifest.assets) {
      asset.name ||= 'items';asset.directorNote ||= '';asset.recall ||= {mode:'keyword',keywords:[]}
      if(asset.kind==='widgets') {
        asset.bundleKey='items';asset.entry='widget.json';manifest.bundles.items={kind:'widget',entry:'widget.json',contentHash:'0'.repeat(64)}
        for(const file of ['widget.json','index.html'])files.set('bundles/items/'+file,await fs.readFile(new URL('../../fork/widgets/items/'+file,import.meta.url)))
      }
    }
    await sealPack(manifest,files)
    const file=path.join(root,manifest.id+'.zip');await writeZip(file,[{path:'manifest.json',data:jsonBytes(manifest)},...[...files].map(([path,data])=>({path,data}))])
    const preview=await packs.inspectImport({bytes:await fs.readFile(file)})
    await packs.applyImport({inspectionId:preview.inspectionId,expectedRevision:preview.expectedRevision,decision:'install',acceptScriptRisk:true})
  }
  const readWorkspace=async key=>JSON.parse(await fs.readFile(path.join(filesRoot,path.basename(key)),'utf8'))
  const writeWorkspace=async(key,value)=>{events.push('card:'+key);await fs.writeFile(path.join(filesRoot,path.basename(key)),JSON.stringify(value))}
  const cardConfig={cardPreparation:prep,listPaths:async()=>keys,readWorkspace,writeWorkspace,withCardLock:storage.withCardLock}
  const cardOwner=createModCardOwner(cardConfig)
  mods=createBuiltinModService({root:path.join(root,'mods'),settings,cards:cardOwner,readCard:readWorkspace,stage:{},variables:{},builtins:builtin})
  const migrationCards=createItemsCardMigrationOwner({...cardConfig,async updateCard(key,patch,revision,rawOperations,expectedRevision) {
    const original=await readWorkspace(key)
    return storage.withCardLock(original.meta.id,async()=>{
      const before=await readWorkspace(key);assert.equal(cardAssetWorkspaceRevision(before),expectedRevision)
      const change=prep.update({kind:'card',card:before,patch,revision,rawOperations})
      if(change.changed)await writeWorkspace(key,change.card)
    })
  }})
  const originalPacks=new Map((await packs.listPacks()).map(row=>[row.manifest.id,row]))
  await mods.ownerSnapshot()
  const config={root:path.join(root,'migration'),cards:migrationCards,mods,modSettings:settings,assetSettings,packs,assertIdle:async()=>{},inspectReplay:async()=>[{chatId:'offline',turn:1,revision:'unchanged'}]}
  return {root,events,keys,config,mods,settings,assetSettings,packs,readWorkspace,originalPacks,open:()=>createItemsMigrationController(config)}
}
