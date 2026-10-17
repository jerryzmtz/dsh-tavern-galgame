import {productionError} from '../../tavern-plugin/lib/domain/asset-production-project.js'
const fail=message=>{throw productionError('INVALID_ARGUMENT',message)}
const list=value=>value===undefined?[]:[value].flat().flatMap(v=>String(v).split(',').map(s=>s.trim()))
export function selectAnimations(project,{sprites,slots,scope}={}) {
  if(sprites===undefined&&slots===undefined)return {project,selection:null}
  if(scope!=='animation')fail('--sprites/animation --slots require --scope animation')
  const ids=new Set(),animation=s=>['mouth','blink'].includes(s.kind)
  for(const id of list(sprites)) {
    if(project.slots[id]?.kind!=='sprite')fail('Unknown sprite selector: '+id)
    const source=project.slots[id],matches=Object.values(project.slots).filter(s=>animation(s)&&s.character===source.character&&s.outfit===source.outfit&&s.emotion===source.emotion)
    if(!matches.length)fail('Sprite selector has no declared animations: '+id)
    for(const s of matches)ids.add(s.id)
  }
  for(const id of list(slots)) {if(!animation(project.slots[id]||{}))fail('Unknown animation slot selector: '+id);ids.add(id)}
  if(!ids.size)fail('Animation selection must not be empty')
  for(const id of ids) {
    const s=project.slots[id]
    if(s.kind==='mouth')for(const frame of ['closed','small','mid','open'])if(!ids.has([s.character,s.outfit,'mouth',s.emotion,frame].join('/')))fail('Select all four mouth slots or use --sprites: '+id)
  }
  const selected=structuredClone(project)
  for(const [id,s]of Object.entries(selected.slots))if(animation(s)&&!ids.has(id))delete selected.slots[id]
  for(const [field,kind]of [['mouthSources','mouth'],['blinkSources','blink']])for(const id of Object.keys(selected[field]||{})) {
    const s=project.slots[id],slot=[s.character,s.outfit,kind,s.emotion,...(kind==='mouth'?['closed']:[])].join('/')
    if(!ids.has(slot))delete selected[field][id]
  }
  return {project:selected,selection:[...ids].sort()}
}
