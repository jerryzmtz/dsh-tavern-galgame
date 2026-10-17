import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'
import backend from '../tavern-plugin/packages/dsh-asset-library/lib/shared/hybrid-sprite.cjs'
import frontend from '../tavern-plugin/shared/sprite-emotions.cjs'
import {hybridFixture} from './fixtures/layered-parts.mjs'
const source=await readFile(new URL('../tavern-plugin/src/client/fork-layered-sprite-render.js',import.meta.url),'utf8')
const select=vm.runInNewContext("const FORK_SPRITE_EVENTS=['closed','a','i','u','e','o'];"+source.slice(source.indexOf('function forkPartsLayers('),source.indexOf('function forkPartsBox('))+';forkPartsLayers')
test('native resolver and merged renderer agree on core availability and every optional frame/fallback',()=>{
  for(const mutation of [()=>{},m=>{m.rigs.maid.parts['mouth-a'].baseRevision=1},m=>{delete m.rigs.maid.parts['mouth-closed']},m=>{delete m.rigs.maid.recipes.calm},m=>{delete m.rigs.maid}]) {
    const manifest=hybridFixture();mutation(manifest)
    for(const emotion of [...Object.keys(manifest.emotions),'unknown']) {
      const view=frontend.hybridSpriteRender(manifest,emotion)
      for(const mouthFrame of [undefined,'closed','a','i','u','e','o'])for(const blinkFrame of [undefined,'half','closed']) {
        const resolved=backend.resolveHybridSprite(manifest,emotion,{mouthFrame,blinkFrame})
        assert.equal(resolved.kind,view.kind)
        if(resolved.kind==='parts')assert.deepEqual(resolved.layers.map(p=>p.id),JSON.parse(JSON.stringify(select(view.parts,mouthFrame,blinkFrame))))
        else if(resolved.kind==='missing')assert.deepEqual(resolved.missing,view.missing)
        else assert.deepEqual(resolved.legacy,view.legacy)
      }
    }
  }
})
