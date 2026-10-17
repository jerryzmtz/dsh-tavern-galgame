// Private fork: refresh the vendored 9Router pricing snapshot (docs/fork/ui-design.md).
// Run inside the 9router container, then copy the outputs out:
//   docker cp bin/vendor-9router-pricing.cjs 9router:/tmp/v.cjs
//   docker exec 9router node /tmp/v.cjs
//   docker cp 9router:/tmp/9router-pricing/. tavern-plugin/lib/vendor/9router/
const fs = require('fs')
const path = require('path')
const out = '/tmp/9router-pricing'
fs.mkdirSync(out, { recursive: true })
fs.copyFileSync('/app/open-sse/providers/pricing.js', path.join(out, 'pricing.js'))
const dir = '/app/open-sse/providers/registry'
const aliases = {}
for (const name of fs.readdirSync(dir)) {
  if (!name.endsWith('.js') || name === 'index.js') continue
  const text = fs.readFileSync(path.join(dir, name), 'utf8')
  const id = /\bid:\s*"([^"]+)"/.exec(text)
  if (!id) continue
  for (const key of ['alias', 'uiAlias']) {
    const match = new RegExp('\\b' + key + ':\\s*"([^"]+)"').exec(text)
    if (match && match[1] !== id[1]) aliases[match[1]] = id[1]
  }
}
const version = JSON.parse(fs.readFileSync('/app/package.json', 'utf8')).version
fs.writeFileSync(path.join(out, 'provider-aliases.json'), JSON.stringify({ version, aliases }, null, 2) + '\n')
console.log('9router', version, Object.keys(aliases).length, 'aliases')
