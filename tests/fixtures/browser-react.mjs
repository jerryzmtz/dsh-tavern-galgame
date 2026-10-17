import '../../scripts/debug/mute-automation.mjs'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)

export async function browserReactScript() {
  let script = 'const modules={};\n'
  for (const [name, file] of [['react', 'react.production.js'], ['scheduler', 'scheduler.production.js'], ['react-dom', 'react-dom.production.js'], ['react-dom/client', 'react-dom-client.production.js']]) {
    script += `modules[${JSON.stringify(name)}]=(()=>{const module={exports:{}};const exports=module.exports;const require=name=>modules[name];\n${await readFile(join(dirname(require.resolve(name)), 'cjs', file), 'utf8')}\nreturn module.exports;})();\n`
  }
  // private fork: the production colour helper is shared by mounted transcript/stage/backlog fixtures.
  script += '\n(()=>{'+await readFile(new URL('../../tavern-plugin/shared/figure-auto-color.cjs',import.meta.url),'utf8')+';Object.assign(window,{figureTextColor,figureContrast});})();'
  script += '\n'+await readFile(new URL('../../tavern-plugin/src/client/fork-figure-color-contrast.js',import.meta.url),'utf8')
  return script
}

