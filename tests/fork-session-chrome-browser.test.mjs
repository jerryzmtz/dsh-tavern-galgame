// private fork: chrome visibility must survive a failed stage slot without changing preferences.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { browserReactScript } from './fixtures/browser-react.mjs'

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8')
const shell = await read('tavern-plugin/src/client/fork-debug.js') + '\n' + await read('tavern-plugin/packages/dsh-tavern-ui/src/fork-shell.js')
const controls = await read('tavern-plugin/src/client/features/play-controls.js')
const css = await read('tavern-plugin/packages/dsh-tavern-ui/src/shell.css') + '\n' + await read('tavern-plugin/lib/client-assets/fork-theme.css')
const upstreamCss = await read('tavern-plugin/lib/client-assets/tavern.css')
const registration = `ctx.effect(() => slots.inject('conversation.session.header.utilities', () => slots.register({name:'conversation.session.header.utilities',id:'dsh-fork-session-marker'}, props => React.createElement(ForkSessionMarker, {sessionId:props.sessionId,view:{subscribe:()=>()=>{},getMode:()=>view ? view.mode : ''}}))));` + controls.slice(controls.indexOf('ctx.effect(() => slots.inject("conversation.input.dock"', controls.indexOf('dsh-tavern: candidate guide panel')),
  controls.indexOf(')), "dsh-tavern: fork session shell");') + ')), "dsh-tavern: fork session shell");'.length)

test('session chrome survives stage errors; debug, mode changes and unmount retain their contracts', async t => {
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage()
  await page.setContent(`<body class="dsh-tavern-shell-active"><div data-slot="main.conversation">
    <div data-slot="conversation.session.header"><div role="tablist">Trajectory</div>
      <div data-slot="conversation.session.header.utilities" id="header"></div>
      <div data-slot="conversation.session.header.lineage">Subagents</div></div>
    <div data-slot="conversation.input.dock" id="dock"></div>
    <div data-turn-tail="124"><div data-slot="conversation.chat.turnTail"></div><div>
      <div data-slot="conversation.chat.assistant-actions"><span class="dsh-fork-turn-actions"><button>Edit</button></span><button class="dsh-tavern-message-fork">Fork</button></div>
      <span id="usage"><button aria-haspopup="dialog">187K tok</button></span>
      <span id="latency"><button aria-haspopup="dialog">106s</button></span><span id="time">15:50</span>
    </div></div><div data-composer-stats>124 rounds 10.2M tok</div></div></body>`)
  await page.addStyleTag({ content: upstreamCss + '\n' + css })
  await page.addScriptTag({ content: await browserReactScript() + `
    const React = modules.react;
    const ReactDOM = modules['react-dom'];
    const registrations = [];
    const ctx = {effect: fn => fn()};
    const slots = {inject: (_, fn) => fn(), register: (meta, component) => registrations.push({meta, component})};
    let view = {mode:'play'}, sessionId = 's1', failed = false;
    const useLiveTavernView = () => ({view});
    const isPlayMode = mode => mode === 'play';
    const executeSlash = () => { throw Error('must not run'); };
    function CardStageHost() { if (failed) throw Error('offline stage failure'); return null; }
    function ForkGalStageHost() { return null; }
    function ForkGalRegenerate() { return null; }
    function ForkGalChoices() { return null; }
    ${shell.slice(shell.indexOf('function applyForkDebug('), shell.indexOf('// private fork: one server-backed'))}
    ${shell.slice(shell.indexOf('function ForkSessionMarker('))}
    ${registration}
    class Boundary extends React.Component {
      constructor(props) { super(props); this.state = {error:false}; }
      static getDerivedStateFromError() { return {error:true}; }
      render() { return this.state.error ? React.createElement('div', {'data-slot-error':this.props.slot}) : this.props.children; }
    }
    const root = modules['react-dom/client'].createRoot(document.getElementById('header'));
    window.render = options => {
      if ('mode' in options) view = options.mode ? {mode:options.mode} : null;
      if ('sessionId' in options) sessionId = options.sessionId;
      if ('failed' in options) failed = options.failed;
      if ('debug' in options) applyForkDebug(document, options.debug);
      root.render(registrations.map(({meta,component}) => ReactDOM.createPortal(
        React.createElement(Boundary, {key:meta.id + sessionId,slot:meta.name}, React.createElement(component,{sessionId})),
        document.querySelector('[data-slot="' + meta.name + '"]'), meta.id)));
    };
    window.unmount = () => root.unmount();
    window.registrationSlots = registrations.map(r => [r.meta.id,r.meta.name]);
    render({});
  ` })
  const root = page.locator('[data-slot="main.conversation"]')
  await page.waitForFunction(() => document.querySelector('[data-dsh-fork-session="play"]'))
  assert.deepEqual(await page.evaluate(() => registrationSlots), [
    ['dsh-fork-session-marker', 'conversation.session.header.utilities'],
    ['dsh-fork-session-shell', 'conversation.input.dock']
  ])
  const stats = ['#usage', '#latency', '[data-composer-stats]']
  const playChrome = ['[role="tablist"]', '[data-slot="conversation.session.header.lineage"]']
  async function visible(selectors, expected) {
    for (const selector of selectors) assert.equal(await page.locator(selector).isVisible(), expected, selector)
  }
  await visible([...stats, ...playChrome], false)
  await visible(['.dsh-fork-turn-actions button', '#time'], true)
  await visible(['.dsh-tavern-message-fork'], false) // private fork: branching lives in the more menu.
  await page.evaluate(() => render({failed:true}))
  await page.locator('[data-slot-error="conversation.input.dock"]').waitFor({state:'attached'})
  assert.equal(await root.getAttribute('data-dsh-fork-session'), 'play')
  await visible([...stats, ...playChrome], false)
  await page.evaluate(() => render({debug:true}))
  await visible([...stats, ...playChrome], true)
  await page.evaluate(() => render({debug:false}))
  await visible([...stats, ...playChrome], false)
  await page.evaluate(() => render({mode:'card',sessionId:'s2',failed:false}))
  await page.waitForFunction(() => document.querySelector('[data-dsh-fork-session="card"]'))
  await visible(['#usage', '#latency', ...playChrome], true)
  await visible(['[data-composer-stats]'], false)
  await page.evaluate(() => render({mode:null,sessionId:'s3'}))
  await page.waitForFunction(() => !document.querySelector('[data-dsh-fork-session]'))
  await visible([...stats, ...playChrome], true)
  await page.evaluate(() => render({mode:'play'}))
  await page.waitForFunction(() => document.querySelector('[data-dsh-fork-session="play"]'))
  await page.evaluate(() => unmount())
  assert.equal(await root.getAttribute('data-dsh-fork-session'), null)
})
