// private fork: sliced VM/browser fixtures must load the production canonical paginator too.
import {readFileSync} from 'node:fs'
export const stagePageSource = readFileSync(new URL('../../tavern-plugin/src/client/fork-stage-page-index.cjs', import.meta.url), 'utf8')
