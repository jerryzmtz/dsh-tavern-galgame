import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { prepareProfileConfiguration } from '../../bin/profile-installation.mjs'
import { beginProfileConfigurationUpdate } from '../../bin/profile-configuration.mjs'

export const sourceRoot = fileURLToPath(new URL('../../', import.meta.url))
const json = async file => JSON.parse(await readFile(file, 'utf8'))

// Run the installer's configuration transaction, not dependency installation or
// legacy-data migration. Resolve link: dependencies read-only without making links.
export async function installedComposition({ home, host = 'desktop', absent = false, patch } = {}) {
  const profileDir = path.join(home, 'profiles/tavern')
  if (patch !== undefined) {
    await mkdir(profileDir, { recursive: true })
    await writeFile(path.join(profileDir, 'package.json'), JSON.stringify({ dshTavern: { profileConfigurationVersion: 1 } }))
    await writeFile(path.join(profileDir, 'cordis.patch.yml'), patch)
  }
  const prepared = prepareProfileConfiguration(host, '0.1.5-rc.2', { sourceRoot, profileDir, dshHome: home })
  const transaction = await beginProfileConfigurationUpdate({ profileDir, ...prepared })
  transaction.commit()
  const manifest = await json(path.join(profileDir, 'package.json'))
  // Model package removal from the installed profile, not a second fixture config.
  if (absent) {
    delete manifest.dependencies['dsh-asset-library']
    manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter(name => name !== 'dsh-asset-library')
    await writeFile(path.join(profileDir, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
  }
  const boot = await import(pathToFileURL(process.env.DSH_BOOT_MODULE))
  const runtimeRequire = createRequire(process.env.DSH_BOOT_MODULE)
  const sourceRequire = createRequire(path.join(sourceRoot, 'package.json'))
  const layers = []
  const modules = new Map()
  for (const name of manifest.dsh.profile.bundles) {
    const spec = manifest.dependencies[name]
    let directory
    if (spec?.startsWith('link:')) directory = spec.slice(5)
    else {
      try { directory = path.dirname(sourceRequire.resolve(name + '/package.json')) }
      catch { directory = path.dirname(runtimeRequire.resolve(name + '/package.json')) }
    }
    const pkg = await json(path.join(directory, 'package.json'))
    const patchPath = path.join(directory, pkg.dsh.bundle.patch)
    layers.push(boot.loadOverlayPatches('asset-install-test', patchPath))
    modules.set(name, pathToFileURL(path.resolve(directory, pkg.main || 'lib/index.js')).href)
  }
  layers.push(boot.loadOverlayPatches('asset-install-test', path.join(profileDir, 'cordis.patch.yml')))
  const entries = boot.composeEntries(layers)
  const { interpolate } = await import('@deepseek-ai/cordis-plugin-loader')
  const configFor = entry => interpolate({ [Symbol.for('cordis.entry')]: { options: entry }, dshHomePath: (...parts) => path.join(home, ...parts) }, entry.config)
  return { manifest, entries, configFor, profileDir, modules }
}
