import test from 'node:test'
import assert from 'node:assert/strict'
import { readZipEntries } from '../tavern-plugin/lib/domain/zip-entries.js'
import { diagnosticZip } from '../tavern-plugin/lib/domain/mvu-diagnostics.js'

test('通用 ZIP 读取还原各文件内容，错误信息带上调用方标签', () => {
  const zip = diagnosticZip([{ path: 'pack/SKILL.md', content: '---\nname: pack\n---\n正文' }, { path: 'pack/references/a.md', content: '参考' }])
  const entries = readZipEntries(zip, { label: 'Skill 压缩包' })
  assert.equal(entries.get('pack/SKILL.md').toString('utf8'), '---\nname: pack\n---\n正文')
  assert.equal(entries.get('pack/references/a.md').toString('utf8'), '参考')
  assert.throws(() => readZipEntries(Buffer.from('not a zip'), { label: 'Skill 压缩包' }), /Skill 压缩包 解析失败：文件不是有效的 Skill 压缩包\/ZIP/)
})
