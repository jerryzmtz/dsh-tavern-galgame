import test from 'node:test'
import assert from 'node:assert/strict'
import { generateSceneImage } from '../tavern-plugin/lib/domain/scene-image-provider.js'

const input = { baseURL: 'https://example.org/v1', apiKey: 'fixture-private-key', model: 'image-test', prompt: 'A window' }
test('provider rejection retains actionable details but not echoed credentials or unrelated response data', async () => {
  await assert.rejects(generateSceneImage(input, { fetch: async () => Response.json({
    error: { message: 'Unsupported size; key=fixture-private-key Bearer other-private-token', param: 'size', code: 'invalid_parameter' },
    debug: 'private response data'
  }, { status: 400 }) }), error => {
    assert.match(error.message, /HTTP 400.*Unsupported size/s)
    assert.equal(error.imageFailure.param, 'size')
    assert.equal(error.imageFailure.code, 'invalid_parameter')
    assert.equal(error.imageOutcome, 'rejected')
    assert.doesNotMatch(JSON.stringify({message: error.message, failure: error.imageFailure}), /fixture-private-key|other-private-token|private response data/)
    return true
  })
})
