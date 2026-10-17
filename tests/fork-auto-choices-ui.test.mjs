// private fork: follow upstream module extraction without weakening behavior assertions.
// private fork (owner 2026-10): 自动生成选项 lives in one place only — 舞台设置 › 基础设置 (fork-asset-pack-card-ui.js
// StageAutoChoicesSwitch, rendered in card-centric-stage-ui.test.mjs). This file holds the shared preference hook to its
// contract (load, persist both ways, keep every mount in sync, report save errors) and checks nothing else mounts a copy.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { browserReactScript } from './fixtures/browser-react.mjs'
import { forkSpinnerSource } from './helpers/fork-spinner.mjs' // private fork (UI standard phase 2 batch 7): ForkSwitch lives in fork-inline-field.js

const read = path => readFile(new URL('../tavern-plugin/src/client/' + path, import.meta.url), 'utf8')
const moduleSource = await read('fork-auto-choices.js')
const settings = await read('features/settings.js')
const config = await read('fork-gal-config.js')
const cardUi = await read('fork-asset-pack-card-ui.js')
const launcher = await read('fork-asset-launcher.js')

test('the preference hook loads the global setting, persists both directions, synchronizes mounts and reports save errors', async t => {
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setContent('<main id="settings"></main>')
  await page.addScriptTag({ content: await browserReactScript() })
  await page.addScriptTag({ content: `
    const React = modules.react;
    window.savedPreference = true;
    window.calls = [];
    window.rejectSave = false;
    async function rpc(method, args) {
      calls.push({ method, args });
      if (method === 'getTavernSettings') return { settings: { candidateAutoGenerate: savedPreference } };
      if (rejectSave) throw new Error('test storage failure');
      savedPreference = args.patch.candidateAutoGenerate;
      return { settings: { candidateAutoGenerate: savedPreference } };
    }
    ${forkSpinnerSource}
    ${moduleSource}
    // The same shape as the 基础设置 row: the shared switch driven by the hook, an alert on a failed save.
    function Probe() {
      const { enabled, loading, busy, error, save } = useForkAutoChoicesPreference();
      return React.createElement('div', null, React.createElement(ForkSwitch, { label: '自动生成选项', checked: enabled, disabled: loading || busy, onChange: save }),
        error ? React.createElement('p', { role: 'alert' }, error) : null);
    }
    modules['react-dom/client'].createRoot(document.querySelector('#settings')).render(
      React.createElement(React.Fragment, null, React.createElement(Probe), React.createElement(Probe)));
  ` })
  const switches = page.getByRole('switch', { name: '自动生成选项', exact: true })
  await switches.first().waitFor()
  await page.waitForFunction(() => [...document.querySelectorAll('[role=switch]')].every(input => input.checked && !input.disabled))
  await switches.first().uncheck()
  await page.waitForFunction(() => [...document.querySelectorAll('[role=switch]')].every(input => !input.checked && !input.disabled))
  await switches.last().check()
  await page.waitForFunction(() => [...document.querySelectorAll('[role=switch]')].every(input => input.checked && !input.disabled))
  assert.deepEqual(await page.evaluate(() => calls.filter(call => call.method === 'updateTavernSettings').map(call => call.args)), [
    { patch: { candidateAutoGenerate: false } }, { patch: { candidateAutoGenerate: true } }
  ])
  await page.evaluate(() => { rejectSave = true })
  await switches.first().click()
  await page.getByRole('alert').waitFor()
  assert.match(await page.getByRole('alert').textContent(), /保存失败.*test storage failure/)
  assert.equal(await switches.first().isChecked(), true, 'failed save keeps the persisted preference')
  assert.equal(await switches.first().isEnabled(), true)
  assert.deepEqual(errors, [])
})

test('one place only: 基础设置 owns the switch; 酒馆设置 › 候选项 and the stage CONFIG no longer mount a copy', () => {
  const candidate = settings.slice(settings.indexOf('function CandidatePreferencesSettings()'), settings.indexOf('// @include modules/global-settings.js'))
  assert.doesNotMatch(candidate, /AutoChoices/, '酒馆设置 › 候选项 keeps only the dismiss mode')
  assert.match(settings, /\/\/ @include fork-auto-choices\.js/, 'the hook is still defined in the client scope')
  assert.doesNotMatch(config, /AutoChoices|自动生成/, 'no CONFIG mirror')
  assert.doesNotMatch(moduleSource, /function ForkAutoChoicesSetting|fork-gal-|fork-bubble|settings-desc|localStorage/)
  assert.match(launcher, /autoChoices:typeof useForkAutoChoicesPreference==='function'\?useForkAutoChoicesPreference:undefined/)
  // private fork (stage mode entry, owner 2026-10): 舞台模式 carries its › (StageModeJump); StageModelRow is gone.
  const basic = cardUi.slice(cardUi.indexOf('function StageSwitches('), cardUi.indexOf('function StageModeJump('))
  assert.match(basic, /row\('stage',[^\n]*\),\s*h\(StageAutoChoicesRow/, 'right after 舞台模式')
})
