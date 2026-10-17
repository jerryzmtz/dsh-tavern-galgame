// private fork: inventory only; never instantiate the mutating library service.
import path from 'node:path'
import {readFile,readdir,access} from 'node:fs/promises'
import {loadProject,safeProjectFile,productionError,intentionalProductionFallback} from '../../tavern-plugin/lib/domain/asset-production-project.js'
import {availableLayeredManifest} from './layered.mjs'
import hybrid from '../../tavern-plugin/packages/dsh-asset-library/lib/shared/hybrid-sprite.cjs'
const kinds=['live2d','sprite','avatar','blink','mouth','settei','background','cg','avatar-sheet','part','base','recipe','rig']
export async function missingImages(root,{library,figure,outfit,kind}={}) {
  if(kind&&!kinds.includes(kind))throw productionError('INVALID_ARGUMENT','Unknown missing kind')
  const rows=[],packs=[]
  const add=row=>{if((!figure||[row.figure,row.figureId].includes(figure))&&(!outfit||row.outfit===outfit)&&(!kind||row.kind===kind))rows.push(row)}
  if(!library) {
    const p=await loadProject(root);packs.push({id:p.id,name:p.name})
    const layered={}
    for(const [key,value]of Object.entries(p.layered||{})) {
      const entry=structuredClone(value),[character,outfit]=key.split('/')
      for(const [src,a]of Object.entries(entry.assets))try{await access(await safeProjectFile(root,a.path))}catch(e){if(e.code!=='ENOENT')throw e;delete entry.assets[src]}
      layered[key]=availableLayeredManifest(entry)
      const marks=p.characters.find(c=>c.key===character)?.outfits.find(o=>o.key===outfit)?.fallbackEmotions || []
      for(const id of marks)delete layered[key].emotions[id]
      for(const slot of hybrid.hybridMissing(layered[key]).slots)if(slot.kind!=='emotion')add({project:path.resolve(root),pack:p.id,figure:character,outfit,emotion:null,kind:slot.group==='underlay'?'base':slot.kind,slot:slot.id,rig:slot.rig,code:slot.code,emotions:slot.emotions})
    }
    for(const s of Object.values(p.slots)) {
      if(s.installed || s.optional || intentionalProductionFallback(p,s))continue
      const doc=layered[s.character+'/'+s.outfit],render=doc?.emotions[s.emotion]?.render
      if(render&&['parts','missing'].includes(render.kind)) {
        if(['blink','mouth'].includes(s.kind))continue
        if(s.kind==='sprite') {
          if(!hybrid.resolveHybridSprite(doc,s.emotion).available)add({project:path.resolve(root),pack:p.id,figure:s.character,outfit:s.outfit,emotion:s.emotion,kind:'sprite',slot:s.id})
          continue
        }
      }
      let present=Boolean(s.artifact)
      if(present)try{await access(await safeProjectFile(root,s.artifact.path))}catch(e){if(e.code!=='ENOENT')throw e;present=false}
      if(present)continue
      add({project:path.resolve(root),pack:p.id,figure:s.character||null,outfit:s.outfit||null,emotion:s.emotion||null,kind:s.kind==='identity-settei'?'settei':s.kind,slot:s.id,...(s.frame?{frame:s.frame}:{})})
    }
  } else {
    const base=path.resolve(library),read=async rel=>JSON.parse(await readFile(await safeProjectFile(base,rel),'utf8'))
    for(const entry of (await readdir(await safeProjectFile(base,'packs'),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
      if(!entry.isDirectory())continue
      const prefix='packs/'+entry.name+'/',manifest=await read(prefix+'manifest.json')
      packs.push({id:manifest.id,name:manifest.name})
      const exists=async hash=>{const blob=manifest.blobs?.[hash];if(!blob)return false;try{await access(await safeProjectFile(base,prefix+'media/'+hash+'.'+blob.ext));return true}catch(e){if(e.code==='ENOENT')return false;throw e}}
      for(const id of manifest.figures) {
        const f=await read(prefix+'figures/'+id+'.json')
        const addSlot=(o,emotion,kind)=>add({pack:manifest.id,packName:manifest.name,figure:f.name,figureId:id,outfit:o?.key||null,emotion,kind})
        if(!await exists(f.identitySettei?.board))addSlot(null,null,'settei')
        for(const o of f.outfits) {
          if(!await exists(o.settei))addSlot(o,null,'settei')
          const sprite=o.sprite,doc=sprite&&manifest.sprites[sprite.manifestKey]?await read(prefix+manifest.sprites[sprite.manifestKey]):null
          const ids=(f.emotions || []).map(row=>row.id).filter(id=>!o.fallbackEmotions?.includes(id))
          if(o.live2d) {
            const descriptor=manifest.bundles?.[o.live2d.bundleKey],modelPath=descriptor && 'bundles/'+o.live2d.bundleKey+'/'+descriptor.entry
            let model=null
            if(modelPath)try{model=await read(prefix+modelPath)}catch(e){if(e.code!=='ENOENT')throw e}
            for(const emotion of ids) {
              const expression=o.live2d.emotionMap?.[emotion]?.expression
              if(emotion===(o.defaultEmotion ?? f.emotions?.[0]?.id) && !expression && model)continue
              const file=model?.FileReferences?.Expressions?.find(e=>e.Name===expression)?.File
              let present=false
              if(file)try{await access(await safeProjectFile(base,prefix+path.posix.join(path.posix.dirname(modelPath),file)));present=true}catch(e){if(e.code!=='ENOENT')throw e}
              if(!present)addSlot(o,emotion,'live2d')
            }
          }
          if(doc?.kind==='hybrid-face-sprites') {
            const availableDoc=structuredClone(doc)
            for(const rig of Object.values(availableDoc.rigs))for(const [id,part] of Object.entries(rig.parts))if(!await exists(sprite.assets[part.src]))delete rig.parts[id]
            const physical=hybrid.hybridMissing({...availableDoc,emotions:Object.fromEntries(Object.entries(availableDoc.emotions).filter(([id])=>ids.includes(id)))})
            for(const slot of physical.slots)if(slot.kind!=='emotion')add({pack:manifest.id,packName:manifest.name,figure:f.name,figureId:id,outfit:o.key,emotion:null,kind:slot.group==='underlay'?'base':slot.kind,slot:slot.id,rig:slot.rig,code:slot.code,emotions:slot.emotions})
            for(const emotion of new Set(ids)) {
              const result=hybrid.resolveHybridSprite(availableDoc,emotion)
              if(result.kind==='whole') {
                const entry=result.legacy.emotions[emotion],view=entry.stage||entry
                if(!await exists(sprite.assets[view.src]))addSlot(o,emotion,'sprite')
                if(!await exists(o.avatars?.[emotion])&&!await exists(sprite.assets[entry.portrait?.src]))addSlot(o,emotion,'avatar')
                if(!await exists(sprite.assets[(entry.blink||entry.stage?.blink)?.closed]))addSlot(o,emotion,'blink')
                const atlas=result.legacy.mouthSets?.[entry.mouthSet]||result.legacy.mouthAtlas
                if(atlas&&Object.keys(entry.mouthFrames||{}).length&&!await exists(sprite.assets[atlas.src]))for(const frame of Object.keys(entry.mouthFrames))add({pack:manifest.id,figure:f.name,figureId:id,outfit:o.key,emotion,kind:'mouth',frame})
                const mouth=result.legacy.rig?.mouthSets?.[entry.binding?.mouth?.set]
                if(mouth)for(const [frame,src] of Object.entries(mouth.frames))if(!await exists(sprite.assets[src]))add({pack:manifest.id,figure:f.name,figureId:id,outfit:o.key,emotion,kind:'mouth',frame})
              } else {
                if(!result.available)addSlot(o,emotion,'sprite')
                if(!await exists(o.avatars?.[emotion]))addSlot(o,emotion,'avatar')
              }
            }
            continue
          }
          for(const emotion of new Set(ids)) {
            // Current model: only explicit emotion ownership, never defaultState fallback.
            const state=doc?.emotions?.[emotion]
            const assets=sprite?.assets||{}
            const view=state?.stage||state
            const own=state&&!state.fallback&&(view.src?await exists(assets[view.src]):view.layers?.length? (await Promise.all(view.layers.map(l=>exists(assets[l.src])))).every(Boolean):false)
            if(sprite&&!own)addSlot(o,emotion,'sprite')
            if(!await exists(o.avatars?.[emotion])&&!await exists(assets[state?.portrait?.src]))addSlot(o,emotion,'avatar')
            if(sprite&&!state?.eyesClosed&&!await exists(assets[(state?.blink||state?.stage?.blink)?.closed]))addSlot(o,emotion,'blink')
            // Mouth is optional in native packs: list only declared rigs, not invented requirements.
            const atlas=doc?.mouthSets?.[state?.mouthSet]||doc?.mouthAtlas
            if(atlas&&Object.keys(state?.mouthFrames||{}).length&&!await exists(assets[atlas.src]))for(const frame of Object.keys(state.mouthFrames))add({pack:manifest.id,packName:manifest.name,figure:f.name,figureId:id,outfit:o.key,emotion,kind:'mouth',frame})
            const mouth=doc?.rig?.mouthSets?.[state?.binding?.mouth?.set]
            if(mouth)for(const [frame,resource] of Object.entries(mouth.frames||{}))if(!await exists(assets[resource]))add({...{pack:manifest.id,packName:manifest.name,figure:f.name,figureId:id,outfit:o.key,emotion,kind:'mouth'},frame})
          }
        }
      }
    }
  }
  rows.sort((a,b)=>JSON.stringify([a.pack,a.figure,a.outfit,a.emotion,a.kind,a.frame]).localeCompare(JSON.stringify([b.pack,b.figure,b.outfit,b.emotion,b.kind,b.frame])))
  const byKind={},byPack=packs.map(p=>({...p,missing:rows.filter(r=>r.pack===p.id).length}))
  for(const r of rows)byKind[r.kind]=(byKind[r.kind]||0)+1
  return {mode:library?'library':'project',total:rows.length,counts:{byKind,byPack},summary:`${rows.length} missing image slots across ${packs.length} pack(s)`,slots:rows}
}
