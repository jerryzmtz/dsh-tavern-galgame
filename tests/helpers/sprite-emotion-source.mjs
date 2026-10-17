// private fork: VM/browser fragments include the same native emotion contract as the client builder.
import {readFile} from 'node:fs/promises'
import bubble from '../../tavern-plugin/src/client/fork-bubble-line.cjs'
const contract = bubble.forkResolveBubbleMood.toString()+'\n'+await readFile(new URL('../../tavern-plugin/shared/sprite-emotions.cjs',import.meta.url),'utf8')
export const withSpriteEmotionSource = source => source.replace('// @include-shared sprite-emotions.cjs', () => contract)
