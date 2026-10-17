// private fork: the viewer consumes this versioned contract; missing slots never borrow images.
import {readFile} from 'node:fs/promises'
import {composeHybridPreview} from '../../tavern-plugin/lib/domain/hybrid-sprite-preview.js'
import {availableLayeredManifest} from './layered.mjs'
import {prerequisites,safeProjectFile,atomic,slotAccepted,mouthBase} from '../../tavern-plugin/lib/domain/asset-production-project.js'
import {validateAgainst} from '../../tavern-plugin/lib/domain/asset-production-schema.js'
import schema from '../../viewer/review-data.schema.json' with {type:'json'}
export function buildReviewData(p) {
  const mouths=new Map()
  for(const s of Object.values(p.slots))if(s.kind==='mouth'){const key=[s.character,s.outfit,s.emotion].join('/');if(!mouths.has(key))mouths.set(key,[]);mouths.get(key).push(s.id)}
  const item=(id)=>{
    const s=p.slots[id],blocked=s?prerequisites(p,s):['SLOT_MISSING']
    const status=s?.installed?'blocked':!s?.artifact?'missing':s?.refusal?'refused':s?.stale?'changed':blocked.length?'blocked':!s?.artifact?'missing':slotAccepted(s)?'approved':'changed'
    const result={slot_id:id,kind:s?.kind||id.split('/')[2]||'unknown',status,blocked,warnings:[...(s?.artifact?.warnings||[]),...(s?.registered?.warnings||[])].map(w=>({...w,symbol:'\u26a0'})),provenance:{...s?.provenance,...(s?.sourceBinding?{sourceBinding:s.sourceBinding}:{}),avatarQa:s?.artifact?.qa,occlusion:s?.artifact?.geometry?.occlusion,...(s?.installed?{baseline_installed:s.installed}:{}),plan_id:s?.planId,registration:s?.registered}}
    if(s?.kind==='sprite'&&(p.mouthSources?.[id]||p.blinkSources?.[id])){const source=p.mouthSources?.[id]||p.blinkSources?.[id];result.image={path:source.path,native_size:[source.width,source.height]}}
    if(s?.artifact&&!(p.mouthSources?.[id]||p.blinkSources?.[id]))result.image={path:s.artifact.path,native_size:[s.artifact.width,s.artifact.height]}
    if(s?.artifact?.rect){result.rect_xywh=s.artifact.rect;if(s.artifact.blend)result.blend=s.artifact.blend;const base=['mouth','blink'].includes(s.kind)?mouthBase(p,s):p.slots[s.character+'/'+s.outfit+'/sprite/'+s.emotion]?.artifact;if(base)result.base_native_size=[base.width,base.height]}
    for(const field of ['frame','palette','settei','refusal'])if(s?.[field]!==undefined)result[field]=s[field]
    if(s?.parentVersion)result.parent_version=s.parentVersion
    const plan=p.plans[s?.planId];if(plan)result.provenance={...result.provenance,prompt:plan.prompt,references:plan.references,source:plan.source,timestamp:plan.completedAt}
    return result
  }
  const data={schema_version:1,project:{id:p.id,name:p.name,revision:p.revision},characters:p.characters.map(c=>({id:c.id,key:c.key,name:c.name,identity_settei:item(c.key+'/identity-settei'),outfits:c.outfits.map(o=>({key:o.key,label:o.label,settei:item(c.key+'/'+o.key+'/settei'),states:c.emotions.filter(row=>!o.fallbackEmotions?.includes(row.id)).map(({id})=>{const prefix=c.key+'/'+o.key+'/',frames=(mouths.get([c.key,o.key,id].join('/'))||[]).map(item);return {id,sprite:item(prefix+'sprite/'+id),avatar:item(prefix+'avatar/'+id),...(p.slots[prefix+'blink/'+id]?{blink:item(prefix+'blink/'+id)}:{}),mouth:{semantics:frames.length?(o.mouthMode==='vowels'?'vowels':'opening-level'):'none',composite:'source-over-native-then-scale',frames}}})}))})),scenes:p.assets.map(a=>item(a.kind+'/'+a.key))}
  validateAgainst(data,schema);return data
}
export async function renderReview(root,p,options={}) {
  const data=options.data?structuredClone(options.data):buildReviewData(p)
  if(p)for(const c of data.characters)for(const o of c.outfits) {
    const entry=p.layered?.[c.key+'/'+o.key];if(!entry)continue
    const manifest=availableLayeredManifest(entry)
    for(const state of o.states)if(['parts','missing'].includes(manifest.emotions[state.id]?.render.kind)) {
      delete state.blink;state.mouth={semantics:'none',composite:'source-over-native-then-scale',frames:[]}
      state.sprite={slot_id:c.key+'/'+o.key+'/sprite/'+state.id,kind:'sprite',status:'changed',blocked:[],warnings:[],provenance:{layered_version:entry.version}}
      try {
        const preview=await composeHybridPreview(manifest,state.id,async src=>readFile(await safeProjectFile(root,entry.assets[src].path)))
        const file='previews/'+c.key+'/'+o.key+'/'+state.id+'.png';await atomic(root,file,preview.bytes)
        state.sprite.image={path:file,native_size:[preview.width,preview.height]}
      }catch(e){if(!['MISSING_DEPENDENCY','ENOENT'].includes(e.code))throw e;state.sprite.status='missing';state.sprite.blocked=['MISSING_PART']}
    }
  }
  if(options.scope)data.scope=options.scope
  validateAgainst(data,schema)
  const template=await readFile(new URL('../../viewer/template.html',import.meta.url),'utf8'),placeholder='__DSH_REVIEW_DATA__'
  if(template.split(placeholder).length!==2)throw new Error('Viewer template must contain exactly one data placeholder')
  // Checking readability does not transform, hash again, or substitute a missing image.
  const readable=new Map()
  const visit=async v=>{
    if(!v||typeof v!=='object')return
    for(const field of ['image','preview_image'])if(v[field]){
      try{
        const file=v[field].path
        if(!readable.has(file))readable.set(file,readFile(await safeProjectFile(root,file)).then(()=>undefined))
        await readable.get(file)
      }catch(e){
        if(e.code!=='ENOENT')throw e
        delete v[field]
        if(field==='image')v.status='missing'
        v.warnings.push({code:'MISSING_IMAGE',severity:'warning',symbol:'\u26a0',message:field==='image'?'Referenced image is missing; no substitute used':'Preview missing; using original image'})
      }
    }
    for(const child of Object.values(v))if(typeof child==='object')await visit(child)
  }
  await visit(data)
  const json=JSON.stringify(data).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029')
  return {data,html:template.replace(placeholder,()=>json)}
}
