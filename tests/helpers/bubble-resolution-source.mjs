// private fork: historical vocabulary is fixture data, not a runtime default.
// private fork: sliced browser fixtures load the same identity and mood resolvers as the client.
import {readFileSync} from 'node:fs'
const root=new URL('../../tavern-plugin/',import.meta.url)
const read=file=>readFileSync(new URL(file,root),'utf8')
const bubbles=read('src/client/fork-bubbles.js')
export const bubbleResolutionSource=bubbles.slice(0,bubbles.indexOf('// Per-session bubble settings'))
 .replace('// @include-protocol figure-resolution.cjs',()=>read('packages/dsh-presentation-protocol/src/figure-resolution.cjs'))
 .replace('// @include fork-bubble-line.cjs',()=>read('src/client/fork-bubble-line.cjs'))
 .replace('__TAVERN_BUBBLE_MOODS__',()=>read('../tests/fixtures/legacy-dialogue-moods.json'))
