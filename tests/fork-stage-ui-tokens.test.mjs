import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const css = await readFile(new URL('../tavern-plugin/lib/client-assets/fork-theme.css', import.meta.url), 'utf8')
const scene = await readFile(new URL('../tavern-plugin/src/client/fork-gal-scene.js', import.meta.url), 'utf8')
const open = '/* ==== stage UI tokens ==== */'
const close = '/* ==== end stage UI tokens ==== */'
// private fork: bases carry no glass opacity any more; every surface paint comes from the surface table (ui-surfaces.md).
const bases = ['bg', 'ink', 'accent', 'radius', 'font'].map(name => '--gal-base-' + name)
const semantics = [
  'surface', 'surface-2', 'ink', 'ink-2', 'accent', 'accent-ink', 'line', 'track', 'thumb',
  'radius', 'font', 'title-font', 'shadow', 'ornament', 'divider', 'gem', 'dim', 'ink-disabled', 'hold-glow', 'ring-faint', 'ring-track',
  'hud-plate', 'hud-ink', 'hud-ink-on', 'hud-ink-idle', 'hud-hover', 'hud-selected', 'hud-line',
  'widget-pink', 'widget-info', 'widget-warning',
  'hover', 'active', 'focus', 'muted', 'title-shadow', 'text-shadow', 'veil', 'hold',
  'divider-width', 'gem-width', 'gem-height', 'gem-fill', 'gem-display', 'name-before', 'name-after',
  'tag-display', 'line-indent', 'thought-width', 'reading-size', 'reading-leading',
  'ornament-corner', 'ornament-size', 'ornament-glow', 'ornament-mini', 'ornament-mini-size', 'ornament-accent',
  // private fork (owner 2026-10, no box in a box): the inner stitched-line tokens (ornament-edge, -edge-inset) are gone.
  'ornament-halo', 'ornament-motion',
].map(name => '--gal-ui-' + name)
// Border ornament tokens that draw something new on a surface; a theme that leaves them at the defaults gets no ornaments.
const ornamentDrawing = ['ornament-corner', 'ornament-mini', 'ornament-mini-size', 'ornament-accent', 'ornament-halo', 'ornament-motion'].map(name => '--gal-ui-' + name)

// Small CSS block lexer: handles comments, quoted strings, escapes and nested at-rules.
// Unlike a selector regex, this also finds selectors inside @media/@supports and CSS nesting.
function rules(source) {
  const result = [], stack = []
  let start = 0, quote = '', comment = false, parens = 0
  for (let i = 0; i < source.length; i++) {
    const c = source[i], next = source[i + 1]
    if (comment) { if (c === '*' && next === '/') { comment = false; i++ } continue }
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; continue }
    if (c === '/' && next === '*') { comment = true; i++; continue }
    if (c === '"' || c === "'") { quote = c; continue }
    if (c === '(') parens++
    if (c === ')') parens--
    if (parens) continue
    if (c === '{') {
      const selector = source.slice(start, i).replace(/\/\*[\s\S]*?\*\//g, '').trim()
      stack.push({ selector, start: i + 1, parents: stack.map(rule => rule.selector) })
      start = i + 1
    } else if (c === '}') {
      const rule = stack.pop()
      assert.ok(rule, 'balanced CSS closing brace')
      result.push({ ...rule, body: source.slice(rule.start, i) })
      start = i + 1
    } else if (c === ';') start = i + 1
  }
  assert.equal(stack.length, 0, 'balanced CSS blocks')
  assert.equal(quote, '', 'terminated CSS string')
  assert.equal(comment, false, 'terminated CSS comment')
  return result
}
function declarations(body) {
  return new Set([...body.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(?:^|[;}])\s*(--[\w-]+)\s*:/g)].map(match => match[1]))
}
function themeViolations(source) {
  return rules(source).filter(rule => {
    if (rule.selector.startsWith('@')) return false
    const selector = [...rule.parents, rule.selector].join(' ')
    return /\.fork-(?:gal-(?:config|mixer|backlog|choice|widget|title|menu)|widget)[\w-]*(?![\w-])/.test(selector) && /\[\s*data-theme\b/i.test(selector)
  }).map(rule => rule.selector)
}
// Plain (non-at) rules whose selector, including parents, matches the pattern.
function rulesFor(source, pattern) {
  return rules(source).filter(rule => !rule.selector.startsWith('@') && pattern.test([...rule.parents, rule.selector].join(' ')))
}
// A literal colour or a host/fork variable instead of a stage UI token. Colour keywords only as whole values
// (a hyphen is a word boundary, so white-space must not count as white).
const untokenised = /#[\da-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(|(?<![\w-])(?:white|black|canvas|canvastext)(?![\w-])|var\(\s*--(?!gal-ui-)/i

test('stage tokens: exactly one bounded contract block with default bases and every semantic token', () => {
  assert.equal(css.split(open).length, 2)
  assert.equal(css.split(close).length, 2)
  const start = css.indexOf(open), end = css.indexOf(close)
  assert.ok(end > start)
  const block = css.slice(start + open.length, end)
  const parsed = rules(block)
  // A palette rule is the stage selector, optionally grouped with the same selector on .fork-gal-theme-scope
  // (a preview element that renders another theme, e.g. the Config screen's box style cards).
  const is = (rule, stage) => { const list = rule.selector.split(',').map(part => part.trim()); return list[0] === stage && (list.length === 1 || (list.length === 2 && list[1] === stage.replace('.fork-gal-stage', '.fork-gal-theme-scope'))) }
  const defaults = parsed.filter(rule => is(rule, '.fork-gal-stage'))
  assert.equal(defaults.length, 1, 'one generic derivation rule')
  const declared = declarations(defaults[0].body)
  for (const name of [...bases, ...semantics]) assert.ok(declared.has(name), name + ' has a no-theme default')
  // private fork: crt (显像管) and aero (千禧晴空) are the fourth and fifth built-in palettes.
  for (const theme of ['classic', 'gothic', 'magical', 'crt', 'aero']) {
    const themed = parsed.find(rule => is(rule, `.fork-gal-stage[data-theme="${theme}"]`))
    assert.ok(themed, theme + ' base palette exists')
    const palette = declarations(themed.body)
    for (const name of bases) assert.ok(palette.has(name), theme + ' defines ' + name)
    assert.equal([...palette].filter(name => name.startsWith('--gal-base-')).length, 5, 'keep each palette small')
  }
  // Detect accidental use of an undocumented/undeclared UI token in concurrent components too.
  for (const [, name] of css.matchAll(/var\(\s*(--gal-ui-[\w-]+)/g)) assert.ok(declared.has(name), name + ' belongs in the contract')
})

test('stage overlays: components never branch on data-theme (decoration allowlist is empty)', () => {
  assert.deepEqual(themeViolations(css), [])
})

test('stage choices: editor, free row and send pill are drawn only from stage UI tokens', () => {
  const groups = {
    send: /\.fork-gal-choice-send(?![\w-])/,
    cancel: /\.fork-gal-choice-cancel(?![\w-])/,
    editing: /\.fork-gal-choice\.is-editing(?![\w-])/,
    free: /\.fork-gal-choice(?:\.is-free|:is\(\.is-free, \.is-regen\))(?![\w-])/, // private fork: 自由输入 and 重新生成正文 share the row recipe
    regen: /\.fork-gal-choice(?:\.is-regen|:is\(\.is-free, \.is-regen\))(?![\w-])/,
  }
  for (const [name, pattern] of Object.entries(groups)) {
    const found = rulesFor(css, pattern)
    assert.ok(found.length > 0, name + ' rules exist')
    for (const rule of found) {
      assert.doesNotMatch(rule.selector, /\[\s*data-theme\b/i, rule.selector)
      assert.doesNotMatch(rule.body.replace(/\/\*[\s\S]*?\*\//g, ''), untokenised, rule.selector + ' uses only --gal-ui-* colours')
    }
  }
  const body = selector => rulesFor(css, selector).map(rule => rule.body).join(';')
  const input = body(/\.fork-gal-choice\.is-editing \.fork-gal-choice-input$/)
  for (const reset of [/background:\s*none/, /border:\s*0/, /box-shadow:\s*none/, /appearance:\s*none/, /outline:\s*none/])
    assert.match(input, reset, 'the textarea resets inherited ' + reset.source)
  assert.match(input, /(?:^|;)\s*color:\s*var\(--gal-ui-ink\)/, 'readable ink on the card surface')
  assert.match(input, /caret-color:\s*var\(--gal-ui-accent\)/)
  assert.match(body(/\.fork-gal-choice-input::placeholder$/), /(?:^|;)\s*color:\s*var\(--gal-ui-ink-2\)/)
  assert.match(body(/\.fork-gal-choice\.is-editing:focus-within$/), /outline:\s*var\(--gal-ui-focus\)/)
  const send = body(/\.fork-gal-choice-send$/)
  assert.match(send, /background:\s*var\(--gal-ui-accent\)/)
  assert.match(send, /(?:^|;)\s*color:\s*var\(--gal-ui-accent-ink\)/)
  assert.match(send, /border-radius:\s*999px/, 'send is a pill')
  // The dream skin's composer marker ([data-dsh-dream-skin-composer]) lands on the editor card; its ::before must not paint.
  const guard = rulesFor(css, /\.fork-gal-stage \.fork-gal-choices \.fork-gal-choice::before/)
  assert.ok(guard.some(rule => /content:\s*none/.test(rule.body)), 'skin pseudo layers are switched off on stage choices')
  // Anything else the skin tags inside the stage (e.g. a wrapper) is neutralised too, above the skin's (0,2,2).
  const anyTagged = rulesFor(css, /\.fork-gal-stage \[data-dsh-dream-skin-composer\]\[data-dsh-dream-skin-composer\]::before/)
  assert.ok(anyTagged.some(rule => /content:\s*none/.test(rule.body)), 'skin pseudo layers are switched off on any tagged stage element')
  assert.ok(rulesFor(css, /\.fork-gal-stage \[data-dsh-dream-skin-composer\]\[data-dsh-dream-skin-composer\](?:,|$)/).some(rule => /outline:\s*none/.test(rule.body)), 'the liquid outline is dropped on tagged stage elements')
  // The fork's global opaque-composer rule (!important cream) must never reach the stage: the skin tags the editor.
  for (const rule of rules(css).filter(rule => !rule.selector.startsWith('@') && /!important/.test(rule.body) && /background/.test(rule.body)))
    for (const part of rule.selector.split(/,(?![^(]*\))/).filter(part => /\[data-(?:dsh-dream-skin-composer|composer-card)\]/.test(part)))
      assert.match(part, /:not\(\.fork-gal-stage \*\)/, part.trim() + ' excludes the stage')
  // Rows are opaque cards in the panel paint (no backdrop blur); the look filter grades each row, never the list.
  const card = body(/^\.fork-gal-stage \.fork-gal-choice$/)
  assert.match(card, /background:\s*var\(--gal-ui-veil\)/)
  assert.doesNotMatch(card, /backdrop-filter/)
  const look = rulesFor(css, /\[data-look-ui\]/).filter(rule => /filter:\s*url\(#fork-gal-look-ui\)/.test(rule.body)).map(rule => rule.selector).join(',')
  assert.match(look, /\.fork-gal-choices > \*/)
  assert.doesNotMatch(look, /\.fork-gal-choices(?! > \*)/)
  assert.match(input, /-webkit-text-fill-color:\s*var\(--gal-ui-ink\)/)
  // 取消 is a quiet pill beside the accent 发送.
  const cancel = body(/\.fork-gal-choice-cancel$/)
  assert.match(cancel, /background:\s*transparent/)
  assert.match(cancel, /(?:^|;)\s*color:\s*var\(--gal-ui-ink-2\)/)
  assert.match(cancel, /border-radius:\s*999px/)
})

test('stage choices: the list draws no box of its own and does not clip its cards\' shadows into a frame', () => {
  const list = rules(css).filter(rule => rule.parents.length === 0 && rule.selector === '.fork-gal-choices')
  assert.ok(list.length > 0)
  const layout = list.find(rule => /position:\s*absolute/.test(rule.body))
  assert.ok(layout, 'the positioned list rule')
  const onList = rule => rule.selector.split(/,(?![^(]*\))/).some(part => /\.fork-gal-choices(?:\[[^\]]*\])*$/.test(part.trim()))
  for (const rule of rules(css).filter(rule => !rule.selector.startsWith('@') && onList(rule))) {
    const decl = rule.body.replace(/\/\*[\s\S]*?\*\//g, '')
    assert.doesNotMatch(decl, /(?:^|;)\s*(?:background(?:-color|-image)?|border(?:-\w+)?|box-shadow|outline|backdrop-filter|-webkit-backdrop-filter)\s*:(?!\s*(?:none|0|transparent)\s*(?:;|$))/, rule.selector + ' paints nothing on the list')
  }
  // The list scrolls (overflow clips at the padding box), so its padding must cover the card shadow
  // (--gal-ui-shadow: 0 8px 28px → 20px up, 28px sideways, 36px down) or the cut edge shows as a frame.
  const shadow = /--gal-ui-shadow:\s*0\s+(\d+)px\s+(\d+)px/.exec(css)
  assert.ok(shadow, 'default --gal-ui-shadow is 0 <y> <blur>')
  const [y, blur] = [Number(shadow[1]), Number(shadow[2])]
  const padding = /(?:^|;)\s*padding:\s*(\d+)px\s+(\d+)px\s+(\d+)px\s*;/.exec(layout.body)
  assert.ok(padding, 'top / sides / bottom padding in px')
  const [top, side, bottom] = padding.slice(1).map(Number)
  assert.ok(top >= blur - y && side >= blur && bottom >= blur + y, `padding ${top}/${side}/${bottom} covers the shadow`)
  assert.match(layout.body, /box-sizing:\s*border-box/)
  assert.match(layout.body, new RegExp(`width:\\s*calc\\(min\\(86%, 640px\\) \\+ ${2 * side}px\\)`), 'the card column keeps its width')
  assert.match(layout.body, /pointer-events:\s*none/, 'the padding band lets clicks through to the stage')
  assert.ok(rules(css).some(rule => rule.selector === '.fork-gal-choices > *' && /pointer-events:\s*auto/.test(rule.body)), 'the cards stay clickable')
})

test('stage ornaments: one token-only block of decorative pseudo-elements; only magical opts in', () => {
  const open = '/* ==== stage ornaments ==== */', close = '/* ==== end stage ornaments ==== */'
  assert.equal(css.split(open).length, 2)
  assert.equal(css.split(close).length, 2)
  const block = css.slice(css.indexOf(open) + open.length, css.indexOf(close))
  const parsed = rules(block).filter(rule => !rule.selector.startsWith('@'))
  assert.ok(parsed.length > 0)
  for (const rule of parsed) {
    assert.doesNotMatch([...rule.parents, rule.selector].join(' '), /\[\s*data-theme\b/i, rule.selector)
    assert.doesNotMatch(rule.body.replace(/\/\*[\s\S]*?\*\//g, ''), untokenised, rule.selector + ' uses only --gal-ui-* colours')
  }
  // Every pseudo-element that draws (content) is decorative: no text and no hit target.
  for (const rule of parsed.filter(rule => /content:/.test(rule.body))) {
    assert.match(rule.body, /content:\s*""/, rule.selector + ' has no text')
    assert.match(rule.body, /pointer-events:\s*none/, rule.selector + ' lets clicks through')
  }
  // Motion goes through the token and has a reduced-motion fallback (fork convention: `and (update: none)`).
  assert.match(block, /@media \(prefers-reduced-motion: reduce\)[^{]*\{[^}]*animation:\s*none/)
  // The CONFIG corner pair shares the recipe: paint + optional mask + glow token.
  const corner = rulesFor(css, /\.fork-gal-config-ornament::before, \.fork-gal-config-ornament::after$/).map(rule => rule.body).join(';')
  for (const token of ['--gal-ui-ornament)', '--gal-ui-ornament-corner', '--gal-ui-ornament-size', '--gal-ui-ornament-glow'])
    assert.ok(corner.includes('var(' + token), 'config corners use ' + token)
  // Palettes: magical sets the drawing tokens; classic and gothic keep the defaults (no visual change).
  const tokens = css.slice(css.indexOf('/* ==== stage UI tokens ==== */'), css.indexOf('/* ==== end stage UI tokens ==== */'))
  const palette = theme => declarations(rules(tokens).find(rule => rule.selector.startsWith(`.fork-gal-stage[data-theme="${theme}"]`)).body)
  for (const name of ornamentDrawing) assert.ok(palette('magical').has(name), 'magical sets ' + name)
  for (const theme of ['classic', 'gothic']) for (const name of ornamentDrawing) assert.ok(!palette(theme).has(name), theme + ' leaves ' + name + ' at its default')
  // private fork (owner 2026-10): one frame per surface. No ornament draws a line inside a card, row, widget or reader,
  // and the magical halo is a single rim (no gap + second ring).
  assert.doesNotMatch(css, /--gal-ui-ornament-edge/)
  for (const rule of parsed) assert.doesNotMatch(rule.body, /(?:^|;)\s*border(?:-width|-style)?\s*:/, rule.selector + ' draws no inner frame line')
  const halo = rules(tokens).find(rule => rule.selector.startsWith('.fork-gal-stage[data-theme="magical"]')).body.match(/--gal-ui-ornament-halo:([^;]+);/)[1]
  assert.equal((halo.match(/(?:^|,)\s*0 0 0 /g) || []).length, 1, 'magical halo is one rim: ' + halo)
})

// private fork (owner 2026-10): the dialogue textbox has one frame in every built-in theme - no stitched frame inside the
// magical plate, no second gold line inside the gothic edge, and a pack skin's border is not doubled by the classic
// plate's top highlight.
test('stage textbox draws a single frame', () => {
  const parsed = rules(css).filter(rule => !rule.selector.startsWith('@'))
  const body = selector => parsed.filter(rule => rule.selector === selector).map(rule => rule.body.replace(/\/\*[\s\S]*?\*\//g, '')).join(';')
  assert.equal(parsed.filter(rule => rule.selector === '.fork-gal-stage[data-theme="magical"] .fork-gal-box::after').length, 0, 'no magical inner stitch')
  const plate = parsed.find(rule => rule.selector === '.fork-gal-box' && rule.body.includes('--gal-box-violet'))
  const gothic = /(?:^|;)\s*box-shadow:([^;]+)/.exec(plate.body.replace(/\/\*[\s\S]*?\*\//g, ''))[1]
  assert.equal((gothic.match(/inset 0 0 0 \d/g) || []).length, 1, 'gothic keeps one edge line: ' + gothic)
  assert.match(body('.fork-gal-stage[data-theme][data-fk-skin]:not(.is-film) .fork-gal-box::before'), /content:\s*none/)
})

test('stage history reading: one token-only block; the scene hold stays mounted to fade and covers at once', () => {
  const open = '/* ==== stage history reading ==== */', close = '/* ==== end stage history reading ==== */'
  assert.equal(css.split(open).length, 2)
  assert.equal(css.split(close).length, 2)
  const block = css.slice(css.indexOf(open) + open.length, css.indexOf(close))
  const parsed = rules(block).filter(rule => !rule.selector.startsWith('@'))
  for (const hook of ['.fork-gal-scene-hold', '.fork-gal-history-indicator', '.fork-gal-history-direction', '.fork-gal-generate-turn', '.fork-gal-history-direction-progress', '.fork-gal-history-direction-error', '.fork-gal-transition-label', '.fork-gal-transition'])
    assert.ok(parsed.some(rule => rule.selector.includes(hook)), hook + ' is styled here')
  for (const rule of parsed) {
    assert.doesNotMatch([...rule.parents, rule.selector].join(' '), /\[\s*data-theme\b/i, rule.selector)
    // Mask art (url(...)) only supplies alpha; everything painted comes from --gal-ui-* tokens. Geometry may follow the
    // box's own layout variables (the transition tab sits on the text column).
    const paint = rule.body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/url\("[^"]*"\)/g, 'url()')
      .replace(/(?:^|;)\s*(?:left|right|top|bottom|width|height|padding(?:-\w+)?|margin(?:-\w+)?)\s*:[^;]*/g, ';')
    assert.doesNotMatch(paint, untokenised, rule.selector + ' uses only --gal-ui-* colours')
  }
  const hold = rulesFor(block, /^\.fork-gal-scene-hold$/).map(rule => rule.body).join(';')
  assert.match(hold, /var\(--gal-ui-hold\)/)
  assert.match(hold, /transition:\s*opacity/)
  assert.ok(rulesFor(block, /^\.fork-gal-scene-hold:not\(\.is-resolved\)$/).some(rule => /transition:\s*none/.test(rule.body)), 'the hold covers without a fade-in')
  assert.ok(rulesFor(block, /^\.fork-gal-scene-hold\.is-resolved$/).some(rule => /opacity:\s*0/.test(rule.body)))
  assert.match(block, /@media \(prefers-reduced-motion: reduce\) and \(update: none\)[^{]*\{[^}]*\.fork-gal-scene-hold \{ transition: none/)
  // The hold token is the renderer's clear colour, so the hand-over to an empty canvas has no step.
  const clear = /backgroundColor:\s*0x([\da-f]{6})/i.exec(scene)
  assert.ok(clear, 'the scene renderer declares its clear colour')
  assert.match(css, new RegExp('--gal-ui-hold:\\s*#' + clear[1] + ';', 'i'))
})

test('stage token lint recognises nested, grouped, multiline and single-quoted selectors', () => {
  const fixture = `/* .fork-gal-backlog[data-theme=x] {} */
    @media (max-width: 640px) {
      .fork-gal-stage[data-theme='classic']
        .fork-gal-backlog-close, .other { content: "{ not a block }"; }
    }
    .fork-gal-stage[data-theme="magical"] { & .fork-gal-mixer-slider { color: pink; } }
    @supports (display: grid) { .fork-gal-config-tab[data-theme] { color: red; } }
    .fork-gal-backlog-title { content: "[data-theme]"; }`
  assert.equal(themeViolations(fixture).length, 3)
  assert.equal(themeViolations('.fork-gal-stage[data-theme="classic"] .fork-gal-choice-send { color: red; } .fork-gal-stage[data-theme=magical] .fork-gal-choice.is-editing textarea { color: red; } .fork-gal-stage .fork-gal-choice.is-free { color: red; }').length, 2)
  assert.deepEqual(themeViolations('.fork-gal-stage[data-theme="gothic"] { --gal-ui-gem: none; }'), [])
})

// private fork: local face layering must not promote the portrait above stage overlays.
test('stage face paints over textbox glass and border but stays below stage overlays', async () => {
  const zIndex = selector => {
    const values = rules(css).filter(rule => rule.selector === selector)
      .flatMap(rule => [...rule.body.matchAll(/(?:^|;)\s*z-index:\s*(-?\d+)/g)].map(match => Number(match[1])))
    assert.ok(values.length, selector + ' has an explicit stacking level')
    return values.at(-1)
  }
  assert.ok(zIndex('.fork-gal-stage[data-theme] .fork-gal-side') > 0,
    'face paints after the textbox background, backdrop filter and auto-layer border ornaments')
  const box = zIndex('.fork-gal-box')
  for (const overlay of ['choices', 'topbar', 'notices', 'backlog', 'config', 'menu']) {
    assert.ok(zIndex('.fork-gal-' + overlay) > box, overlay + ' stays above the entire textbox context')
  }
  const stage = await readFile(new URL('../tavern-plugin/src/client/fork-gal-stage.js', import.meta.url), 'utf8')
  assert.match(stage, /h\("div", \{ className: "fork-gal-box"[^\n]*\n\s*activeSkin \? h\(ForkStageSkinFrame,\{skin:activeSkin\}\) : h\(ForkGalBoxFrame\),\s*\/\/[^\n]*\n\s*faceMode !== "off" \? h\(ForkGalSide,/,
    'face remains inside the textbox stacking context, after its frame')
})

// private fork: crt r2 (owner 2026-10: "画面整体的曲度感 / 扫描线"). The tube is one static glass over the whole stage,
// not a per-panel theme branch: it sits above every stage overlay, never takes input, uses no filter or blend mode, and
// a pack skin turns it off. Its only motion, the rolling band, moves by transform and stops under CONFIG 「减少动态」.
test('crt tube glass: one static stage overlay above every stage layer; the rolling band honours reduced motion', () => {
  const parsed = rules(css).filter(rule => !rule.selector.startsWith('@'))
  const one = selector => { const found = parsed.filter(rule => rule.selector === selector); assert.equal(found.length, 1, selector); return found[0].body.replace(/\/\*[\s\S]*?\*\//g, '') }
  const glass = one('.fork-gal-stage[data-theme="crt"]:not([data-fk-skin])::after')
  for (const pattern of [/content:\s*""/, /position:\s*absolute/, /inset:\s*0/, /pointer-events:\s*none/]) assert.match(glass, pattern)
  assert.doesNotMatch(glass, /(?:^|;)\s*(?:filter|backdrop-filter|-webkit-backdrop-filter|mix-blend-mode|animation|opacity)\s*:/, 'static paint only')
  const level = body => Number(/(?:^|;)\s*z-index:\s*(\d+)/.exec(body)[1])
  const top = Math.max(...['.fork-gal-box', '.fork-gal-choices', '.fork-gal-topbar', '.fork-gal-notices', '.fork-gal-backlog', '.fork-gal-config', '.fork-gal-menu', '.fork-gal-title', '.fork-cg-gallery']
    .map(selector => Math.max(...parsed.filter(rule => rule.selector === selector).map(rule => /z-index:\s*(\d+)/.exec(rule.body)).filter(Boolean).map(match => Number(match[1])))))
  assert.ok(level(glass) > top, 'the glass covers every stage overlay (' + top + ')')
  const band = one('.fork-gal-stage[data-theme="crt"]:not([data-fk-skin])::before')
  assert.match(band, /pointer-events:\s*none/)
  assert.ok(level(band) > top && level(band) < level(glass), 'the band runs under the glass, over the overlays')
  const roll = /@keyframes fork-gal-crt-roll \{([\s\S]*?\})\s*\}/.exec(css)
  assert.ok(roll, 'roll keyframes')
  assert.deepEqual([...new Set([...roll[1].matchAll(/([\w-]+)\s*:/g)].map(match => match[1]))].sort(), ['animation-timing-function', 'transform'], 'the band only moves')
  assert.match(one('.fork-gal-stage[data-theme="crt"][data-reduced-motion]::before'), /display:\s*none/)
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) and \(update: none\) \{ \.fork-gal-stage\[data-theme="crt"\]::before \{ display: none;/)
})
// private fork: 千禧晴空 aero (owner 2026-10: "为什么有大量蓝色球呢？没必要吧"). No orb markers anywhere: gems collapse
// (titles stand alone; an active tab / menu row is its fill and accent bar), the next cue is a small triangle, the name pill
// has no bead, the text box no bubble cluster and no surface a mini bubble-pair ornament. The soap bubbles stay in the scene layer only.
test('aero: no orb markers - gems collapse, the next cue is a triangle, no name bead, bubble cluster or mini ornament', () => {
  const tokens = css.slice(css.indexOf(open), css.indexOf(close))
  const block = rules(tokens).find(rule => rule.selector.startsWith('.fork-gal-stage[data-theme="aero"]'))
  assert.ok(block, 'aero token block')
  const value = name => new RegExp('(?:^|;)\\s*' + name + ':\\s*([^;]+);').exec(block.body.replace(/\/\*[\s\S]*?\*\//g, ''))?.[1].trim()
  assert.deepEqual([value('--gal-ui-gem-display'), value('--gal-ui-gem-width'), value('--gal-ui-gem-height'), value('--gal-ui-gem-fill')], ['none', '0px', '0px', 'none'])
  for (const name of ['--gal-ui-ornament-mini', '--gal-ui-ornament-mini-size', '--gal-ui-ornament-accent']) assert.equal(value(name), undefined, 'aero leaves ' + name + ' at its default (no bubble pair)')
  assert.match(value('--gal-ui-next'), /^polygon\(/)
  for (const name of ['--gal-ui-gem', '--gal-ui-next', '--gal-ui-next-fill']) assert.doesNotMatch(value(name), /circle|radial-gradient|ellipse/, name)
  const parsed = rules(css).filter(rule => !rule.selector.startsWith('@'))
  const aero = parsed.filter(rule => /data-theme="aero"/.test([...rule.parents, rule.selector].join(' ')))
  const named = part => aero.filter(rule => rule.selector.includes(part)).map(rule => rule.body.replace(/\/\*[\s\S]*?\*\//g, '').trim())
  assert.deepEqual(named('.fork-gal-name-gem'), ['display: none;'], 'no bead in the name pill')
  assert.ok(aero.some(rule => /\.fork-gal-frame :is\([^)]*\.bow/.test(rule.selector) && /display:\s*none/.test(rule.body)), 'no bubble cluster on the box')
  assert.equal(named('.fork-gal-next::before').length, 0, 'the next cue draws no orb of its own')
  assert.doesNotMatch(aero.map(rule => rule.body).join('\n'), /border-radius:\s*50%/, 'no round marker painted in the aero rules')
})
