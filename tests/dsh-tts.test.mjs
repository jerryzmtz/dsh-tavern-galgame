// Private fork: include standalone TTS coverage in the Windows runner and full repository gate.
import {readdir} from 'node:fs/promises'
const directory = new URL('../tavern-plugin/packages/dsh-tts/tests/', import.meta.url)
for (const file of (await readdir(directory)).filter(file => file.endsWith('.test.mjs')).sort()) {
  await import(new URL(file, directory).href)
}
