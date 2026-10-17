import contract from '../shared/hybrid-sprite.cjs'
import {shape, check, integer, record, relativePath, validateStateId, oneOf} from './common.js'
const groups = contract.HYBRID_GROUPS
function box(value, path, canvas) {
  check(Array.isArray(value) && value.length === 4 && value.every(Number.isInteger), path, 'Expected pixel rect')
  const [x,y,w,h] = value
  check(x >= 0 && y >= 0 && w > 0 && h > 0 && x+w <= canvas[0] && y+h <= canvas[1], path, 'Rect outside canvas')
}
export function validateHybridSprite(value, path, validateLegacy) {
  shape(value, ['kind','version','rigs','emotions'], ['kind','version','rigs','emotions'], path)
  oneOf(value.version, [1], path+'.version')
  record(value.rigs, path+'.rigs', (rig,p,id) => {
    validateStateId(id,p)
    shape(rig, ['canvas','baseRevision','drawOrder','parts','recipes'], ['canvas','baseRevision','drawOrder','parts','recipes'], p)
    check(Array.isArray(rig.canvas) && rig.canvas.length === 2, p+'.canvas')
    rig.canvas.forEach(n => integer(n,p+'.canvas',1,4096))
    integer(rig.baseRevision,p+'.baseRevision',1,Number.MAX_SAFE_INTEGER)
    check(JSON.stringify(rig.drawOrder) === JSON.stringify(groups), p+'.drawOrder', 'Fixed five-group draw order required')
    record(rig.parts,p+'.parts',(part,q,key) => {
      validateStateId(key,q); check(key !== 'none',q)
      shape(part,['group','src','rect','bbox','revision','baseRevision','clearRect','replaceRect'],['group','src','rect','bbox','revision','baseRevision'],q)
      oneOf(part.group,groups,q+'.group'); relativePath(part.src,q+'.src'); check(/\.png$/i.test(part.src),q+'.src','Layered parts must be PNG')
      box(part.rect,q+'.rect',rig.canvas); box(part.bbox,q+'.bbox',part.rect.slice(2))
      if (part.clearRect !== undefined) box(part.clearRect,q+'.clearRect',rig.canvas)
      if (part.replaceRect !== undefined) {
        box(part.replaceRect,q+'.replaceRect',rig.canvas)
        const [x,y,w,h]=part.replaceRect,[px,py,pw,ph]=part.rect
        check(part.group==='mouth'&&x>=px&&y>=py&&x+w<=px+pw&&y+h<=py+ph,q+'.replaceRect','Mouth replacement must fit its part')
      }
      integer(part.revision,q+'.revision',1,Number.MAX_SAFE_INTEGER); integer(part.baseRevision,q+'.baseRevision',1,rig.baseRevision)
    })
    check(Object.keys(rig.parts).length <= 128,p+'.parts','Part limit','LIMIT_EXCEEDED')
    record(rig.recipes,p+'.recipes',(recipe,q,key) => {
      validateStateId(key,q)
      shape(recipe,['revision','selection','mouthFrames','blinkFrames'],['revision','selection'],q)
      integer(recipe.revision,q+'.revision',1,Number.MAX_SAFE_INTEGER)
      shape(recipe.selection,groups,groups,q+'.selection')
      const ref = (id,group,r,optional=false) => {
        validateStateId(id,r)
        if (id === 'none') { check(optional,r,'Core group cannot be none'); return }
        if (rig.parts[id]) check(rig.parts[id].group === group,r,'Part belongs to another group')
      }
      for (const group of groups) ref(recipe.selection[group],group,q+'.selection.'+group,!['underlay','face'].includes(group))
      for (const [field,group,keys] of [['mouthFrames','mouth',['closed','a','i','u','e','o']],['blinkFrames','face',['closed','half']]]) if (recipe[field] !== undefined) {
        shape(recipe[field],keys,[],q+'.'+field)
        for (const [frame,id] of Object.entries(recipe[field])) ref(id,group,q+'.'+field+'.'+frame)
      }
    })
  })
  record(value.emotions,path+'.emotions',(entry,p,id) => {
    check(/^[a-z][a-z0-9_-]{0,23}$/.test(id) && id !== 'default',p,'Canonical figure emotion ID required')
    shape(entry,['render'],['render'],p)
    const r = entry.render, q = p+'.render'
    oneOf(r?.kind,['whole','parts','missing'],q+'.kind')
    const keys = r.kind === 'whole' ? ['kind','legacy'] : r.kind === 'parts' ? ['kind','rig','recipe'] : ['kind']
    shape(r,r.kind==='parts'?[...keys,'preview','previewRevision']:keys,keys,q)
    if (r.kind === 'whole') {
      oneOf(r.legacy?.kind,['static-sprites','layered-static-sprites'],q+'.legacy.kind')
      check(Object.keys(r.legacy.emotions || {}).length === 1 && Object.hasOwn(r.legacy.emotions,id),q+'.legacy','Whole must preserve exactly this emotion')
      validateLegacy(r.legacy,q+'.legacy')
    } else if (r.kind === 'parts') {
      validateStateId(r.rig,q+'.rig'); validateStateId(r.recipe,q+'.recipe')
      if(r.preview!==undefined||r.previewRevision!==undefined) {
        relativePath(r.preview,q+'.preview');check(/\.png$/i.test(r.preview),q+'.preview','Preview must be PNG')
        const resolved=contract.resolveHybridSprite(value,id)
        check(resolved.available&&r.previewRevision===resolved.revision,q+'.previewRevision','Preview is stale or core parts are missing','REVISION_CONFLICT')
      }
    }
  })
  check(Object.keys(value.emotions).length > 0 && Object.keys(value.emotions).length <= 17,path+'.emotions')
  return value
}
