// private fork: owner-approved live listener dimming, not a new P6 lighting policy.
import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {packFigureShade} = createRequire(import.meta.url)('../tavern-plugin/src/client/fork-pack-playback.cjs')
test('listener dimming matches live speaker and close-up policy', () => {
  const members = [{id:'a'}, {id:'b'}, {id:'c'}]
  assert.equal(packFigureShade('a','a',members),1)
  assert.equal(packFigureShade('b','a',members),0.8)
  assert.equal(packFigureShade('b','offstage',members),0.94)
  const camera = {mode:'close',actor:'b'}
  assert.equal(packFigureShade('a','a',members,camera),1)
  assert.equal(packFigureShade('b','a',members,camera),0.8)
  assert.equal(packFigureShade('c','a',members,camera),0.8 * 0.82)
  assert.equal(packFigureShade('c','offstage',members,camera),0.94 * 0.82)
})
