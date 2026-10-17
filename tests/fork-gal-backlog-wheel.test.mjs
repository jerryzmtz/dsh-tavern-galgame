// private fork: actual backlog wheel handler; normal scrolling is never prevented or forwarded.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
const source=readFileSync(new URL('../tavern-plugin/src/client/fork-gal-backlog.js',import.meta.url),'utf8')
const handler=source.slice(source.indexOf('    function onWheel(event)'),source.indexOf('    const player =',source.indexOf('    function onWheel(event)')))
test('backlog scrolls normally and only a settled downward gesture at the bottom closes it',()=>{
  let now=1000,closed=0,stopped=0
  const box={scrollTop:100,clientHeight:400,scrollHeight:1000}
  const scope={Date:{now:()=>now},scroller:{current:box},movedAt:{current:0},openedAt:{current:0},props:{onClose(){closed++}}}
  vm.runInNewContext(handler,scope)
  const wheel=(deltaY,deltaMode=0)=>scope.onWheel({deltaY,deltaMode,stopPropagation(){stopped++},preventDefault(){assert.fail('must keep native scrolling')}})
  wheel(120);wheel(-120);assert.equal(closed,0,'inside the list both directions scroll')
  box.scrollTop=600;scope.movedAt.current=now
  wheel(120);assert.equal(closed,0,'momentum arriving at the end does not immediately close')
  now+=221;wheel(-120);assert.equal(closed,0)
  wheel(3,1);assert.equal(closed,1,'line-mode wheel closes at newest entry')
  wheel(0.5);assert.equal(closed,2,'small trackpad delta closes too')
  wheel(1,2);assert.equal(closed,3,'page-mode wheel closes')
  wheel(0);wheel(NaN);assert.equal(closed,3)
  assert.equal(stopped,9,'no event leaks through to stage paging')
})
