// private fork: conservative iteration selection; the full suite remains the deployment gate.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

export const coreTests = [
  'asset-packs-director', 'fork-opening-scene', 'fork-gal-mood-motion',
  'fork-stage-history-chain', 'fork-surfaces', 'crypto-digest',
  'conversation-page-store', 'legacy-compatible-storage', 'fork-skills',
  'fork-stage-perf', 'fork-test-windows-runner',
].map(name => 'tests/' + name + '.test.mjs')

export function discoverTests(root) {
  // private fork: package-local suites are part of the gate, not just root tests.
  const directories = ['tests', 'testsets/tests']
  const packages = path.join(root, 'tavern-plugin/packages')
  if (fs.existsSync(packages)) for (const entry of fs.readdirSync(packages, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const dir = `tavern-plugin/packages/${entry.name}/tests`
      if (fs.existsSync(path.join(root, dir))) directories.push(dir)
    }
  }
  return directories.flatMap(dir => fs.readdirSync(path.join(root, dir))
    .filter(file => file.endsWith('.test.mjs')).map(file => dir + '/' + file)).sort()
}

export function gitChanges(root, ref) {
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  const commit = git(['rev-parse', '--verify', '--end-of-options', ref + '^{commit}']).trim()
  // Include committed, staged, unstaged, untracked, and both sides of renames.
  return [...new Set((git(['diff', '--name-only', '--no-renames', '-z', commit, '--']) +
    git(['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean))]
}

export function buildGraph(root) {
  // Public source archives have no Git history. Never discover an enclosing
  // private repository; walk only regular source files and skip generated data.
  const walk = (directory = '') => fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap(entry => {
    if (entry.isSymbolicLink() || ['.git', 'node_modules', 'data', 'output', '.preview', '.tmp', '.wt', 'runtime'].includes(entry.name) || entry.name.startsWith('runtime-')) return []
    const name = directory ? directory + '/' + entry.name : entry.name
    return entry.isDirectory() ? walk(name) : entry.isFile() ? [name] : []
  })
  const tracked = fs.existsSync(path.join(root, '.git'))
    ? execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).split('\0').filter(Boolean)
    : walk()
  const files = new Set(tracked)
  const reverse = new Map(), sources = new Map(), basenames = new Map()
  for (const file of files) {
    const basename = path.posix.basename(file)
    if (!basenames.has(basename)) basenames.set(basename, [])
    basenames.get(basename).push(file)
  }
  for (const file of files) {
    if (!/\.(?:[cm]?js|tsx?|jsx|html|css)$/.test(file) || !fs.existsSync(path.join(root, file))) continue
    const text = fs.readFileSync(path.join(root, file), 'utf8')
    sources.set(file, text)
    const references = new Set()
    for (const match of text.matchAll(/['"`]([^'"`\r\n]+)['"`]|@include\s+(\S+)/g)) {
      const value = match[1] || match[2]
      if (value.length > 512 || !value.includes('.') || value.includes('${')) continue
      for (const base of [path.posix.dirname(file), '.', 'tavern-plugin', 'tavern-plugin/src/client']) {
        const candidate = path.posix.normalize(path.posix.join(base, value))
        if (files.has(candidate)) references.add(candidate)
      }
      // Source-reading harnesses often compose directory + a literal basename.
      if (!value.includes('/') && basenames.has(value)) for (const candidate of basenames.get(value)) references.add(candidate)
    }
    for (const dependency of references) {
      if (!reverse.has(dependency)) reverse.set(dependency, new Set())
      reverse.get(dependency).add(file)
    }
  }
  return { reverse, sources }
}

export function dependents(reverse, changed) {
  const seen = new Set(changed), queue = [...changed]
  for (let i = 0; i < queue.length; i++) for (const file of reverse.get(queue[i]) || []) {
    if (!seen.has(file)) { seen.add(file); queue.push(file) }
  }
  return seen
}

export function selectChanged(files, changed, graph) {
  const selected = new Set(coreTests.filter(file => files.includes(file)))
  const reasons = []
  for (const file of changed) {
    const documentation = /^(?:docs\/|\.pi\/skills\/.*\.md$)|^(?:AGENTS|CONTEXT|README)\.md$/.test(file)
    const touched = dependents(graph.reverse, [file])
    if (/^tavern-plugin\/(?:src\/client\/|lib\/client-assets\/)/.test(file)) {
      for (const consumer of dependents(graph.reverse, ['tavern-plugin/lib/client.js'])) touched.add(consumer)
    }
    const related = files.filter(test => touched.has(test))
    if ((!related.length && !documentation) || /^(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|\.pi\/.*\.[cm]?js|tests\/fixtures\/(?:host-session-patch-preload|runtime-module-resolution|no-dependency-links)\.mjs)$/.test(file)) {
      reasons.push('Unmapped or suite-wide change: ' + file)
    }
    for (const test of related) selected.add(test)
  }
  return { files: reasons.length ? files : files.filter(file => selected.has(file)), fallback: reasons, changed }
}

export function classifyTests(files, graph) {
  const browserSources = [...graph.sources].filter(([, text]) => /(?:from\s*|import\s*\(|require\s*\()\s*['"](?:playwright|@playwright\/test)['"]/.test(text)).map(([file]) => file)
  const browsers = dependents(graph.reverse, browserSources)
  return Object.fromEntries(files.map(file => [file,
    /(?:perf|performance|installer|installation|launcher|application-update|windows-setup|service-startup|pnpm-install|fork-stage-session-cache|fork-foreground-browser|fork-gal-face-handoff-browser|fork-opening-scene)/.test(file)
      ? 'exclusive' : browsers.has(file) ? 'browser' : 'parallel']))
}

export async function schedule(files, classes, limits, run) {
  // Exclusive jobs never overlap any suite child; browser jobs have a separate cap.
  for (const file of files.filter(file => classes[file] === 'exclusive')) await run(file, 'exclusive', 0)
  const queues = {
    parallel: files.filter(file => classes[file] === 'parallel'),
    browser: files.filter(file => classes[file] === 'browser'),
  }
  await Promise.all(Object.entries(queues).flatMap(([lane, queue]) =>
    Array.from({ length: Math.min(limits[lane], queue.length) }, async (_, slot) => {
      while (queue.length) await run(queue.shift(), lane, slot)
    })))
}
