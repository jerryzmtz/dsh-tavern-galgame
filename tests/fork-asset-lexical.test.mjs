// private fork: shared normalized hard triggers replace lexical scores; names are default words.
import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeCatalogueText as normalize, triggerEvidence } from '../tavern-plugin/lib/domain/asset-pack-lexical.js'

test('pack triggers retain NFKC and fixed OpenCC normalization', () => {
  assert.equal(normalize('　醫院 ＢＡＲ\t開門  聲音　'), '医院 bar 开门 声音')
  assert.equal(normalize('医。院'), '医。院')
})

test('names and words are hard triggers with boundaries, one-hop synonyms and canonical deduplication', () => {
  const item = {name:'医院',keywords:['医院','走廊'],synonyms:{医院:['hospital','病院']}}
  const hit = text => triggerEvidence(item,[normalize(text)])
  assert.equal(hit('医院医院病院 hospital 走廊').evidence.length,2)
  for (const text of ['病院','HOSPITAL','没去医院']) assert.equal(hit(text).matched,true)
  assert.equal(hit('医。院').matched,false)
  for (const text of ['barrier','foobar bar2']) assert.equal(triggerEvidence({name:'bar'},[text]).matched,false)
  assert.equal(triggerEvidence({name:'bar'},['在bar里']).matched,true)
  assert.equal(triggerEvidence({name:'rail station'},[normalize('RAIL   STATION')]).matched,true)
  assert.equal(triggerEvidence({keywords:['医院']},['医','院']).matched,false)
  assert.equal(triggerEvidence({name:'白天·夜晚',keywords:['门']},['白天夜晚开门']).matched,false)
  assert.equal(triggerEvidence({keywords:['医院'],synonyms:{医院:['病院']}},['诊所']).matched,false)
  assert.equal(triggerEvidence(item,['x'.repeat(601) + '医院']).evidence[0].offset,601)
  assert.equal(triggerEvidence({name:'night'},['night']).matched,false)
  assert.equal(triggerEvidence({name:'night'},['night'],{excludeTimeWords:false}).matched,true)
  assert.equal('score' in hit('医院'),false)
})
