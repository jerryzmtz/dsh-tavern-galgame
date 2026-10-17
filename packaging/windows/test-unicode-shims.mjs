import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

// Run with the extracted Electron executable in ELECTRON_RUN_AS_NODE mode.
const runtime = path.resolve(process.argv[2]);
const scratch = path.resolve(process.argv[3]);
fs.mkdirSync(scratch, { recursive: true });
const fixture = path.join(scratch, '命令 入口.mjs');
fs.writeFileSync(fixture, 'console.log(JSON.stringify(process.argv.slice(2)))');
const hostLib = ['resources/app/lib', 'resources/app.asar.unpacked/lib']
  .map(item => path.join(runtime, item, 'desktop-runtime-environment.js'))
  .find(fs.existsSync);
if (!hostLib) throw new Error('Desktop runtime environment module not found');
const { installDesktopDshRuntime, installDesktopPnpmRuntime } = await import(pathToFileURL(hostLib));
const environment = { ...process.env };
installDesktopDshRuntime({ platform: 'win32', appExecutable: process.execPath, dshBootstrapPath: fixture, profileName: 'tavern', homeDir: path.join(scratch, '旧数据'), stateDir: path.join(scratch, 'dsh'), environment });
const pnpm = installDesktopPnpmRuntime({ platform: 'win32', appExecutable: process.execPath, pnpmBinPath: fixture, electronVersion: process.versions.electron, stateDir: path.join(scratch, 'pnpm'), environment });
const pathKey = Object.keys(environment).find(key => key.toUpperCase() === 'PATH');
environment[pathKey] = pnpm.nodeBinDir + ';' + environment[pathKey];
for (const command of ['dsh probe', 'pnpm probe', 'node --version']) {
  const result = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/c', `chcp 936>nul & ${command}`], { env: environment, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, `${command}: ${result.stderr}`);
  if (command.startsWith('node')) assert.match(result.stdout.trim(), /^v\d+\./);
  else assert.equal(JSON.parse(result.stdout).at(-1), 'probe');
  console.log(`PASS: ${command} works from a Unicode path under code page 936`);
}
