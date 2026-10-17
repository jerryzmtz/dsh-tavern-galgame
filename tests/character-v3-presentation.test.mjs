// private fork: presentation/director/browser agree on the figure's downward-only appearance choice.
import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {selectPackFigure} from '../tavern-plugin/lib/domain/asset-pack-presentation.js'
import {frozenActors} from '../tavern-plugin/lib/domain/stage-asset-pack-director.js'
import {figureActorKey} from '../tavern-plugin/lib/domain/figure-catalogue.js'
import {syntheticPack,cardExtension,PACK_ID,FIGURE_ID} from './fixtures/asset-packs/pack.mjs'
const require = createRequire(import.meta.url)
const {packAppearance} = require('../tavern-plugin/lib/domain/pack-avatar.cjs')
const {packFigureRenderInputs} = require('../tavern-plugin/src/client/fork-pack-playback.cjs')
const source = await syntheticPack(), ref={packId:PACK_ID,figureId:FIGURE_ID}, actorKey=figureActorKey(ref)

for (const appearance of ['live2d','sprite','avatar']) for (let mask=0; mask<8; mask++) {
  test(`${appearance} with asset mask ${mask}: shared fallback, no input writes and no avatar stage actor`, () => {
    const pack=structuredClone(source), figure=pack.figures[FIGURE_ID], extension=cardExtension()
    const outfit={key:'daily',label:'Daily',enabled:true,
      ...(mask&1 ? {live2d:figure.outfits[1].live2d} : {}),
      ...(mask&2 ? {sprite:figure.outfits[0].sprite} : {}),
      ...(mask&4 ? {avatars:figure.outfits[0].avatars} : {})}
    figure.outfits=[outfit]
    figure.appearance=appearance
    const before=structuredClone({pack,extension})
    const expected=packAppearance(outfit,appearance)
    const projected=selectPackFigure(figure,pack.sprites,{appearance})
    assert.equal(projected.appearance,appearance)
    assert.equal(projected.form,expected.form)
    assert.deepEqual(projected.missing,expected.missing)
    const actors=frozenActors(extension,[pack])
    assert.equal(Object.hasOwn(actors,actorKey),expected.form!=='avatar')
    if (expected.form==='avatar') {
      const rendered=packFigureRenderInputs({...projected,alias:'actor'})
      assert.equal(rendered.stage,null)
    } else assert.equal(actors[actorKey].outfits[0].key,'daily')
    assert.deepEqual({pack,extension},before)
  })
}

test('director does not silently promote a later outfit past the first enabled avatar-only outfit', () => {
  const pack=structuredClone(source), figure=pack.figures[FIGURE_ID], extension=cardExtension()
  figure.outfits.unshift({key:'empty',label:'Empty',enabled:true})
  assert.deepEqual(frozenActors(extension,[pack]),{})
  assert.equal(selectPackFigure(figure,pack.sprites,{appearance:'live2d'}).form,'avatar')
  const state={actors:{actor:{figure:ref,outfitKey:'school'}}}
  const carried=frozenActors(extension,[pack],state)
  assert.ok(carried.actor, 'a valid story outfit must survive a newly added empty opening outfit')
  assert.equal(carried.actor.outfits[0].key,'empty', 'explicit reset still uses the first enabled outfit')
  assert.equal(carried.actor.outfits[0].ruler,null)
  figure.outfits[0].enabled=false
  assert.equal(frozenActors(extension,[pack])[actorKey].outfits[0].key,'school')
})

test('retired historical outfit projects to the current default without changing the request', () => {
  const figure=source.figures[FIGURE_ID], before=structuredClone(figure)
  for (const appearance of ['live2d','sprite','avatar']) {
    const request={outfitKey:'deleted',appearance}
    const projected=selectPackFigure(figure,source.sprites,request)
    const current=selectPackFigure(figure,source.sprites,{appearance})
    assert.equal(projected.form,current.form)
    assert.equal(projected.outfitKey,current.outfitKey)
    assert.ok(projected.diagnostics.includes('outfit-fallback'))
    assert.equal(request.outfitKey,'deleted')
  }
  assert.deepEqual(figure,before)
})
