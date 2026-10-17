// private fork: historical vocabulary is fixture data, not a runtime default.
// private fork: real-browser transcript scroll harness for avatar first-frame painting.
// Production cache/resource owner/ForkPackImage/ForkBubbleRow in headless Chrome, a long
// non-virtualized transcript inside its own scroller (like the live chat), a Live2D-only
// figure with dedicated per-mood images (crop:null) and sprite-crop figures. Every
// animation frame of a scripted scroll is sampled: a row inside the scroller viewport
// whose avatar is not a complete, visible image is a placeholder/empty frame.
import builtinMoods from '../tests/fixtures/legacy-dialogue-moods.json' with {type:'json'} // private fork
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {chromium} from 'playwright'
import {browserReactScript} from './fixtures/browser-react.mjs'

const path = name => 'tavern-plugin/src/client/' + name
const current = name => readFileSync(new URL('../' + path(name), import.meta.url), 'utf8')
const between = (s, a, b) => s.slice(s.indexOf(a), s.indexOf(b, s.indexOf(a)))
const css = readFileSync(new URL('../tavern-plugin/lib/client-assets/fork-theme.css', import.meta.url), 'utf8')
  .split('\n').filter(line => /^\.fork-(bubble|pack-crop)/.test(line) && !/lightbox|card|voice|chip/.test(line)).join('\n')

function sources(read) {
  // private fork: current bubbles use the extracted line helpers; old comparison code predates them.
  const bubbles = read('fork-bubbles.js'), extracted = bubbles.includes('// @include fork-bubble-line.cjs')
  return [
    readFileSync(new URL('../tavern-plugin/packages/dsh-presentation-protocol/src/figure-resolution.cjs',import.meta.url),'utf8'),
    read('fork-stage-resources.cjs').replace("'use strict';", ''),
    read('fork-avatar-cache.cjs'),
    current('fork-spinner.js'), // private fork: shared host-shell spinner, not the historical avatar implementation.
    ...(extracted ? [read('fork-bubble-line.cjs')] : []),
    read('fork-pack-playback.cjs'),
    between(bubbles, 'const FORK_CUSTOM_MOOD_MAX', extracted ? '// Per-session bubble settings' : 'function forkBubbleSegment'),
    between(bubbles, 'function forkBubbleMediaDescriptor', '// Drop-in for TavernColoredMarkdown')
  ].join('\n;\n')
}

const app = String.raw`
const FORK_BUBBLE_MOODS = ${JSON.stringify(builtinMoods.slice(0,6))};
const FORK_BUBBLE_PALETTE = ['#e0707c','#2fae9a','#b56be0'];
const forkPackListeners = new Set(), useForkPackRevision = () => 0;
const forkGalActive = {subscribe:() => () => {}, get:() => null};
function ForkVoiceButton() { return null; }
function forkShowPortrait() {}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function png(w, h, hue) {
  const canvas = new OffscreenCanvas(w, h), g = canvas.getContext('2d');
  g.fillStyle = 'hsl(' + hue + ' 60% 55%)'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#fff'; g.beginPath(); g.arc(w / 2, h * 0.12, w * 0.1, 0, 7); g.fill();
  return canvas.convertToBlob({type:'image/png'});
}
const moods = FORK_BUBBLE_MOODS.map(m => m.id), blobs = new Map();
const figures = [
  {alias:'player', name:'高坂月', pack:'luna', w:512, h:512, crop:null},
  {alias:'homura', name:'Homura', pack:'mado', w:600, h:1400, crop:{x:0.3,y:0.03,w:0.4,h:0.17}},
  {alias:'madoka', name:'Madoka', pack:'mado', w:600, h:1400, crop:{x:0.32,y:0.04,w:0.36,h:0.16}}];
const characters = [];
let hue = 0;
for (const f of figures) {
  const media = mood => ({resource:true, kind:'media', ref:{packId:f.pack, figureId:'f-' + f.alias}, alias:'f_'+f.alias, revision:'r1',
    hash:f.alias + '-' + mood, outfitKey:'default', stateId:f.crop ? mood : null, crop:f.crop, identity:f.pack + ':figures:f-' + f.alias + ':' + f.alias + '-' + mood});
  for (const mood of moods) blobs.set(f.alias + '-' + mood, await png(f.w, f.h, hue += 23));
  characters.push({alias:'f_'+f.alias, aliases:[f.alias], ref:{packId:f.pack,figureId:'f-'+f.alias}, name:f.name, color:'#e08a3c', avatarMedia:{default:media('calm'), moods:Object.fromEntries(moods.map(m => [m, media(m)]))}});
}
const config = {characters, moods:FORK_BUBBLE_MOODS};
const service = {async leaseMedia({hash}) { return {revision:'r1', url:'/fixture/' + hash, ticket:hash}; }, async releaseLease() {}};
const owner = createStageResourceOwner({service, fetch:async url => {
    await sleep(25);
    const blob = blobs.get(url.split('/').pop());
    return new Response(blob, {headers:{'content-type':'image/png','content-length':String(blob.size)}});
  },
  async decode(blob, url, {avatar = false} = {}) {
    if (!blob.type.startsWith('image/')) return null;
    if (avatar && typeof createImageBitmap === 'function') return createImageBitmap(blob);
    const image = new Image(); image.src = url;
    try { await image.decode(); return image; } catch (error) { image.src = ''; throw error; }
  }});
const source = {sessionId:'s', authorityEpoch:1};
const forkStageSessions = {resourceOwner:owner, get:() => ({subscribe:() => () => {}, getSnapshot:() => ({source})})};
forkAvatarCache.select('s');
for (const c of characters) forkAvatarCache.revision(c.avatarMedia.default.ref.packId, 'r1');
// Session-open default prefetch, as fork-stage-session-binding does.
for (const c of characters) {
  const d = c.avatarMedia.default;
  owner.acquire(d, JSON.stringify(['s',1])).then(async pin => { try { await forkAvatarCache.prepare({...d,sessionId:'s'}, pin.handle.url); } finally { pin.release(); } });
}
let seed = 7;
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const rows = Array.from({length:480}, (_, i) => {
  const alias = rand() < 0.5 ? 'player' : rand() < 0.5 ? 'homura' : 'madoka';
  return {alias, name:forkBubbleCharacter(config,alias).name, mood:FORK_BUBBLE_MOODS[Math.floor(rand() * moods.length)].label, text:'Line ' + i + ' ' + 'lorem ipsum dolor '.repeat(4 + i % 5), thought:false};
});
function Transcript() {
  return React.createElement('div', null, rows.map((segment, i) => React.createElement(ForkBubbleRow, {key:i, sessionId:'s', segment, config})));
}
const scroll = document.getElementById('scroll'), root = ReactDOM.createRoot(document.getElementById('root'));
ReactDOM.flushSync(() => root.render(React.createElement(Transcript)));
scroll.scrollTop = scroll.scrollHeight;
function sample(stats) {
  const box = scroll.getBoundingClientRect();
  let bad = 0;
  for (const row of scroll.querySelectorAll('.fork-bubble')) {
    const r = row.getBoundingClientRect();
    if (r.bottom <= box.top || r.top >= box.bottom) continue;
    const avatar = row.querySelector('.fork-bubble-avatar'), img = avatar.querySelector('img');
    const kind = !img ? (avatar.textContent ? 'surname' : 'blank')
      : img.style.visibility === 'hidden' || !img.complete || !img.naturalWidth ? 'hidden' : null;
    if (!kind) continue;
    bad++; stats[kind]++;
    stats.byAlias[row.dataset.alias] = (stats.byAlias[row.dataset.alias] || 0) + 1;
  }
  stats.frames++; if (bad) stats.badFrames++;
}
async function pass(step, frames) {
  const stats = {frames:0, badFrames:0, surname:0, blank:0, hidden:0, byAlias:{}};
  for (let i = 0; i < frames; i++) {
    await new Promise(requestAnimationFrame);
    sample(stats);
    scroll.scrollTop += step;
    // Live chat frames also lay out Markdown and host UI; keep the main thread similarly busy.
    setTimeout(() => { const end = performance.now() + 10; while (performance.now() < end); });
  }
  for (let i = 0; i < 3; i++) { await new Promise(requestAnimationFrame); sample(stats); }
  return stats;
}
window.avatarScroll = async settle => {
  await sleep(settle); // initial idle prefetch settles at the bottom of the chat
  const up = await pass(-120, 220);
  const down = await pass(120, 220);
  const flingUp = await pass(-700, 40);
  const flingDown = await pass(700, 40);
  // Fresh component instances for every row (host history window / chat re-entry):
  // already-seen avatars must be complete in the synchronous commit, before any frame.
  const top = scroll.scrollTop;
  ReactDOM.flushSync(() => root.render(React.createElement('div')));
  ReactDOM.flushSync(() => root.render(React.createElement(Transcript)));
  scroll.scrollTop = top;
  const remount = {frames:0, badFrames:0, surname:0, blank:0, hidden:0, byAlias:{}};
  sample(remount);
  for (let i = 0; i < 3; i++) { await new Promise(requestAnimationFrame); sample(remount); }
  return {up, down, flingUp, flingDown, remount};
};
window.avatarReady = true;
`

async function run(browser, read, settle = 2500) {
  const page = await browser.newPage({viewport:{width:1200, height:924}, deviceScaleFactor:2})
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setContent(`<style>body{margin:0;font:15px sans-serif}${css}
    .fork-bubble{display:flex;gap:12px;padding:10px 16px}.fork-bubble-portrait{flex:none}</style>
    <div id="scroll" style="position:fixed;top:50px;left:0;right:0;bottom:0;overflow:auto"><div id="root"></div></div>`)
  await page.addScriptTag({type:'module', content:await browserReactScript() +
    '\nconst React=modules.react,ReactDOM={...modules["react-dom"],...modules["react-dom/client"]};\n' + sources(read) + '\n' + app})
  await page.waitForFunction(() => window.avatarReady, null, {timeout:20000})
  const result = await page.evaluate(settle => window.avatarScroll(settle), settle)
  await page.close()
  assert.deepEqual(errors, [])
  return result
}

test('an uncached crop whose source is already available is visible in its first commit', {timeout:60000}, async () => {
  const browser = await chromium.launch({channel:'chrome', headless:true})
  try {
    const check = async read => {
      const page = await browser.newPage()
      await page.setContent('<div id="root" style="width:88px;height:88px"></div>')
      await page.addScriptTag({type:'module', content:await browserReactScript() +
        '\nconst React=modules.react,ReactDOM={...modules["react-dom"],...modules["react-dom/client"]};\n' + sources(read) + String.raw`
        const canvas = new OffscreenCanvas(400, 800); canvas.getContext('2d').fillRect(0, 0, 400, 800);
        const url = URL.createObjectURL(await canvas.convertToBlob({type:'image/png'}));
        const warm = new Image(); warm.src = url; await warm.decode();
        const root = ReactDOM.createRoot(document.getElementById('root'));
        // Stage face: overflow crops never use the square cache.
        ReactDOM.flushSync(() => root.render(React.createElement(ForkPackImage, {identity:'face', src:url, crop:{x:0.3,y:0,w:0.4,h:0.2}, cropOverflow:true, alt:''})));
        window.firstCommit = document.querySelector('#root img').style.visibility;`})
      await page.waitForFunction(() => window.firstCommit !== undefined)
      const value = await page.evaluate(() => window.firstCommit)
      await page.close()
      return value
    }
    assert.notEqual(await check(current), 'hidden')
  } finally { await browser.close() }
})

test('scripted transcript scroll paints dedicated and crop avatars in every frame', {timeout:120000}, async t => {
  const browser = await chromium.launch({channel:'chrome', headless:true})
  try {
    // The historical 8a6ddfd5 reproducer proved the bug during development; only
    // the shipped implementation belongs in the recurring regression gate.
    const after = await run(browser, current)
    t.diagnostic(JSON.stringify({after}))
    for (const name of ['up', 'down', 'flingUp', 'flingDown', 'remount'])
      assert.deepEqual({name, badFrames:after[name].badFrames, surname:after[name].surname, blank:after[name].blank, hidden:after[name].hidden},
        {name, badFrames:0, surname:0, blank:0, hidden:0})
  } finally { await browser.close() }
})
