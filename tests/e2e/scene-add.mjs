import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { deflateSync, crc32 } from 'node:zlib'

// A small valid RGB PNG; the host's attachment service rejects degenerate images.
function solidPng(size, rgb) {
  const chunk = (type, data) => {
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data]), crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body))
    return Buffer.concat([length, body, crc])
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 2
  const row = Buffer.concat([Buffer.from([0]), Buffer.concat(Array.from({ length: size }, () => Buffer.from(rgb)))])
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: size }, () => row)))), chunk('IEND', Buffer.alloc(0))]).toString('base64')
}
// A local OpenAI-compatible image endpoint: the only substituted image boundary.
const png = solidPng(64, [200, 150, 60])
export async function startSceneImageServer() {
  const prompts = []
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', chunk => { body += chunk })
    request.on('end', () => {
      try { prompts.push(JSON.parse(body).prompt) } catch { prompts.push('') }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ data: [{ b64_json: png }] }))
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { baseURL: 'http://127.0.0.1:' + server.address().port + '/v1', prompts, close: () => new Promise(resolve => server.close(resolve)) }
}

async function until(check) { for (let n = 0; n < 600; n++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 100)) } throw new Error('condition timeout') }

export async function sceneAddChecks({ page, step, output, report, images, savedChat }) {
  async function rpc(method, args) {
    return page.evaluate(async ({ method, args }) => {
      const response = await fetch('/api/dsh-tavern/' + method, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) })
      const value = await response.json()
      if (value && value.ok === false) throw new Error(value.error || method + ' failed')
      return value
    }, { method, args })
  }
  const pictures = page.locator('.dsh-tavern-illustration img')
  await step('玩一轮后开启场景生图', async () => {
    const composer = page.getByRole('textbox', { name: /发消息|Message/ })
    await composer.fill('领取任务奖励')
    await composer.press('Enter')
    await page.getByText('你获得了十枚金币。', { exact: false }).filter({ visible: true }).first().waitFor()
    // Pictures are refused while the reply is still finishing; wait for settlement.
    await page.getByText(/变量已更新/).filter({ visible: true }).first().waitFor()
    await rpc('saveSceneImageSettings', { provider: 'openai', baseURL: images.baseURL, model: 'e2e-image', size: '1024x1024', apiKey: 'e2e-image-key' })
    await rpc('saveSceneImageSettings', { provider: 'openai', enabled: true })
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('dsh-tavern-image-settings-changed')))
  })
  await step('生成本轮第一张插图', async () => {
    await page.getByRole('button', { name: '为这一轮生成插图' }).last().click()
    await pictures.first().waitFor()
    assert.equal(await pictures.count(), 1)
  })
  await step('新增插图：填写描述，另选场景，两张并存', async () => {
    await page.getByRole('button', { name: '新增插图', exact: true }).last().click()
    await page.getByRole('textbox', { name: '新插图想画什么（选填）' }).fill('画柜台上的金币')
    await page.getByRole('region', { name: '新增插图' }).getByRole('button', { name: '新增插图' }).click()
    await page.waitForFunction(() => document.querySelectorAll('.dsh-tavern-illustration img').length === 2, null, { timeout: 60000 })
    const audit = (await readFile(join(output, 'scene-requests.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse)
    assert.deepEqual(audit, [{ addition: false, request: false }, { addition: true, request: true }], '新增插图的规划请求带上已有插图与用户描述')
    assert.equal(images.prompts.length, 2)
    assert.match(images.prompts[1], /gold coins on a wooden counter/)
    // Every picture of the turn offers adding another, not only the first.
    await page.locator('.dsh-tavern-illustration').nth(1).getByRole('button', { name: '新增插图', exact: true }).waitFor()
    await page.screenshot({ path: join(output, 'scene-add.png'), fullPage: true })
  })
  await step('改提示词：自己写的提示词原样发给生图渠道', async () => {
    await page.locator('.dsh-tavern-illustration').first().getByRole('button', { name: '改提示词' }).click()
    const box = page.getByRole('textbox', { name: '画面提示词' })
    assert.match(await box.inputValue(), /tavern counter/)
    // A long hand-written Chinese prompt (~18 KB) once hit a 16 KB request limit.
    await box.fill('一位旅人在烛光下数金币，油画质感' + '，细节丰富'.repeat(1200))
    await page.getByRole('button', { name: '用这段重画' }).click()
    await until(() => images.prompts.length === 3)
    assert.match(images.prompts[2], /^一位旅人在烛光下数金币，油画质感/)
    await page.locator('.dsh-tavern-illustration').first().getByText('2 / 2').waitFor()
  })
  await step('画廊与导出都包含新增的插图', async () => {
    await page.getByRole('tab', { name: '画廊' }).or(page.getByText('画廊', { exact: true })).first().click()
    await page.locator('.dsh-tavern-gallery-shot img').nth(2).waitFor()
    assert.equal(await page.locator('.dsh-tavern-gallery-turn').count(), 1, '同一轮的插图在画廊同一行')
    assert.equal(await page.locator('.dsh-tavern-gallery-shot').count(), 3, '画廊并列本轮全部插图，包括重画的版本')
    await page.screenshot({ path: join(output, 'scene-add-gallery.png'), fullPage: true })
    await page.getByRole('tab', { name: 'Chat' }).or(page.getByText('Chat', { exact: true })).first().click()
    const { id: chatId } = await savedChat()
    const exported = await rpc('exportConversation', { chatId })
    const zip = Buffer.from(exported.base64 || '', 'base64').toString('latin1')
    assert.equal(exported.images, 2, '导出带上两张插图（每张取当前版本）')
    assert.ok(zip.includes('images/001.png') && zip.includes('images/001-2.png'))
  })
  await step('刷新后两张插图保留，删除新增的一张不影响第一张', async () => {
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => document.querySelectorAll('.dsh-tavern-illustration img').length === 2, null, { timeout: 60000 })
    page.once('dialog', dialog => dialog.accept())
    await page.locator('.dsh-tavern-illustration').nth(1).getByRole('button', { name: '删除图片' }).click()
    const confirm = page.getByRole('button', { name: /^(确定|确认|删除)$/ }).filter({ visible: true })
    if (await confirm.count()) await confirm.first().click()
    await page.waitForFunction(() => document.querySelectorAll('.dsh-tavern-illustration img').length === 1, null, { timeout: 30000 })
    assert.equal(images.prompts.length, 3, '删除不会请求图片')
    report.sceneAdd = { prompts: images.prompts.length }
  })
  await step('每轮自动生图：打开后新一轮结算完自动画一张，只画一次', async () => {
    const before = images.prompts.length
    const pictures = await page.locator('.dsh-tavern-illustration img').count()
    await rpc('saveSceneImageSettings', { provider: 'openai', auto: true })
    const composer = page.getByRole('textbox', { name: /发消息|Message/ })
    await composer.fill('再次领取奖励')
    await composer.press('Enter')
    await page.getByText('你再次领取了奖励，金币累计二十枚。', { exact: true }).filter({ visible: true }).first().waitFor()
    await page.waitForFunction(count => document.querySelectorAll('.dsh-tavern-illustration img').length > count, pictures, { timeout: 60000 })
    await new Promise(resolve => setTimeout(resolve, 3000))
    assert.equal(images.prompts.length, before + 1, '自动生图每轮只请求一次')
    await page.screenshot({ path: join(output, 'scene-auto.png'), fullPage: true })
    await rpc('saveSceneImageSettings', { provider: 'openai', auto: false })
  })
}
