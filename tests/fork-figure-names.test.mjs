// Figure names have one persisted list; editing does not write figure recall words.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../tavern-plugin/src/client/fork-asset-pack-figure-ui.js', import.meta.url), 'utf8')
const between = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b, i); assert.ok(i >= 0 && j > i, 'missing ' + a); return s.slice(i, j) }
const { figureNames, namesPatch, aliasProblem, splitAliases } = new Function(between(source, 'const ALIAS_HELP=', 'const OUTFIT_LAMPS=') + 'return {figureNames,namesPatch,aliasProblem,splitAliases}')()

const figure = { name: '大肥鱼', aliases: ['dafeiyu', '大肥鱼酱', 'c8', '鱼鱼', '肥鱼'], recall: { mode: 'keyword' } }

test('one list: merged names in stored order; old lowercase actor codes are not shown', () => {
  assert.deepEqual(figureNames(figure), ['大肥鱼酱', '鱼鱼', '肥鱼'])
  assert.deepEqual(figureNames({ name: 'x' }), [])
})
test('adding writes aliases only and keeps hidden codes', () => {
  const patch = namesPatch(figure, ['大肥鱼酱', '鱼鱼', 'Kaguya'])
  assert.deepEqual(patch, { aliases: ['dafeiyu', '大肥鱼酱', 'c8', '鱼鱼', 'Kaguya'] })
})
test('removing any name edits only aliases, leaving the lamp policy alone', () => {
  assert.deepEqual(namesPatch(figure, ['大肥鱼酱']), { aliases: ['dafeiyu', '大肥鱼酱', 'c8'] })
  assert.deepEqual(namesPatch(figure, ['鱼鱼']), { aliases: ['dafeiyu', 'c8', '鱼鱼'] })
})
test('validation: readable names only, at most 32, 40 characters each; 、 ， and , all separate', () => {
  assert.deepEqual(splitAliases('辉夜、かぐや，Kaguya, 辉夜'), ['辉夜', 'かぐや', 'Kaguya'])
  assert.equal(aliasProblem(['惠']), '')
  assert.match(aliasProblem(['kei']), /内部代号.*Kei/)
  assert.match(aliasProblem(Array.from({ length: 33 }, (_, i) => '名' + i)), /32/)
  assert.match(aliasProblem(['长'.repeat(41)]), /40/)
})
