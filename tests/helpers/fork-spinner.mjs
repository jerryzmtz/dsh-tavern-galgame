// private fork: the shared ForkSpinner (tavern-plugin/src/client/fork-spinner.js). Harnesses that evaluate client
// sources outside the bundle prepend it, as main.js includes it before every fork UI module.
// private fork (figure-editor r6): the shared ForkInlineField is bundled at the same level, right after it.
import {readFileSync} from 'node:fs'
const client = name => readFileSync(new URL('../../tavern-plugin/src/client/' + name, import.meta.url), 'utf8')
export const forkSpinnerSource = client('fork-spinner.js') + '\n' + client('fork-inline-field.js')
// private fork (UI standard phase 2 batch 16): just the shared draft text area, for harnesses that evaluate one module.
const inline = client('fork-inline-field.js')
export const forkTextAreaSource = inline.slice(inline.indexOf('function ForkTextArea('), inline.indexOf('// private fork (UI standard §三.23')) + '\n'
