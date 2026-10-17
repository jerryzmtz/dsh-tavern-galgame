import assert from 'node:assert/strict'
import {writeFile,readFile} from 'node:fs/promises'
import {join} from 'node:path'
export async function backgroundLifecycleChecks({page,step,savedChat,data,output,report,restartServer}) {
  const control=value=>writeFile(join(output,'background-control.json'),JSON.stringify(value))
  async function wait(check) {for(let i=0;i<200;i++){if(await check())return;await new Promise(r=>setTimeout(r,100))}throw Error('background lifecycle condition timed out')}
  const audit = async file => (await readFile(join(output,file),'utf8').catch(()=>'' )).trim().split('\n').filter(Boolean).map(JSON.parse)
  async function retry() {
    await page.getByRole('button',{name:'重试变量结算',exact:true}).click()
    await page.getByPlaceholder('例如：这轮还没有交付物品，不要扣除库存。').fill('E2E 修正金币为四十')
    await page.getByRole('button',{name:'重新结算',exact:true}).click()
  }
  async function stopAttempt(attempt) {
    await wait(async()=> (await audit('background-attempts.jsonl')).some(row=>row.attempt===attempt))
    const id=(await savedChat()).timeline.participants.background.sessionId
    await page.getByRole('button',{name:'更多 ▾',exact:true}).click()
    await page.getByRole('menuitem',{name:'停止后台',exact:true}).click()
    await control({mode:'pass'})
    await wait(async()=>!!JSON.parse(await readFile(join(data,'background-session-retirement.json'),'utf8').catch(()=>'{}'))[id])
    await wait(async()=> (await audit('background-late.jsonl')).some(row=>row.attempt===attempt && row.tool==='mvu_submit_update'))
    await page.getByRole('button',{name:'重试变量结算',exact:true}).waitFor()
    assert.equal((await savedChat()).messages.at(-1).variables[0].stat_data.gold,10)
    return id
  }
  await step('后台结算取消与迟到返回不改写变量',async()=>{
    await control({mode:'hold',attempt:1})
    const receipt=page.locator('.dsh-tavern-mvu-receipt[data-status="updated"]').filter({visible:true}).last()
    await receipt.locator('summary').click()
    await receipt.getByRole('button',{name:'重新结算变量',exact:true}).click()
    await page.getByPlaceholder('例如：这轮还没有交付物品，不要扣除库存。').fill('E2E 修正金币为四十')
    await page.getByRole('button',{name:'重新结算',exact:true}).click()
    report.retiredSession=await stopAttempt(1)
    await writeFile(join(output,'background-ui.txt'),await page.locator('body').innerText())
    await page.screenshot({path:join(output,'background-stopped.png'),fullPage:true})
  })
  await step('连续重试并再次取消，不复用已退休会话',async()=>{
    await control({mode:'hold',attempt:2})
    await retry()
    report.secondRetiredSession=await stopAttempt(2)
    assert.notEqual(report.secondRetiredSession,report.retiredSession)
  })
  await step('不刷新页面重试结算，换新会话并真实落盘',async()=>{
    await retry()
    await wait(async()=> (await savedChat()).messages.at(-1).variables[0].stat_data.gold===40)
    const chat=await savedChat();report.currentBackground=chat.timeline.participants.background.sessionId
    assert.notEqual(report.currentBackground,report.retiredSession)
    assert.notEqual(report.currentBackground,report.secondRetiredSession)
    await page.getByText('酒馆状态',{exact:true}).filter({visible:true}).first().click()
    await page.frameLocator('.dsh-tavern-status-runtime iframe:not([aria-hidden="true"])').locator('#e2e-gold').filter({hasText:/^金币：40$/}).waitFor()
    await page.screenshot({path:join(output,'background-retried.png'),fullPage:true})
    await writeFile(join(output,'background-ui-retried.txt'),await page.locator('body').innerText())
    const trigger=page.getByText(/^\d+ subagents?$/).filter({visible:true}).first()
    await trigger.click()
    await page.getByText('酒馆后台 Agent',{exact:true}).filter({visible:true}).first().waitFor()
    await page.screenshot({path:join(output,'background-catalog.png'),fullPage:true})
    await writeFile(join(output,'background-catalog.txt'),await page.locator('body').innerText())
    assert.equal(await page.getByText('酒馆后台 Agent',{exact:true}).filter({visible:true}).count(),1)
    assert.equal(await trigger.innerText(),'1 subagent','目录和标题计数必须一致')
  })
  await step('服务重启后目录与结算结果仍保留',async()=>{
    await restartServer()
    assert.equal((await savedChat()).messages.at(-1).variables[0].stat_data.gold,40)
    await page.getByText(/^1 subagent$/).filter({visible:true}).first().waitFor()
  })
}
