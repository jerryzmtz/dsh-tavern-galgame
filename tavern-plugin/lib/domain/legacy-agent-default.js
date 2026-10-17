// A Profile-private preset must not remain the default for every Profile.
// Inspect the raw user layer: the Tavern composition base intentionally stays tavern.
export async function clearLegacyTavernDefault(settings) {
  const descriptor = settings.describe().find(item => item.ns === 'agent-presets')
  if (descriptor?.user?.default !== 'tavern') return false
  await settings.mutate('agent-presets', [{ op: 'unset', path: ['default'] }], descriptor.revision)
  return true
}
