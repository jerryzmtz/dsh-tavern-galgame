import { readHostCompatibility } from '../tavern-plugin/lib/domain/host-compatibility.js'
import { resolveTavernDataRoot } from '../tavern-plugin/lib/domain/tavern-data.js'
import { ensureUserExtensions } from '../tavern-plugin/lib/domain/user-extensions.js'

// Only the standard package bundle mounts this guard. Legacy installers check
// the selected host before installation and retain their existing behavior.
export async function apply() {
  const compatibility = readHostCompatibility()
  if (compatibility.status !== 'verified') throw new Error(compatibility.message)
  await ensureUserExtensions(resolveTavernDataRoot())
}
