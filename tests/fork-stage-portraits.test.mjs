import test from 'node:test'
import assert from 'node:assert/strict'

import {normalizeStagePortraits} from '../tavern-plugin/lib/domain/stage-portraits.js'

test('talk normalization drops invalid, orphaned and removed custom mood slots; legacy entries remain valid', () => {
  const sha = 'a'.repeat(64), id = 'sp0123456789'
  const raw = { portraits: [{ id, images: { default: sha, custom: sha }, talk: { default: sha, custom: sha, joy: sha, bogus: sha } }] }
  assert.deepEqual(normalizeStagePortraits(raw, [{ id: 'custom' }]).portraits[0].talk, { default: sha, custom: sha })
  assert.deepEqual(normalizeStagePortraits(raw).portraits[0].talk, { default: sha, custom: sha }) // private fork: absent vocabulary preserves declared image keys
  assert.deepEqual(normalizeStagePortraits({ portraits: [{ id, images: { default: sha } }] }).portraits[0].talk, {})
  raw.portraits[0].talk.default = '../bad'
  assert.deepEqual(normalizeStagePortraits(raw).portraits[0].talk, {custom:sha}) // private fork: only the invalid default is dropped
})
