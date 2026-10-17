import {createModConfigStore,createModConfigRpc} from './fork-mod-config.js'
import {createModConfigCardPacks} from './fork-mod-config-card-packs.js'
import {createModConfigService,validateConfigValue} from './domain/mods/config.js'
import {createConfigSourceRegistry} from './domain/mods/config-sources.js'
import {builtinConfigSchemas,stageConfigExports} from './domain/mods/config-builtins.js'
import {rawData} from './domain/card-preparation.js'
import {effectiveCardStage} from './domain/card-stage-settings.js'
import {cardAssetWorkspaceRevision} from './fork-card-asset-bindings.js'
import {readCardVariableSources} from './domain/card-variable-bindings.js'
import skinContract from '../packages/dsh-presentation-protocol/src/stage-skin.cjs'
import {figureCatalogue,effectiveFigurePackIds} from './domain/figure-catalogue.js'
import {stateSourceSchema,ledgerSource,ledgerConfigExports,resolveStateSource,ledgerInventoryBinding} from './domain/mods/state-source.js'
import {ITEM_CATEGORY_IDS} from '../../fork/mods/items/categories.js'
import {ASSET_PACK_RECORD_FIELD,readAssetPackRecord} from './domain/stage-asset-pack-director.js'
const fail=(code,message)=>{throw Object.assign(new Error(message),{code})}

export function createModConfigStageReader({readChat,readRevision}) {
  return async (sessionId,revision)=>{
    let chat=await readChat(sessionId)
    // Background writes may advance the head while config reads its pinned variable window.
    if(chat && chat._storageRevision!==revision) {
      chat=await readRevision(chat.id,revision)
      if(!chat)fail('REVISION_CONFLICT','Stage read point unavailable')
    }
    if(chat && (chat._storageRevision!==revision || chat.sessionId!==sessionId))fail('REVISION_CONFLICT','Stage read point changed')
    const row=chat?.messages.findLast(message=>message.role==='assistant' && message[ASSET_PACK_RECORD_FIELD])
    if(!row)return null
    const record=readAssetPackRecord(row[ASSET_PACK_RECORD_FIELD])
    return record.entries.at(-1)?.state || record.baseline
  }
}

export function createModConfigHost({workbenchAuthority,root,manifests,listCards,readCard,getAssetLibrary,readSession,readWindow,getEngine,readStage=async()=>null,invalidate,getGlobalEnabledPackIds=()=>[]}) {
  const schemas={...builtinConfigSchemas(manifests),'dsh.state':stateSourceSchema},registered=new WeakSet(),cache=new Map()
  function register(packs) {
    if(!packs || packs.apiVersion!==2 || typeof packs.registerModPrivate!=='function')fail('SOURCE_UNAVAILABLE','Native mod config pack owner unavailable')
    if(registered.has(packs))return packs
    for(const [modId,schema] of Object.entries(schemas).filter(([id])=>id!=='dsh.state'))packs.registerModPrivate({modId,validate:config=>{
      if(!config || config.version!==1 || Object.keys(config).some(key=>!['version','values'].includes(key)) || !config.values || typeof config.values!=='object' || Array.isArray(config.values))fail('CONFIG_TYPE','Invalid mod config document')
      for(const [key,value] of Object.entries(config.values)) {
        const field=schema.fields.find(row=>row.key===key)
        if(!field)fail('UNKNOWN_FIELD','Unknown config key: '+modId+':'+key)
        validateConfigValue(value,field)
      }
    }})
    registered.add(packs);return packs
  }
  const getPacks=async()=>register(getAssetLibrary())
  const cardPacks=createModConfigCardPacks({listCards,readCard,getPacks}),store=createModConfigStore({root,cardPacks}),sources=createConfigSourceRegistry()
  for(const id of ['mvu','helper-chat'])sources.register({id,label:id==='mvu'?'MVU':'聊天变量',exports:[],read:ctx=>ctx.sources?.[id] || {available:false}})
  sources.register({id:'ledger',label:'游玩台账',exports:ledgerConfigExports,read:ctx=>ctx.sources?.ledger || {available:false}})
  sources.register({id:'stage',label:'舞台',exports:stageConfigExports,read:ctx=>ctx.sources?.stage || {available:false}})
  for(const [id,schema] of Object.entries(schemas).filter(([id])=>id!=='dsh.state'))sources.register({id:'mod:'+id,label:manifests.find(row=>row.id===id).name,exports:schema.fields.map(field=>({path:'/'+field.key,name:field.label || field.key,type:field.valueType,description:field.label || field.key,settingKey:field.key})),read:({settings})=>settings})
  const service=createModConfigService({schemas,store,sources})
  async function context(args,pinned) {
    const indexed=pinned?.chat || (args.sessionId?await readSession(args.sessionId):null)
    if(args.sessionId && !indexed)fail('NOT_FOUND','Session not found')
    let card=pinned?.card?{path:indexed?.cardPath,workspace:pinned.card}:args.cardId?await cardPacks.lookup(args.cardId):null
    if(indexed && !card){const workspace=await readCard(indexed.cardPath);if(!workspace)fail('NOT_FOUND','Session card unavailable');card={path:indexed.cardPath,workspace}}
    if(indexed && indexed.cardPath!==card.path)fail('NOT_FOUND','Session does not belong to card')
    if(!card)return {}
    const setting=await service.resolve('dsh.state','source'),preference=setting.value
    const engine=getEngine(),revision=JSON.stringify([cardAssetWorkspaceRevision(card.workspace),indexed?._storageRevision,engine.revision,engine.assetRevision,getGlobalEnabledPackIds(),preference,indexed?.timeline?.branchId,indexed?.ledger])
    const key=JSON.stringify([card.workspace.meta.id,args.sessionId,revision])
    if(cache.has(key))return cache.get(key)
    const source=indexed?await readCardVariableSources({path:card.path,indexed,readWindow}):{},ext=rawData(card.workspace.raw).extensions?.dsh_tavern || {},stage={},labels={}
    const packs=await getPacks(),lead=ext.openings?.lead,state=args.sessionId?await readStage(args.sessionId,indexed?._storageRevision):null
    if(state) {
      if(state.scene?.background)stage.background=state.scene.background
      if(state.scene?.timeOfDay)stage.timeOfDay=state.scene.timeOfDay
      if(state.music)stage.bgm=state.music
      const actors=(state.cast || []).map(id=>({id,actor:state.actors?.[id]})).filter(row=>row.actor?.figure)
      const figures=actors.length?await packs.resolveFigures({refs:actors.map(row=>row.actor.figure)}):[]
      stage.characters=actors.map(({id,actor},i)=>({id,name:actor.name || id,figure:actor.figure,...(figures[i]?.value?.imageColor || figures[i]?.value?.autoColor?{color:figures[i].value.imageColor || figures[i].value.autoColor}:{})}))
      if(state.speaker)stage.speaker=state.speaker
    }
    if(lead) {
      const figure=(await packs.resolveFigures({refs:[lead]}))[0]?.value
      if(figure) {
        stage.mainCharacterColor=figure.imageColor ?? figure.autoColor
        if(stage.mainCharacterColor===undefined)delete stage.mainCharacterColor
        labels['/mainCharacterColor']=(figure.name || rawData(card.workspace.raw).name)+'形象色'
        if(!state)stage.characters=[{...lead,name:figure.name || rawData(card.workspace.raw).name,...(stage.mainCharacterColor?{color:stage.mainCharacterColor}:{})}]
      }
    }
    // private fork (settings-ux r2, owner 2026-10): the phone's contacts as the stage builds them (stage-asset-pack-director
    // phone.characters): the enabled figures of the card's packs through the one figure catalogue, keyed by actor key.
    if(ext.assetBindings) {
      const global=getGlobalEnabledPackIds(),ids=effectiveFigurePackIds(ext.assetBindings,global)
      const snapshots=(await Promise.all(ids.map(packId=>packs.getPackSnapshot({packId}).catch(()=>null)))).filter(Boolean)
      stage.contacts=figureCatalogue({snapshots,bindings:ext.assetBindings,globalEnabledPackIds:global,roster:state?.actors || {}}).filter(row=>row.enabled)
        .map(row=>({id:row.actorKey,name:row.name,figure:row.ref,...(row.figure.imageColor || row.figure.autoColor?{color:row.figure.imageColor || row.figure.autoColor}:{})}))
    }
    const skinRef=state?.skin?.ref || effectiveCardStage(ext,engine.values).defaultSkin
    const skin=typeof skinRef==='string'?skinContract.BUILTIN_STAGE_SKINS[skinRef]:skinRef?(await packs.getPackSnapshot({packId:skinRef.packId}))?.skins?.[skinRef.assetId]:null
    const appearance=skin && skinContract.stageSkinAppearance(skin,state?.skin?.level)
    if(appearance?.ui){stage.skin=Object.fromEntries(Object.entries({surface:appearance.ui.bg,line:appearance.ui.border,accent:appearance.ui.accent}).filter(([,value])=>value!==undefined));labels['/skin/surface']='舞台皮肤';labels['/skin/line']='舞台皮肤'}
    source.stage={available:true,value:stage,labels}
    source.ledger=ledgerSource(indexed)
    const stateSource=resolveStateSource({preference,raw:card.workspace.raw,chat:indexed,sources:source})
    const value={cardId:card.workspace.meta.id,sessionId:args.sessionId,raw:card.workspace.raw,revision,sources:source,stateSource}
    cache.set(key,value);if(cache.size>32)cache.delete(cache.keys().next().value)
    return value
  }
  const rpc=createModConfigRpc({schemas,store,sources,context,authorize:({context})=>typeof context?.origin==='string' || !!workbenchAuthority && context===workbenchAuthority})
  return Object.freeze({schemas,store,service,cardPacks,context,register,async call(method,args,authority) {
    const value=await rpc[method](args,authority)
    if(['setModConfig','clearModConfig','uploadModConfigFile'].includes(method)){cache.clear();invalidate()}
    return value
  },async values(modId,card,chat) {return (await this.resolved(modId,card,chat)).values},
  // private fork (mod-pages): a reference or formula that cannot be read shows the declared default on stage (the
  // editor alone shows the ⚠); layers say which layer's files/ an uploaded image is read from.
  async resolved(modId,card,chat) {
    const result=await service.get({modId,...await context({cardId:card.meta.id,sessionId:chat?.sessionId},chat?{card,chat}:undefined)}),values={},layers={}
    for(const [key,row] of Object.entries(result.resolved)) {
      values[key]=row.error?structuredClone(schemas[modId].fields.find(field=>field.key===key).default):row.value
      layers[key]=row.error?'auto':row.layer
    }
    return {values,layers}
  },
  async categoryMedia(ref,cardId) {
    if(ref.packId==='builtin' && ITEM_CATEGORY_IDS.includes(ref.entryId))return {modId:'dsh.items',layer:'global',path:'categories/'+ref.entryId+'.png',revision:'builtin'}
    const result=await service.get({modId:'dsh.items',...await context({cardId})}),category=result.resolved.categories
    const row=!category.error && category.value.find(row=>row.icon.file?.slice(6,42)===ref.entryId)
    if(!row || ref.packId!=='config.'+category.layer)fail('MOD_RESOURCE_UNAVAILABLE','Category icon is no longer configured')
    return {modId:'dsh.items',layer:category.layer,cardId,path:row.icon.file,revision:result.revision}
  },
  async stateSource(chat,raw) {
    const preference=(await service.resolve('dsh.state','source')).value
    const sources=await readCardVariableSources({path:chat.cardPath,indexed:chat,readWindow})
    return resolveStateSource({preference,raw,chat,sources})
  },
  readFile:args=>store.readFile(args),async bindings(manifest,card,chat,overrideSources) {
    const ctx=overrideSources?{cardId:card.meta.id,raw:card.raw,sources:overrideSources}:await context({cardId:card.meta.id,sessionId:chat?.sessionId},chat?{card,chat}:undefined)
    if(overrideSources)ctx.stateSource=resolveStateSource({preference:(await service.resolve('dsh.state','source')).value,raw:card.raw,chat,sources:overrideSources})
    const data=await store.read({modId:manifest.id,cardId:card.meta.id}),result={}
    for(const read of manifest.permissions.variables?.reads || [])if(read.slot) {
      const entry=data.card[read.slot] ?? data.global[read.slot] ?? {auto:true}
      const slot=manifest.variableSlots.find(slot=>slot.id===read.slot)
      if(entry.auto && manifest.id==='dsh.items' && slot.id==='inventory' && ctx.stateSource?.source==='ledger') {
        if(ctx.stateSource.available)result[read.id]=structuredClone(ledgerInventoryBinding)
      } else if(entry.ref && ['mvu','ledger'].includes(entry.ref.source))result[read.id]=entry.ref
      else if(entry.auto) {
        const resolved=await service.resolve(manifest.id,read.slot,ctx),field=schemas[manifest.id].fields.find(row=>row.key===read.slot),candidate=resolved.autoCandidates?.[0]
        if(!resolved.error && candidate?.variable.source===slot.source && candidate.score>=(field.guessHints?.threshold ?? 65))result[read.id]=candidate.variable
      }
    }
    return result
  }})
}
