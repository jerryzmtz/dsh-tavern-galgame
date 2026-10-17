import assert from 'node:assert/strict'

// These fixtures test the Helper protocol, not loading its bundled libraries.
// Match the dependency import and fail loudly if the production bootstrap changes.
export function stubFrameDependencyImports(script) {
  if (!script.includes('import(')) return script
  const dependencies = []
  const stubbed = script.replace(/import\(new URL\("\/api\/dsh-tavern\/vendor\/runtime-assets\/(zod|yaml)\/index\.mjs",document\.baseURI\)\.href\)/g, (_, name) => {
    dependencies.push(name)
    return 'Promise.resolve({})'
  })
  assert.deepEqual(dependencies, ['zod', 'yaml'], 'Update the fixture for the current frame dependency imports')
  return stubbed
}
