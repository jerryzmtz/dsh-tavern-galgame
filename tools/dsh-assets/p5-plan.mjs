// Explicit offline conversion only; shared by publication, mirror authoring and owner migration.
import assert from 'node:assert/strict'
import {isDeepStrictEqual as equal} from 'node:util'

const TIMES = ['day','dusk','night']
const ref = (packId, asset) => ({packId,kind:asset.kind,assetId:asset.id})
export const p5RefKey = value => JSON.stringify([value.packId,value.kind,value.assetId ?? value.figureId])
const pick = (value, keys) => Object.fromEntries(keys.filter(key => Object.hasOwn(value,key)).map(key => [key,structuredClone(value[key])]))
const omit = (value, keys) => Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)))

export function flattenP5Background(asset, proof) {
  if (Array.isArray(asset.variants?.entries)) return structuredClone(asset)
  if (!Object.hasOwn(asset,'baseTime') && !Object.hasOwn(asset,'variants')) return structuredClone(asset)
  const old = asset.variants || {}, content = pick(asset,['media','pendingMedia','tags','stageTheme'])
  assert.ok(Object.keys(old).every(key => TIMES.includes(key)), 'Unknown background time key: '+asset.id)
  let base = asset.baseTime
  if (proof) {
    assert.equal(proof.media,asset.media,'Base proof no longer identifies the original image')
    assert.ok(TIMES.includes(proof.timeOfDay) && proof.evidence,'Explicit base identity evidence is required')
    assert.ok(!base || base === proof.timeOfDay,'Base evidence conflicts with authored time')
    base = proof.timeOfDay
  }
  if (!base) {
    const matches = TIMES.filter(key => old[key] === asset.media && asset.media != null)
    base = matches.length === 1 ? matches[0] : 'base'
  }
  assert.ok(!old[base] || old[base] === asset.media,'Base time collides with a different image: '+asset.id)
  const entries = [{id:base,name:base,content}]
  for (const id of TIMES) if (old[id] && id !== base) entries.push({id,name:id,content:{...omit(content,['pendingMedia']),media:old[id]}})
  const next = omit(asset,['media','pendingMedia','tags','stageTheme','baseTime','variants'])
  next.variants = {default:base,entries}
  return next
}

export function flattenP5Cg(asset) {
  if (!Array.isArray(asset.variants)) return structuredClone(asset)
  assert.ok(asset.variants.some(row => row.key === asset.defaultVariant),'CG default is missing: '+asset.id)
  const next = omit(asset,['defaultVariant','variants','focusHints'])
  next.variants = {default:asset.defaultVariant,entries:asset.variants.map(row => ({id:row.key,name:row.label,content:{media:row.media,description:row.description,...pick(asset,['focusHints'])}}))}
  return next
}

function privateProps(pack) {
  const files = new Map(pack.files.map(file => [file.path,file])), fileInputs = new Map()
  const assets = pack.entries.filter(entry => entry.kind === 'item').map(entry => {
    const sourcePath = entry.media?.image, source = files.get(sourcePath)
    assert.ok(source,'Private item image is not in its file closure: '+entry.id)
    const match = /(?:^|\/)([a-f0-9]{64})\.(png|webp|jpeg)$/.exec(sourcePath)
    assert.ok(match,'Private image has no stored media identity: '+sourcePath)
    const [,hash,ext] = match, destination = 'media/'+hash+'.'+ext
    fileInputs.set(destination,{path:destination,sourcePath,size:source.size,sha256:hash,blob:{ext,mime:'image/'+ext,size:source.size}})
    return {kind:'props',id:entry.id,name:entry.name,enabled:entry.enabled,recall:structuredClone(entry.recall),directorNote:entry.directorNote || '',media:hash,
      ...pick(entry,['description','aliases']),...(entry.fields?.genreId?{category:entry.fields.genreId}:{}),
      ...(entry.fields && Object.keys(entry.fields).length?{extensions:{'dsh.items':pick(entry.fields,['genreId','inventoryId'])}}:{})}
  })
  // Non-image credits stay in the declared archive rather than silently losing attribution.
  for (const file of pack.files) if (/\/credits\//.test(file.path)) {
    const destination = 'credits/'+file.path.split('/credits/')[1]
    fileInputs.set(destination,{path:destination,sourcePath:file.path,size:file.size})
  }
  const inputs = [...fileInputs.values()]
  return {manifest:{format:'dsh-asset-pack',schemaVersion:1,id:pack.id,name:pack.name,contentHash:'0'.repeat(64),assets,figures:[],sprites:{},bundles:{},
    blobs:Object.fromEntries(inputs.filter(file=>file.blob).map(file=>[file.sha256,file.blob])),
    files:inputs.map(({path,size,sha256})=>({path,size,...(sha256?{sha256}:{})}))},fileInputs:inputs}
}

export function planModsP5({snapshots,mods = [],baseIdentities = [],assetSettings,cards = []}) {
  const targets=[],refMap=[],requests=[],audit={timeLooks:[],emptyKeywordTimeLooks:[],moodLooks:[],missingBaseTime:[],backgrounds:0,legacyBackgroundTables:0,cg:0,phone:[],privateItems:[]},blockers=[]
  const proofMap = new Map(baseIdentities.map(row=>[p5RefKey(row.ref),row]))
  for (const snapshot of snapshots) {
    assert.ok(snapshot?.manifest && typeof snapshot.revision === 'string','Official pack snapshot/revision required')
    const before=snapshot.manifest, manifest=structuredClone(before), assets=[]
    for (const asset of before.assets) {
      const from=ref(before.id,asset), key=p5RefKey(from)
      if (asset.kind === 'looks' && asset.layer === 'time') {
        const row={ref:from,name:asset.name,timeOfDay:asset.timeOfDay,params:asset.params,enabled:asset.enabled,recall:asset.recall}
        audit.timeLooks.push(row)
        if (asset.recall.mode === 'keyword' && !asset.recall.keywords.length) audit.emptyKeywordTimeLooks.push(row)
        refMap.push({from,to:null,reason:'retired-pack-time-look',coreTime:asset.timeOfDay})
        continue
      }
      if (asset.kind === 'widgets' && before.id === 'da95db75-cad8-43a9-92e2-ad15cb290b83' && asset.id === 'phone') {
        audit.phone.push({ref:from,reason:'builtin-device-owner'})
        refMap.push({from,to:null,reason:'phone-builtin-not-library'})
        continue
      }
      let next=structuredClone(asset)
      if (asset.kind === 'backgrounds') {
        audit.backgrounds++
        if (asset.variants && !Array.isArray(asset.variants.entries)) audit.legacyBackgroundTables++
        next=flattenP5Background(asset,proofMap.get(key))
        if (!asset.baseTime && asset.variants && !Array.isArray(asset.variants.entries)) audit.missingBaseTime.push({ref:from,media:asset.media,default:next.variants.default,evidence:proofMap.get(key)?.evidence || (next.variants.default==='base'?'original-base-identity-only':'existing-time-key-image-identity')})
      }
      if (asset.kind === 'cg') {audit.cg++;next=flattenP5Cg(asset)}
      if (asset.kind === 'looks' && asset.layer === 'mood') audit.moodLooks.push({ref:from,value:asset})
      assets.push(next)
      if (!equal(asset,next)) refMap.push({from,to:from,...(next.variants?{default:next.variants.default,variants:next.variants.entries.map(row=>row.id)}:{})})
    }
    manifest.assets=assets
    if (equal(before,manifest)) continue
    targets.push({packId:before.id,revision:snapshot.revision,manifest,needsSeal:true,mediaClosure:structuredClone(before.files)})
    const legacyContent=before.assets.some(asset=>asset.variants && !Array.isArray(asset.variants.entries))
    // Archive ingress validates the target independently of the retired source content shape.
    // patchPack's metadata/resource comparison deliberately understands only the new schema.
    if (legacyContent) requests.push({owner:'assetLibrary',method:'inspectImport',packId:before.id,expectedSourceRevision:snapshot.revision,args:{bytes:{$archive:before.id}},
      then:{method:'applyImport',args:{inspectionId:'$inspection.inspectionId',expectedRevision:'$inspection.expectedRevision',decision:'update',acceptScriptRisk:true}},
      preconditions:['inspection.expectedRevision === expectedSourceRevision','inspection.voiceChanges.length === 0','inspection.incoming equals reviewed target']})
    else requests.push({owner:'assetLibrary',method:'patchPack',args:{packId:before.id,expectedRevision:snapshot.revision,patch:{assets}}})
  }
  for (const mod of mods) {
    assert.equal(typeof mod.revision,'string','Official mod revision required')
    for (const pack of mod.packs) {
      if (mod.modId === 'dsh.items') {
        const unknown=pack.entries.filter(row=>!['item','icon'].includes(row.kind))
        if (unknown.length) {blockers.push({code:'UNKNOWN_PRIVATE_ITEM_KIND',packId:pack.id});continue}
        const props=privateProps(pack), existing=snapshots.find(row=>row.manifest.id===pack.id)
        if (existing && !equal(existing.manifest.assets,props.manifest.assets)) {blockers.push({code:'TARGET_ID_COLLISION',packId:pack.id});continue}
        if (!existing && props.manifest.assets.length) {
          targets.push({packId:pack.id,revision:null,...props,needsSeal:true,sourceModId:mod.modId,mediaClosure:props.manifest.files})
          requests.push({owner:'assetLibrary',method:'inspectImport',packId:pack.id,args:{bytes:{$archive:pack.id}},then:{method:'applyImport',args:{inspectionId:'$inspection.inspectionId',expectedRevision:'$inspection.expectedRevision',decision:'install'}}})
        }
        for (const entry of pack.entries) refMap.push({from:{modId:mod.modId,packId:pack.id,kind:entry.kind,entryId:entry.id},to:entry.kind==='item'?{packId:pack.id,kind:'props',assetId:entry.id}:null,reason:entry.kind==='item'?'private-item-to-core-props':'builtin-category-icon'})
        audit.privateItems.push({packId:pack.id,items:props.manifest.assets.length,icons:pack.entries.filter(row=>row.kind==='icon').length})
      } else if (mod.modId === 'dsh.phone') {
        audit.phone.push({packId:pack.id,entries:pack.entries.length})
        if (pack.entries.length || pack.files.length) {blockers.push({code:'PHONE_UPLOAD_MIGRATION_REQUIRED',packId:pack.id});continue}
      } else continue
      requests.push({owner:'mods',method:'deleteModPack',args:{modId:mod.modId,packId:pack.id,confirmed:true,expectedRevision:'$previousModReceipt.revision'},initialRevision:mod.revision,after:'destination-import-and-lamp-readback'})
    }
  }
  const itemPackIds = new Set(audit.privateItems.filter(row=>row.items).map(row=>row.packId))
  const globalProps = mods.find(mod=>mod.modId==='dsh.items')?.packScopes?.filter(row=>row.scope==='global' && itemPackIds.has(row.id)).map(row=>row.id) || []
  const lamps=[]
  if (globalProps.length) {
    assert.ok(assetSettings?.revision && assetSettings.values,'Native pack settings snapshot required')
    const ids=[...new Set([...assetSettings.values.globalEnabledPackIds,...globalProps])]
    if (!equal(ids,assetSettings.values.globalEnabledPackIds)) lamps.push({owner:'assetPackSettings',method:'saveSettings',args:{expectedRevision:assetSettings.revision,globalEnabledPackIds:ids}})
  }
  for (const card of cards) {
    const bound=card.extension.modBindings?.mods?.['dsh.items']?.boundPackIds?.filter(id=>itemPackIds.has(id)) || []
    if (!bound.length) continue
    const bindings=card.bindings.extension?.assetBindings
    if (!bindings) {blockers.push({code:'MISSING_CARD_ASSET_BINDINGS',path:card.path});continue}
    const ids=[...new Set([...bindings.boundPackIds,...bound])]
    if (!equal(ids,bindings.boundPackIds)) lamps.push({owner:'cardPreparation',method:'saveCardAssetBindings',args:{path:card.path,expectedRevision:card.bindings.revision,patch:{assetBindings:{...bindings,boundPackIds:ids}}}})
  }
  const firstDelete=requests.findIndex(row=>row.owner==='mods')
  requests.splice(firstDelete<0?requests.length:firstDelete,0,...lamps)
  return {version:1,mode:'dry-run',targets,refMap,requests,audit,blockers,promptBytes:0,toolSchemaBytes:0}
}

