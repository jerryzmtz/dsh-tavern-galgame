// private fork: tagged English defaults; retain protocol, payload, cache and budget assertions.
import test from 'node:test'
import assert from 'node:assert/strict'
import {selectModAdmission,modKeepFragments} from '../tavern-plugin/lib/domain/mods/relevance.js'

test('mod admission uses recalled entries or direct availability, and preserves only minimal inactive state',()=>{
  const manifests=[{id:'assets',admission:{entryKinds:['props']},assetKinds:[{directorSelectable:true}]},{id:'style',admission:{entryKinds:[]},assetKinds:[{directorSelectable:true}]}]
  const empty=selectModAdmission(manifests,{})
  assert.deepEqual(empty.mods,[{id:'assets',reason:null,selected:false},{id:'style',reason:'direct',selected:true}])
  const catalogue={packs:[{id:'pack',scope:'global'}],recalled:[{packId:'pack',kind:'props',assetId:'picked-green'}]}
  assert.equal(selectModAdmission(manifests,{assets:catalogue}).mods[0].reason,'lamp')
  assert.equal(selectModAdmission(manifests,{assets:{...catalogue,recalled:[{packId:'pack',kind:'performances',assetId:'wrong-kind'}]}}).mods[0].reason,null)
  catalogue.packs[0].scope='builtin'
  assert.deepEqual(selectModAdmission(manifests,{assets:catalogue}).mods[0],{id:'assets',reason:null,selected:false})
  const keep=modKeepFragments(manifests,empty,{assets:{wallpaper:{entryId:'saved'}}})
  assert.equal(keep.length,1)
  assert.match(keep[0].text,/wallpaper.*keeps/)
  assert.doesNotMatch(keep[0].text,/saved/)
})
