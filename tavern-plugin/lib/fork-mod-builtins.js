import {readFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import * as items from '../../fork/mods/items/runtime.js'
import * as phone from '../../fork/mods/phone/runtime.js'
import * as textcard from '../../fork/mods/textcard/runtime.js'
import * as performance from '../../fork/mods/performance/runtime.js'
import * as danmaku from '../../fork/mods/danmaku/runtime.js'
import {validateAudienceContent} from '../../fork/mods/danmaku/audience.js'
import {emptyPresentation,appendPresentation,readPresentation} from '../../fork/mods/danmaku/presentation.js'
import {createBuiltinModRegistry} from './domain/mods/runtime.js'
const sources = Object.freeze([
  {id:'dsh.danmaku',directory:new URL('../../fork/mods/danmaku/',import.meta.url),module:danmaku,assetPackId:'829254f8-e721-4c06-ae27-73d91c495f7c'},
  {id:'dsh.performance',directory:new URL('../../fork/mods/performance/',import.meta.url),module:performance},
  {id:'dsh.items',directory:new URL('../../fork/mods/items/',import.meta.url),module:items},
  {id:'dsh.phone',directory:new URL('../../fork/mods/phone/',import.meta.url),module:phone},
  {id:'dsh.textcard',directory:new URL('../../fork/mods/textcard/',import.meta.url),module:textcard},
])

export async function createFirstPartyMods() {
  const releases=[],assetPacks=[]
  for (const source of sources) {
    const manifest=JSON.parse(await readFile(new URL('manifest.json',source.directory),'utf8'))
    const files=new Map(await Promise.all(manifest.files.map(async entry=>[entry.path,await readFile(new URL(entry.path,source.directory))])))
    releases.push({manifest,files,module:source.module})
    if(source.assetPackId) {
      const assets=manifest.builtinAssets.filter(row=>row.type==='bundle').map(row=>JSON.parse(files.get(row.path).toString('utf8')))
      for(const asset of assets)validateAudienceContent(asset.content)
      assetPacks.push({packId:source.assetPackId,name:manifest.name,assets})
    }
  }
  const registry=createBuiltinModRegistry(releases)
  return Object.freeze({...registry,
    assetPacks:()=>structuredClone(assetPacks),
    presentation:id=>id==='dsh.danmaku'?{empty:emptyPresentation,append:appendPresentation,read:readPresentation}:null,
    catalogue:() => sources.map(source=>({id:source.id,name:registry.manifest(source.id).name,version:registry.manifest(source.id).version})),
    source(id) {const source=sources.find(row=>row.id===id);if(!source)throw Object.assign(new Error('Unknown first-party release'),{code:'MOD_RESOURCE_UNAVAILABLE'});return {kind:'directory',path:fileURLToPath(source.directory)}},
  })
}
