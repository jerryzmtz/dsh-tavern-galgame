import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { mergeProfileManifest, prepareProfilePatch } from '../bin/profile-configuration.mjs'
const root=fileURLToPath(new URL('../',import.meta.url)),source=JSON.parse(readFileSync(path.join(root,'package.json'),'utf8'))
test('profile composes one absolute link and bundle per TTS package, preserves user dependencies and disable patch',() => {
  const current={dependencies:{extra:'1.0.0'},dsh:{profile:{bundles:['extra','dsh-tts','dsh-tts-local']}}}
  const options={source,current,pluginPath:path.join(root,'tavern-plugin'),dataRoot:'test-data',host:'cli'}
  const result=mergeProfileManifest(options)
  for (const name of ['dsh-tts','dsh-tts-local']) {
    assert.equal(result.dsh.profile.bundles.filter(n => n === name).length,1)
    assert.equal(result.dependencies[name],'link:' + path.join(root,'tavern-plugin/packages',name).replaceAll('\\','/'))
  }
  assert.equal(result.dependencies.extra,'1.0.0');assert.ok(result.dsh.profile.bundles.includes('extra'))
  assert.deepEqual(mergeProfileManifest({...options,current:result}),result)
  const dir=mkdtempSync(path.join(tmpdir(),'tts-profile-')),patch='- id: dsh-tts-local\n  disabled: true\n'
  writeFileSync(path.join(dir,'cordis.patch.yml'),patch)
  assert.equal(prepareProfilePatch({profileDir:dir,templateText:'',profileConfigurationVersion:1}),undefined)
  assert.equal(readFileSync(path.join(dir,'cordis.patch.yml'),'utf8'),patch)
})
test('generated aggregate includes both packages once; all generated artifacts are current',() => {
  execFileSync(process.execPath,['bin/build-plugin-package.mjs','--check'],{cwd:root})
  const aggregate=readFileSync(path.join(root,'plugin.patch.yml'),'utf8')
  for(const name of ['dsh-tts','dsh-tts-local']) {
    assert.equal(aggregate.split('id: ' + name + '\n').length - 1,1)
    execFileSync(process.execPath,[`tavern-plugin/packages/${name}/build.mjs`,'--check'],{cwd:root})
    const manifest=JSON.parse(readFileSync(path.join(root,`tavern-plugin/packages/${name}/package.json`),'utf8'))
    assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-slots'))
    assert.equal(manifest.dsh.client.inject.includes('dsh-tavern-plugin'),false)
  }
})
test('real DSH can compose independent patches and preserve disabled overrides', {skip:!process.env.DSH_BOOT_MODULE},async () => {
  const boot=await import(pathToFileURL(process.env.DSH_BOOT_MODULE))
  const load=file => boot.loadOverlayPatches('test',file)
  const entries=boot.composeEntries(['dsh-tts','dsh-tts-local'].map(name => load(path.join(root,`tavern-plugin/packages/${name}/cordis.patch.yml`))))
  assert.deepEqual(entries.map(e => e.id),['dsh-tts','dsh-tts-local'])
  // private fork: local TTS is an external service; the removed worker has no dataDir/server expression.
  assert.equal(entries.find(entry => entry.id === 'dsh-tts').config.dataDir.__jsExpr, "dshHomePath('profile-data', 'tavern', 'tts')")
  assert.equal(entries.find(entry => entry.id === 'dsh-tts-local').config, undefined)
  const directory=mkdtempSync(path.join(tmpdir(),'tts-disabled-')),file=path.join(directory,'cordis.patch.yml')
  writeFileSync(file,'- id: dsh-tts-local\n  disabled: true\n')
  const disabled=boot.composeEntries([...['dsh-tts','dsh-tts-local'].map(name => load(path.join(root,`tavern-plugin/packages/${name}/cordis.patch.yml`))),load(file)])
  assert.equal(disabled.find(entry => entry.id === 'dsh-tts-local').disabled,true)
})
