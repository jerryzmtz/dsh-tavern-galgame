import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
const read = p => readFile(new URL('../tavern-plugin/src/client/' + p, import.meta.url), 'utf8')
const widgets = await read('fork-gal-widgets.js')
const source = await read('fork-gal-scene.js')
// private fork: exercise the sole production allocator, not the retired scale/chip fallback.
const ctx = vm.createContext({})
vm.runInContext(await read('fork-widget-source.cjs') + '\n' + source.slice(source.indexOf('function forkGalFigureRects('), source.indexOf('// ---------- Scene helpers')) + '\nthis.api={forkWidgetSourcePlace,forkGalFigureRects};', ctx)
const { forkWidgetSourcePlace: place } = ctx.api
const overlap=(a,b)=>Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y))
const inflate=(r,n)=>({x:r.x-n,y:r.y-n,width:r.width+n*2,height:r.height+n*2})
const figure = (x, width = 270) => ({ body: { x, y: 105, width, height: 630 }, head: { x: x + width / 2 - 65, y: 105, width: 130, height: 140 } })
const base = { width: 1280, height: 800, size: { width: 280, height: 170 }, anchor: 'top-center', blocked: [{ x: 0, y: 0, width: 1280, height: 52 }, { x: 0, y: 610, width: 1280, height: 190 }] }
function legal(result, input) {
  assert.ok(result)
  for (const r of input.blocked) assert.equal(overlap(result, r), 0)
  for (const f of input.figures) {
    assert.equal(overlap(result, inflate(f.head, 24)), 0)
    assert.equal(overlap(result, inflate(f.body, 18)), 0)
  }
}
test('placement: a preferred top-centre slot never covers a single centre figure', () => {
  const input = { ...base, figures: [figure(505)] }, result = place(input)
  legal(result, input); assert.notEqual(result.x, 500); assert.deepEqual(place(input), result)
})
test('placement: three figures use a free edge at the requested readable size', () => {
  const input = { ...base, size:{width:100,height:100}, figures: [figure(140), figure(505), figure(870)] }
  legal(place(input), input)
})
test('placement: film bars, toolbar and dialogue remain forbidden', () => {
  const input = { ...base, figures: [figure(505)], blocked: [...base.blocked, { x: 0, y: 0, width: 1280, height: 110 }, { x: 0, y: 690, width: 1280, height: 110 }] }
  legal(place(input), input)
})
test('placement: narrow window rejects unreadable shrink or chip fallback', () => {
  const input = { ...base, width: 390, figures: [figure(45, 300)], blocked: [{ x: 0, y: 0, width: 390, height: 52 }, { x: 0, y: 610, width: 390, height: 190 }] }
  assert.equal(place(input), null)
})
test('placement: nothing fits returns null, including a viewport entirely occupied by heads', () => {
  const input = { ...base, figures: [figure(0, 1280)] }
  assert.equal(place(input), null)
  const occluded = place({ ...base, figures: [{ body: { x: 0, y: 0, width: 1280, height: 800 }, head: { x: 0, y: 0, width: 1280, height: 800 } }] })
  assert.equal(occluded, null)
})
test('placement hysteresis keeps a safe rest position despite a changed preference and small movement', () => {
  const input = { ...base, figures: [figure(505)] }, previous = place(input)
  const result = place({ ...input, figures: [figure(508)], anchor: 'corner-right', previous })
  assert.equal(result.x, previous.x); assert.equal(result.y, previous.y)
  const blocked = place({ ...input, blocked: [...base.blocked, previous], previous })
  assert.equal(overlap(blocked, previous), 0)
})
test('scene rectangles are pure, transformed rest bounds including headroom and camera rotation', () => {
  const figures = [{ id: 'A', visible: true, body: { x: 100, y: 100, width: 200, height: 500 }, head: { x: 200, top: 100, chin: 200, width: 100 }, shift: 20 }]
  const before = JSON.stringify(figures), camera = { zoom: 1, fx: .5, fy: .5, ax: .5, ay: .5, rotation: 0 }
  const [result] = ctx.api.forkGalFigureRects(figures, camera, 1000, 800)
  assert.equal(result.body.y, 120); assert.equal(result.head.x, 150)
  result.body.x = -1; assert.equal(JSON.stringify(figures), before)
  const [rotated] = ctx.api.forkGalFigureRects(figures, { ...camera, rotation: Math.PI / 2 }, 1000, 800)
  assert.ok(Math.abs(rotated.body.width - 500) < .001)
})
// private fork: preferences are in the reading context, never sessionStorage or turn keys.
test('host preferences and single-instance keys are independent of page, order and lease',async()=>{
 const owner=await read('fork-widget-source.js')
 assert.doesNotMatch(widgets,/sessionStorage|forkWidgetVisit|forkWidgetReader|forkWidgetPlacement|forkWidgetOverlap|forkWidgetInflate|forkWidgetTitle/)
 assert.ok(owner.includes("identity:props.sessionId+':'+(props.source?.authorityEpoch || 0)+':'+(props.source?.branchId || '')+':'+key+':'+value.definition.contentIdentity"))
 assert.match(owner,/forkReduceWidgetPresentation/)
})
test('stage has one unified mount and a toolbar entry even when all panels are hidden',async()=>{
 const stage=await read('fork-gal-stage.js')
 assert.match(stage,/h\(ForkGalWidgets,\{owner:sourceWidget/)
 assert.match(stage,/h\(ForkWidgetMenu,\{owner:sourceWidget/)
 assert.doesNotMatch(stage,/ForkSourceWidget|sourceWidget.notice/)
})
