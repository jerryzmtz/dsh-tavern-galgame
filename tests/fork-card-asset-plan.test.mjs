import test from 'node:test'
import assert from 'node:assert/strict'

// private fork: the unused sha256 fixture (and fork-card-storage's consumer-less sha256 export) are gone.
import { normalizeLive2dManifest, MAX_CARD_MODELS } from '../tavern-plugin/lib/domain/live2d-library.js'

test('239 models retain metadata beyond 200 and explicit 1000 cap rejects instead of truncating', () => {
  const models = Array.from({ length: 239 }, (_, i) => ({ id: 'model-' + i, label: 'Model ' + i, moods: {} }))
  const result = normalizeLive2dManifest({ version: 1, models })
  assert.equal(result.models.length, 239); assert.equal(result.models[238].label, 'Model 238')
  assert.throws(() => normalizeLive2dManifest({ models: Array.from({ length: MAX_CARD_MODELS + 1 }, (_, i) => ({ id: 'm' + i })) }), /1000/)
})
