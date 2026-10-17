// private fork: follow upstream module extraction without weakening behavior assertions.
// private fork: built-in Tavern skills load from fork/skills; upstream presets/*/skills is an archive (docs/fork/skills.md).
import assert from 'node:assert/strict'
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { createTavernSkillModule } from '../tavern-plugin/lib/domain/tavern-skills.js'

const repo = fileURLToPath(new URL('../', import.meta.url))
const roots = {
  card: { fork: path.join(repo, 'fork/skills/tavern'), upstream: path.join(repo, 'presets/tavern/skills') },
  background: { fork: path.join(repo, 'fork/skills/tavern-background'), upstream: path.join(repo, 'presets/tavern-background/skills') }
}

async function skillNames(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  return entries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
}

async function exists(file) {
  try { await stat(file); return true } catch { return false }
}

test('plugin loads built-in skills from fork/skills instead of the upstream archive', async () => {
  const source = await readFile(path.join(repo, 'tavern-plugin/lib/index.js'), 'utf8')
  assert.match(source, /builtInDirectory: sourceRoot \+ '\/fork\/skills\/tavern'/)
  assert.match(source, /backgroundDirectory: sourceRoot \+ '\/fork\/skills\/tavern-background'/)
  assert.match(source, /bundledSkillDir: sourceRoot \+ '\/fork\/skills\/tavern' \}/)
  assert.match(source, /bundledSkillDir: sourceRoot \+ '\/fork\/skills\/tavern-background' \}/)
  assert.doesNotMatch(source, /sourceRoot \+ '\/presets\/tavern(-background)?\/skills'/)
  assert.equal(await exists(path.join(repo, 'presets/fork')), false, 'presets/ is scanned as agent presets; fork skills must live outside it')
})

test('every upstream archived skill has a fork version with valid frontmatter and references', async () => {
  for (const { fork, upstream } of Object.values(roots)) {
    const forkNames = await skillNames(fork)
    for (const name of await skillNames(upstream)) assert.ok(forkNames.includes(name), 'upstream skill without fork version: ' + name)
    for (const name of forkNames) {
      const content = await readFile(path.join(fork, name, 'SKILL.md'), 'utf8')
      assert.ok(!content.startsWith('\uFEFF') && !content.includes('\r\n'), name + ' must be UTF-8 without BOM and LF')
      const match = content.match(/^---\n([\s\S]*?)\n---\n/)
      assert.ok(match, name + ' frontmatter')
      const meta = parse(match[1])
      assert.equal(meta.name, name)
      assert.ok(typeof meta.description === 'string' && meta.description.trim() && meta.description.length <= 500, name + ' description')
      for (const [, link] of content.matchAll(/\]\((references\/[^)]+\.md)\)/g)) {
        assert.ok(await exists(path.join(fork, name, link)), name + ' missing ' + link)
      }
    }
  }
})

test('skill names used by client drafts and prompts exist in fork/skills', async () => {
  const client = await readFile(path.join(repo, 'tavern-plugin/lib/client.js'), 'utf8')
  const names = new Set([...client.matchAll(/setDraft\(\s*"\/([a-z0-9-]+)/g)].map(match => match[1]))
  for (const file of await readdir(path.join(repo, 'tavern-plugin/prompts'))) {
    const text = await readFile(path.join(repo, 'tavern-plugin/prompts', file), 'utf8')
    for (const match of text.matchAll(/^\/([a-z0-9-]+)\s*$/gm)) names.add(match[1])
  }
  assert.ok(names.size >= 5)
  const available = [...await skillNames(roots.card.fork)]
  for (const name of names) assert.ok(available.includes(name), 'missing fork skill: ' + name)
  assert.ok((await skillNames(roots.background.fork)).includes('character-design'))
})

test('fork skill library lists and reads references through the Tavern skill module', async () => {
  const skills = createTavernSkillModule({ directory: path.join(repo, 'data/__fork-skills-test-missing__'), builtInDirectory: roots.card.fork, backgroundDirectory: roots.background.fork })
  const listed = await skills.list()
  const byName = Object.fromEntries(listed.map(skill => [skill.name, skill]))
  assert.equal(byName['card-to-mvu'].source, 'builtin')
  assert.deepEqual(byName['card-to-mvu'].agents, ['card'])
  assert.deepEqual(byName['character-design'].agents, ['background'])
  assert.match(await skills.readReference('card-to-mvu', 'references/mvu-format.md'), /strictSet/)
  assert.match(await skills.readReference('tavern-plugin', 'references/plugin-api.md'), /onTurnSettled/)
  assert.match(await skills.readReference('debug-card', 'references/evidence.md'), /overview/)
})
