import test from 'node:test'
import assert from 'node:assert/strict'
import { decodeLiteralUnicodeEscapes } from '../tavern-plugin/lib/domain/candidate-generation.js'

test('double-escaped choice text is decoded; ordinary backslashes are left alone', () => {
  assert.equal(decodeLiteralUnicodeEscapes('\\u7a97\\u5916\\u5929\\u8272\\uff0c'), '窗外天色，')
  assert.equal(decodeLiteralUnicodeEscapes('混合 \\u4e2d 文本'), '混合 中 文本')
  assert.equal(decodeLiteralUnicodeEscapes('路径 C:\\users\\x'), '路径 C:\\users\\x')
  assert.equal(decodeLiteralUnicodeEscapes('普通文本'), '普通文本')
})
