import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../tavern-plugin/src/client/ui/message-frame.js', import.meta.url), 'utf8')
const code = source.slice(source.indexOf('function nativeFullscreenElement('), source.indexOf('function TavernImmersiveAction('))
const install = new Function(code + ';return installTavernImmersiveMode')()

function htmlList() {
  const classes = new Set()
  return {
    classes,
    classList: {
      add: k => classes.add(k),
      remove: k => classes.delete(k),
      contains: k => classes.has(k),
      toggle(k, on) { if (on) classes.add(k); else classes.delete(k) }
    }
  }
}

test('延迟全屏请求不能在退出或卸载后恢复沉浸状态', async () => {
  for (const action of ['leave', 'dispose']) {
    const html = htmlList(), doc = { documentElement: html }
    let complete, exits = 0
    html.requestFullscreen = () => new Promise(resolve => { complete = () => { doc.fullscreenElement = html; resolve() } })
    doc.exitFullscreen = async () => { exits++; doc.fullscreenElement = null }
    const controller = install({ closest: () => ({ ownerDocument: doc }), focus() {} })
    controller.enter(); controller[action](); complete()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(html.classes.has('dsh-tavern-play-fullscreen'), false)
    assert.ok(doc.fullscreenElement === null)
    assert.equal(exits, 1)
  }
})
