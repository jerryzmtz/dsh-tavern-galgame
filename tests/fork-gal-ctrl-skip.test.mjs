// private fork: the CG gallery shares the existing modal pause fence.
// private fork: holding Ctrl fast-forwards the galgame stage, like most galgames.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../tavern-plugin/src/client/fork-gal-stage.js', import.meta.url), 'utf8')
const hold = source.slice(source.indexOf('// Hold Ctrl to fast-forward'), source.indexOf('const para = current && current.para || 1;'))

test('skip is the latched control or a held Ctrl, sharing one fast-forward path', () => {
  assert.match(source, /const \[skipLatch, setSkipping\] = React\.useState\(false\)/)
  assert.match(source, /const skipping = skipLatch \|\| skipHeld;/)
  // The SKIP control toggles only the latch, but shows active while Ctrl is held.
  assert.match(source, /setSkipping\(!skipLatch\); \}, skipping, atEnd\)/)
  assert.doesNotMatch(source, /setSkipping\(!skipping\)/)
  // Both stop at the first unread page (behaviour covered in fork-gal-continuity).
  // private fork: an unread / end line stops a held Ctrl too, so the skip animation never loops over it.
  assert.match(source, /if \(!forkGalPageRead\(readState\.readThrough, nextPosition\(\)\)\) \{ stopSkip\(\); return; \}/)
  assert.match(source, /function stopSkip\(\) \{ setSkipping\(false\); setSkipHeld\(false\); \}/)
  assert.match(source, /if \(atEnd \|\| \(current && current\.pending\)\) \{ stopSkip\(\); return; \}/)
})

test('Ctrl arms after a short delay and releases on keyup', () => {
  assert.ok(hold.length > 0)
  // private fork (reading controls §2.2): any other key interrupts, which also stops a SKIP-control fast-forward.
  assert.match(hold, /event\.key !== "Control"\) \{ interrupt\(event\); return; \}/)
  assert.match(hold, /function interrupt\(event\) \{[^]*?cancel\(\);\s*if \(running\) setSkipping\(false\);/)
  // private fork: Ctrl does not arm at all when nothing can be skipped (no one-frame SKIP flash).
  assert.match(hold, /setTimeout\(\(\) => \{ timer = 0; if \(!skipPossibleRef\.current\) return; setAuto\(false\); setSkipHeld\(true\); \}, 160\)/)
  assert.match(hold, /function onUp\(event\) \{ if \(event\.key === "Control"\) cancel\(\); \}/)
  assert.match(hold, /event\.repeat \|\| timer \|\| event\.altKey \|\| event\.shiftKey \|\| event\.metaKey/)
})

test('Ctrl shortcuts, wheel zoom, clicks, focus loss and overlays never leave skip running', () => {
  for (const name of ['wheel', 'pointerdown']) assert.match(hold, new RegExp(`addEventListener\\("${name}", interrupt, true\\)`)) // private fork: also stops SKIP
  assert.match(hold, /addEventListener\("blur", cancel\)/)
  assert.match(hold, /visibilitychange/)
  assert.match(hold, /isContentEditable/)
  assert.match(hold, /const skipHoldBlocked = configOpen \|\| galleryOpen \|\| menuOpen \|\| backlog \|\| hidden;/)
  assert.match(hold, /if \(skipHoldBlocked\) \{ setSkipHeld\(false\); return; \}/)
  assert.match(hold, /return \(\) => \{\s*forkForeground\.clearTimeout\(timer\); setSkipHeld\(false\);/)
})
