import test from 'node:test'
import assert from 'node:assert/strict'
import {extractProductionPatch} from '../tavern-plugin/lib/domain/asset-production-images.js'
import {decodeAssetRgba,encodeAssetRgba} from '../tavern-plugin/lib/domain/asset-image-processing.js'
import {compositePatch} from '../tavern-plugin/lib/domain/sprite-blink-patch.js'
import {sourceBoundMouthPatch} from '../tavern-plugin/lib/domain/sprite-mouth-matte.js'

const image=rgba=>({width:60,height:50,data:Uint8ClampedArray.from({length:60*50*4},(_,i)=>rgba[i%4])})
for(const alpha of [252,253,254,255])test('normal extract/composite retains exact source RGBA with alpha '+alpha,()=>{
  const base=image([180,150,130,alpha]),edit=image([70,20,35,250]),rect=[10,10,40,30]
  const geometry={mouthMask:{core:[[[20,20],[38,20],[38,30],[20,30]]],feather:3}}
  const artifact=extractProductionPatch(encodeAssetRgba(base),encodeAssetRgba(edit),'mouth',rect,geometry)
  assert.equal(artifact.blend,'replace')
  const patch=decodeAssetRgba(artifact.bytes),expected=sourceBoundMouthPatch(base,edit,rect,geometry.mouthMask)
  const actual=compositePatch(base,patch,artifact.rect,artifact.blend)
  for(let y=0;y<base.height;y++)for(let x=0;x<base.width;x++){
    const i=(y*base.width+x)*4,inside=x>=10&&x<50&&y>=10&&y<40,j=((y-10)*40+x-10)*4
    const want=inside?expected.data.subarray(j,j+4):base.data.subarray(i,i+4)
    assert.deepEqual(actual.data.subarray(i,i+4),want)
    if(!inside||!expected.mask[j/4])assert.deepEqual(actual.data.subarray(i,i+4),base.data.subarray(i,i+4))
  }
  assert.deepEqual(Array.from(actual.data.slice((25*60+25)*4,(25*60+25)*4+4)),[70,20,35,alpha])
  if(alpha!==255)assert.notDeepEqual(compositePatch(base,patch,rect).data,actual.data,'fixture detects the old double-alpha bug')
})
test('unmasked historical mouths retain source-over semantics',()=>{
  const base=image([180,150,130,254]),edit=image([70,20,35,250])
  const artifact=extractProductionPatch(encodeAssetRgba(base),encodeAssetRgba(edit),'mouth',[10,10,40,30])
  assert.equal(artifact.blend,undefined)
})
