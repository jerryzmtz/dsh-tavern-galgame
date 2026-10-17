// private fork: the play card picker renders compact cover tiles and an intentional no-cover placeholder.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { spawnSync } from 'node:child_process'
import { browserReactScript } from './fixtures/browser-react.mjs'
import { forkThemeCss } from './helpers/fork-theme-css.mjs'

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8')
const cardList = await read('tavern-plugin/src/client/features/card-list.js')
const sidebar = await read('tavern-plugin/src/client/features/sidebar.js')
const css = await read('tavern-plugin/lib/client-assets/tavern.css') + '\n' + await forkThemeCss()
const listContent = cardList.slice(cardList.indexOf('function TavernCardListContent('), cardList.indexOf('async function deleteTavernCards('))
// Optional: FORK_PICKER_SHOTS=<dir> writes screenshots; FORK_PICKER_COVER=<png> uses a real cover.
const shots = process.env.FORK_PICKER_SHOTS || ''
const coverFile = process.env.FORK_PICKER_COVER || ''
function cover(w, h, color) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=${w}x${h}`, '-frames:v', '1', '-c:v', 'png', '-f', 'image2pipe', 'pipe:1'], {maxBuffer:32 * 1024 ** 2, windowsHide:true})
  return r.status === 0 ? r.stdout : null
}
const hasFfmpeg = !spawnSync('ffmpeg', ['-version'], {windowsHide:true}).error
const themes = {
  dark: '--dsw-alias-brand-primary:#4d8bff;--dsw-alias-bg-base:#1b1c20;--dsw-specific-sidebar-fill:#232429;--dsw-alias-border-l2:#ffffff1f;--dsw-alias-border-l3:#ffffff33;--dsw-alias-interactive-bg-hover:#ffffff12;--dsw-alias-label-primary:#f2f3f5;--dsw-alias-label-secondary:#c3c6cc;--dsw-alias-label-tertiary:#8b8f97;background:#111215;color:#f2f3f5',
  light: '--dsw-alias-brand-primary:#4176e6;--dsw-alias-bg-base:#ffffff;--dsw-specific-sidebar-fill:#f7f8fa;--dsw-alias-border-l2:#0000001a;--dsw-alias-border-l3:#0000002e;--dsw-alias-interactive-bg-hover:#0000000a;--dsw-alias-label-primary:#1d1f23;--dsw-alias-label-secondary:#4a4e57;--dsw-alias-label-tertiary:#80858f;background:#e9eaee;color:#1d1f23',
}
const cards = [
  {path:'cards/大肥鱼.json', name:'大肥鱼', hasImage:false},
  {path:'cards/魔法少女小圆.json', name:'魔法少女小圆 · 见泷原的放学后', hasImage:true},
  {path:'cards/海边.json', name:'海边咖啡屋', hasImage:true, script:{title:'夏日来信'}},
  {path:'cards/「星」.json', name:'「星」', hasImage:false},
  {path:'cards/宽图.json', name:'宽幅封面', hasImage:true},
]

test('picker source keeps the upstream helper and placeholder hooks this theme targets', () => {
  assert.match(sidebar, /"aria-label": openingPicker \? "游戏准备" : "选择人物卡开始游玩"/)
  assert.match(sidebar, /h\("div", \{ className: "dsh-tavern-side-empty", style: \{ padding: "4px 6px" \} \}, "已绑定剧本的人物卡将自动按剧本推进/)
  assert.match(listContent, /className: "dsh-tavern-card-thumb placeholder"/)
})

test('picker tiles are compact cover + copy, placeholder fills the cover box, helper hidden', {skip:!hasFfmpeg && 'ffmpeg unavailable'}, async t => {
  const images = {'cards/魔法少女小圆.json':cover(600, 800, '0xc86a8a'), 'cards/海边.json':cover(900, 1200, '0x3d7fa6'), 'cards/宽图.json':cover(1600, 600, '0x7a9a52')}
  if (coverFile) images['cards/大肥鱼.json'] = await readFile(coverFile)
  const browser = await chromium.launch({headless:true})
  t.after(() => browser.close())
  for (const [theme, vars] of Object.entries(themes)) for (const width of [1280, 760]) {
    const page = await browser.newPage({viewport:{width, height:900}})
    await page.route('http://picker.test/**', route => {
      const url = new URL(route.request().url())
      if (url.pathname === '/') return route.fulfill({contentType:'text/html', body:'<!doctype html><meta charset="utf-8"><body><div id="root"></div></body>'})
      const bytes = images[url.searchParams.get('path')]
      return bytes ? route.fulfill({contentType:'image/png', body:bytes}) : route.fulfill({status:404, body:''})
    })
    await page.goto('http://picker.test/')
    await page.evaluate(style => document.body.setAttribute('style', style), vars)
    await page.addStyleTag({content:css})
    const data = cards.map(card => ({...card, hasImage:card.hasImage || Boolean(coverFile && card.name === '大肥鱼')}))
    await page.addScriptTag({content:await browserReactScript() + `
      const React = modules.react, h = React.createElement;
      ${listContent}
      const cards = ${JSON.stringify(data)};
      function Picker() {
        return h('div', {className:'dsh-tavern-picker-overlay', style:{position:'fixed', inset:0, display:'grid', placeItems:'center'}},
          h('div', {className:'dsh-tavern-card-picker', role:'dialog', 'aria-modal':'true', 'aria-label':'选择人物卡开始游玩'},
            h('div', {className:'dsh-tavern-card-picker-head'}, h('span', null, '选择人物卡 · 开始游玩'), h('span', {className:'dsh-tavern-spacer'}), h('button', {className:'dsh-tavern-btn'}, '批量删除'), h('button', {className:'dsh-tavern-btn'}, '关闭')),
            h('div', {className:'dsh-tavern-side-empty', style:{padding:'4px 6px'}}, '已绑定剧本的人物卡将自动按剧本推进；未绑定的按自由故事推进。剧本绑定在“卡片模式”中管理。'),
            cards.map(card => h('div', {key:card.path, className:'dsh-tavern-card-pick-wrap'},
              h('button', {className:'dsh-tavern-card-pick' + (card.hasImage ? ' with-image' : '')}, h(TavernCardListContent, {showPath:true, card, detail:card.script ? '剧本：' + card.script.title : '自由故事（未绑定剧本）'}))))));
      }
      modules['react-dom/client'].createRoot(document.getElementById('root')).render(h(Picker));
    `})
    await page.waitForFunction(n => document.querySelectorAll('.dsh-tavern-card-pick').length === n && [...document.images].every(img => img.complete && img.naturalWidth), cards.length)
    const m = await page.evaluate(() => {
      const r = el => el.getBoundingClientRect()
      return {
        helper: getComputedStyle(document.querySelector('.dsh-tavern-card-picker > .dsh-tavern-side-empty')).display,
        tiles: [...document.querySelectorAll('.dsh-tavern-card-pick')].map(button => {
          const thumb = button.querySelector('.dsh-tavern-card-thumb'), copy = button.querySelector('.dsh-tavern-card-list-copy'), style = getComputedStyle(thumb)
          const b = r(button), c = r(thumb), k = r(copy), letter = thumb.classList.contains('placeholder') ? (() => { const range = document.createRange(); range.selectNodeContents(thumb); return range.getBoundingClientRect() })() : null
          return {name:button.querySelector('b').textContent, placeholder:thumb.classList.contains('placeholder'), text:thumb.textContent, button:{w:b.width, h:b.height, top:b.top}, thumb:{x:c.left - b.left, y:c.top - b.top, w:c.width, h:c.height}, copyBottom:k.bottom - b.top,
            pseudo:getComputedStyle(button, '::before').content, fit:style.objectFit, display:style.display, bg:style.backgroundImage, fontSize:parseFloat(style.fontSize), letter:letter && {cx:letter.left + letter.width / 2 - c.left, cy:letter.top + letter.height / 2 - c.top}}
        }),
      }
    })
    assert.equal(m.helper, 'none', `${theme}/${width}: grey helper hidden`)
    for (const tile of m.tiles) {
      const label = `${theme}/${width}/${tile.name}`
      assert.ok(tile.pseudo === 'none' || tile.pseudo === 'normal', label + ': no extra ::before box')
      assert.ok(Math.abs(tile.thumb.h / tile.thumb.w - 4 / 3) < 0.02, label + ': 3:4 cover ' + JSON.stringify(tile.thumb))
      assert.ok(Math.abs(tile.thumb.x) < 1.5 && Math.abs(tile.thumb.y) < 1.5 && Math.abs(tile.thumb.w - (tile.button.w - 2)) < 1.5, label + ': cover fills tile width at top')
      assert.ok(tile.button.h - tile.copyBottom < 2, label + ': no empty space below copy (' + (tile.button.h - tile.copyBottom) + 'px)')
      assert.ok(tile.button.h < tile.thumb.h + 90, label + ': compact tile ' + tile.button.h)
      if (tile.placeholder) {
        assert.equal(tile.display, 'grid', label)
        assert.match(tile.bg, /gradient/, label + ': tinted placeholder')
        assert.ok(tile.fontSize >= 36, label + ': large initial')
        assert.ok(Math.abs(tile.letter.cx - tile.thumb.w / 2) < 6 && Math.abs(tile.letter.cy - tile.thumb.h / 2) < 8, label + ': centred initial ' + JSON.stringify(tile.letter))
      } else assert.equal(tile.fit, 'cover', label)
    }
    assert.equal(m.tiles.find(tile => tile.name === '「星」').text, '星')
    if (!coverFile) assert.equal(m.tiles.find(tile => tile.name === '大肥鱼').text, '大')
    if (shots) { await mkdir(shots, {recursive:true}); await page.screenshot({path:`${shots}/picker-${coverFile ? 'cover' : 'placeholder'}-${theme}-${width}.png`}) }
    await page.close()
  }
})
