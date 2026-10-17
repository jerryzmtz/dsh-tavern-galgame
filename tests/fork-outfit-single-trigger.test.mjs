import test from 'node:test'
import assert from 'node:assert/strict'
import {validateRecall} from '../tavern-plugin/packages/dsh-asset-library/lib/asset-packs/manifest.js'
import {recallFigureOutfits} from '../tavern-plugin/lib/domain/stage-asset-pack-catalogue.js'
import {triggerEvidence} from '../tavern-plugin/lib/domain/asset-pack-lexical.js'

test('single-character outfit triggers are recalled only on evidence or carry; ordinary assets keep their gate',()=>{
  const actors={uuid:{outfits:[{key:'default',label:'Daily',enabled:true},{key:'basin',label:'Basin',enabled:true,guidance:'When teased',recall:{mode:'keyword',keywords:['傻','笨']}},{key:'claude',label:'Claude',enabled:true,recall:{mode:'keyword',keywords:['中转站']}}]}}
  const recall=(text,state={actors:{}})=>recallFigureOutfits(actors,[text],state).uuid
  assert.deepEqual(recall('普通日常').map(o=>o.key),['default'])
  for(const text of ['你傻呀','你很笨','笨蛋'])assert.equal(recall(text).find(o=>o.key==='basin').guidance,'When teased')
  assert.deepEqual(recall('在中转站工作').map(o=>o.key),['default','claude'])
  assert.deepEqual(recall('普通日常',{actors:{uuid:{outfitKey:'basin'}}}).map(o=>o.key),['default','basin'])
  const r=actors.uuid.outfits[1].recall
  assert.doesNotThrow(()=>validateRecall(r,'$',1))
  assert.throws(()=>validateRecall(r))
  assert.throws(()=>validateRecall({...r,keywords:['']},'$',1))
  assert.equal(triggerEvidence({keywords:['笨']},['你很笨']).matched,false)
})
