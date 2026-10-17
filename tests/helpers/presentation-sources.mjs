// private fork: source-only tests follow moved algorithms, not relocation entry points.
const moved = new Set(['fork-figure-scale.cjs', 'fork-stage-phone.cjs', 'fork-stage-soundscape.cjs', 'fork-stage-light.cjs', 'fork-stage-pacing.cjs'])
export const presentationSourceUrl = name => new URL('../../tavern-plugin/' + (moved.has(name) ? 'packages/dsh-presentation-protocol/src/' : 'src/client/') + name, import.meta.url)
