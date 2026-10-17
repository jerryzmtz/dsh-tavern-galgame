import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// Runs inside the card's shared Tavern Helper sandbox. Every call goes through
// the real bridge and host; only the model output is fixed by tests/e2e/model.mjs.
export const helperApiScript = String.raw`(async () => {
  const out = {}, events = []
  const run = async (name, fn) => { try { out[name] = { ok: true, value: await fn() } } catch (error) { out[name] = { ok: false, name: error && error.name, error: String(error && error.message || error) } } }
  const ev = window.iframe_events || {}
  eventOn(ev.GENERATION_STARTED || 'js_generation_started', id => events.push('start:' + id))
  eventOn(ev.GENERATION_ENDED || 'js_generation_ended', (_text, id) => events.push('end:' + id))
  await run('worldbookNames', () => getCharWorldbookNames('current'))
  await run('findentry', () => triggerSlash('/findentry file=current field=comment 金币规则'))
  await run('pass', () => triggerSlash('/pass E2E管道'))
  await run('generateRaw', () => generateRaw({ ordered_prompts: [{ role: 'user', content: 'E2E_HELPER_RAW' }], generation_id: 'e2e-raw' }))
  await run('generate', () => generate({ user_input: 'E2E_HELPER_GENERATE', generation_id: 'e2e-gen' }))
  await run('concurrent', () => Promise.all([
    generateRaw({ ordered_prompts: [{ role: 'user', content: 'E2E_A' }], generation_id: 'e2e-a' }),
    generateRaw({ ordered_prompts: [{ role: 'user', content: 'E2E_B' }], generation_id: 'e2e-b' })]))
  await run('cancel', async () => {
    // Observe the generation before stopping it: cancellation rejects it at once.
    const settled = generate({ user_input: 'E2E_HELPER_CANCEL', generation_id: 'e2e-cancel' })
      .then(() => ({ settled: 'resolved' }), error => ({ settled: 'rejected', name: error.name }))
    const stopped = await stopGenerationById('e2e-cancel')
    return { stopped, ...(await settled) }
  })
  await run('reuseId', () => generateRaw({ ordered_prompts: [{ role: 'user', content: 'E2E_REUSE' }], generation_id: 'e2e-cancel' }))
  await run('variables', async () => {
    await insertOrAssignVariables({ e2e_temp: 1 }, { type: 'chat' })
    const deleted = await deleteVariable('e2e_temp', { type: 'chat' })
    return { deleted: deleted && deleted.delete_occurred, left: Object.prototype.hasOwnProperty.call(getVariables({ type: 'chat' }), 'e2e_temp') }
  })
  await run('regex', () => formatAsTavernRegexedString('<StatusPlaceHolderImpl/>', 'ai_output', 'display'))
  await run('macros', () => substitudeMacros('{{char}}|{{user}}'))
  out.events = events
  window.__e2eHelperRuns = (window.__e2eHelperRuns || 0) + 1
  window.__e2eHelper = out
})()`

async function helperFrameResult(page) {
  for (let attempt = 0; attempt < 120; attempt++) {
    for (const frame of page.frames()) {
      const value = await frame.evaluate(() => window.__e2eHelper ? { result: window.__e2eHelper, runs: window.__e2eHelperRuns } : null).catch(() => null)
      if (value) return value
    }
    await page.waitForTimeout(500)
  }
  throw new Error('卡片脚本没有在 60 秒内完成接口调用')
}

function check(result) {
  for (const [name, item] of Object.entries(result)) if (name !== 'events') assert.equal(item.ok, true, name + ' 调用失败：' + (item.error || ''))
  assert.equal(result.worldbookNames.value.primary, '验收初始变量', '世界书名称')
  assert.match(String(result.findentry.value), /^\d+$/, '/findentry 返回条目 UID')
  assert.equal(result.pass.value, 'E2E管道', '/pass 返回原文')
  for (const name of ['generateRaw', 'generate', 'reuseId']) assert.ok(String(result[name].value).trim().length > 0, name + ' 返回文本')
  assert.equal(result.concurrent.value.length, 2)
  assert.ok(result.concurrent.value.every(text => String(text).trim()), '并发生成都返回文本')
  assert.equal(result.cancel.value.settled, 'rejected', '取消后 Promise 被拒绝')
  assert.equal(result.cancel.value.name, 'AbortError')
  assert.equal(result.cancel.value.stopped, true)
  assert.deepEqual(result.variables.value, { deleted: true, left: false }, '变量删除生效')
  assert.match(String(result.regex.value), /e2e-gold/, '正则格式化套用卡内显示规则')
  assert.equal(result.macros.value.split('|')[0], 'E2E 奖励验收', '宏替换角色名')
  for (const id of ['e2e-raw', 'e2e-gen', 'e2e-a', 'e2e-b', 'e2e-cancel']) {
    assert.ok(result.events.includes('start:' + id), id + ' 发出开始事件')
    assert.ok(result.events.includes('end:' + id), id + ' 发出结束事件')
  }
}

export async function helperApiChecks({ page, step, savedChat, output, report }) {
  let before
  await step('卡片脚本经真实桥接调用新增接口', async () => {
    before = await savedChat()
    const { result, runs } = await helperFrameResult(page)
    report.helperApi = result
    await writeFile(join(output, 'helper-api.json'), JSON.stringify(result, null, 2))
    assert.equal(runs, 1, '脚本只运行一次')
    check(result)
  })
  await step('脚本生成不改动剧情存档', async () => {
    const after = await savedChat()
    assert.equal(after.messages.length, before.messages.length, '生成调用不新增楼层')
    assert.deepEqual(after.messages.map(message => message.content || message.mes), before.messages.map(message => message.content || message.mes))
  })
  await step('刷新后脚本重新运行，结果一致', async () => {
    await page.reload({ waitUntil: 'domcontentloaded' })
    const { result, runs } = await helperFrameResult(page)
    assert.equal(runs, 1, '刷新后不残留旧运行')
    check(result)
    assert.equal((await savedChat()).messages.length, before.messages.length)
  })
}
