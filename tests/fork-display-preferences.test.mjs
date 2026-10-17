// private fork: exercise the upstream store and fork row together, without user data.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { createSessionViewReader } from '../tavern-plugin/lib/domain/session-view-reader.js'
import test from 'node:test'
import { applyTavernSettingsPatch, presentTavernSettings } from '../tavern-plugin/lib/domain/tavern-settings.js'

const settings = await readFile(new URL('../tavern-plugin/src/client/features/settings.js', import.meta.url), 'utf8')
const shell = await readFile(new URL('../tavern-plugin/src/client/fork-debug.js', import.meta.url), 'utf8')
const globalSettings = await readFile(new URL('../tavern-plugin/src/client/modules/global-settings.js', import.meta.url), 'utf8')
// private fork (UI standard phase 2 batch 7): the 调试视图 switch is the shared ForkSwitch (fork-inline-field.js).
const inlineField = await readFile(new URL('../tavern-plugin/src/client/fork-inline-field.js', import.meta.url), 'utf8')
const forkSwitch = inlineField.slice(inlineField.indexOf('function ForkSwitch('), inlineField.indexOf('\nfunction ', inlineField.indexOf('function ForkSwitch(') + 1))
const legacyKey = 'dsh-tavern-fork-debug'
const syncKey = 'dsh-tavern:display-preferences-changed'
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
function classes() {
  const values = new Set()
  return { contains: key => values.has(key), toggle(key, on) { on ? values.add(key) : values.delete(key) }, remove(key) { values.delete(key) } }
}
function harness({ document = {}, legacy, failSave = false, failRead = false } = {}) {
  const storage = new Map(legacy === undefined ? [] : [[legacyKey, legacy]])
  const events = new Map(), writes = [], states = []
  const h = { document, failSave, failRead, storage, events, writes, states }
  const context = {
    document: { body: { classList: classes() }, documentElement: { classList: classes() } },
    window: { localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) }, addEventListener: (key, fn) => events.set(key, fn), removeEventListener: key => events.delete(key) },
    // private fork (UI standard phase 2 batch 7): the fake createElement expands the shared ForkSwitch.
    React: { createElement: (type, props, ...children) => type?.name === 'ForkSwitch' ? type(props) : ({ type, props, children }), useSyncExternalStore: (_, snapshot) => snapshot(), useState: initial => [initial, value => states.push(value)] },
    async rpc(method, args) {
      if (method === 'updateTavernSettings') {
        if (h.failSave) throw Error('offline')
        writes.push(args.patch)
        h.document = applyTavernSettingsPatch(h.document, args.patch)
        return { settings: presentTavernSettings(h.document, {}) }
      }
      assert.equal(method, 'getDisplayPreferences')
      if (h.failRead) throw Error('offline')
      return presentTavernSettings(h.document, {})
    }
  }
  // Match production declaration order: the store precedes the fork shell include.
  vm.runInNewContext(settings.slice(settings.indexOf('        const displayPreferences ='), settings.indexOf('        function DisplayPreferencesSettings')) + shell.slice(0, shell.indexOf('// The host logo row')) + forkSwitch + '\n;this.store = displayPreferences;this.render = ForkDebugSetting;', context)
  return Object.assign(h, { context, store: context.store, render: context.render })
}
function nodes(root) { return !root || typeof root !== 'object' ? [] : [root, ...(root.children || []).flatMap(nodes)] }
function assertVisibility(h, debug) {
  assert.equal(h.context.document.body.classList.contains('dsh-fork-debug'), debug)
  assert.equal(h.context.document.documentElement.classList.contains('dsh-tavern-hide-process'), !debug)
}

test('unset profiles hide by default; the one fork switch persists both display classes', async () => {
  const h = harness()
  h.store.start()
  assertVisibility(h, false)
  assert.equal(nodes(h.render()).find(n => n.type === 'input').props.disabled, true)
  await flush()
  assert.equal(h.store.snapshot(), true)
  let input = nodes(h.render()).find(n => n.type === 'input')
  assert.equal(input.props.checked, false)
  await input.props.onChange({ target: { checked: true } })
  assertVisibility(h, true)
  assert.equal(h.document.hideContextAndReasoning, false)
  assert.ok(h.storage.has(syncKey))
  assert.equal(h.storage.has(legacyKey), false)
  input = nodes(h.render()).find(n => n.type === 'input')
  await input.props.onChange({ target: { checked: false } })
  assertVisibility(h, false)
  assert.equal(h.document.hideContextAndReasoning, true)
  const anotherOrigin = harness({ document: h.document })
  anotherOrigin.store.start(); await flush()
  assertVisibility(anotherOrigin, false)
})

test('legacy opt-in writes once then removes the key; legacy off does not overwrite explicit server choice', async () => {
  const h = harness({ legacy: '1', document: { unknown: 'keep' } })
  h.store.start(); await flush()
  assertVisibility(h, true)
  assert.equal(h.writes.length, 1)
  assert.equal(h.document.unknown, 'keep')
  assert.equal(h.storage.has(legacyKey), false)
  h.events.get('focus')(); await flush()
  assert.equal(h.writes.length, 1)
  const off = harness({ legacy: '0', document: { hideContextAndReasoning: false } })
  off.store.start(); await flush()
  assertVisibility(off, true)
  assert.equal(off.writes.length, 0)
  assert.equal(off.storage.has(legacyKey), false)
})

test('migration failure retains the key and retries on focus; failed toggles leave visibility unchanged', async () => {
  const h = harness({ legacy: '1', failSave: true })
  h.store.start(); await flush()
  assertVisibility(h, false)
  assert.equal(h.storage.get(legacyKey), '1')
  await nodes(h.render()).find(n => n.type === 'input').props.onChange({ target: { checked: true } })
  assert.ok(h.states.some(value => String(value).includes('保存失败')))
  assertVisibility(h, false)
  h.failSave = false
  h.events.get('focus')(); await flush()
  assertVisibility(h, true)
  assert.equal(h.storage.has(legacyKey), false)
})

test('storage/focus refresh update both classes and subscribers; offline startup remains hidden', async () => {
  const h = harness({ failRead: true })
  const stop = h.store.start()
  await flush(); assertVisibility(h, false)
  assert.equal(h.store.snapshot(), null)
  let notifications = 0
  const unsubscribe = h.store.subscribe(() => notifications++)
  h.failRead = false; h.document.hideContextAndReasoning = false
  h.events.get('storage')({ key: syncKey }); await flush()
  assertVisibility(h, true)
  h.document.hideContextAndReasoning = true
  h.events.get('focus')(); await flush()
  assertVisibility(h, false)
  assert.equal(notifications, 2)
  unsubscribe(); stop()
  assert.equal(h.events.size, 0)
})

test('settings dependency hook leaves upstream code intact but mounts only the fork display row', () => {
  const h = harness()
  const context = h.context
  Object.assign(context, { rpc: () => {}, notifySettingsChanged() {}, TavernDefaultModelSetting() {}, TavernConversationWritingSkills() {}, CandidatePreferencesSettings() {}, PromptTemplateSettingsEntry() {}, ContextCompactionSettings() {}, SceneImageSettings() {}, ForkUiSizeSetting() {}, GlobalPlayDefaults() {}, DisplayPreferencesSettings() { throw Error('upstream row must not mount') } })
  context.ForkCubismCoreEntry = context.ForkSpineRuntimeEntry = () => null // private fork: independently tested runtime settings entries
  context.React.useEffect = () => {}
  const wiring = settings.slice(settings.indexOf('        const { TavernSettingsSection } ='))
  vm.runInNewContext(globalSettings + wiring + ';this.section = TavernSettingsSection;', context)
  const rendered = nodes(context.section({ renderSlot: () => null })).flatMap(node => typeof node.type === 'function' ? nodes(node.type(node.props)) : [node])
  assert.equal(rendered.filter(n => n.props?.className?.includes('dsh-fork-debug-setting')).length, 1)
  assert.equal(rendered.filter(n => n.props?.className?.includes('dsh-tavern-display-preferences')).length, 0)
})

test('legacy sillytavern sessions retain their mode and can read through getSession', async () => {
  const server = await readFile(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')
  const context = {}
  vm.runInNewContext(server.slice(server.indexOf('  function normalizeChat('), server.indexOf('  const chatJournalStore =')) + ';this.normalize = normalizeChat;', context)
  const saved = { id: 'legacy', sessionId: 's', mode: 'story', requestMode: 'sillytavern', messages: [{ role: 'assistant', text: 'old story' }], _storageRevision: 1 }
  const before = JSON.stringify(saved)
  const read = async () => context.normalize(structuredClone(saved))
  const reader = createSessionViewReader({ readState: read, readChat: read,
    project: { full: async chat => ({ requestMode: chat.requestMode, messages: chat.messages }) },
    activity: () => ({}), foregroundRunning: () => false,
    trace: { stage: (_, fn) => fn(), state() {} }, synchronize: (_, view) => ({ view }) })
  const reconciliations = []
  Object.assign(context, { sessionViews: reader, args: { sessionId: 's' }, completeTemplateHistorySessions: new Set(),
    reconcileWhenIdle: async (sessionId, options) => { reconciliations.push({ sessionId, once: options.once }) } })
  const start = server.indexOf("case 'getSession': {")
  vm.runInNewContext('this.open = async () => { switch ("getSession") {' + server.slice(start, server.indexOf("case 'hydrateTavernHelperMessages':", start)) + '} };', context)
  const result = await context.open()
  assert.deepEqual(reconciliations, [{ sessionId: 's', once: true }])
  assert.equal(result.view.requestMode, 'sillytavern')
  assert.equal(result.view.messages[0].text, 'old story')
  assert.equal(JSON.stringify(saved), before)
})

test('compatibility defaults follow upstream even with legacy flags; data is not rewritten', () => {
  const saved = { compatibilityMode: true, sillyModeEnabled: true, unknown: 'keep' }
  const before = JSON.stringify(saved)
  const presented = presentTavernSettings(saved, {})
  assert.equal(presented.compatibilityMode, false)
  assert.equal(presented.sillyModeEnabled, false)
  assert.equal(JSON.stringify(saved), before)
  assert.throws(() => applyTavernSettingsPatch(saved, { compatibilityMode: true }), /已停用/)
})
