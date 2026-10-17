// private fork: the stylesheet pair production installs — the static fork theme plus the runtime surface table
// (fork-surfaces.js injects surfaces.css() at startup; stage roots and theme previews resolve their context from it).
import { readFile } from 'node:fs/promises'
import surfaces from '../../tavern-plugin/src/client/fork-surfaces.cjs'
export async function forkThemeCss() {
  return await readFile(new URL('../../tavern-plugin/packages/dsh-tavern-ui/src/shell.css', import.meta.url), 'utf8') + '\n' + await readFile(new URL('../../tavern-plugin/lib/client-assets/fork-theme.css', import.meta.url), 'utf8') + '\n' + surfaces.css()
}
